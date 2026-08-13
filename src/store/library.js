import * as db from './db.js';

const uid = () => crypto.randomUUID();

export async function listScripts() {
  const scripts = await db.getAll('scripts');
  return scripts.sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadScript(id) {
  const script = await db.get('scripts', id);
  if (!script) return null;
  const scenes = await db.getAllBy('scenes', 'scriptId', id);
  scenes.sort((a, b) => a.order - b.order);
  return { script, scenes };
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
    sceneCount: sceneRecords.length,
    lineCount: sceneRecords.reduce((n, s) => n + s.lines.length, 0),
  };

  await db.writeAll([['scripts', script], ...sceneRecords.map((s) => ['scenes', s])]);
  return scriptId;
}

export async function renameScript(id, title) {
  const script = await db.get('scripts', id);
  if (!script) return;
  await db.put('scripts', { ...script, title: title.trim() || script.title });
}

export async function deleteScript(id) {
  const scenes = await db.getAllBy('scenes', 'scriptId', id);
  await db.deleteAll([['scripts', id], ...scenes.map((s) => ['scenes', s.id])]);
}
