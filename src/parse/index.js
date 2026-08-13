import { parseText } from './txt.js';
import { parseFountain } from './fountain.js';

export const FORMATS = [
  { id: 'text', label: 'Plain text' },
  { id: 'fountain', label: 'Fountain' },
];

// Markup that plain prose would not contain: a title page key, a forced scene
// heading, a forced character cue, or a transition.
const FOUNTAIN_HINTS = [/^title\s*:/im, /^\.[A-Z]/m, /^@[A-Z]/m, /^>\s*[A-Z].*(TO:|<)\s*$/m];

export function detectFormat(text, filename = '') {
  if (/\.fountain$/i.test(filename)) return 'fountain';
  if (/\.(txt|text|md)$/i.test(filename)) return 'text';
  return FOUNTAIN_HINTS.some((re) => re.test(text)) ? 'fountain' : 'text';
}

/** @returns {{ title: string|null, scenes: object[], characters: string[] }} */
export function parseScript(text, format) {
  return format === 'fountain' ? parseFountain(text) : { title: null, ...parseText(text) };
}
