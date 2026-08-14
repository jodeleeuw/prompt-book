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
// Modules reach for the bare global, as they do in a browser. Without this the
// storage tests pass against an in-memory cache and prove nothing.
globalThis.localStorage = dom.window.localStorage;

// Dynamic, so the globals above exist before the view modules load.
const { parseText } = await import('../src/parse/txt.js');
const { commitDraft } = await import('../src/parse/draft.js');
const {
  createScript,
  loadScript,
  listScripts,
  deleteScript,
  renameScript,
  renameScene,
  moveScene,
  deleteScene,
  saveRehearsalSetup,
} = await import('../src/store/library.js');
const { renderLibrary } = await import('../src/ui/library-view.js');
const { renderScript } = await import('../src/ui/script-view.js');
const { renderRehearse } = await import('../src/ui/rehearse-view.js');

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
  // Before a character is chosen there is no "yours" to count, so the cast size
  // stands in. The whole-script line total was never a number anyone wanted.
  assert.match(library.textContent, /2 scenes · 2 characters/);
  assert.doesNotMatch(library.textContent, /3 lines/);

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

// --- scene management ------------------------------------------------------

const threeScenes = () =>
  createScript(
    commitDraft({
      title: 'Three',
      ...parseText('HAMLET: One.\n\n---\n\nHAMLET: Two.\n\n---\n\nHAMLET: Three.'),
    }),
  );

const textsOf = (scenes) => scenes.map((s) => s.lines[0].text);

test('scenes can be reordered, and orders stay contiguous', async () => {
  const id = await threeScenes();
  const first = (await loadScript(id)).scenes[0].id;

  await moveScene(id, first, 1);
  const { scenes } = await loadScript(id);
  assert.deepEqual(textsOf(scenes), ['Two.', 'One.', 'Three.']);
  assert.deepEqual(
    scenes.map((s) => s.order),
    [0, 1, 2],
  );

  await deleteScript(id);
});

test('a move past either end is a no-op', async () => {
  const id = await threeScenes();
  const { scenes } = await loadScript(id);

  await moveScene(id, scenes[0].id, -1);
  await moveScene(id, scenes[2].id, 1);
  assert.deepEqual(textsOf((await loadScript(id)).scenes), ['One.', 'Two.', 'Three.']);

  await deleteScript(id);
});

test('deleting a scene renumbers the rest and updates the script counts', async () => {
  const id = await threeScenes();
  const { scenes } = await loadScript(id);

  await deleteScene(id, scenes[1].id);
  const after = await loadScript(id);

  assert.deepEqual(textsOf(after.scenes), ['One.', 'Three.']);
  assert.deepEqual(
    after.scenes.map((s) => s.order),
    [0, 1],
  );
  assert.equal(after.script.sceneCount, 2);
  assert.equal(after.script.lineCount, 2, 'the library listing must not keep counting deleted lines');

  await deleteScript(id);
});

test('scenes can be renamed', async () => {
  const id = await threeScenes();
  const { scenes } = await loadScript(id);

  await renameScene(scenes[0].id, 'The battlements');
  assert.equal((await loadScript(id)).scenes[0].title, 'The battlements');

  const view = await renderScript(id);
  assert.deepEqual(
    [...view.querySelectorAll('.scene-title-input')].map((input) => input.value),
    ['The battlements', 'Scene 2', 'Scene 3'],
  );

  await deleteScript(id);
});

// --- rehearsal wiring ------------------------------------------------------

const twoHander = () =>
  createScript(
    commitDraft({
      title: 'Two hander',
      ...parseText('MIRA: One.\n\nDEV: Two.\n\n---\n\nMIRA: Three.'),
    }),
  );

test('rehearsal sends you to setup until a character and scenes are chosen', async () => {
  const id = await twoHander();

  const view = await renderRehearse(id);
  assert.match(view.textContent, /Setting up/);
  assert.match(window.location.hash, new RegExp(`#/script/${id}/setup$`));

  await deleteScript(id);
});

test('setup is remembered, and a run covers only the chosen scenes', async () => {
  const id = await twoHander();
  const { script, scenes } = await loadScript(id);
  const mira = script.characters.find((c) => c.name === 'MIRA');

  await saveRehearsalSetup(id, {
    userCharacterIds: [mira.id],
    sceneIds: [scenes[0].id],
    voiceByCharacterId: { [mira.id]: 'uri:Alice' },
  });

  const reloaded = (await loadScript(id)).script;
  assert.deepEqual(reloaded.userCharacterIds, [mira.id]);
  assert.deepEqual(reloaded.sceneIds, [scenes[0].id]);
  assert.equal(reloaded.characters.find((c) => c.id === mira.id).voiceURI, 'uri:Alice');

  // jsdom has no speechSynthesis, which is the same situation as a device with
  // no voices: the run falls back to reading every line yourself.
  const view = await renderRehearse(id);
  assert.match(view.textContent, /Silent run/);
  assert.match(view.querySelector('.counter').textContent, /^2 lines$/, 'scene two is excluded');

  await deleteScript(id);
});

// --- settings ---------------------------------------------------------------

const { getSettings, updateSettings, applyTheme } = await import('../src/store/settings.js');

test('an explicit theme is stamped on the root, and "system" stands aside', () => {
  updateSettings({ theme: 'dark' });
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');

  updateSettings({ theme: 'light' });
  assert.equal(document.documentElement.getAttribute('data-theme'), 'light');

  updateSettings({ theme: 'system' });
  assert.equal(
    document.documentElement.hasAttribute('data-theme'),
    false,
    'system must leave prefers-color-scheme to decide',
  );
});

test('settings survive a reload and keep their defaults', () => {
  updateSettings({ hideLevel: 'opening' });
  assert.equal(getSettings().hideLevel, 'opening');
  assert.equal(getSettings().silenceMs, 2500, 'untouched settings keep their default');

  applyTheme('dark');
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
  updateSettings({ theme: 'system' });
});

// --- rehearsal screen affordances -------------------------------------------

const tick = () => new Promise((r) => setTimeout(r, 0));

test('the stage is a keyboard-operable control, not a bare div', async () => {
  const id = await twoHander();
  const { script, scenes } = await loadScript(id);
  const mira = script.characters.find((c) => c.name === 'MIRA');
  await saveRehearsalSetup(id, { userCharacterIds: [mira.id], sceneIds: [scenes[0].id] });

  const view = await renderRehearse(id);
  await tick();

  const stage = view.querySelector('.stage');
  assert.equal(stage.getAttribute('role'), 'button');
  assert.equal(stage.getAttribute('tabindex'), '0');
  assert.match(stage.getAttribute('aria-label'), /begin/i, 'the name says what a press does');

  assert.ok(view.querySelector('[aria-live="polite"]'), 'turn changes need announcing');

  await deleteScript(id);
});

test('the transport keeps its shape, so buttons do not move under a thumb', async () => {
  const id = await twoHander();
  const { script, scenes } = await loadScript(id);
  const mira = script.characters.find((c) => c.name === 'MIRA');
  await saveRehearsalSetup(id, { userCharacterIds: [mira.id], sceneIds: [scenes[0].id] });

  const view = await renderRehearse(id);
  await tick();

  view.querySelector('.stage').click(); // begin
  await tick();

  const buttons = () => [...view.querySelectorAll('.transport .button')];
  assert.deepEqual(
    buttons().map((b) => b.textContent),
    ['Back', 'Pause', 'Peek', 'Next line'],
    'and Skip is named for what it does on your own line',
  );
  assert.equal(buttons()[2].disabled, false, 'the line is masked, so Peek is live');

  // With nothing hidden there is nothing to peek at — but the slot must stay,
  // or Skip slides under a thumb that already knows where it is.
  view.querySelector('.hide-chip').click();
  view.querySelector('.hide-chip').click();
  assert.equal(getSettings().hideLevel, 'full');
  assert.deepEqual(buttons().map((b) => b.textContent), ['Back', 'Pause', 'Peek', 'Next line']);
  assert.equal(buttons()[2].disabled, true, 'Peek is disabled, not removed');

  await deleteScript(id);
});

test('rehearsal claims the whole surface and gives it back on exit', async () => {
  const id = await twoHander();
  const { script, scenes } = await loadScript(id);
  const mira = script.characters.find((c) => c.name === 'MIRA');
  await saveRehearsalSetup(id, { userCharacterIds: [mira.id], sceneIds: [scenes[0].id] });

  await renderRehearse(id);
  await tick();
  assert.ok(document.body.classList.contains('rehearsing'), 'the stage ground and banner rule depend on this');

  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  assert.equal(document.body.classList.contains('rehearsing'), false);

  await deleteScript(id);
});

// --- resuming, correcting, undoing ------------------------------------------

const { getLastRun, setLastRun, clearLastRun } = await import('../src/store/session.js');
const { snapshotScript, restoreScript, updateLine } = await import('../src/store/library.js');

test('the library offers the run you were part-way through', async () => {
  const id = await twoHander();
  const { script, scenes } = await loadScript(id);
  const mira = script.characters.find((c) => c.name === 'MIRA');
  await saveRehearsalSetup(id, { userCharacterIds: [mira.id], sceneIds: [scenes[0].id] });
  setLastRun({ scriptId: id, index: 1, total: 2, sceneTitle: scenes[0].title });

  const view = await renderLibrary();
  const resume = view.querySelector('.resume');
  assert.ok(resume, 'a part-finished run should be one tap from the library');
  assert.equal(resume.getAttribute('href'), `#/script/${id}/rehearse`);
  assert.match(resume.textContent, /line 2 of 2/);
  assert.match(view.textContent, /you play MIRA/, 'the count that matters is whose lines they are');

  await deleteScript(id);
  clearLastRun();
});

test('a bookmark pointing at a deleted script is forgotten, not shown', async () => {
  setLastRun({ scriptId: 'gone', index: 3, total: 9, sceneTitle: 'Nowhere' });
  const view = await renderLibrary();
  assert.equal(view.querySelector('.resume'), null);
  assert.equal(getLastRun(), null, 'and it is cleared rather than checked again every visit');
});

test('a line can be corrected after import', async () => {
  const id = await twoHander();
  const { scenes } = await loadScript(id);
  const line = scenes[0].lines[0];

  await updateLine(scenes[0].id, line.id, 'One. Two ran together here.');
  const after = await loadScript(id);
  assert.equal(after.scenes[0].lines[0].text, 'One. Two ran together here.');

  await updateLine(scenes[0].id, line.id, '   ');
  assert.equal(
    (await loadScript(id)).scenes[0].lines[0].text,
    'One. Two ran together here.',
    'emptying a line is a delete, and is not what the editor is for',
  );

  await deleteScript(id);
});

test('a deleted script can be put back exactly as it was', async () => {
  const id = await twoHander();
  const before = await snapshotScript(id);

  await deleteScript(id);
  assert.equal(await loadScript(id), null);

  await restoreScript(before);
  // Compared as stored, not as loaded: loading fills in the parts you read,
  // and the point here is that what went back into the database is byte for
  // byte what came out of it.
  const after = await snapshotScript(id);
  assert.deepEqual(after.script, before.script);
  assert.deepEqual(after.scenes, before.scenes);

  await deleteScript(id);
});

test('a deleted scene can be put back, renumbering and counts included', async () => {
  const id = await threeScenes();
  const before = await snapshotScript(id);
  const { scenes } = await loadScript(id);

  await deleteScene(id, scenes[1].id);
  assert.equal((await loadScript(id)).script.sceneCount, 2);

  await restoreScript(before);
  const after = await loadScript(id);
  assert.deepEqual(textsOf(after.scenes), ['One.', 'Two.', 'Three.']);
  assert.equal(after.script.sceneCount, 3);

  await deleteScript(id);
});

// --- importing from a link --------------------------------------------------

const { renderImport } = await import('../src/ui/import-view.js');

const submitLink = async (view, value) => {
  view.querySelector('.link-input').value = value;
  view
    .querySelector('.link-row')
    .dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  for (let i = 0; i < 8; i++) await tick();
};

test('a link that the browser is not allowed to read says so, beside the field', async () => {
  // The failure this feature will hit most often. A browser reports a CORS
  // refusal as an anonymous network error, so the risk is showing the user
  // nothing, or something wrong like "not found".
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  const view = await renderImport();
  await submitLink(view, 'https://example.com/scene.txt');

  const problem = view.querySelector('.problem');
  assert.equal(problem.hidden, false, 'the message must actually be shown');
  assert.match(problem.textContent, /not allowed/);
  assert.match(problem.textContent, /raw file link/, 'and it must say what to try instead');
  assert.ok(view.querySelector('.link-input'), 'the link stays on screen to be corrected');

  globalThis.fetch = original;
});

test('a link to a real script loads it into the preview', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    text: async () => 'KEEPER: You are late.\n\nVISITOR: I walked.',
  });

  const view = await renderImport();
  await submitLink(view, 'github.com/someone/scripts/blob/main/lighthouse.txt');

  assert.match(view.textContent, /You are late/, 'the script reaches the preview');
  assert.equal(
    view.querySelector('.title-input').value,
    'lighthouse',
    'and the filename from the link becomes the title',
  );

  globalThis.fetch = original;
});

// --- reading more than one part ---------------------------------------------
//
// One actor covering several small parts is the ordinary case in a school
// production, not an edge case.

const { renderSetup } = await import('../src/ui/setup-view.js');

// Ticking a box only runs its activation behaviour — and so fires `change` —
// while the node is in the document. A detached tree silently toggles and tells
// nobody, which reads exactly like a broken handler.
const mount = (view) => {
  document.getElementById('app').replaceChildren(view);
  return view;
};

/**
 * Poll until `fn` returns something truthy.
 *
 * A button that saves does so in an async handler nothing hands back, and one
 * turn of the event loop is not reliably enough for the write to land. Waiting
 * a fixed tick passes most runs and fails one in twenty, which is worse than
 * failing every time.
 */
async function eventually(fn, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const value = await fn();
    if (value) return value;
    await tick();
  }
  throw new Error('condition never became true');
}

const bothParts = async (id) => {
  const { script, scenes } = await loadScript(id);
  await saveRehearsalSetup(id, {
    userCharacterIds: script.characters.map((c) => c.id),
    sceneIds: scenes.map((s) => s.id),
  });
  return script;
};

test('setup offers every part as a checkbox and saves all that are ticked', async () => {
  const id = await twoHander();
  const view = mount(await renderSetup(id));

  const boxes = [...view.querySelectorAll('input[name="user-character"]')];
  assert.equal(boxes.length, 2);
  assert.deepEqual(
    boxes.map((b) => b.type),
    ['checkbox', 'checkbox'],
    'a radio would make the second part cost you the first',
  );

  boxes[1].click(); // the first is already ticked as the default
  view.querySelector('.actions .primary').click();

  const saved = await eventually(async () => {
    const { script } = await loadScript(id);
    return script.userCharacterIds.length === 2 ? script : null;
  });
  assert.deepEqual(
    saved.characters.filter((c) => saved.userCharacterIds.includes(c.id)).map((c) => c.name),
    ['MIRA', 'DEV'],
  );

  await deleteScript(id);
});

test('unticking every part disables Start, since a run needs someone to read', async () => {
  const id = await twoHander();
  const view = mount(await renderSetup(id));

  for (const box of view.querySelectorAll('input[name="user-character"]:checked')) box.click();
  assert.equal(view.querySelector('.actions .primary').disabled, true);

  await deleteScript(id);
});

test('a part you read is not offered a voice, however many you read', async () => {
  const id = await twoHander();
  await bothParts(id);

  const view = await renderSetup(id);
  assert.equal(view.querySelectorAll('.voice-row').length, 0);
  assert.match(view.textContent, /taken every part/i);

  await deleteScript(id);
});

test('the stage names which of your parts is speaking', async () => {
  const id = await twoHander();
  const script = await bothParts(id);

  const view = await renderRehearse(id);
  await tick();
  view.querySelector('.stage').click(); // begin
  await tick();

  // "You" alone cannot say which part, and the line arrives while you are
  // standing a metre away mid-scene.
  assert.equal(view.querySelector('.line.current .speaker').textContent, 'You · MIRA');

  view.querySelector('.stage').click();
  await tick();
  assert.equal(view.querySelector('.line.current .speaker').textContent, 'You · DEV');

  await deleteScript(id);
});

test('with one part it stays plain "You", since there is nothing to tell apart', async () => {
  // A fresh script: the one above left a resume bookmark, and resuming would
  // start this run on a different line than the assertion is about.
  const id = await twoHander();
  const { script, scenes } = await loadScript(id);
  await saveRehearsalSetup(id, {
    userCharacterIds: [script.characters.find((c) => c.name === 'MIRA').id],
    sceneIds: scenes.map((s) => s.id),
  });

  const view = await renderRehearse(id);
  await tick();
  view.querySelector('.stage').click();
  await tick();
  assert.equal(view.querySelector('.line.current .speaker').textContent, 'You');

  await deleteScript(id);
});

test('line counts and cast marks cover every part you read', async () => {
  const id = await twoHander();
  await bothParts(id);

  const view = await renderScript(id);
  assert.match(view.textContent, /3 lines yours/);
  assert.equal(view.querySelectorAll('.cast .chip.mine').length, 2);

  const library = await renderLibrary();
  assert.match(library.textContent, /you play MIRA and DEV/);

  await deleteScript(id);
});

test('a setup saved before parts were a list still loads', async () => {
  const id = await twoHander();
  const snapshot = await snapshotScript(id);
  const mira = snapshot.script.characters.find((c) => c.name === 'MIRA');

  // Written the old way, straight past saveRehearsalSetup.
  await restoreScript({
    ...snapshot,
    script: { ...snapshot.script, userCharacterId: mira.id, sceneIds: [snapshot.scenes[0].id] },
  });

  const { script } = await loadScript(id);
  assert.deepEqual(script.userCharacterIds, [mira.id], 'nobody has to set their script up again');

  await deleteScript(id);
});

// --- choosing between the two kinds of voice ---------------------------------

const withHighQuality = async (fn, { supported = true } = {}) => {
  updateSettings({ voiceQuality: 'high' });
  // kokoro's support check wants an AudioContext, which jsdom has no notion of.
  if (supported) globalThis.AudioContext = class {};
  try {
    return await fn();
  } finally {
    delete globalThis.AudioContext;
    updateSettings({ voiceQuality: 'device' });
  }
};

test('with high quality on, setup offers the neural voices and says how good each is', async () => {
  const id = await twoHander();
  const { script, scenes } = await loadScript(id);
  await saveRehearsalSetup(id, {
    userCharacterIds: [script.characters.find((c) => c.name === 'MIRA').id],
    sceneIds: scenes.map((s) => s.id),
  });

  await withHighQuality(async () => {
    const view = mount(await renderSetup(id));

    const options = [...view.querySelectorAll('.voice-select option')];
    assert.ok(options.length, 'the run speaks in these, so they are what setup must offer');
    assert.ok(
      options.every((o) => /^[a-z]{2}_[a-z]+$/.test(o.value)),
      'neural voice ids, not device voiceURIs',
    );
    // The question the screen has to answer is which ones are the good ones.
    assert.match(options[0].textContent, /Heart · American female · A/);
    assert.match(view.textContent, /grade is the model’s own rating/);
  });

  await deleteScript(id);
});

test('a neural voice chosen in setup is the one the run uses', async () => {
  const id = await twoHander();
  const { script, scenes } = await loadScript(id);
  await saveRehearsalSetup(id, {
    userCharacterIds: [script.characters.find((c) => c.name === 'MIRA').id],
    sceneIds: scenes.map((s) => s.id),
  });

  await withHighQuality(async () => {
    const view = mount(await renderSetup(id));
    const select = view.querySelector('.voice-select');
    select.value = 'bm_george';
    select.dispatchEvent(new window.Event('change'));
    view.querySelector('.actions .primary').click();

    const saved = await eventually(async () => {
      const { script: s } = await loadScript(id);
      return s.characters.find((c) => c.name === 'DEV')?.kokoroVoice ? s : null;
    });
    assert.equal(saved.characters.find((c) => c.name === 'DEV').kokoroVoice, 'bm_george');
  });

  await deleteScript(id);
});

test('a browser that cannot run the neural voices falls back to the device list', async () => {
  const id = await twoHander();
  const { script, scenes } = await loadScript(id);
  await saveRehearsalSetup(id, {
    userCharacterIds: [script.characters.find((c) => c.name === 'MIRA').id],
    sceneIds: scenes.map((s) => s.id),
  });

  globalThis.speechSynthesis = {
    getVoices: () => [{ name: 'Alice', voiceURI: 'uri:Alice', lang: 'en-GB', localService: true }],
    addEventListener() {},
    removeEventListener() {},
  };

  await withHighQuality(
    async () => {
      const view = await renderSetup(id);
      assert.match(view.textContent, /cannot run them, so the device voices below/i);
      assert.deepEqual(
        [...view.querySelectorAll('.voice-select option')].map((o) => o.value),
        ['uri:Alice'],
      );
    },
    { supported: false },
  );

  delete globalThis.speechSynthesis;
  await deleteScript(id);
});

test('and says so plainly when there are no voices of either kind', async () => {
  const id = await twoHander();
  const { script, scenes } = await loadScript(id);
  await saveRehearsalSetup(id, {
    userCharacterIds: [script.characters.find((c) => c.name === 'MIRA').id],
    sceneIds: scenes.map((s) => s.id),
  });

  // No AudioContext and no speechSynthesis. Rendering an empty picker here
  // reads as a broken screen; it used to throw on the empty list instead.
  await withHighQuality(
    async () => {
      const view = await renderSetup(id);
      assert.match(view.textContent, /no voices of its own either/i);
      assert.equal(view.querySelectorAll('.voice-select').length, 0);
    },
    { supported: false },
  );

  await deleteScript(id);
});
