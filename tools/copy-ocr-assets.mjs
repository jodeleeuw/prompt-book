// Copies the OCR engine's runtime assets into public/ocr/.
//
// They are served from our own origin rather than a CDN: the app is a PWA that
// is expected to work on a tablet in a rehearsal room, and a third-party
// runtime fetch is a dependency the rest of the app does not have. They are
// also gitignored — 5.7MB of binaries do not belong in the history — so this
// runs automatically before dev and build.

import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/ocr');

// The integerised "best" model: close to the full model's accuracy on printed
// text at 2.8MB rather than 10MB.
const ASSETS = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.js', 'tesseract-core-simd-lstm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.js', 'tesseract-core-lstm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];

mkdirSync(out, { recursive: true });

let copied = 0;
for (const [from, to] of ASSETS) {
  const source = resolve(root, from);
  if (!existsSync(source)) {
    console.error(`missing: ${from} — run npm install`);
    process.exit(1);
  }
  copyFileSync(source, resolve(out, to));
  copied++;
}
console.log(`ocr assets: ${copied} files into public/ocr/`);
