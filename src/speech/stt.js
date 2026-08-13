// Adapter over SpeechRecognition.
//
// Three facts drive the design. Chrome ends a recognition session on its own
// after a stretch of silence even with `continuous` set, so listening means a
// restart loop rather than a single start(). The recogniser is server-side —
// audio goes to Google and comes back as text — so it needs a connection. And
// a session's events keep arriving after it has been aborted, so every handler
// has to know whether it still speaks for the live session.

const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;

const BENIGN = new Set(['no-speech', 'aborted']);
const REFUSED = new Set(['not-allowed', 'service-not-allowed']);
const MAX_BACKOFF_MS = 2000;

export const isSupported = () => Boolean(Recognition);

/**
 * @param onResult  transcript of everything heard since the last mark()
 * @param onStatus  'listening' | 'idle' | 'denied' | 'error'
 */
export function createListener({ lang = 'en-US', onResult, onStatus } = {}) {
  let recognition = null;
  let wanted = false;
  let restarts = 0;
  let restartTimer = null;

  // abort() delivers onend asynchronously, so a session that has already been
  // replaced still fires its handlers. Without this guard the dead session's
  // onend nulls out the live one and schedules a restart on top of it — which
  // aborts the live session, which fires another onend, and the microphone
  // cycles open and shut until something gives.
  let generation = 0;

  // Where in the current session's results the caller's interest begins.
  // The session outlives a single line, so each line re-baselines rather than
  // tearing the microphone down and building it back up.
  let baseline = 0;
  let seen = 0;

  function build(id) {
    const r = new Recognition();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    const live = () => id === generation;

    r.onstart = () => {
      if (!live()) return;
      restarts = 0;
      baseline = 0; // a fresh session's results start empty
      seen = 0;
      onStatus?.('listening');
    };

    r.onresult = (event) => {
      if (!live()) return;
      seen = event.results.length;
      let transcript = '';
      for (let i = baseline; i < event.results.length; i++) {
        transcript += `${event.results[i][0].transcript} `;
      }
      onResult?.(transcript.trim());
    };

    r.onerror = (event) => {
      if (!live()) return;
      if (BENIGN.has(event.error)) return; // silence and deliberate aborts
      if (REFUSED.has(event.error)) {
        wanted = false;
        onStatus?.('denied');
        return;
      }
      onStatus?.('error', event.error);
    };

    r.onend = () => {
      if (!live()) return; // a session we already replaced; it owns nothing now
      recognition = null;
      if (!wanted) return onStatus?.('idle');
      // Chrome ends the session on silence. Back off, so a recogniser that
      // refuses to run does not spin.
      const delay = Math.min(MAX_BACKOFF_MS, 100 * 2 ** restarts++);
      restartTimer = setTimeout(start, delay);
    };

    return r;
  }

  function start() {
    if (!isSupported() || recognition) return; // already listening
    wanted = true;
    const id = ++generation;
    try {
      recognition = build(id);
      recognition.start();
    } catch {
      recognition = null; // start() throws if a session is somehow still live
    }
  }

  /**
   * Treat everything heard so far as belonging to the previous line. Lets one
   * session serve consecutive lines without closing the microphone between
   * them — a speech broken up by stage directions is several lines in a row
   * for the same character, and cycling the microphone through each of them
   * is both slow and, on some devices, audible.
   */
  function mark() {
    baseline = seen;
  }

  function stop() {
    wanted = false;
    clearTimeout(restartTimer);
    generation += 1; // everything still in flight from the old session is stale
    const live = recognition;
    recognition = null;
    live?.abort(); // abort, not stop: it takes effect at once
    onStatus?.('idle');
  }

  return { start, stop, mark, isSupported: isSupported() };
}
