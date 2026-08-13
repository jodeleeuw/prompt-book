// Keep the screen alive during a run. A tablet on a music stand will otherwise
// blank in the middle of a scene.
//
// The lock is dropped by the browser whenever the page is hidden, so it has to
// be taken again on the way back rather than assumed to still be held.

export function createWakeLock() {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  let sentinel = null;
  let wanted = false;

  async function take() {
    if (!supported || !wanted || sentinel || document.visibilityState !== 'visible') return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null;
      });
    } catch {
      sentinel = null; // refused, or the battery is too low — not worth surfacing
    }
  }

  const onVisibility = () => take();
  if (supported) document.addEventListener('visibilitychange', onVisibility);

  return {
    supported,
    /** Call from a user gesture — some browsers refuse otherwise. */
    request() {
      wanted = true;
      return take();
    },
    release() {
      wanted = false;
      const held = sentinel;
      sentinel = null;
      held?.release?.().catch(() => {});
    },
    destroy() {
      this.release();
      if (supported) document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
