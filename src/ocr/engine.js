// Adapter over the OCR engine. Like the speech adapters, it knows nothing
// about scripts — it turns an image into positioned words.
//
// Loaded on demand. The engine and its language data are about 5.7MB, which is
// several hundred times the rest of the app, and nobody who never scans a page
// should pay for it. It is also deliberately absent from the service worker's
// precache; the browser caches it normally after first use.

import { normalisePage } from './layout.js';

const base = import.meta.env?.BASE_URL ?? '/';

let worker = null;
let loading = null;

/** Progress arrives as 0–1 with a stage name the UI can show. */
async function getWorker(onProgress) {
  if (worker) return worker;
  if (loading) return loading;

  loading = (async () => {
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker('eng', 1, {
      workerPath: `${base}ocr/worker.min.js`,
      corePath: `${base}ocr/`,
      langPath: `${base}ocr/`,
      gzip: true,
      logger: (message) => {
        if (typeof message?.progress === 'number') {
          onProgress?.({ stage: message.status ?? 'working', progress: message.progress });
        }
      },
    });
    return worker;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/**
 * Recognise one prepared image.
 * @returns {{ pageWidth: number, lines: object[] }}
 */
export async function recognise(image, { onProgress } = {}) {
  const engine = await getWorker(onProgress);

  // Word boxes are the whole point — without them a cue is indistinguishable
  // from a short line of dialogue. Older builds ignore the third argument and
  // return lines anyway, which normalisePage also accepts.
  const { data } = await engine.recognize(image, {}, { blocks: true, text: true });

  const page = normalisePage(data);
  if (!page.pageWidth && image?.width) page.pageWidth = image.width;
  return page;
}

/** Free the worker and its several megabytes once scanning is finished. */
export async function release() {
  const engine = worker;
  worker = null;
  await engine?.terminate?.().catch(() => {});
}

export const isSupported = () =>
  typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof createImageBitmap !== 'undefined';
