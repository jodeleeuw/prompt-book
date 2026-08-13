import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, createCueMatcher } from '../src/engine/match.js';
import { createCueing } from '../src/engine/cueing.js';

// --- normalisation ----------------------------------------------------------

test('normalisation makes script and recogniser output comparable', () => {
  assert.deepEqual(normalize("Don't — you *dare*!"), ['do', 'not', 'you', 'dare']);
  assert.deepEqual(normalize('do not you dare'), ['do', 'not', 'you', 'dare']);
  assert.deepEqual(normalize('I’ve got 21 of them'), ['i', 'have', 'got', 'twenty', 'one', 'of', 'them']);
  assert.deepEqual(normalize('I have got twenty one of them').join(' '), 'i have got twenty one of them');
});

// --- tail matching ----------------------------------------------------------

const matcher = (text) => createCueMatcher(text);

test('the cue is the last few words, not the whole line', () => {
  const cue = matcher('A little more than kin, and less than kind.');
  assert.deepEqual(cue.tail, ['less', 'than', 'kind']);
  assert.equal(cue.test('and less than kind'), true);
  assert.equal(cue.test('a little more than kin'), false, 'the start of the line is not the end of it');
});

test('a paraphrased middle still lands the cue', () => {
  const cue = matcher('The road washed out at the bridge, so I walked the last two miles.');
  assert.equal(cue.test('the road was flooded so I walked the last two miles'), true);
});

test('a mishearing inside the tail is forgiven once', () => {
  const cue = matcher('Somewhere the dark stays where you put it.');
  assert.equal(cue.test('somewhere the dark stays where you putt it'), true);
  assert.equal(cue.test('somewhere the dark stays were you put in'), true);
});

test('a tail that was never said does not match', () => {
  const cue = matcher('Everything here sticks.');
  assert.equal(cue.test('I have absolutely no idea what my line is'), false);
});

test('the tail may appear before the recogniser has stopped writing', () => {
  const cue = matcher('That is me.');
  assert.equal(cue.test('that is me and then some extra words ran on'), true);
});

test('short lines use what tail there is, and demand it exactly', () => {
  const cue = matcher('Yes.');
  assert.deepEqual(cue.tail, ['yes']);
  assert.equal(cue.test('yes'), true);
  assert.equal(cue.test('no'), false);
});

test('a line with no words never matches, leaving it to the silence timer', () => {
  const cue = matcher('—');
  assert.deepEqual(cue.tail, []);
  assert.equal(cue.test('anything at all'), false);
});

// --- cueing -----------------------------------------------------------------

function harness({ silenceMs = 20 } = {}) {
  const calls = { start: 0, stop: 0, mark: 0, advanced: 0 };
  const listener = {
    start: () => calls.start++,
    stop: () => calls.stop++,
    mark: () => calls.mark++,
  };
  const cueing = createCueing({
    listener,
    onAdvance: () => calls.advanced++,
    silenceMs,
  });
  return { cueing, calls };
}

const after = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('hearing the tail advances at once and stops matching', () => {
  const { cueing, calls } = harness();
  cueing.expect('Everything here sticks.');
  assert.equal(calls.start, 1);

  cueing.heard('everything here sticks');
  assert.equal(calls.advanced, 1);
  assert.equal(cueing.expecting, false);
});

test('the microphone is closed before the app speaks, even after a cue landed', () => {
  const { cueing, calls } = harness();
  cueing.expect('Everything here sticks.');
  cueing.heard('everything here sticks'); // finish() clears the matcher

  // cancel() is what the run calls when it moves off your line. It must close
  // the microphone even though there is no matcher left to infer it from.
  cueing.cancel();
  assert.equal(calls.stop, 1, 'the microphone must not stay open into the reply');
  assert.equal(cueing.listening, false);

  cueing.cancel();
  assert.equal(calls.stop, 1, 'and closing twice does not close it twice');
});

test('consecutive lines for one character reuse the open microphone', () => {
  const { cueing, calls } = harness();

  // BULLFROG's speech, split into separate lines by the stage directions
  // between them.
  for (const line of ['Hang on...', 'I have a human in my throat.', 'Oh well.']) {
    cueing.expect(line);
    cueing.heard(line.toLowerCase());
  }

  assert.equal(calls.advanced, 3);
  assert.equal(calls.start, 1, 'the microphone opens once, not once per line');
  assert.equal(calls.stop, 0, 'and is not torn down between them');
  assert.equal(calls.mark, 3, 'but each line starts from a clean transcript');
});

test('going quiet advances even when the tail was never heard', async () => {
  const { cueing, calls } = harness({ silenceMs: 20 });
  cueing.expect('Everything here sticks.');

  cueing.heard('something else entirely');
  assert.equal(calls.advanced, 0, 'still talking');

  await after(50);
  assert.equal(calls.advanced, 1, 'the silence timer covers a line the recogniser missed');
});

test('silence before you speak waits indefinitely', async () => {
  const { cueing, calls } = harness({ silenceMs: 20 });
  cueing.expect('Everything here sticks.');

  await after(50);
  assert.equal(calls.advanced, 0, 'a pause before starting is thinking, not a finished line');
  assert.equal(cueing.expecting, true);
});

test('the silence timer restarts on every word, so pauses mid-line are safe', async () => {
  const { cueing, calls } = harness({ silenceMs: 40 });
  cueing.expect('Everything here sticks.');

  for (let i = 0; i < 4; i++) {
    cueing.heard(`word ${i}`);
    await after(20);
  }
  assert.equal(calls.advanced, 0, 'a dramatic pause must not end the line');

  await after(60);
  assert.equal(calls.advanced, 1);
});

test('transcripts arriving outside a cue are ignored', () => {
  const { cueing, calls } = harness();
  cueing.heard('everything here sticks');
  assert.equal(calls.advanced, 0, 'the app speaking must not cue itself');
});

test('cancelling disarms the timer as well as the microphone', async () => {
  const { cueing, calls } = harness({ silenceMs: 20 });
  cueing.expect('Everything here sticks.');
  cueing.heard('half a line');

  cueing.cancel();
  assert.equal(calls.stop, 1);

  await after(50);
  assert.equal(calls.advanced, 0, 'a cancelled cue cannot fire later');
});

test('advancing only ever happens once per line', async () => {
  const { cueing, calls } = harness({ silenceMs: 20 });
  cueing.expect('Everything here sticks.');

  cueing.heard('everything here sticks');
  cueing.heard('everything here sticks again');
  await after(50);
  assert.equal(calls.advanced, 1);
});
