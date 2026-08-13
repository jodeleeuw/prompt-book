// Copies the OCR engine's runtime assets into public/ocr/.
//
// They are served from our own origin rather than a CDN: the app is a PWA
// expected to work on a tablet in a rehearsal room, and a third-party runtime
// fetch is a dependency the rest of the app does not have. They are also
// gitignored — megabytes of binaries do not belong in the history — so this
// runs automatically before dev and build.
//
// The core filenames are read out of the worker rather than listed here. The
// first version of this file hand-listed them, guessed wrong about which
// variant a current browser picks, and shipped a build that failed at the
// first scan with a NetworkError. The worker is the only thing that actually
// knows.

import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/ocr');

const WORKER = 'node_modules/tesseract.js/dist/worker.min.js';
const CORE_DIR = 'node_modules/tesseract.js-core';
const LANG = 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz';

// src/ocr/engine.js pins oem: 1 (LSTM only), so only the -lstm cores are
// reachable. Change that and this filter has to change with it.
const REACHABLE = /-lstm\.wasm\.js$/;

function coreFilenames() {
  const worker = readFileSync(resolve(root, WORKER), 'utf8');
  const referenced = [...worker.matchAll(/tesseract-core[\w-]*\.wasm\.js/g)].map((m) => m[0]);
  const wanted = [...new Set(referenced)].filter((name) => REACHABLE.test(name));

  if (!wanted.length) {
    console.error(
      `No core variants matched ${REACHABLE} in ${WORKER}.\n` +
        `tesseract.js has probably renamed them — check what it references and update REACHABLE.`,
    );
    process.exit(1);
  }
  return wanted;
}

const assets = [
  [WORKER, 'worker.min.js'],
  [LANG, 'eng.traineddata.gz'],
  // The worker importScripts these; each embeds its own wasm, so the bare
  // .wasm files alongside them are never requested and are not copied.
  ...coreFilenames().map((name) => [`${CORE_DIR}/${name}`, name]),
];

mkdirSync(out, { recursive: true });

for (const [from, to] of assets) {
  const source = resolve(root, from);
  if (!existsSync(source)) {
    console.error(`missing: ${from}\nrun npm install`);
    process.exit(1);
  }
  copyFileSync(source, resolve(out, to));
}

console.log(`ocr assets: ${assets.length} files into public/ocr/`);
for (const [, name] of assets) console.log(`  ${name}`);
