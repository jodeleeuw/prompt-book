import { h, plural } from './dom.js';
import { loadScript, deleteScript, renameScript } from '../store/library.js';
import { navigate } from './router.js';

export async function renderScript(id) {
  const loaded = await loadScript(id);
  if (!loaded) {
    return h(
      'main',
      { class: 'page' },
      h('h1', { class: 'title' }, 'Not found'),
      h('p', { class: 'note' }, 'That script is no longer in your library.'),
      h('a', { class: 'button', href: '#/' }, 'Back to library'),
    );
  }

  const { script, scenes } = loaded;
  const nameById = new Map(script.characters.map((c) => [c.id, c.name]));

  const titleField = h('input', {
    class: 'title-input',
    type: 'text',
    value: script.title,
    'aria-label': 'Script title',
    onchange: () => renameScript(script.id, titleField.value),
  });

  return h(
    'main',
    { class: 'page' },
    h('a', { class: 'back', href: '#/' }, '← Library'),
    h(
      'header',
      { class: 'masthead' },
      titleField,
      h(
        'p',
        { class: 'subtitle' },
        [plural(scenes.length, 'scene'), plural(script.characters.length, 'character')].join(' · '),
      ),
    ),
    h(
      'p',
      { class: 'cast' },
      script.characters.map((c) => h('span', { class: 'chip' }, c.name)),
    ),
    scenes.map((scene) =>
      h(
        'section',
        { class: 'scene' },
        h('h2', { class: 'scene-title' }, scene.title),
        h(
          'div',
          { class: 'script-body' },
          scene.lines.map((line) =>
            h(
              'p',
              { class: 'line' },
              h('span', { class: 'speaker' }, nameById.get(line.characterId) ?? 'Unknown'),
              h('span', { class: 'speech' }, line.text),
            ),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          class: 'button danger',
          type: 'button',
          onclick: async () => {
            if (!confirm(`Delete “${script.title}”? This can’t be undone.`)) return;
            await deleteScript(script.id);
            navigate('#/');
          },
        },
        'Delete script',
      ),
    ),
  );
}
