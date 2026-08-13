import { applyParens } from './txt.js';

/**
 * Turn a reviewed draft into the shape `createScript` persists.
 *
 * This is the moment stage directions and unkept parentheticals are actually
 * discarded — deliberately one pure function, so what gets thrown away is
 * testable rather than buried in a click handler.
 */
export function commitDraft(draft) {
  const scenes = draft.scenes
    .map((scene) => ({
      title: scene.title,
      lines: scene.lines
        .filter((line) => line.kind === 'dialogue' && line.character)
        .map((line) => ({ character: line.character, text: spokenText(line) }))
        .filter((line) => line.text),
    }))
    .filter((scene) => scene.lines.length);

  return { title: draft.title, scenes };
}

/**
 * Stripping parentheticals must never empty a line the user assigned to a
 * character — a line wholly inside brackets, promoted from a stage direction,
 * would otherwise vanish without trace. Losing a line is worse than speaking
 * a bracket, so the full text wins.
 */
function spokenText(line) {
  const stripped = applyParens(line.text, line.parens);
  return stripped || line.text.trim();
}
