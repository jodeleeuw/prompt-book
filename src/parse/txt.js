// Plain-text script parser.
//
// Pure: string in, draft scene list out. No DOM, no storage. Everything it
// produces is a *guess* that the import preview lets the user correct before
// anything is saved or stripped.

import { SCENE_HEADING, dialogue, direction, finalize } from './lines.js';

const DIVIDER = /^[-*_=]{3,}$/;
const ACT_HEADING = /^(ACT|SCENE|PROLOGUE|EPILOGUE)\b[^.!?]{0,60}$/i;
const SPEAKER_COLON = /^([^:]{1,40}):[ \t]*(.*)$/;
const WRAPPED = /^(\(.*\)|\[.*\]|\*[^*].*\*|_[^_].*_)$/;

// Deliberately narrow: freeform text uses parentheses for all sorts of things,
// so only well-known cue extensions are removed from a name.
function cleanName(raw) {
  return raw
    .trim()
    .replace(/\s*\((cont'?d|continued|o\.s\.|o\.c\.|v\.o\.)\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// A speaker label, not a sentence that happens to contain a colon.
function isSpeakerLabel(raw) {
  const t = raw.trim();
  if (!t || t.length > 40) return false;
  if (!/[A-Za-z]/.test(t)) return false; // rules out timestamps like "10:30"
  if (/[.!?,;]$/.test(t)) return false;
  return t.split(/\s+/).length <= 5;
}

// A character name standing alone on its own line — conventionally uppercase.
function isNameOnly(raw) {
  const t = cleanName(raw);
  if (!t || t.length > 40) return false;
  if (/[.!?,;:]$/.test(t)) return false;
  if (t.split(/\s+/).length > 4) return false;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (!letters) return false;
  const upper = t.replace(/[^A-Z]/g, '');
  return upper.length / letters.length >= 0.8;
}

export function parseText(input) {
  const rawLines = String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
  const scenes = [];
  let scene = { title: null, lines: [] };
  let speaker = null;
  let current = null; // open speech, so wrapped lines join one utterance

  const flush = () => {
    if (scene.lines.length) scenes.push(scene);
  };
  const startScene = (title) => {
    flush();
    scene = { title: title || null, lines: [] };
    speaker = null;
    current = null;
  };

  for (const raw of rawLines) {
    const line = raw.trim();

    if (!line) {
      speaker = null;
      current = null;
      continue;
    }
    if (DIVIDER.test(line)) {
      startScene(null);
      continue;
    }
    if (SCENE_HEADING.test(line) || ACT_HEADING.test(line)) {
      startScene(line);
      continue;
    }
    if (WRAPPED.test(line)) {
      scene.lines.push(direction(line));
      current = null;
      continue;
    }

    const m = line.match(SPEAKER_COLON);
    if (m && isSpeakerLabel(m[1])) {
      speaker = cleanName(m[1]);
      current = dialogue(speaker, m[2].trim());
      scene.lines.push(current);
      continue;
    }
    if (isNameOnly(line)) {
      speaker = cleanName(line);
      current = null;
      continue;
    }
    if (speaker) {
      if (current) current.text = current.text ? `${current.text} ${line}` : line;
      else {
        current = dialogue(speaker, line);
        scene.lines.push(current);
      }
      continue;
    }

    scene.lines.push(direction(line));
    current = null;
  }
  flush();

  return finalize(scenes);
}
