// On-device neural speech, as an alternative to the device's own voices.
//
// Same shape as createSpeaker in tts.js — speak(line) resolves when the line
// finishes, cancel() silences it — so the rehearsal engine needs no knowledge
// that this exists.
//
// Two facts shape it. The weights are large — 92MB quantised, 326MB at full
// precision, which is what a device with WebGPU fetches — so they are loaded
// only when chosen and only once. And generation runs at roughly 2.5x realtime
// on a CPU, which is fast enough to stay ahead of a scene but far too slow to
// start when the line is already due — hence prefetch(), which the run calls
// for the next line while the current one is still playing.

import { kokoroVoice } from './kokoro-voices.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const SAMPLE_LIMIT = 40; // generated lines kept in memory

let engine = null;

/**
 * One number out of many concurrent downloads.
 *
 * Progress arrives per file with several in flight, so forwarding the reports
 * straight through makes a percentage jump between a 500-byte config at 90% and
 * the 326MB model at 3%. Summing does not rescue a percentage either: the
 * denominator only exists for files that have already announced themselves, so
 * the config finishing first reads as 100% and then sits there for the rest of
 * the download.
 *
 * Reporting both figures instead lets the screen say "40 MB of 326 MB" — the
 * denominator is measured rather than assumed, which matters because the size
 * depends on which weights the device gets.
 */
export function aggregateProgress(onProgress) {
  if (!onProgress) return undefined;

  const files = new Map();
  let high = 0;

  return (report) => {
    const file = report?.file;
    if (!file) return;

    if (report.status === 'done' || report.status === 'ready') {
      const seen = files.get(file);
      if (!seen) return;
      seen.loaded = seen.total; // the last chunk often goes unreported
    } else if (typeof report.loaded === 'number' && report.total > 0) {
      files.set(file, { loaded: report.loaded, total: report.total });
    } else {
      return;
    }

    let loaded = 0;
    let total = 0;
    for (const entry of files.values()) {
      loaded += entry.loaded;
      total += entry.total;
    }

    high = Math.max(high, loaded); // a retried file restarting must not rewind it
    onProgress({ loaded: high, total });
  };
}

/** WebGPU is several times faster; fp32 is the recommended dtype there. */
async function bestBackend() {
  try {
    if (navigator.gpu && (await navigator.gpu.requestAdapter())) {
      return { device: 'webgpu', dtype: 'fp32' };
    }
  } catch {
    // no WebGPU; fall through
  }
  return { device: 'wasm', dtype: 'q8' };
}

/**
 * Load the model once per session. The browser caches the weights, so this is
 * slow the first time and quick afterwards.
 */
export function loadKokoro({ onProgress } = {}) {
  if (engine) return engine;

  engine = (async () => {
    const { KokoroTTS } = await import('kokoro-js');

    // Weights and runtime are fetched from Hugging Face and the ONNX Runtime
    // CDN rather than served from here. Unlike the OCR engine — 15MB, worth
    // self-hosting — this is ~100MB, and self-hosting it would put that in
    // every deploy for a feature most runs never turn on.
    const { device, dtype } = await bestBackend();
    const tts = await KokoroTTS.from_pretrained(MODEL, {
      device,
      dtype,
      progress_callback: aggregateProgress(onProgress),
    });
    return { tts, device };
  })();

  engine = engine.catch((error) => {
    engine = null; // a failed load must not poison every later attempt
    throw error;
  });

  return engine;
}

export const isSupported = () =>
  typeof AudioContext !== 'undefined' && typeof WebAssembly !== 'undefined';

/**
 * @param voiceFor   line -> Kokoro voice id
 * @param rate       speaking speed, 1 is normal
 * @param load       how to get the model; replaced in tests, which have no
 *                   business fetching 326MB to check a queue
 */
export function createKokoroSpeaker({ voiceFor, rate = 1, onProgress, load = loadKokoro } = {}) {
  const audio = new AudioContext();
  const cache = new Map(); // key -> Promise<RawAudio>
  let source = null;
  let cancelled = false;

  let queue = [];
  let draining = false;

  const keyFor = (line, voice) => `${voice}|${rate}|${line.text}`;
  const ready = (line) => cache.has(keyFor(line, kokoroVoice(voiceFor?.(line)).id));

  /**
   * Work through the lookahead one line at a time.
   *
   * The model generates serially whatever it is asked, so starting six lines at
   * once does not make them arrive sooner — it makes the one needed next arrive
   * last. In order, one at a time, is the whole trick.
   */
  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length) {
      try {
        await generate(queue.shift());
      } catch {
        // A failed prefetch is not an error here: speak() will try it again.
      }
    }
    draining = false;
  }

  function generate(line) {
    const voice = kokoroVoice(voiceFor?.(line)).id;
    const key = keyFor(line, voice);
    if (cache.has(key)) return cache.get(key);

    const pending = load({ onProgress }).then(({ tts }) =>
      tts.generate(line.text, { voice, speed: rate }),
    );
    cache.set(key, pending);

    // Bound the cache so a long run does not hold every line's audio.
    if (cache.size > SAMPLE_LIMIT) cache.delete(cache.keys().next().value);
    return pending;
  }

  return {
    /**
     * Start work on the lines that are coming up, nearest first.
     *
     * Takes the whole lookahead rather than one line, and replaces whatever was
     * queued: the caller passes the window from wherever the run now is, so
     * anything left over from the last position is by definition stale.
     */
    prefetch(lines) {
      const wanted = (Array.isArray(lines) ? lines : [lines]).filter((line) => line?.text);
      queue = wanted.filter((line) => !ready(line));
      drain();
    },

    /** Whether a line would play at once. Exposed for the tests. */
    ready,

    speak(line) {
      cancelled = false;
      return generate(line).then((raw) => {
        if (cancelled) return; // silenced while it was still being generated
        return new Promise((resolve) => {
          const buffer = audio.createBuffer(1, raw.audio.length, raw.sampling_rate);
          buffer.copyToChannel(raw.audio, 0);

          source = audio.createBufferSource();
          source.buffer = buffer;
          source.connect(audio.destination);
          // Cancellation resolves rather than rejects, matching the device
          // speaker: a stopped line is part of pausing, not a failure.
          source.onended = () => {
            source = null;
            resolve();
          };
          audio.resume().catch(() => {});
          source.start();
        });
      });
    },

    cancel() {
      cancelled = true;
      const playing = source;
      source = null;
      try {
        playing?.stop();
      } catch {
        // already finished
      }
    },

    close() {
      this.cancel();
      queue = [];
      cache.clear();
      audio.close().catch(() => {});
    },
  };
}
