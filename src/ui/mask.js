// Progressive concealment of your own lines — the ladder every actor already
// uses on paper: read it, then just enough to get started, then nothing but
// the shape.

const WORD = /[\p{L}\p{M}'’]+/gu;
const MAX_DOTS = 14;
const OPENING_WORDS = 2;

const dots = (word) => '·'.repeat(Math.min(word.length, MAX_DOTS));

export function maskLine(text, level) {
  // The opening words are the hard part of recall — once a line is running it
  // tends to keep running — so they are what the middle rung gives back.
  if (level === 'opening') {
    let seen = 0;
    return text.replace(WORD, (word) => (++seen <= OPENING_WORDS ? word : dots(word)));
  }
  // Punctuation and word count survive, so the rhythm of the line is still
  // there to recall it by. No letters do.
  if (level === 'hidden') return text.replace(WORD, dots);
  return text;
}
