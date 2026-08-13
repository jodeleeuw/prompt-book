// Adapter over speechSynthesis. Knows nothing about rehearsal — it speaks a
// string in a voice and resolves when the utterance ends.

const KEEPALIVE_MS = 10_000;
const VOICE_TIMEOUT_MS = 2000;

export const isSupported = () => typeof speechSynthesis !== 'undefined';

/**
 * getVoices() is empty until the engine has loaded them and fires
 * `voiceschanged` — which some browsers never fire at all, hence the timeout.
 */
export function loadVoices() {
  if (!isSupported()) return Promise.resolve([]);
  const ready = speechSynthesis.getVoices();
  if (ready.length) return Promise.resolve(ready);

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve(speechSynthesis.getVoices());
    };
    const timer = setTimeout(finish, VOICE_TIMEOUT_MS);
    speechSynthesis.addEventListener('voiceschanged', finish);
  });
}

/**
 * Speak `text`, resolving when it finishes.
 *
 * Cancellation resolves rather than rejects: a cancelled utterance is a normal
 * part of pausing or skipping, not a failure the caller should handle.
 */
export function createSpeaker({ voiceFor, rate = 1, pitch = 1 } = {}) {
  let utterance = null; // held so it is not collected before its events fire
  let keepalive = null;

  const stopKeepalive = () => {
    clearInterval(keepalive);
    keepalive = null;
  };

  const cancel = () => {
    stopKeepalive();
    utterance = null;
    if (isSupported()) speechSynthesis.cancel();
  };

  const speak = (line) =>
    new Promise((resolve, reject) => {
      if (!isSupported()) return reject(new Error('This browser cannot speak.'));

      const u = new SpeechSynthesisUtterance(line.text);
      const voice = voiceFor?.(line);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = rate;
      u.pitch = pitch;

      u.onend = () => {
        stopKeepalive();
        utterance = null;
        resolve();
      };
      u.onerror = (event) => {
        stopKeepalive();
        utterance = null;
        if (event.error === 'interrupted' || event.error === 'canceled') resolve();
        else reject(new Error(`Speech failed: ${event.error}`));
      };

      utterance = u;
      speechSynthesis.speak(u);

      // Chrome stops synthesising after ~15s of a single utterance unless
      // nudged. Harmless where the bug is absent.
      keepalive = setInterval(() => speechSynthesis.resume(), KEEPALIVE_MS);
    });

  return { speak, cancel };
}
