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

export const SILENCE_CHOICES = [
  { id: 1500, label: 'Brisk', hint: 'Moves on 1.5s after you stop.' },
  { id: 2500, label: 'Natural', hint: 'Moves on 2.5s after you stop.' },
  { id: 4000, label: 'Unhurried', hint: 'Moves on 4s after you stop — room to breathe.' },
];

const DEFAULTS = { theme: 'system', hideLevel: 'full', silenceMs: 2500 };

let cache = null;

export function getSettings() {
  if (cache) return cache;
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    stored = {}; // private mode, or a value from an older shape
  }
  cache = { ...DEFAULTS, ...stored };
  // A stored value from an earlier version of a list — 'initials', say — would
  // otherwise silently fall through to showing the full line.
  if (!HIDE_LEVELS.some((level) => level.id === cache.hideLevel)) {
    cache.hideLevel = DEFAULTS.hideLevel;
  }
  return cache;
}

export function updateSettings(patch) {
  cache = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Preferences that cannot be stored still apply for this session.
  }
  if ('theme' in patch) applyTheme(cache.theme);
  return cache;
}

/** 'system' leaves the attribute off, so prefers-color-scheme decides. */
export function applyTheme(theme = getSettings().theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
