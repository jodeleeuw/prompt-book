import * as db from './db.js';

const uid = () => crypto.randomUUID();

const counts = (scenes) => ({
  sceneCount: scenes.length,
  lineCount: scenes.reduce((n, scene) => n + scene.lines.length, 0),
});

const ordered = (scenes) => [...scenes].sort((a, b) => a.order - b.order);

const scenesOf = async (scriptId) => ordered(await db.getAllBy('scenes', 'scriptId', scriptId));

export async function listScripts() {
  const scripts = await db.getAll('scripts');
  return scripts.sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadScript(id) {
  const script = await db.get('scripts', id);
  if (!script) return null;
  return { script, scenes: await scenesOf(id) };
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
