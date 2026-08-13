// Where you were last. Not a preference — a bookmark — so it lives apart from
// settings, and a corrupt or stale value is simply forgotten rather than
// migrated.

const KEY = 'prompt-book:last-run';

export function getLastRun() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!stored?.scriptId || typeof stored.index !== 'number') return null;
    return stored;
  } catch {
    return null;
  }
}

export function setLastRun({ scriptId, index, total, sceneTitle }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ scriptId, index, total, sceneTitle }));
  } catch {
    // A bookmark that cannot be stored is not worth interrupting a run for.
  }
}

export function clearLastRun(scriptId) {
  const stored = getLastRun();
  if (scriptId && stored?.scriptId !== scriptId) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
