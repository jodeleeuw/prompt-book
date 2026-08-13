// Rebuilding a script from OCR word positions.
//
// This is the part that makes photo import worth having. OCR returns text in
// reading order and throws away where on the page it sat — but a script *is*
// its layout: a character cue is a cue because it is indented or centred, not
// because of anything in the words themselves. Flatten that and "MIRA" becomes
// indistinguishable from a line of dialogue that happens to be short.
//
// So we keep the x-positions and reconstruct the shape, emitting plain text in
// the form the existing parser already understands.

const CUE_MAX_WORDS = 5;

/** The most common left edge, to a tolerance — the body text margin. */
function bodyMargin(lines, tolerance) {
  const buckets = new Map();
  for (const line of lines) {
    const key = Math.round(line.left / tolerance);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [key, count] of buckets) {
    // Ties go to the leftmost bucket: body text is the left-most thing that
    // repeats, and indented blocks can be just as numerous in dialogue-heavy
    // pages.
    if (count > bestCount || (count === bestCount && key < best)) {
      best = key;
      bestCount = count;
    }
  }
  return best * tolerance;
}

const isUpperish = (text) => {
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (!letters) return false;
  const upper = text.replace(/[^A-Z]/g, '');
  return upper.length / letters.length >= 0.8;
};

/**
 * A cue is short, upper-case, and set in from the body margin — either
 * indented (screenplay) or roughly centred (many stage-play editions).
 */
function looksLikeCue(line, margin, pageWidth) {
  if (!line.text || line.words > CUE_MAX_WORDS) return false;
  if (!isUpperish(line.text)) return false;
  if (/[.!?,;:]$/.test(line.text.trim())) return false;

  const indent = line.left - margin;
  const indented = indent > pageWidth * 0.12;
  const pageCentre = pageWidth / 2;
  const centred = Math.abs((line.left + line.right) / 2 - pageCentre) < pageWidth * 0.08;

  return indented || centred;
}

/**
 * @param page {{ pageWidth: number, lines: Array<{text, left, right, words, confidence}> }}
 * @returns {{ text: string, confidence: number }} plain text the txt parser reads
 */
export function pageToScript(page) {
  const lines = (page.lines ?? []).filter((line) => line.text?.trim());
  if (!lines.length) return { text: '', confidence: 0 };

  const pageWidth = page.pageWidth || Math.max(...lines.map((l) => l.right)) || 1;
  const margin = bodyMargin(lines, Math.max(pageWidth * 0.02, 1));

  const out = [];
  let previous = null;

  for (const line of lines) {
    const text = line.text.trim();
    const cue = looksLikeCue(line, margin, pageWidth);

    // A cue starts a new speech, so it needs the blank line the parser uses to
    // close the one before it.
    if (cue && out.length && previous !== 'blank') out.push('');
    // Dialogue running back out to the body margin after an indented block is
    // a new paragraph of action, not a continuation of the speech.
    else if (!cue && previous === 'dialogue' && line.left <= margin + pageWidth * 0.04) {
      out.push('');
    }

    out.push(text);
    previous = cue ? 'cue' : 'dialogue';
  }

  const weighted = lines.reduce((sum, l) => sum + (l.confidence ?? 0) * (l.words || 1), 0);
  const words = lines.reduce((sum, l) => sum + (l.words || 1), 0);

  return { text: out.join('\n'), confidence: words ? weighted / words : 0 };
}

/**
 * Normalise whatever shape the OCR engine returned into the one above.
 * Engines disagree about where lines live, and versions move them.
 */
export function normalisePage(data) {
  const pageWidth =
    data?.pageWidth ?? data?.width ?? (data?.blocks?.[0]?.bbox ? undefined : undefined);

  const collected =
    data?.lines ??
    data?.blocks?.flatMap((block) => block.paragraphs?.flatMap((p) => p.lines ?? []) ?? []) ??
    [];

  const lines = collected
    .map((line) => {
      const words = line.words ?? [];
      const text = (line.text ?? words.map((w) => w.text).join(' ')).replace(/\s+/g, ' ').trim();
      const boxes = words.map((w) => w.bbox).filter(Boolean);
      const left = line.bbox?.x0 ?? (boxes.length ? Math.min(...boxes.map((b) => b.x0)) : 0);
      const right = line.bbox?.x1 ?? (boxes.length ? Math.max(...boxes.map((b) => b.x1)) : 0);
      return {
        text,
        left,
        right,
        words: words.length || text.split(/\s+/).filter(Boolean).length,
        confidence: line.confidence ?? 0,
      };
    })
    .filter((line) => line.text);

  return {
    pageWidth: pageWidth ?? (lines.length ? Math.max(...lines.map((l) => l.right)) : 0),
    lines,
  };
}
