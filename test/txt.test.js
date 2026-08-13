import test from 'node:test';
import assert from 'node:assert/strict';
import { parseText } from '../src/parse/txt.js';
import { applyParens, segmentParens } from '../src/parse/lines.js';

test('parses CHARACTER: dialogue form', () => {
  const { scenes, characters } = parseText('HAMLET: To be, or not to be.\n\nHORATIO: My lord?');
  assert.equal(scenes.length, 1);
  assert.deepEqual(characters, ['HAMLET', 'HORATIO']);
  assert.deepEqual(
    scenes[0].lines.map((l) => [l.character, l.text]),
    [
      ['HAMLET', 'To be, or not to be.'],
      ['HORATIO', 'My lord?'],
    ],
  );
});

test('parses a name on its own line followed by dialogue', () => {
  const { scenes } = parseText('HAMLET\nTo be, or not to be.\n\nHORATIO\nMy lord?');
  assert.deepEqual(
    scenes[0].lines.map((l) => [l.character, l.text]),
    [
      ['HAMLET', 'To be, or not to be.'],
      ['HORATIO', 'My lord?'],
    ],
  );
});

test('joins a wrapped speech into one utterance', () => {
  const { scenes } = parseText('HAMLET\nTo be, or not to be,\nthat is the question.');
  assert.equal(scenes[0].lines.length, 1);
  assert.equal(scenes[0].lines[0].text, 'To be, or not to be, that is the question.');
});

test('does not mistake a timestamp for a speaker', () => {
  const { scenes } = parseText('10:30 and the clock strikes.');
  assert.equal(scenes[0].lines[0].kind, 'direction');
});

test('splits scenes on sluglines, act headings and dividers', () => {
  const { scenes } = parseText(
    'INT. CASTLE - NIGHT\nHAMLET: One.\n\nEXT. BATTLEMENTS - DAWN\nHAMLET: Two.\n\n---\nHAMLET: Three.',
  );
  assert.equal(scenes.length, 3);
  assert.equal(scenes[0].title, 'INT. CASTLE - NIGHT');
  assert.equal(scenes[1].title, 'EXT. BATTLEMENTS - DAWN');
  assert.equal(scenes[2].title, 'Scene 3');
});

test('marks wrapped lines as directions', () => {
  const { scenes } = parseText('(A trumpet sounds.)\n\nHAMLET: Who’s there?');
  assert.equal(scenes[0].lines[0].kind, 'direction');
  assert.equal(scenes[0].lines[1].kind, 'dialogue');
});

test('records inline parentheticals without removing them from the draft', () => {
  const { scenes } = parseText('HAMLET: (aside) A little more than kin.');
  const line = scenes[0].lines[0];
  assert.equal(line.text, '(aside) A little more than kin.');
  assert.deepEqual(line.parens, [{ text: '(aside)', keep: false }]);
});

test('applyParens drops unkept parentheticals and keeps the flagged ones', () => {
  const text = '(aside) A little more (softly) than kin.';
  const parens = [{ keep: false }, { keep: true }];
  assert.equal(applyParens(text, parens), 'A little more (softly) than kin.');
});

test('segmentParens preserves order and indices', () => {
  const segs = segmentParens('a (b) c [d]');
  assert.deepEqual(
    segs.map((s) => [s.type, s.value]),
    [
      ['text', 'a '],
      ['paren', '(b)'],
      ['text', ' c '],
      ['paren', '[d]'],
    ],
  );
  assert.deepEqual(
    segs.filter((s) => s.type === 'paren').map((s) => s.index),
    [0, 1],
  );
});

test('strips continuation markers from speaker names', () => {
  const { characters } = parseText("HAMLET (CONT'D): And yet.");
  assert.deepEqual(characters, ['HAMLET']);
});

test('drops empty scenes and blank lines', () => {
  const { scenes } = parseText('\n\n---\n\n\nHAMLET: Only line.\n\n---\n\n');
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].lines.length, 1);
});
