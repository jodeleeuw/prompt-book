import { h } from './dom.js';
import { section, choice } from './controls.js';
import {
  getSettings,
  updateSettings,
  THEMES,
  HIDE_LEVELS,
  SILENCE_CHOICES,
} from '../store/settings.js';

export async function renderSettings() {
  const settings = getSettings();

  const group = (title, note, options, current, key) =>
    section(
      title,
      note,
      h(
        'div',
        { class: 'choices' },
        options.map((option) =>
          choice(
            'radio',
            key,
            option.label,
            current === option.id,
            (on) => on && updateSettings({ [key]: option.id }),
            option.hint,
          ),
        ),
      ),
    );

  return h(
    'main',
    { class: 'page' },
    h('a', { class: 'back', href: '#/' }, '← Library'),
    h('header', { class: 'masthead' }, h('h1', { class: 'title' }, 'Settings')),
    group('Appearance', null, THEMES, settings.theme, 'theme'),
    group(
      'Your lines',
      'Where a run starts. You can still change it mid-rehearsal.',
      HIDE_LEVELS,
      settings.hideLevel,
      'hideLevel',
    ),
    group(
      'Waiting for you',
      'How long a silence has to last before the run decides your line is over. Only applies when voice cueing is on.',
      SILENCE_CHOICES,
      settings.silenceMs,
      'silenceMs',
    ),
  );
}
