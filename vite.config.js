import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig } from 'vite';

const BASE = '/prompt-book/';

// The OCR engine is loaded on demand and is larger than the rest of the app by
// three orders of magnitude. Precaching it would turn a 60kB install into a
// 6MB one for everybody, including people who never scan a page.
const PRECACHE_EXCLUDE = /^ocr\//;

/** Every file under public/, as URLs, so icons and the manifest work offline too. */
function publicFiles(dir = 'public', root = 'public') {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? publicFiles(full, root)
      : [relative(root, full).split(/[\\/]/).join('/')];
  });
}

/**
 * The app shell: the entry chunk and everything it imports *statically*, plus
 * stylesheets.
 *
 * Anything reachable only through a dynamic import is deliberately left out.
 * Precaching every emitted file put the lazily-loaded speech engine and its
 * 20MB of WebAssembly into the install — 22.8MB downloaded by everyone,
 * including the majority who never turn that feature on. The fetch handler
 * still caches those on first use, so the feature works offline once used.
 */
function shellFiles(bundle) {
  const shell = new Set();

  const walk = (name) => {
    const chunk = bundle[name];
    if (!chunk || shell.has(name)) return;
    shell.add(name);
    for (const dependency of chunk.imports ?? []) walk(dependency); // static only
    for (const css of chunk.viteMetadata?.importedCss ?? []) shell.add(css);
  };

  for (const [name, output] of Object.entries(bundle)) {
    if (output.type === 'chunk' && output.isEntry) walk(name);
    if (output.type === 'asset' && name.endsWith('.css')) shell.add(name);
  }

  // Belt and braces: a WebAssembly binary is never part of a shell.
  return [...shell].filter((name) => !name.endsWith('.wasm'));
}

/**
 * Emits a service worker that precaches the build.
 *
 * Hand-rolled rather than pulled from a toolkit: the shell is a handful of
 * files, and an inspectable worker is worth more here than a dependency whose
 * behaviour has to be configured back down to this.
 */
function serviceWorker() {
  return {
    name: 'prompt-book-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = [
        BASE,
        ...shellFiles(bundle).map((file) => BASE + file),
        ...publicFiles()
          .filter((file) => !PRECACHE_EXCLUDE.test(file))
          .map((file) => BASE + file),
      ].sort();

      // The cache name changes with its contents, which is what retires the
      // previous one on activate.
      const version = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);

      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker(assets, version) });
    },
  };
}

const worker = (assets, version) => `// Generated at build time. Do not edit.
const CACHE = 'prompt-book-${version}';
const PRECACHE = ${JSON.stringify(assets, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // speech recognition, and anything else remote

  // Hash routing means every navigation is the same document.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('${BASE}').then((hit) => hit ?? fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
`;

// `host: true` so the dev server is reachable from the tablet over the LAN.
export default defineConfig({
  base: BASE,
  server: { host: true },
  plugins: [serviceWorker()],
});
