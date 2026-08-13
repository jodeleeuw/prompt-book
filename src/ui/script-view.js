import { h, plural } from './dom.js';
import {
  loadScript,
  deleteScript,
  renameScript,
  renameScene,
  moveScene,
  deleteScene,
} from '../store/library.js';
import { navigate, refresh } from './router.js';

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

  const sceneSection = (scene, i) => {
    const title = h('input', {
      class: 'scene-title-input',
      type: 'text',
      value: scene.title,
      'aria-label': 'Scene title',
      onchange: () => renameScene(scene.id, title.value),
    });

    const move = (delta, label, glyph) =>
      h(
        'button',
        {
          class: 'icon',
          type: 'button',
          'aria-label': `Move ${scene.title} ${label}`,
          disabled: delta < 0 ? i === 0 : i === scenes.length - 1,
          onclick: async () => {
            await moveScene(script.id, scene.id, delta);
            refresh();
          },
        },
        glyph,
      );

    return h(
      'section',
      { class: 'scene' },
      h(
        'div',
        { class: 'scene-controls' },
        title,
        move(-1, 'up', '↑'),
        move(1, 'down', '↓'),
        h(
          'button',
          {
            class: 'icon danger',
            type: 'button',
            'aria-label': `Delete ${scene.title}`,
            onclick: async () => {
              if (!confirm(`Delete “${scene.title}” and its ${plural(scene.lines.length, 'line')}?`)) return;
              await deleteScene(script.id, scene.id);
              refresh();
            },
          },
          '×',
        ),
      ),
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
    );
  };

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
    scenes.length
      ? scenes.map(sceneSection)
      : h('p', { class: 'note' }, 'Every scene has been deleted. Import the script again to start over.'),
    h(
      'div',
      { class: 'actions' },
      scenes.length &&
        h('a', { class: 'button primary', href: `#/script/${script.id}/setup` }, 'Rehearse'),
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
