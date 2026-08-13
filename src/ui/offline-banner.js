import { h } from './dom.js';

/**
 * Being offline is a partial loss, not a failure: scripts, voices and tapping
 * all still work, and only voice cueing needs the network. The banner says
 * which, so an offline run is not mistaken for a broken one.
 */
export function mountOfflineBanner() {
  const banner = h(
    'div',
    { class: 'offline-banner', role: 'status', hidden: true },
    'Offline — your scripts are all here. Voice cueing needs a connection.',
  );

  const update = () => {
    banner.hidden = navigator.onLine !== false;
  };

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();

  document.body.append(banner);
  return banner;
}
