import { h, plural } from './dom.js';
import { listScripts } from '../store/library.js';

export async function renderLibrary() {
  const scripts = await listScripts();

  return h(
    'main',
    { class: 'page' },
    h(
      'header',
      { class: 'masthead' },
      h('h1', { class: 'title' }, 'Prompt Book'),
      h('p', { class: 'subtitle' }, 'Rehearse your lines.'),
    ),
    scripts.length ? scriptList(scripts) : emptyState(),
    h('div', { class: 'actions' }, h('a', { class: 'button', href: '#/import' }, 'Import a script')),
  );
}

const emptyState = () =>
  h(
    'div',
    { class: 'empty' },
    h('p', null, 'No scripts yet.'),
    h('p', { class: 'note' }, 'Import a plain-text script to get started. You’ll be able to correct anything the parser guesses wrong before it’s saved.'),
  );

const scriptList = (scripts) =>
  h(
    'ul',
    { class: 'script-list' },
    scripts.map((script) =>
      h(
        'li',
        null,
        h(
          'a',
          { class: 'script-card', href: `#/script/${script.id}` },
          h('span', { class: 'script-title' }, script.title),
          h(
            'span',
            { class: 'script-meta' },
            [
              plural(script.sceneCount ?? 0, 'scene'),
              plural(script.lineCount ?? 0, 'line'),
              plural(script.characters?.length ?? 0, 'character'),
            ].join(' · '),
          ),
        ),
      ),
    ),
  );
