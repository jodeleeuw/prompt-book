// The worker only exists in a production build, so registering it in dev would
// just log a 404 — and a stale worker there would serve yesterday's bundle.

export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // No offline support this session. Nothing the reader can act on.
    });
  });
}
