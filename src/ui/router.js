import { h } from './dom.js';
import { renderLibrary } from './library-view.js';
import { renderImport } from './import-view.js';
import { renderScript } from './script-view.js';

const routes = [
  [/^#?\/?$/, renderLibrary],
  [/^#\/import$/, renderImport],
  [/^#\/script\/([^/]+)$/, (m) => renderScript(m[1])],
];

export const navigate = (hash) => {
  window.location.hash = hash;
};

function errorView(err) {
  console.error(err);
  return h(
    'main',
    { class: 'page' },
    h('h1', { class: 'title' }, 'Something went wrong'),
    h('p', { class: 'note' }, err?.message ?? String(err)),
    h('a', { class: 'button', href: '#/' }, 'Back to library'),
  );
}

export function startRouter() {
  const app = document.getElementById('app');

  const run = async () => {
    const hash = window.location.hash || '#/';
    const route = routes.find(([pattern]) => pattern.test(hash));
    if (!route) return navigate('#/');
    const match = hash.match(route[0]);
    try {
      app.replaceChildren(await route[1](match));
    } catch (err) {
      app.replaceChildren(errorView(err));
    }
    window.scrollTo(0, 0);
  };

  window.addEventListener('hashchange', run);
  run();
}
