// The service worker precaches everything the manifest points at, and
// cache.addAll is atomic: one missing file disables offline support entirely
// and silently. These checks are cheap insurance against that.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path));
const manifest = JSON.parse(read('public/manifest.webmanifest').toString());

/** width and height out of a PNG's IHDR chunk. */
function pngSize(buffer) {
  assert.deepEqual(
    [...buffer.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'not a PNG',
  );
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('every icon the manifest names exists, at the size it claims', () => {
  for (const icon of manifest.icons) {
    const path = `public/${icon.src.replace(/^\.\//, '')}`;
    assert.ok(existsSync(resolve(root, path)), `${path} is missing`);

    const [declared] = icon.sizes.split('x').map(Number);
    const { width, height } = pngSize(read(path));
    assert.equal(width, declared, `${path} is ${width}px, not ${declared}`);
    assert.equal(height, declared);
  }
});

test('there is a maskable icon, so Android does not letterbox the mark', () => {
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});

test('start_url and scope are relative, so the base path is not baked in', () => {
  assert.match(manifest.start_url, /^\.\//);
  assert.match(manifest.scope, /^\.\//);
});

test('index.html links the manifest and the icons that exist', () => {
  const html = read('index.html').toString();
  assert.match(html, /rel="manifest"/);

  for (const href of html.matchAll(/(?:href|src)="\/((?:icons|favicon)[^"]*)"/g)) {
    assert.ok(existsSync(resolve(root, 'public', href[1])), `${href[1]} is missing`);
  }
});

test('the app declares a theme colour for both schemes', () => {
  const html = read('index.html').toString();
  assert.match(html, /theme-color"[^>]*prefers-color-scheme: light/);
  assert.match(html, /theme-color"[^>]*prefers-color-scheme: dark/);
});
