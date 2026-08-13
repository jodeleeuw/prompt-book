// Progressive concealment of your own lines — the ladder every actor already
// uses on paper: read it, then the first letters, then nothing but the shape.

const WORD = /[\p{L}\p{M}'’]+/gu;
const MAX_DOTS = 14;

export function maskLine(text, level) {
  if (level === 'initials') return text.replace(WORD, (word) => word[0]);
  if (level === 'hidden') {
    // Punctuation and word count survive, so the rhythm of the line is still
    // there to recall it by. No letters do.
    return text.replace(WORD, (word) => '·'.repeat(Math.min(word.length, MAX_DOTS)));
  }
  return text;
}
