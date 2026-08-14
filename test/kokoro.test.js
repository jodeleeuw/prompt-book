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
