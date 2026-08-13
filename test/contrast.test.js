// Contrast is checked against the stylesheet itself, not a copy of the values,
// so a token edited to something prettier fails here rather than in a dim
// rehearsal room at a metre.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles.css'),
  'utf8',
);

const channels = (h) => h.match(/\w\w/g).map((x) => parseInt(x, 16) / 255);
const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (h) => {
  const [r, g, b] = channels(h).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Read a palette block out of the stylesheet by its selector. */
function palette(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `no palette block for ${selector}`);
  const body = css.slice(start, css.indexOf('}', start));
  const tokens = Object.fromEntries(
    [...body.matchAll(/--(\w+):\s*#([0-9a-f]{6})/g)].map((m) => [m[1], m[2]]),
  );
  assert.ok(tokens.paper, `${selector} defines no --paper`);
  return tokens;
}

const PALETTES = {
  light: ':root {',
  'dark (device preference)': ":root:not([data-theme='light'])",
  'dark (explicit choice)': ":root[data-theme='dark']",
  'rehearsal stage': 'body.rehearsing',
};

// Every one of these carries text a user has to read. --rule is excluded on
// purpose: it draws hairlines, never content.
const TEXT_TOKENS = ['ink', 'muted', 'faint', 'accent', 'danger'];

for (const [name, selector] of Object.entries(PALETTES)) {
  test(`${name} palette meets WCAG AA for every text token`, () => {
    const tokens = palette(selector);
    for (const token of TEXT_TOKENS) {
      if (!tokens[token]) continue;
      const ratio = contrast(tokens[token], tokens.paper);
      assert.ok(
        ratio >= 4.5,
        `--${token} (#${tokens[token]}) on --paper (#${tokens.paper}) is ${ratio.toFixed(2)}:1, needs 4.5:1`,
      );
    }
  });
}

test('the two dark palettes have not drifted apart', () => {
  // They are declared twice so an explicit choice can override the device
  // preference. Nothing keeps them in step but this.
  assert.deepEqual(
    palette(":root:not([data-theme='light'])"),
    palette(":root[data-theme='dark']"),
  );
});
