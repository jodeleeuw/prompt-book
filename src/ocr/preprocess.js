// Photographs are not scans. A phone picture of a page carries a colour cast,
// an uneven exposure and far more resolution than the recogniser wants. These
// three things — downscale, grey, stretch the contrast — are most of the
// accuracy difference between a usable result and a useless one.

const MAX_EDGE = 2000; // beyond this OCR gets slower without getting better
const CLIP = 0.02; // ignore the extreme 2% at each end when stretching

/**
 * Convert RGBA to grey and stretch the result to the full range, in place.
 *
 * Pure, and separated from the canvas on purpose: this is the part with
 * arithmetic worth testing, and jsdom has no canvas to test it through.
 */
export function greyAndStretch(rgba) {
  const histogram = new Uint32Array(256);
  const grey = new Uint8ClampedArray(rgba.length / 4);

  for (let i = 0, g = 0; i < rgba.length; i += 4, g++) {
    // Rec. 601 luma: closer to perceived lightness than a flat average, which
    // matters for the blue-grey cast of a page shot under room light.
    const value = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
    grey[g] = value;
    histogram[value | 0]++;
  }

  const total = grey.length;
  const clip = total * CLIP;
  let low = 0;
  let high = 255;
  for (let count = 0; low < 255; low++) {
    count += histogram[low];
    if (count > clip) break;
  }
  for (let count = 0; high > 0; high--) {
    count += histogram[high];
    if (count > clip) break;
  }

  const span = Math.max(high - low, 1);
  for (let i = 0, g = 0; i < rgba.length; i += 4, g++) {
    const stretched = ((grey[g] - low) * 255) / span;
    const value = stretched < 0 ? 0 : stretched > 255 ? 255 : stretched;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = value;
    rgba[i + 3] = 255;
  }
  return rgba;
}

/** Longest edge capped at MAX_EDGE, aspect kept. */
export function fitted(width, height, max = MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Prepare one photo for recognition.
 * @param rotation quarter turns clockwise, applied before anything else
 * @returns a canvas the OCR engine can read
 */
export async function prepare(blob, rotation = 0) {
  const bitmap = await createImageBitmap(blob);
  const turned = rotation % 2 !== 0;
  const source = {
    width: turned ? bitmap.height : bitmap.width,
    height: turned ? bitmap.width : bitmap.height,
  };
  const { width, height } = fitted(source.width, source.height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  context.translate(width / 2, height / 2);
  context.rotate((rotation * Math.PI) / 2);
  const drawWidth = turned ? height : width;
  const drawHeight = turned ? width : height;
  context.drawImage(bitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.setTransform(1, 0, 0, 1, 0, 0);
  bitmap.close?.();

  const image = context.getImageData(0, 0, width, height);
  greyAndStretch(image.data);
  context.putImageData(image, 0, 0);

  return canvas;
}
