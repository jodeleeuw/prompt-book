// OCR bench: runs the app's real pipeline plus variants over the sample photos
// and scores each against a transcription.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';

const APP = resolve(import.meta.dirname, '../..');
const HERE = import.meta.dirname;
const OUT = resolve(HERE, 'out');
mkdirSync(OUT, { recursive: true });

const { greyAndStretch, fitted } = await import(`${APP}/src/ocr/preprocess.js`);
const { normalisePage, pageToScript } = await import(`${APP}/src/ocr/layout.js`);
const { parseText } = await import(`${APP}/src/parse/txt.js`);

const PAGES = [
  { id: '91', file: `${APP}/samples/img/PXL_20260813_194504358.jpg`, truth: `${HERE}/truth-91.txt` },
  { id: '92', file: `${APP}/samples/img/PXL_20260813_194515741.jpg`, truth: `${HERE}/truth-92.txt` },
];

// ---- scoring ---------------------------------------------------------------

const tokens = (s) =>
  s.toLowerCase().replace(/[^a-z0-9']+/g, ' ').split(/\s+/).filter(Boolean);

/** Word-level accuracy: 1 - (edit distance / truth length). */
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

// ---- image preparation -----------------------------------------------------

async function prepare(file, { maxEdge, stretch }) {
  let pipeline = sharp(file).rotate(); // honour EXIF orientation
  const meta = await pipeline.metadata();

  if (maxEdge) {
    const { width, height } = fitted(meta.width, meta.height, maxEdge);
    pipeline = pipeline.resize(width, height);
  }

  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (stretch) greyAndStretch(data); // the app's own arithmetic, unchanged

  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

// ---- variants --------------------------------------------------------------

const VARIANTS = [
  { name: 'shipped (2000px + stretch, PSM auto)', maxEdge: 2000, stretch: true, psm: PSM.AUTO },
  { name: 'no preprocessing (2000px, PSM auto)', maxEdge: 2000, stretch: false, psm: PSM.AUTO },
  { name: 'full res + stretch, PSM auto', maxEdge: null, stretch: true, psm: PSM.AUTO },
  { name: 'full res, no preprocessing, PSM auto', maxEdge: null, stretch: false, psm: PSM.AUTO },
  { name: 'full res + stretch, PSM single column', maxEdge: null, stretch: true, psm: PSM.SINGLE_COLUMN },
  { name: 'full res + stretch, PSM uniform block', maxEdge: null, stretch: true, psm: PSM.SINGLE_BLOCK },
  { name: 'full res, no preproc, PSM single column', maxEdge: null, stretch: false, psm: PSM.SINGLE_COLUMN },
];

const worker = await createWorker('eng', 1, {
  langPath: `${APP}/public/ocr`,
  gzip: true,
  cachePath: OUT,
});

const results = [];

for (const page of PAGES) {
  const truth = readFileSync(page.truth, 'utf8');

  for (const variant of VARIANTS) {
    const started = Date.now();
    const image = await prepare(page.file, variant);
    await worker.setParameters({ tessedit_pageseg_mode: variant.psm });

    const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    const raw = data.text ?? '';
    const structured = pageToScript(normalisePage(data));
    const parsed = parseText(structured.text);
    const cues = parsed.scenes.flatMap((s) => s.lines).filter((l) => l.kind === 'dialogue').length;

    results.push({
      page: page.id,
      variant: variant.name,
      seconds,
      rawAccuracy: wordAccuracy(truth, raw),
      structuredAccuracy: wordAccuracy(truth, structured.text),
      confidence: structured.confidence,
      characters: parsed.characters,
      cues,
    });

    writeFileSync(
      resolve(OUT, `p${page.id}-${variant.name.replace(/[^a-z0-9]+/gi, '-')}.txt`),
      `=== RAW ===\n${raw}\n\n=== STRUCTURED ===\n${structured.text}\n`,
    );
    process.stderr.write('.');
  }
}

await worker.terminate();
process.stderr.write('\n\n');

for (const page of ['91', '92']) {
  console.log(`\nPAGE ${page}`);
  console.log('  ' + 'variant'.padEnd(42) + 'raw%  struct%  conf  cues  cast');
  for (const r of results.filter((r) => r.page === page)) {
    console.log(
      '  ' +
        r.variant.padEnd(42) +
        (r.rawAccuracy * 100).toFixed(0).padStart(4) +
        (r.structuredAccuracy * 100).toFixed(0).padStart(8) +
        r.confidence.toFixed(0).padStart(6) +
        String(r.cues).padStart(6) +
        '  ' +
        (r.characters.slice(0, 4).join(',') || '(none)'),
    );
  }
}
writeFileSync(resolve(OUT, 'results.json'), JSON.stringify(results, null, 2));
