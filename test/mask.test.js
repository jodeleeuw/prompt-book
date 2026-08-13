import test from 'node:test';
import assert from 'node:assert/strict';
import { maskLine } from '../src/ui/mask.js';

const LINE = 'To be, or not to be — that is the question.';

test('full text is left alone', () => {
  assert.equal(maskLine(LINE, 'full'), LINE);
});

test('the opening gives back the first two words and hides the rest', () => {
  assert.equal(maskLine(LINE, 'opening'), 'To be, ·· ··· ·· ·· — ···· ·· ··· ········.');
});

test('the opening treats a contraction as one word', () => {
  assert.equal(maskLine("Don't you dare", 'opening'), "Don't you ····");
});

test('a line shorter than the opening is shown whole', () => {
  assert.equal(maskLine('Not so.', 'opening'), 'Not so.');
});

test('hidden leaves no letters at all', () => {
  const hidden = maskLine(LINE, 'hidden');
  assert.doesNotMatch(hidden, /\p{L}/u, 'a single surviving letter defeats the point');
});

test('hidden preserves word count and punctuation, so the rhythm survives', () => {
  assert.equal(maskLine('To be, or not to be.', 'hidden'), '·· ··, ·· ··· ·· ··.');
});

test('long words are capped rather than running off the screen', () => {
  assert.equal(maskLine('antidisestablishmentarianism', 'hidden').length, 14);
});

test('an unknown level falls back to showing the line', () => {
  assert.equal(maskLine(LINE, undefined), LINE);
});

test('a hide level from an older version of the app never reaches the UI', async () => {
  const { updateSettings, getSettings, hideLevel } = await import('../src/store/settings.js');
  updateSettings({ hideLevel: 'initials' }); // the level this app used to have
  assert.equal(getSettings().hideLevel, 'full', 'an unknown level is replaced on write');
  assert.ok(hideLevel('initials').label, 'and the lookup still returns something renderable');
});
