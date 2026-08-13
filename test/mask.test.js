import test from 'node:test';
import assert from 'node:assert/strict';
import { maskLine } from '../src/ui/mask.js';

const LINE = 'To be, or not to be — that is the question.';

test('full text is left alone', () => {
  assert.equal(maskLine(LINE, 'full'), LINE);
});

test('initials keep the first letter of every word and all punctuation', () => {
  assert.equal(maskLine(LINE, 'initials'), 'T b, o n t b — t i t q.');
});

test('initials treat a contraction as one word', () => {
  assert.equal(maskLine("Don't you dare", 'initials'), 'D y d');
});

test('hidden leaves no letters at all', () => {
  const hidden = maskLine(LINE, 'hidden');
  assert.doesNotMatch(hidden, /\p{L}/u, 'a single surviving letter defeats the point');
});

test('hidden preserves word count and punctuation, so the rhythm survives', () => {
  assert.equal(maskLine('To be, or not to be.', 'hidden'), '·· ··, ·· ··· ·· ··.');
});

test('hidden caps very long words rather than running off the screen', () => {
  assert.equal(maskLine('antidisestablishmentarianism', 'hidden').length, 14);
});

test('an unknown level falls back to showing the line', () => {
  assert.equal(maskLine(LINE, undefined), LINE);
});
