// Shared vocabulary for the format parsers. Every parser emits the same draft
// shape, so the import preview and commit step never need to know the source
// format.

const PAREN_GROUP = /\(([^()]*)\)|\[([^[\]]*)\]/g;

export const SCENE_HEADING = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;

export const dialogue = (character, text) => ({ kind: 'dialogue', character, text });
export const direction = (text) => ({ kind: 'direction', character: null, text });

/** Split dialogue into plain-text and parenthetical segments, in order. */
export function segmentParens(text) {
  const re = new RegExp(PAREN_GROUP.source, 'g');
  const out = [];
  let last = 0;
  let index = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    out.push({ type: 'paren', value: m[0], index: index++ });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/** Rebuild a line's text, keeping only the parentheticals flagged `keep`. */
export function applyParens(text, parens = []) {
  return segmentParens(text)
    .filter((seg) => seg.type === 'text' || parens[seg.index]?.keep)
    .map((seg) => seg.value)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove Fountain emphasis markup so it is neither displayed nor spoken. */
export function stripEmphasis(text) {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1');
}

/** Distinct character names, in order of first appearance. */
export function characterNames(scenes) {
  const seen = new Set();
  for (const scene of scenes) {
    for (const line of scene.lines) {
      if (line.kind === 'dialogue' && line.character) seen.add(line.character);
    }
  }
  return [...seen];
}

/** Normalise a parser's raw scene list into the draft the preview edits. */
export function finalize(scenes) {
  let n = 0;
  const out = scenes
    .map((scene) => ({
      title: scene.title || null,
      lines: scene.lines
        .filter((line) => line.text.trim().length > 0)
        .map((line) => ({
          id: `l${n++}`,
          kind: line.kind,
          character: line.character,
          text: line.text.trim(),
          parens: segmentParens(line.text)
            .filter((seg) => seg.type === 'paren')
            .map((seg) => ({ text: seg.value, keep: false })),
        })),
    }))
    .filter((scene) => scene.lines.length > 0)
    .map((scene, i) => ({ ...scene, title: scene.title || `Scene ${i + 1}` }));

  return { scenes: out, characters: characterNames(out) };
}
