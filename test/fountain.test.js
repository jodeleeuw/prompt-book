import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFountain } from '../src/parse/fountain.js';
import { detectFormat, parseScript } from '../src/parse/index.js';

const lines = (scene) => scene.lines.map((l) => [l.kind, l.character, l.text]);

test('reads the title page and starts the body after it', () => {
  const { title, scenes } = parseFountain(
    'Title: _**Big Fish**_\nCredit: Written by\nAuthor: John August\n\nINT. KITCHEN - DAY\n\nEDWARD\nHello.',
  );
  assert.equal(title, 'Big Fish');
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].title, 'INT. KITCHEN - DAY');
  assert.deepEqual(lines(scenes[0]), [['dialogue', 'EDWARD', 'Hello.']]);
});

test('a colon line that is not a title-page key is not eaten as one', () => {
  const { title, scenes } = parseFountain('HAMLET: Not a title page.\n');
  assert.equal(title, null);
  assert.equal(scenes.length, 1);
});

test('character cues, parentheticals and dialogue', () => {
  const { scenes } = parseFountain('INT. HALL - DAY\n\nHAMLET (V.O.)\n(aside)\nA little more than kin.');
  const [line] = scenes[0].lines;
  assert.equal(line.character, 'HAMLET', 'the (V.O.) extension is not part of the name');
  assert.equal(line.text, '(aside) A little more than kin.');
  assert.deepEqual(line.parens, [{ text: '(aside)', keep: false }]);
});

test('forced markers override the heuristics', () => {
  const { scenes } = parseFountain('.SNIPER SCOPE POV\n\n@McCLANE\nYippee ki-yay.\n\n!SHOUTING IN CAPS');
  assert.equal(scenes[0].title, 'SNIPER SCOPE POV');
  assert.deepEqual(lines(scenes[0]), [
    ['dialogue', 'McCLANE', 'Yippee ki-yay.'],
    ['direction', null, 'SHOUTING IN CAPS'],
  ]);
});

test('transitions and action are directions, not dialogue', () => {
  const { scenes } = parseFountain('EXT. STREET - DAY\n\nThe car pulls away.\n\nCUT TO:\n\nEXT. FIELD - DAY\n\nWind.');
  assert.deepEqual(lines(scenes[0]), [
    ['direction', null, 'The car pulls away.'],
    ['direction', null, 'CUT TO:'],
  ]);
});

test('an uppercase line with nothing after it is action, not a cue', () => {
  const { scenes } = parseFountain('INT. HALL - DAY\n\nFADE OUT.\n');
  assert.deepEqual(lines(scenes[0]), [['direction', null, 'FADE OUT.']]);
});

test('discards boneyard, notes and synopses', () => {
  const { scenes } = parseFountain(
    'INT. HALL - DAY\n\n= A synopsis line.\n\nHAMLET\nKept. [[reminder to self]]\n\n/* HAMLET\nCut entirely. */\n',
  );
  assert.deepEqual(lines(scenes[0]), [['dialogue', 'HAMLET', 'Kept.']]);
});

test('strips emphasis markup so it is never spoken', () => {
  const { scenes } = parseFountain('INT. HALL - DAY\n\nHAMLET\nTo *be* or **not** to _be_.');
  assert.equal(scenes[0].lines[0].text, 'To be or not to be.');
});

test('sections and scene headings both start scenes', () => {
  const { scenes } = parseFountain('# Act One\n\nHAMLET\nOne.\n\nINT. HALL - DAY\n\nHAMLET\nTwo.');
  assert.deepEqual(
    scenes.map((s) => s.title),
    ['Act One', 'INT. HALL - DAY'],
  );
});

test('page breaks do not split scenes', () => {
  const { scenes } = parseFountain('INT. HALL - DAY\n\nHAMLET\nOne.\n\n===\n\nHAMLET\nTwo.');
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].lines.length, 2);
});

test('dual dialogue carets are dropped from the name', () => {
  const { characters } = parseFountain('INT. HALL - DAY\n\nBRICK\nHey.\n\nSTEEL ^\nHey.');
  assert.deepEqual(characters, ['BRICK', 'STEEL']);
});

test('detectFormat prefers the file extension over content', () => {
  assert.equal(detectFormat('Title: Anything', 'scene.fountain'), 'fountain');
  assert.equal(detectFormat('Title: Anything', 'scene.txt'), 'text');
});

test('detectFormat falls back to content markers for pasted text', () => {
  assert.equal(detectFormat('Title: Big Fish\n\nINT. KITCHEN - DAY'), 'fountain');
  assert.equal(detectFormat('.FORCED HEADING\n\nBOB\nHi.'), 'fountain');
  assert.equal(detectFormat('HAMLET: To be or not to be.'), 'text');
});

test('parseScript returns the same draft shape for both formats', () => {
  const fountain = parseScript('INT. HALL - DAY\n\nHAMLET\nHello.', 'fountain');
  const plain = parseScript('INT. HALL - DAY\nHAMLET: Hello.', 'text');
  assert.deepEqual(Object.keys(fountain).sort(), Object.keys(plain).sort());
  assert.deepEqual(fountain.scenes[0].lines[0], plain.scenes[0].lines[0]);
});
