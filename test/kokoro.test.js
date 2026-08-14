// The neural voice reports its download per file, and several files are in
// flight at once. What reaches the screen has to be one number that only ever
// moves forward.

import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateProgress } from '../src/speech/kokoro.js';

const collect = () => {
  const seen = [];
  return { seen, report: aggregateProgress((r) => seen.push(r)) };
};

const chunk = (file, loaded, total) => ({ status: 'progress', file, loaded, total });

const MODEL = 88_000_000;

test('bytes are summed across files, not taken from whichever reported last', () => {
  const { seen, report } = collect();

  report(chunk('config.json', 500, 500));
  report(chunk('model.onnx', 40_000_000, MODEL));

  assert.equal(seen.at(-1).loaded, 40_000_500);
});

test('a small file finishing first does not read as finished', () => {
  // This is why the figure is bytes and not a percentage: at this moment the
  // only known total is 500 bytes, all of which have arrived, so a percentage
  // would say 100% and then sit there for the next 88MB.
  const { seen, report } = collect();

  report(chunk('config.json', 500, 500));
  report(chunk('model.onnx', 0, MODEL));

  assert.equal(seen.at(-1).loaded, 500, 'half a kilobyte, and it says so');
});

test('the figure never decreases across a whole download', () => {
  const { seen, report } = collect();

  report(chunk('a', 0, 1000));
  report(chunk('a', 400, 1000));
  report(chunk('b', 0, 9000));
  report(chunk('b', 3000, 9000));
  report(chunk('a', 1000, 1000));
  report(chunk('b', 9000, 9000));

  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i].loaded >= seen[i - 1].loaded, `fell at report ${i}`);
  }
  assert.equal(seen.at(-1).loaded, 10_000);
});

test('a retried file restarting at zero does not rewind the figure', () => {
  const { seen, report } = collect();

  report(chunk('a', 8000, 10_000));
  report(chunk('a', 0, 10_000)); // connection dropped, fetched again
  assert.equal(seen.at(-1).loaded, 8000);
});

test('done completes a file whose last chunk went unreported', () => {
  const { seen, report } = collect();

  report(chunk('a', 900, 1000));
  report({ status: 'done', file: 'a' });
  assert.equal(seen.at(-1).loaded, 1000);
});

test('reports with nothing to count are ignored rather than counted as zero', () => {
  const { seen, report } = collect();

  report(undefined);
  report({ status: 'initiate', file: 'a' }); // announced, no size yet
  report({ status: 'done' }); // no file
  report(chunk('a', 0, 0)); // zero-length
  assert.deepEqual(seen, []);
});

test('no callback means no wrapper, so nothing is done for nobody', () => {
  assert.equal(aggregateProgress(undefined), undefined);
});

// --- keeping ahead of the run ------------------------------------------------
//
// The model generates one line at a time whatever it is asked for, so the order
// work is started in is the order it finishes in.

import { createKokoroSpeaker } from '../src/speech/kokoro.js';

globalThis.AudioContext = class {
  close() {
    return Promise.resolve();
  }
};

/** A stand-in model that records what it was asked for, and in what order. */
function fakeModel() {
  const started = [];
  let inFlight = 0;
  let overlapped = false;
  const pending = [];

  const tts = {
    generate: (text) => {
      started.push(text);
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      return new Promise((resolve) => {
        pending.push(() => {
          inFlight -= 1;
          resolve({ audio: new Float32Array(1), sampling_rate: 24000 });
        });
      });
    },
  };

  return {
    started,
    get overlapped() {
      return overlapped;
    },
    /** Let the oldest outstanding generation finish. */
    async settle(n = 1) {
      for (let i = 0; i < n; i++) {
        pending.shift()?.();
        await new Promise((r) => setTimeout(r, 0));
      }
    },
    load: async () => ({ tts }),
  };
}

const say = (text) => ({ text, characterId: 'c1' });

test('the lookahead is generated in order, one at a time', async () => {
  const model = fakeModel();
  const speaker = createKokoroSpeaker({ load: model.load });

  speaker.prefetch([say('one'), say('two'), say('three')]);
  await model.settle(3);

  assert.deepEqual(model.started, ['one', 'two', 'three']);
  assert.equal(model.overlapped, false, 'three at once would make the next one arrive last');
});

test('a fresh window replaces the old one rather than queuing behind it', async () => {
  const model = fakeModel();
  const speaker = createKokoroSpeaker({ load: model.load });

  speaker.prefetch([say('one'), say('two'), say('three')]);
  // The run has moved on; 'two' and 'three' are behind it and no longer wanted.
  speaker.prefetch([say('four'), say('five')]);
  await model.settle(3);

  assert.deepEqual(model.started, ['one', 'four', 'five'], 'stale lines are dropped');
});

test('a line already generated is not generated again', async () => {
  const model = fakeModel();
  const speaker = createKokoroSpeaker({ load: model.load });

  speaker.prefetch([say('one'), say('two')]);
  await model.settle(2);
  assert.equal(speaker.ready(say('one')), true);

  speaker.prefetch([say('one'), say('two'), say('three')]);
  await model.settle(1);

  assert.deepEqual(model.started, ['one', 'two', 'three'], 'only the new line');
});

test('lines with no text are skipped rather than queued', async () => {
  const model = fakeModel();
  const speaker = createKokoroSpeaker({ load: model.load });

  speaker.prefetch([null, { text: '' }, say('one')]);
  await model.settle(1);

  assert.deepEqual(model.started, ['one']);
});

test('one line still works, since that is how the run asked before', async () => {
  const model = fakeModel();
  const speaker = createKokoroSpeaker({ load: model.load });

  speaker.prefetch(say('one'));
  await model.settle(1);

  assert.deepEqual(model.started, ['one']);
});
