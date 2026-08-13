// The recogniser adapter, driven through a fake SpeechRecognition.
//
// These exist because of a real failure: a speech broken up by stage
// directions becomes several consecutive lines for the same character, the
// microphone was torn down and rebuilt between each of them, and the aborted
// session's late events restarted it on top of the live one. The recording
// indicator flickered on and off until the run was abandoned.

import test from 'node:test';
import assert from 'node:assert/strict';

/** Enough of the real thing to reproduce its asynchronous teardown. */
class FakeRecognition {
  static instances = [];

  constructor() {
    this.started = false;
    this.aborted = false;
    FakeRecognition.instances.push(this);
  }

  start() {
    if (this.started) throw new Error('recognition already started');
    this.started = true;
    queueMicrotask(() => this.onstart?.());
  }

  // The crux: abort() returns immediately but onend lands later, by which
  // time the caller may already have opened a replacement session.
  abort() {
    this.aborted = true;
    this.started = false;
    queueMicrotask(() => this.onend?.());
  }

  stop() {
    this.abort();
  }

  /** Deliver interim results, as a live session would. */
  say(...phrases) {
    this.onresult?.({ results: phrases.map((text) => [{ transcript: text }]) });
  }

  /** Chrome ends a session by itself after silence. */
  endNaturally() {
    this.started = false;
    this.onend?.();
  }
}

globalThis.SpeechRecognition = FakeRecognition;
const { createListener, isSupported } = await import('../src/speech/stt.js');

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const live = () => FakeRecognition.instances.filter((r) => r.started);

test.beforeEach(() => {
  FakeRecognition.instances = [];
});

test('the adapter reports support when the API exists', () => {
  assert.equal(isSupported(), true);
});

test('a session replaced mid-teardown does not restart on top of its successor', async () => {
  const listener = createListener({});

  listener.start();
  await settle();
  assert.equal(FakeRecognition.instances.length, 1);

  // Exactly what consecutive lines used to do: close, then immediately reopen
  // before the first session's onend has landed.
  listener.stop();
  listener.start();
  await settle();

  assert.equal(
    FakeRecognition.instances.length,
    2,
    'the aborted session must not spawn a third',
  );
  assert.equal(live().length, 1, 'exactly one microphone session may be open');
  listener.stop();
});

test('repeating that cycle does not accumulate sessions', async () => {
  const listener = createListener({});

  // Six consecutive lines — the length of BULLFROG's speech once its stage
  // directions are stripped.
  for (let i = 0; i < 6; i++) {
    listener.stop();
    listener.start();
    await settle();
    assert.ok(live().length <= 1, `two sessions open at once on line ${i + 1}`);
  }

  assert.ok(
    FakeRecognition.instances.length <= 7,
    `sessions ran away: ${FakeRecognition.instances.length} created for 6 lines`,
  );
  listener.stop();
});

test('a stale session cannot report status for the live one', async () => {
  const statuses = [];
  const listener = createListener({ onStatus: (s) => statuses.push(s) });

  listener.start();
  await settle();
  const first = FakeRecognition.instances[0];

  listener.stop();
  listener.start();
  await settle();
  statuses.length = 0;

  first.onerror?.({ error: 'network' });
  first.endNaturally();
  await settle();

  assert.deepEqual(statuses, [], 'the replaced session must be silent');
  listener.stop();
});

test('a session that ends on its own is restarted', async () => {
  const listener = createListener({});
  listener.start();
  await settle();

  FakeRecognition.instances[0].endNaturally();
  await new Promise((r) => setTimeout(r, 250)); // the backoff

  assert.equal(FakeRecognition.instances.length, 2, 'silence should not end listening');
  assert.equal(live().length, 1);
  listener.stop();
});

test('starting while already listening is a no-op', async () => {
  const listener = createListener({});
  listener.start();
  await settle();
  listener.start();
  listener.start();
  await settle();

  assert.equal(FakeRecognition.instances.length, 1);
  listener.stop();
});

test('mark() re-baselines, so one line is not cued by the previous line', async () => {
  const heard = [];
  const listener = createListener({ onResult: (t) => heard.push(t) });

  listener.start();
  await settle();
  const session = FakeRecognition.instances[0];

  session.say('leave me alone');
  assert.equal(heard.at(-1), 'leave me alone');

  // The run moves to the next line without closing the microphone.
  listener.mark();
  session.say('leave me alone', 'what do you want');

  assert.equal(
    heard.at(-1),
    'what do you want',
    'the previous line must not appear in this line’s transcript',
  );
  listener.stop();
});

test('a fresh session clears the baseline', async () => {
  const heard = [];
  const listener = createListener({ onResult: (t) => heard.push(t) });

  listener.start();
  await settle();
  FakeRecognition.instances[0].say('one', 'two');
  listener.mark();

  FakeRecognition.instances[0].endNaturally();
  await new Promise((r) => setTimeout(r, 250));

  FakeRecognition.instances[1].say('three');
  assert.equal(heard.at(-1), 'three', 'a restarted session starts counting from zero');
  listener.stop();
});
