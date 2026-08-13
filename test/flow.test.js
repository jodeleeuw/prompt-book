// End-to-end smoke test of the import → save → render path, headless.
// jsdom stands in for the browser; fake-indexeddb for the tablet's storage.

import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;

// Dynamic, so the globals above exist before the view modules load.
const { parseText } = await import('../src/parse/txt.js');
const { commitDraft } = await import('../src/parse/draft.js');
const { createScript, loadScript, listScripts, deleteScript, renameScript } = await import(
  '../src/store/library.js'
);
const { renderLibrary } = await import('../src/ui/library-view.js');
const { renderScript } = await import('../src/ui/script-view.js');

const SAMPLE = `INT. ELSINORE - NIGHT

(A trumpet sounds.)

HAMLET: (aside) A little more than kin, and less than kind.

CLAUDIUS
How is it that the clouds still hang on you?

---

HAMLET: Not so, my lord.`;

test('commitDraft drops directions and unkept parentheticals', () => {
  const draft = { title: 'Hamlet', ...parseText(SAMPLE) };
  const { scenes } = commitDraft(draft);

  assert.equal(scenes.length, 2);
  assert.deepEqual(
    scenes[0].lines.map((l) => [l.character, l.text]),
    [
      ['HAMLET', 'A little more than kin, and less than kind.'],
      ['CLAUDIUS', 'How is it that the clouds still hang on you?'],
    ],
    'the trumpet direction and the (aside) are gone',
  );
  assert.equal(scenes[1].lines[0].text, 'Not so, my lord.');
});

test('commitDraft keeps a parenthetical the user flagged', () => {
  const draft = { title: 'Hamlet', ...parseText('HAMLET: (aside) A little more than kin.') };
  draft.scenes[0].lines[0].parens[0].keep = true;
  const { scenes } = commitDraft(draft);
  assert.equal(scenes[0].lines[0].text, '(aside) A little more than kin.');
});

test('a line reassigned from direction to a character survives intact', () => {
  const draft = { title: 'Hamlet', ...parseText(SAMPLE) };
  const trumpet = draft.scenes[0].lines.find((l) => l.kind === 'direction');
  Object.assign(trumpet, { kind: 'dialogue', character: 'GHOST' });

  const { scenes } = commitDraft(draft);
  assert.equal(scenes[0].lines[0].character, 'GHOST');
  assert.equal(
    scenes[0].lines[0].text,
    '(A trumpet sounds.)',
    'a wholly bracketed line must not be stripped to nothing and dropped',
  );
});

test('a committed script round-trips through IndexedDB', async () => {
  const draft = { title: 'Hamlet', ...parseText(SAMPLE) };
  const id = await createScript(commitDraft(draft));

  const { script, scenes } = await loadScript(id);
  assert.equal(script.title, 'Hamlet');
  assert.equal(script.sceneCount, 2);
  assert.equal(script.lineCount, 3);
  assert.deepEqual(
    script.characters.map((c) => c.name),
    ['HAMLET', 'CLAUDIUS'],
  );
  assert.deepEqual(
    scenes.map((s) => s.order),
    [0, 1],
    'scenes come back in order',
  );

  const names = new Map(script.characters.map((c) => [c.id, c.name]));
  assert.equal(names.get(scenes[0].lines[0].characterId), 'HAMLET');
});

test('library and script views render the stored script', async () => {
  const library = await renderLibrary();
  assert.match(library.textContent, /Hamlet/);
  assert.match(library.textContent, /2 scenes · 3 lines · 2 characters/);

  const [{ id }] = await listScripts();
  const view = await renderScript(id);
  assert.match(view.textContent, /A little more than kin/);
  assert.match(view.textContent, /CLAUDIUS/);
  assert.doesNotMatch(view.textContent, /trumpet/, 'stripped directions never reach the script view');
  assert.doesNotMatch(view.textContent, /Unknown/, 'every line resolves to a character');
});

test('renaming and deleting a script', async () => {
  const [{ id }] = await listScripts();
  await renameScript(id, 'Hamlet, Prince of Denmark');
  assert.equal((await loadScript(id)).script.title, 'Hamlet, Prince of Denmark');

  await deleteScript(id);
  assert.equal(await loadScript(id), null);
  assert.deepEqual(await listScripts(), []);

  const library = await renderLibrary();
  assert.match(library.textContent, /No scripts yet/);
});
