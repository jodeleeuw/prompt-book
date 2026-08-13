// Fountain parser — https://fountain.io/syntax
//
// Covers what rehearsal needs: title page, scene headings and sections,
// character cues, dialogue and parentheticals, action, transitions, lyrics.
// Notes, boneyard and synopses are author annotations and are discarded.

import { SCENE_HEADING, dialogue, direction, finalize, stripEmphasis } from './lines.js';

const TITLE_KEY =
  /^(title|credit|author|authors|source|draft date|date|contact|copyright|notes|revision)\s*:/i;
const TRANSITION = /^[A-Z0-9 ]+TO:$/;
const PAGE_BREAK = /^={3,}$/;
const SECTION = /^#{1,6}\s*/;

// Per the spec any trailing parenthetical on a cue is an extension —
// (V.O.), (CONT'D), (O.S.) — and a trailing ^ marks dual dialogue.
function cleanCharacter(raw) {
  return raw
    .trim()
    .replace(/\s*\^\s*$/, '')
    .replace(/(?:\s*\([^)]*\))+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCharacterCue(line, prevBlank, next) {
  if (!prevBlank || !next.trim()) return false;
  if (TRANSITION.test(line)) return false;
  const name = cleanCharacter(line);
  if (!name || !/[A-Za-z]/.test(name)) return false;
  return name === name.toUpperCase();
}

function readTitlePage(lines) {
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length || !TITLE_KEY.test(lines[i])) return { title: null, start: 0 };

  const fields = {};
  let key = null;
  for (; i < lines.length; i++) {
    if (!lines[i].trim()) break; // the title page ends at the first blank line
    const m = lines[i].match(/^([A-Za-z ]+):\s*(.*)$/);
    if (m && TITLE_KEY.test(lines[i])) {
      key = m[1].trim().toLowerCase();
      fields[key] = m[2].trim();
    } else if (key) {
      fields[key] = `${fields[key] ? `${fields[key]} ` : ''}${lines[i].trim()}`;
    }
  }
  return { title: fields.title ? stripEmphasis(fields.title) : null, start: i };
}

export function parseFountain(input) {
  const text = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '') // boneyard
    .replace(/\[\[[\s\S]*?\]\]/g, ''); // notes

  const all = text.split('\n');
  const { title, start } = readTitlePage(all);
  const lines = all.slice(start);

  const scenes = [];
  let scene = { title: null, lines: [] };
  let speaker = null;
  let current = null;

  const flush = () => {
    if (scene.lines.length) scenes.push(scene);
  };
  const startScene = (sceneTitle) => {
    flush();
    scene = { title: sceneTitle || null, lines: [] };
    speaker = null;
    current = null;
  };
  const speak = (raw) => {
    const spoken = stripEmphasis(raw);
    if (current) current.text = `${current.text} ${spoken}`.trim();
    else {
      current = dialogue(speaker, spoken);
      scene.lines.push(current);
    }
  };
  const act = (raw) => {
    scene.lines.push(direction(stripEmphasis(raw)));
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const prevBlank = i === 0 || !lines[i - 1].trim();
    const next = lines[i + 1] ?? '';

    if (!line) {
      speaker = null;
      current = null;
      continue;
    }
    if (PAGE_BREAK.test(line)) continue;
    if (SECTION.test(line)) {
      startScene(stripEmphasis(line.replace(SECTION, '')));
      continue;
    }
    if (line.startsWith('=')) continue; // synopsis
    if (/^\.[^.]/.test(line)) {
      startScene(stripEmphasis(line.slice(1).trim())); // forced scene heading
      continue;
    }
    if (SCENE_HEADING.test(line)) {
      startScene(stripEmphasis(line));
      continue;
    }
    if (line.startsWith('!')) {
      act(line.slice(1).trim()); // forced action
      continue;
    }
    if (line.startsWith('@')) {
      speaker = cleanCharacter(line.slice(1)); // forced character
      current = null;
      continue;
    }
    if (line.startsWith('>')) {
      act(line.replace(/^>\s*/, '').replace(/\s*<$/, '')); // transition or centered
      continue;
    }
    if (line.startsWith('~')) {
      const lyric = line.slice(1).trim();
      if (speaker) speak(lyric);
      else act(lyric);
      continue;
    }
    if (speaker) {
      speak(line); // dialogue, including parentheticals on their own line
      continue;
    }
    if (isCharacterCue(line, prevBlank, next)) {
      speaker = cleanCharacter(line);
      current = null;
      continue;
    }
    act(line);
  }
  flush();

  return { title, ...finalize(scenes) };
}
