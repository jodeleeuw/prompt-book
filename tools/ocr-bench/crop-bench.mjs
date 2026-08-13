// Does cropping to the page fix it? Tests the best Tesseract config from
// bench.mjs (no preprocessing, PSM auto) against hand-cropped page regions,
// plus a couple of gentler preprocessing options than greyAndStretch.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';

const APP = resolve(import.meta.dirname, '../..');
const HERE = import.meta.dirname;
const OUT = resolve(HERE, 'out');
mkdirSync(OUT, { recursive: true });

const { fitted } = await import(`${APP}/src/ocr/preprocess.js`);
const { normalisePage, pageToScript } = await import(`${APP}/src/ocr/layout.js`);
const { parseText } = await import(`${APP}/src/parse/txt.js`);

// Hand-drawn crops standing in for a crop UI: the printed page only, no facing
// page, no cat, no thumb.
const PAGES = [
  {
    id: '91',
    file: `${APP}/samples/img/PXL_20260813_194504358.jpg`,
    truth: `${HERE}/truth-91.txt`,
    crop: { left: 500, top: 150, width: 2200, height: 3850 },
  },
  {
    id: '92',
    file: `${APP}/samples/img/PXL_20260813_194515741.jpg`,
    truth: `${HERE}/truth-92.txt`,
    crop: { left: 100, top: 200, width: 2050, height: 2240 },
  },
];

const tokens = (s) => s.toLowerCase().replace(/[^a-z0-9']+/g, ' ').split(/\s+/).filter(Boolean);

function wordAccuracy(truth, got) {
  const a = tokens(truth);
  const b = tokens(got);
  if (!a.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return Math.max(0, 1 - prev[b.length] / a.length);
}

const VARIANTS = [
  { name: 'uncropped, no preproc @2000', crop: false, treat: 'none', maxEdge: 2000 },
  { name: 'CROPPED, no preproc @2000', crop: true, treat: 'none', maxEdge: 2000 },
  { name: 'CROPPED, no preproc @2600', crop: true, treat: 'none', maxEdge: 2600 },
  { name: 'CROPPED, greyscale @2000', crop: true, treat: 'grey', maxEdge: 2000 },
  { name: 'CROPPED, grey+normalise @2000', crop: true, treat: 'normalise', maxEdge: 2000 },
  { name: 'CROPPED, grey+sharpen @2000', crop: true, treat: 'sharpen', maxEdge: 2000 },
];

async function prepare(page, variant) {
  let pipeline = sharp(page.file).rotate();
  if (variant.crop) pipeline = pipeline.extract(page.crop);

  const meta = await pipeline.png().toBuffer({ resolveWithObject: true });
  const { width, height } = fitted(meta.info.width, meta.info.height, variant.maxEdge);

  let out = sharp(meta.data).resize(width, height);
  if (variant.treat === 'grey') out = out.greyscale();
  // `normalise` is a per-image histogram stretch — the same idea as
  // greyAndStretch but computed by libvips rather than by hand.
  if (variant.treat === 'normalise') out = out.greyscale().normalise();
  if (variant.treat === 'sharpen') out = out.greyscale().sharpen();
  return out.png().toBuffer();
}

const worker = await createWorker('eng', 1, {
  langPath: `${APP}/public/ocr`,
  gzip: true,
  cachePath: OUT,
});
await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });

const results = [];
for (const page of PAGES) {
  const truth = readFileSync(page.truth, 'utf8');
  for (const variant of VARIANTS) {
    const image = await prepare(page, variant);
    const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
    const structured = pageToScript(normalisePage(data));
    const parsed = parseText(structured.text);

    results.push({
      page: page.id,
      variant: variant.name,
      accuracy: wordAccuracy(truth, data.text ?? ''),
      confidence: structured.confidence,
      characters: parsed.characters,
      lines: parsed.scenes.flatMap((s) => s.lines).filter((l) => l.kind === 'dialogue').length,
    });
    writeFileSync(
      resolve(OUT, `crop-p${page.id}-${variant.name.replace(/[^a-z0-9]+/gi, '-')}.txt`),
      `=== RAW ===\n${data.text}\n\n=== STRUCTURED ===\n${structured.text}\n`,
    );
    process.stderr.write('.');
  }
}
await worker.terminate();
process.stderr.write('\n');

for (const page of ['91', '92']) {
  console.log(`\nPAGE ${page}`);
  console.log('  ' + 'variant'.padEnd(34) + 'word%  conf  lines  cast');
  for (const r of results.filter((r) => r.page === page)) {
    console.log(
      '  ' +
        r.variant.padEnd(34) +
        (r.accuracy * 100).toFixed(0).padStart(5) +
        r.confidence.toFixed(0).padStart(6) +
        String(r.lines).padStart(7) +
        '  ' +
        (r.characters.join(', ') || '(none)'),
    );
  }
}
