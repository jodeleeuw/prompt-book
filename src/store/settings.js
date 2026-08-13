// App-wide preferences. localStorage rather than IndexedDB: these are tiny,
// and the theme has to be applied synchronously at startup to avoid a flash of
// the wrong one.

const KEY = 'prompt-book:settings';

export const THEMES = [
  { id: 'system', label: 'Match the device' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export const HIDE_LEVELS = [
  { id: 'full', label: 'Full text', hint: 'Read your lines as written.' },
  {
    id: 'opening',
    label: 'First two words',
    hint: 'To be, ·· ··· ·· ·· — enough to start you off.',
  },
  { id: 'hidden', label: 'Hidden', hint: 'Rhythm and punctuation only.' },
];

export const STAGE_GROUNDS = [
  {
    id: 'dark',
    label: 'Always dark',
    hint: 'A lit page at a metre, in a dim room, is punishing to read from.',
  },
  { id: 'theme', label: 'Follow the app theme', hint: 'Rehearse on the same ground as everything else.' },
];

export const SILENCE_CHOICES = [
  { id: 1500, label: 'Brisk', hint: 'Moves on 1.5s after you stop.' },
  { id: 2500, label: 'Natural', hint: 'Moves on 2.5s after you stop.' },
  { id: 4000, label: 'Unhurried', hint: 'Moves on 4s after you stop — room to breathe.' },
];

const DEFAULTS = { theme: 'system', hideLevel: 'full', silenceMs: 2500, stage: 'dark' };

let cache = null;

export function getSettings() {
  if (cache) return cache;
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    stored = {}; // private mode, or a value from an older shape
  }
  cache = sanitise({ ...DEFAULTS, ...stored });
  return cache;
}

/**
 * A value from an earlier version of a list — 'initials', say — must never
 * reach the UI. It has no label to render, and the rehearsal screen would
 * throw while drawing its own controls.
 */
function sanitise(settings) {
  if (!HIDE_LEVELS.some((level) => level.id === settings.hideLevel)) {
    settings.hideLevel = DEFAULTS.hideLevel;
  }
  if (!STAGE_GROUNDS.some((ground) => ground.id === settings.stage)) {
    settings.stage = DEFAULTS.stage;
  }
  if (!THEMES.some((theme) => theme.id === settings.theme)) settings.theme = DEFAULTS.theme;
  return settings;
}

/** The full hide-level record, never undefined. */
export const hideLevel = (id) =>
  HIDE_LEVELS.find((level) => level.id === id) ??
  HIDE_LEVELS.find((level) => level.id === DEFAULTS.hideLevel);

export function updateSettings(patch) {
  cache = sanitise({ ...getSettings(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Preferences that cannot be stored still apply for this session.
  }
  if ('theme' in patch) applyTheme(cache.theme);
  if ('stage' in patch) applyStage(cache.stage);
  return cache;
}

/** Applies both stored appearance choices. Called once before the first paint. */
export function applyPreferences() {
  applyTheme();
  applyStage();
}

/**
 * 'dark' is the default and leaves the attribute off, because the stage rules
 * are written as the exception rather than the norm.
 */
export function applyStage(stage = getSettings().stage) {
  const root = document.documentElement;
  if (stage === 'theme') root.setAttribute('data-stage', 'theme');
  else root.removeAttribute('data-stage');
}

/** 'system' leaves the attribute off, so prefers-color-scheme decides. */
export function applyTheme(theme = getSettings().theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
