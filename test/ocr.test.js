import test from 'node:test';
import assert from 'node:assert/strict';
import { pageToScript, normalisePage } from '../src/ocr/layout.js';
import { joinPages } from '../src/ocr/pages.js';
import { greyAndStretch, fitted } from '../src/ocr/preprocess.js';
import { parseText } from '../src/parse/txt.js';

// --- layout reconstruction --------------------------------------------------

const PAGE_WIDTH = 1000;
const BODY = 100; // where body text starts
const INDENT = 380; // where a screenplay cue sits

const line = (text, left, { width = 400, confidence = 92 } = {}) => ({
  text,
  left,
  right: left + width,
  words: text.split(/\s+/).length,
  confidence,
});

const script = (lines) => pageToScript({ pageWidth: PAGE_WIDTH, lines }).text;

test('an indented upper-case line becomes a cue on its own line', () => {
  const text = script([
    line('The door opens.', BODY),
    line('MIRA', INDENT, { width: 90 }),
    line('Breathe. You have done harder things.', BODY),
  ]);
  assert.match(text, /\nMIRA\nBreathe\./, 'the cue must stand alone for the parser to see it');
});

test('a centred upper-case line becomes a cue too', () => {
  const centred = PAGE_WIDTH / 2 - 45;
  const text = script([line('KEEPER', centred, { width: 90 }), line("You're late.", BODY)]);
  assert.match(text, /^KEEPER\n/);
});

test('a scene heading at the body margin is left alone', () => {
  // Upper-case, but it sits where body text sits, so it is not a cue.
  const text = script([
    line('INT. LIGHTHOUSE - NIGHT', BODY),
    line('The beam turns steadily.', BODY),
  ]);
  assert.equal(text.split('\n')[0], 'INT. LIGHTHOUSE - NIGHT');
  assert.doesNotMatch(text, /^\n/);
});

test('a long indented line is dialogue, not a cue', () => {
  const text = script([
    line('MIRA', INDENT, { width: 90 }),
    line('I have absolutely no idea what you are talking about', INDENT, { width: 500 }),
  ]);
  const [first, ...rest] = text.split('\n');
  assert.equal(first, 'MIRA');
  assert.match(rest.join('\n'), /absolutely no idea/);
});

test('the reconstructed page parses into the right cast and speeches', () => {
  // The real proof: hand the output to the parser the app already uses.
  const text = script([
    line('INT. LIGHTHOUSE - NIGHT', BODY),
    line('A lamp room. The beam turns.', BODY),
    line('KEEPER', INDENT, { width: 110 }),
    line("You're late.", BODY),
    line('VISITOR', INDENT, { width: 130 }),
    line('The road washed out at the bridge.', BODY),
    line('KEEPER', INDENT, { width: 110 }),
    line('Nobody walks the last two miles.', BODY),
  ]);

  const parsed = parseText(text);
  assert.deepEqual(parsed.characters, ['KEEPER', 'VISITOR']);
  const dialogue = parsed.scenes[0].lines.filter((l) => l.kind === 'dialogue');
  assert.deepEqual(
    dialogue.map((l) => [l.character, l.text]),
    [
      ['KEEPER', "You're late."],
      ['VISITOR', 'The road washed out at the bridge.'],
      ['KEEPER', 'Nobody walks the last two miles.'],
    ],
  );
});

test('page confidence is weighted by how many words each line had', () => {
  const page = pageToScript({
    pageWidth: PAGE_WIDTH,
    lines: [
      { text: 'one', left: BODY, right: 200, words: 1, confidence: 20 },
      { text: 'a b c d e f g h i', left: BODY, right: 600, words: 9, confidence: 90 },
    ],
  });
  assert.ok(page.confidence > 80, 'one badly-read short word must not condemn the page');
});

test('an empty page yields nothing rather than throwing', () => {
  assert.deepEqual(pageToScript({ pageWidth: 0, lines: [] }), { text: '', confidence: 0 });
  assert.deepEqual(pageToScript({}), { text: '', confidence: 0 });
});

test('normalisePage accepts either shape the recogniser returns', () => {
  const fromBlocks = normalisePage({
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                text: 'MIRA',
                bbox: { x0: 380, x1: 470 },
                confidence: 95,
                words: [{ text: 'MIRA', bbox: { x0: 380, x1: 470 } }],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(fromBlocks.lines.length, 1);
  assert.equal(fromBlocks.lines[0].left, 380);

  const fromLines = normalisePage({
    lines: [{ words: [{ text: 'MIRA', bbox: { x0: 380, x1: 470 } }], confidence: 95 }],
  });
  assert.equal(fromLines.lines[0].text, 'MIRA');
  assert.equal(fromLines.lines[0].left, 380, 'position is recovered from the words when absent');
});

// --- page furniture ---------------------------------------------------------

test('page numbers at the edges go, digits in dialogue stay', () => {
  const { text, dropped } = joinPages([
    '12\nKEEPER\nI have been here 19 years.\n\n13',
    'VISITOR\nNineteen?',
  ]);
  assert.doesNotMatch(text, /^12$/m);
  assert.match(text, /19 years/, 'a number inside a line is not page furniture');
  assert.ok(dropped.includes('12'));
});

test('a running header is removed once it proves itself repetitive', () => {
  const page = (n, body) => `THE LIGHTHOUSE — DRAFT 3\n${body}\n${n}`;
  const { text } = joinPages([page(1, 'KEEPER\nOne.'), page(2, 'KEEPER\nTwo.'), page(3, 'KEEPER\nThree.')]);
  assert.doesNotMatch(text, /DRAFT 3/);
  assert.match(text, /One\./);
});

test('a header on only two pages is left alone, being unprovable', () => {
  const { text } = joinPages(['THE LIGHTHOUSE\nKEEPER\nOne.', 'THE LIGHTHOUSE\nKEEPER\nTwo.']);
  assert.match(text, /THE LIGHTHOUSE/);
});

test('CONTINUED and MORE markers go wherever they appear', () => {
  const { text } = joinPages(['KEEPER\nOne.\n(MORE)', '(CONTINUED)\nKEEPER\nTwo.']);
  assert.doesNotMatch(text, /MORE|CONTINUED/);
});

test("a speech broken across pages rejoins instead of starting again", () => {
  const { text, dropped } = joinPages([
    'KEEPER\nThe supply boat brings letters,',
    "KEEPER (CONT'D)\nand letters bring news.",
  ]);
  assert.doesNotMatch(text, /CONT/);
  assert.ok(dropped.some((d) => /CONT/.test(d)));
  const lines = text.split('\n').filter(Boolean);
  assert.deepEqual(lines, ['KEEPER', 'The supply boat brings letters,', 'and letters bring news.']);
});

test('separate speeches on separate pages stay separate', () => {
  const { text } = joinPages(['KEEPER\nOne.', 'VISITOR\nTwo.']);
  assert.equal(parseText(text).scenes[0].lines.length, 2);
});

// --- image preparation ------------------------------------------------------

const rgba = (pixels) => Uint8ClampedArray.from(pixels.flatMap((p) => [...p, 255]));

test('grey conversion leaves all three channels equal', () => {
  const out = greyAndStretch(rgba([[200, 40, 90], [10, 250, 30]]));
  for (let i = 0; i < out.length; i += 4) {
    assert.equal(out[i], out[i + 1]);
    assert.equal(out[i + 1], out[i + 2]);
  }
});

test('a flat, low-contrast photograph is stretched to the full range', () => {
  // A page shot in poor light: ink and paper only 40 levels apart.
  const flat = rgba(Array.from({ length: 100 }, (_, i) => (i < 50 ? [110, 110, 110] : [150, 150, 150])));
  const out = greyAndStretch(flat);
  const values = [...new Set([...out].filter((_, i) => i % 4 === 0))].sort((a, b) => a - b);
  assert.equal(values[0], 0);
  assert.equal(values.at(-1), 255, 'ink should reach black and paper white');
});

test('preparation forces every pixel opaque', () => {
  const out = greyAndStretch(Uint8ClampedArray.from([10, 10, 10, 0, 200, 200, 200, 128]));
  assert.equal(out[3], 255);
  assert.equal(out[7], 255);
});

test('images are capped on the long edge with the aspect kept', () => {
  assert.deepEqual(fitted(4000, 3000), { width: 2000, height: 1500 });
  assert.deepEqual(fitted(3000, 4000), { width: 1500, height: 2000 });
  assert.deepEqual(fitted(800, 600), { width: 800, height: 600 }, 'small images are left alone');
});
