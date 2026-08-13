import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig } from 'vite';

const BASE = '/prompt-book/';

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
 * Emits a service worker that precaches the build.
 *
 * Hand-rolled rather than pulled from a toolkit: the app is three files and a
 * handful of icons, and an inspectable 60-line worker is worth more here than
 * a dependency whose behaviour has to be configured back down to this.
 */
function serviceWorker() {
  return {
    name: 'prompt-book-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = [
        BASE,
        ...Object.keys(bundle).map((file) => BASE + file),
        ...publicFiles().map((file) => BASE + file),
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
