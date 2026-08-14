import * as db from './db.js';

const uid = () => crypto.randomUUID();

const counts = (scenes) => ({
  sceneCount: scenes.length,
  lineCount: scenes.reduce((n, scene) => n + scene.lines.length, 0),
});

const ordered = (scenes) => [...scenes].sort((a, b) => a.order - b.order);

const scenesOf = async (scriptId) => ordered(await db.getAllBy('scenes', 'scriptId', scriptId));

/**
 * Fill in the parts the user reads as a list.
 *
 * One person often covers several small parts in a scene, so this is a list
 * rather than a single id. Saves made before that was true hold one
 * `userCharacterId`; they are widened here, on the way out of storage, so no
 * view has to know both shapes and nobody has to set their script up again.
 */
const hydrate = (script) => ({
  ...script,
  userCharacterIds: Array.isArray(script.userCharacterIds)
    ? script.userCharacterIds
    : script.userCharacterId
      ? [script.userCharacterId]
      : [],
});

export async function listScripts() {
  const scripts = await db.getAll('scripts');
  return scripts.sort((a, b) => b.createdAt - a.createdAt).map(hydrate);
}

export async function loadScript(id) {
  const script = await db.get('scripts', id);
  if (!script) return null;
  return { script: hydrate(script), scenes: await scenesOf(id) };
}

/**
 * Persist a committed import.
 * `scenes` is [{ title, lines: [{ character, text }] }] — dialogue only,
 * directions already dropped by the preview.
 */
export async function createScript({ title, scenes }) {
  const scriptId = uid();
  const names = [...new Set(scenes.flatMap((s) => s.lines.map((l) => l.character)))];
  const characters = names.map((name) => ({ id: uid(), name }));
  const idByName = new Map(characters.map((c) => [c.name, c.id]));

  const sceneRecords = scenes.map((scene, i) => ({
    id: uid(),
    scriptId,
    order: i,
    title: scene.title?.trim() || `Scene ${i + 1}`,
    lines: scene.lines.map((line) => ({
      id: uid(),
      characterId: idByName.get(line.character),
      text: line.text,
    })),
  }));

  const script = {
    id: scriptId,
    title: title?.trim() || 'Untitled script',
    createdAt: Date.now(),
    characters,
    ...counts(sceneRecords),
  };

  await db.transact([
    { store: 'scripts', put: script },
    ...sceneRecords.map((scene) => ({ store: 'scenes', put: scene })),
  ]);
  return scriptId;
}

export async function renameScript(id, title) {
  const script = await db.get('scripts', id);
  if (!script) return;
  await db.transact([{ store: 'scripts', put: { ...script, title: title.trim() || script.title } }]);
}

export async function deleteScript(id) {
  const scenes = await scenesOf(id);
  await db.transact([
    { store: 'scripts', delete: id },
    ...scenes.map((scene) => ({ store: 'scenes', delete: scene.id })),
  ]);
}

/**
 * Remember who you are playing, which scenes are in the run, and which voice
 * each character speaks in. Voices live on the character so they survive
 * between sessions; a voice that no longer exists on the device is reassigned
 * at setup rather than failing silently at rehearsal.
 */
export async function saveRehearsalSetup(scriptId, { userCharacterIds, sceneIds, voiceByCharacterId }) {
  const script = await db.get('scripts', scriptId);
  if (!script) return;

  const characters = script.characters.map((character) => ({
    ...character,
    voiceURI: voiceByCharacterId?.[character.id] ?? character.voiceURI ?? null,
  }));

  // The superseded single-id field goes rather than lingering as a second,
  // quietly disagreeing answer to the same question.
  const { userCharacterId: _superseded, ...rest } = script;

  await db.transact([
    { store: 'scripts', put: { ...rest, characters, userCharacterIds, sceneIds } },
  ]);
}

/**
 * Everything needed to put a script back exactly as it was. Taken before a
 * delete so the deletion can be offered as undo rather than as a confirmation
 * the user has to read.
 */
export async function snapshotScript(id) {
  const script = await db.get('scripts', id);
  if (!script) return null;
  return { script, scenes: await scenesOf(id) };
}

export async function restoreScript(snapshot) {
  if (!snapshot) return;
  await db.transact([
    { store: 'scripts', put: snapshot.script },
    ...snapshot.scenes.map((scene) => ({ store: 'scenes', put: scene })),
  ]);
}

/**
 * Correct the text of a single line.
 *
 * The import preview could reassign a line's character but never fix its
 * words, so a script where two speeches ran together on one line could only be
 * deleted and imported again.
 */
export async function updateLine(sceneId, lineId, text) {
  const scene = await db.get('scenes', sceneId);
  if (!scene) return;
  const trimmed = text.trim();
  if (!trimmed) return; // emptying a line is a delete, and has its own path
  await db.transact([
    {
      store: 'scenes',
      put: {
        ...scene,
        lines: scene.lines.map((line) => (line.id === lineId ? { ...line, text: trimmed } : line)),
      },
    },
  ]);
}

export async function renameScene(sceneId, title) {
  const scene = await db.get('scenes', sceneId);
  if (!scene) return;
  await db.transact([{ store: 'scenes', put: { ...scene, title: title.trim() || scene.title } }]);
}

/** Move a scene by `delta` places. Out-of-range moves are a no-op. */
export async function moveScene(scriptId, sceneId, delta) {
  const scenes = await scenesOf(scriptId);
  const from = scenes.findIndex((scene) => scene.id === sceneId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= scenes.length) return;

  const [moved] = scenes.splice(from, 1);
  scenes.splice(to, 0, moved);
  await db.transact(scenes.map((scene, i) => ({ store: 'scenes', put: { ...scene, order: i } })));
}

export async function deleteScene(scriptId, sceneId) {
  const script = await db.get('scripts', scriptId);
  const scenes = await scenesOf(scriptId);
  const remaining = scenes.filter((scene) => scene.id !== sceneId);
  if (!script || remaining.length === scenes.length) return;

  await db.transact([
    { store: 'scenes', delete: sceneId },
    ...remaining.map((scene, i) => ({ store: 'scenes', put: { ...scene, order: i } })),
    { store: 'scripts', put: { ...script, ...counts(remaining) } },
  ]);
}
