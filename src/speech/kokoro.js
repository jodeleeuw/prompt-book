// On-device neural speech, as an alternative to the device's own voices.
//
// Same shape as createSpeaker in tts.js — speak(line) resolves when the line
// finishes, cancel() silences it — so the rehearsal engine needs no knowledge
// that this exists.
//
// Two facts shape it. The model is about 88MB and the runtime another 11–21MB,
// so it is loaded only when chosen and only once. And generation runs at
// roughly 2.5x realtime on a CPU, which is fast enough to stay ahead of a scene
// but far too slow to start when the line is already due — hence prefetch(),
// which the run calls for the next line while the current one is still playing.

import { kokoroVoice } from './kokoro-voices.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const SAMPLE_LIMIT = 40; // generated lines kept in memory

let engine = null;

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
      progress_callback: (report) => {
        if (typeof report?.progress === 'number') {
          onProgress?.({ stage: report.status ?? 'loading', progress: report.progress / 100 });
        }
      },
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
 */
export function createKokoroSpeaker({ voiceFor, rate = 1, onProgress } = {}) {
  const audio = new AudioContext();
  const cache = new Map(); // key -> Promise<RawAudio>
  let source = null;
  let cancelled = false;

  const keyFor = (line, voice) => `${voice}|${rate}|${line.text}`;

  function generate(line) {
    const voice = kokoroVoice(voiceFor?.(line)).id;
    const key = keyFor(line, voice);
    if (cache.has(key)) return cache.get(key);

    const pending = loadKokoro({ onProgress }).then(({ tts }) =>
      tts.generate(line.text, { voice, speed: rate }),
    );
    cache.set(key, pending);

    // Bound the cache so a long run does not hold every line's audio.
    if (cache.size > SAMPLE_LIMIT) cache.delete(cache.keys().next().value);
    return pending;
  }

  return {
    /** Start work on a line that is coming up, so it is ready when due. */
    prefetch(line) {
      if (!line?.text) return;
      generate(line).catch(() => {}); // a failed prefetch is retried by speak()
    },

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
      cache.clear();
      audio.close().catch(() => {});
    },
  };
}
