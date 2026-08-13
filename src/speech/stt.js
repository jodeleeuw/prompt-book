// Adapter over SpeechRecognition.
//
// Two facts drive the design. Chrome ends a recognition session on its own
// after a stretch of silence even with `continuous` set, so listening means a
// restart loop rather than a single start(). And the recogniser is server-side
// — audio goes to Google and comes back as text — so it needs a connection.

const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;

const BENIGN = new Set(['no-speech', 'aborted']);
const REFUSED = new Set(['not-allowed', 'service-not-allowed']);
const MAX_BACKOFF_MS = 2000;

export const isSupported = () => Boolean(Recognition);

/**
 * @param onResult  called with the transcript so far, interim results included
 * @param onStatus  'listening' | 'idle' | 'denied' | 'error'
 */
export function createListener({ lang = 'en-US', onResult, onStatus } = {}) {
  let recognition = null;
  let wanted = false;
  let restarts = 0;
  let restartTimer = null;

  function build() {
    const r = new Recognition();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onstart = () => {
      restarts = 0;
      onStatus?.('listening');
    };

    // `results` accumulates for the life of a session, so this is everything
    // heard since the last restart — which is where the end of a line will be.
    r.onresult = (event) => {
      let transcript = '';
      for (const result of event.results) transcript += `${result[0].transcript} `;
      onResult?.(transcript.trim());
    };

    r.onerror = (event) => {
      if (BENIGN.has(event.error)) return; // silence and deliberate aborts
      if (REFUSED.has(event.error)) {
        wanted = false;
        onStatus?.('denied');
        return;
      }
      onStatus?.('error', event.error);
    };

    r.onend = () => {
      recognition = null;
      if (!wanted) return onStatus?.('idle');
      // Back off, so a recogniser that refuses to run does not spin.
      const delay = Math.min(MAX_BACKOFF_MS, 100 * 2 ** restarts++);
      restartTimer = setTimeout(start, delay);
    };

    return r;
  }

  function start() {
    if (!isSupported() || recognition) return;
    wanted = true;
    try {
      recognition = build();
      recognition.start();
    } catch {
      recognition = null; // start() throws if a session is somehow still live
    }
  }

  function stop() {
    wanted = false;
    clearTimeout(restartTimer);
    const live = recognition;
    recognition = null;
    live?.abort(); // abort, not stop: it takes effect at once
    onStatus?.('idle');
  }

  return { start, stop, isSupported: isSupported() };
}
