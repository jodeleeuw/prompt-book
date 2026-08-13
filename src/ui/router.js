import { h } from './dom.js';
import { renderLibrary } from './library-view.js';
import { renderImport } from './import-view.js';
import { renderScript } from './script-view.js';
import { renderSetup } from './setup-view.js';
import { renderRehearse } from './rehearse-view.js';
import { renderSettings } from './settings-view.js';

const routes = [
  [/^#?\/?$/, renderLibrary],
  [/^#\/import$/, renderImport],
  [/^#\/settings$/, renderSettings],
  [/^#\/script\/([^/]+)\/setup$/, (m) => renderSetup(m[1])],
  [/^#\/script\/([^/]+)\/rehearse$/, (m) => renderRehearse(m[1])],
  [/^#\/script\/([^/]+)$/, (m) => renderScript(m[1])],
];

export const navigate = (hash) => {
  window.location.hash = hash;
};

// Views mutate storage and then need the route rebuilt from it. Re-running the
// route keeps the store as the single source of truth rather than patching the
// DOM to match a write that may not have landed.
let rerun = () => {};
export const refresh = async () => {
  const y = window.scrollY;
  await rerun();
  window.scrollTo(0, y);
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

  rerun = run;
  window.addEventListener('hashchange', run);
  run();
}
