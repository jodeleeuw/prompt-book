import { h } from './dom.js';
import { section, choice } from './controls.js';
import {
  getSettings,
  updateSettings,
  THEMES,
  STAGE_GROUNDS,
  VOICE_QUALITY,
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
      'Rehearsal ground',
      'Running a scene is its own room. The device usually sits a metre away in low light, so the stage is dark whatever the app theme is.',
      STAGE_GROUNDS,
  VOICE_QUALITY,
      settings.stage,
      'stage',
    ),
    group(
      'Voices',
      'How the other characters are spoken. High quality runs a neural model on this device — nothing is uploaded, but the model itself is downloaded once from Hugging Face.',
      VOICE_QUALITY,
      settings.voiceQuality,
      'voiceQuality',
    ),
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
