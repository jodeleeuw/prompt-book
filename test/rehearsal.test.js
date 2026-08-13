import test from 'node:test';
import assert from 'node:assert/strict';
import { createRehearsal, runningOrder } from '../src/engine/rehearsal.js';
import { assignVoices, voicePool } from '../src/speech/voices.js';

const ME = 'me';

const script = [
  { id: 'a', characterId: 'other', text: 'One.' },
  { id: 'b', characterId: ME, text: 'Two.' },
  { id: 'c', characterId: 'other', text: 'Three.' },
];

/** A stand-in synthesiser whose utterances resolve only when told to. */
function fakeSpeaker() {
  const spoken = [];
  let pending = null;
  return {
    spoken,
    speak(line) {
      spoken.push(line.text);
      return new Promise((resolve) => {
        pending = resolve;
      });
    },
    cancel() {
      pending?.(); // a cancelled utterance resolves, as the real one does
      pending = null;
    },
    finish() {
      const resolve = pending;
      pending = null;
      resolve?.();
      return Promise.resolve(); // let the engine's await settle
    },
  };
}

function harness(lines = script) {
  const speaker = fakeSpeaker();
  const states = [];
  const engine = createRehearsal({
    lines,
    isUserLine: (line) => line.characterId === ME,
    speak: speaker.speak,
    cancel: speaker.cancel,
    onChange: (state) => states.push(state.status),
  });
  return { engine, speaker, states };
}

test('speaks other characters and waits on yours', async () => {
  const { engine, speaker } = harness();

  engine.begin();
  assert.equal(engine.state.status, 'speaking');
  assert.deepEqual(speaker.spoken, ['One.']);

  await speaker.finish();
  assert.equal(engine.state.status, 'awaiting', 'your line is not spoken for you');
  assert.equal(engine.state.line.text, 'Two.');
  assert.equal(engine.state.isMine, true);

  engine.advance();
  assert.equal(engine.state.status, 'speaking');
  assert.deepEqual(speaker.spoken, ['One.', 'Three.']);

  await speaker.finish();
  assert.equal(engine.state.status, 'done');
});

test('a run that is all your lines never speaks', async () => {
  const { engine, speaker } = harness([
    { id: 'a', characterId: ME, text: 'One.' },
    { id: 'b', characterId: ME, text: 'Two.' },
  ]);

  engine.begin();
  assert.equal(engine.state.status, 'awaiting');
  engine.advance();
  assert.equal(engine.state.status, 'awaiting');
  engine.advance();
  assert.equal(engine.state.status, 'done');
  assert.deepEqual(speaker.spoken, []);
});

test('pausing mid-utterance holds position, and the stale utterance cannot advance it', async () => {
  const { engine, speaker } = harness();

  engine.begin();
  engine.pause();
  assert.equal(engine.state.status, 'paused');
  assert.equal(engine.state.index, 0);

  // The synthesiser reports the cancelled utterance ended, late.
  await speaker.finish();
  await Promise.resolve();
  assert.equal(engine.state.status, 'paused', 'a stale utterance must not drag the run forward');
  assert.equal(engine.state.index, 0);

  engine.resume();
  assert.equal(engine.state.status, 'speaking');
  assert.deepEqual(speaker.spoken, ['One.', 'One.'], 'resuming re-speaks the interrupted line');
});

test('skipping a line being spoken cancels it and moves on', async () => {
  const { engine, speaker } = harness();

  engine.begin();
  engine.advance();
  assert.equal(engine.state.status, 'awaiting', 'skipped straight to your line');
  assert.equal(engine.state.index, 1);

  await speaker.finish();
  await Promise.resolve();
  assert.equal(engine.state.status, 'awaiting', 'the cancelled utterance changes nothing');
});

test('back steps to the previous line and stops at the start', async () => {
  const { engine, speaker } = harness();

  engine.begin();
  await speaker.finish();
  assert.equal(engine.state.index, 1);

  engine.back();
  assert.equal(engine.state.index, 0);
  engine.back();
  assert.equal(engine.state.index, 0, 'cannot reverse past the first line');
});

test('a failed utterance surfaces as an error the run can continue from', async () => {
  const failing = {
    speak: () => Promise.reject(new Error('Speech failed: synthesis-unavailable')),
    cancel() {},
  };
  const engine = createRehearsal({
    lines: script,
    isUserLine: (line) => line.characterId === ME,
    ...failing,
  });

  engine.begin();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(engine.state.status, 'error');
  assert.match(engine.state.error, /synthesis-unavailable/);
  assert.equal(engine.state.index, 0, 'the run holds where it broke');
});

test('stop resets to the top', async () => {
  const { engine, speaker } = harness();
  engine.begin();
  await speaker.finish();
  engine.stop();
  assert.equal(engine.state.status, 'idle');
  assert.equal(engine.state.index, 0);
});

test('runningOrder flattens scenes and carries the scene title', () => {
  const order = runningOrder([
    { id: 's1', title: 'One', lines: [{ id: 'l1', characterId: 'x', text: 'a' }] },
    { id: 's2', title: 'Two', lines: [{ id: 'l2', characterId: 'y', text: 'b' }] },
  ]);
  assert.deepEqual(
    order.map((l) => [l.sceneTitle, l.text]),
    [
      ['One', 'a'],
      ['Two', 'b'],
    ],
  );
});

// --- voice assignment -------------------------------------------------------

const voice = (name, lang, localService = true) => ({
  name,
  lang,
  localService,
  voiceURI: `uri:${name}`,
});

test('characters get distinct voices', () => {
  const voices = [voice('Alice', 'en-GB'), voice('Bob', 'en-US'), voice('Cara', 'en-AU')];
  const assignment = assignVoices([{ id: '1' }, { id: '2' }, { id: '3' }], voices);
  assert.equal(new Set(Object.values(assignment)).size, 3);
});

test('voices are shared round-robin when there are fewer than characters', () => {
  const voices = [voice('Alice', 'en-GB'), voice('Bob', 'en-US')];
  const assignment = assignVoices([{ id: '1' }, { id: '2' }, { id: '3' }], voices);
  assert.equal(assignment['1'], 'uri:Alice');
  assert.equal(assignment['2'], 'uri:Bob');
  assert.equal(assignment['3'], 'uri:Alice');
});

test('a saved voice is kept, but only while the device still has it', () => {
  const voices = [voice('Alice', 'en-GB'), voice('Bob', 'en-US')];
  const assignment = assignVoices(
    [
      { id: '1', voiceURI: 'uri:Bob' },
      { id: '2', voiceURI: 'uri:Vanished' },
    ],
    voices,
  );
  assert.equal(assignment['1'], 'uri:Bob');
  assert.equal(assignment['2'], 'uri:Alice', 'a missing voice is replaced, not left dangling');
});

test('the pool prefers the document language and local voices', () => {
  const voices = [voice('Remote', 'en-US', false), voice('Local', 'en-GB', true), voice('Marie', 'fr-FR')];
  assert.deepEqual(
    voicePool(voices, 'en').map((v) => v.name),
    ['Local', 'Remote'],
  );
});

test('the pool falls back to every voice when none match the language', () => {
  const voices = [voice('Marie', 'fr-FR'), voice('Hans', 'de-DE')];
  assert.equal(voicePool(voices, 'en').length, 2);
});

test('no voices at all yields no assignment rather than throwing', () => {
  assert.deepEqual(assignVoices([{ id: '1' }], []), { 1: null });
});

// --- voice names ------------------------------------------------------------

const { voiceLabel } = await import('../src/ui/setup-view.js');

test('voice names are trimmed to something that reads as a cast list', () => {
  assert.equal(voiceLabel({ name: 'Microsoft David - English (United States)' }), 'David');
  assert.equal(voiceLabel({ name: 'Google UK English Female' }), 'UK English Female');
  assert.equal(voiceLabel({ name: 'Daniel (Enhanced)' }), 'Daniel');
  assert.equal(voiceLabel({ name: 'Samantha' }), 'Samantha');
});

test('a name that trims to nothing keeps the original', () => {
  assert.equal(voiceLabel({ name: 'Google' }), 'Google');
});
