// Give each character its own voice, so a four-hander sounds like four people.

const baseLang = (lang = '') => lang.toLowerCase().split(/[-_]/)[0];

/**
 * Voices worth handing out, best first.
 *
 * Same-language voices only — a French voice reading English is unusable — and
 * device-local voices ahead of remote ones, since they work offline and on
 * Android are generally the better ones anyway.
 */
export function voicePool(voices, lang = 'en') {
  const wanted = baseLang(lang);
  const matching = voices.filter((voice) => baseLang(voice.lang) === wanted);
  const usable = matching.length ? matching : voices;

  const seen = new Set();
  return usable
    .filter((voice) => {
      if (seen.has(voice.name)) return false;
      seen.add(voice.name);
      return true;
    })
    .sort((a, b) => Number(b.localService) - Number(a.localService));
}

/**
 * Map character id → voiceURI. A character with a saved voice that still
 * exists on this device keeps it; the rest are dealt round-robin from the pool
 * so they stay distinct while there are voices to go round.
 */
export function assignVoices(characters, voices, { lang = 'en' } = {}) {
  const pool = voicePool(voices, lang);
  const available = new Set(voices.map((voice) => voice.voiceURI));
  const assignment = {};

  let next = 0;
  for (const character of characters) {
    if (character.voiceURI && available.has(character.voiceURI)) {
      assignment[character.id] = character.voiceURI;
      continue;
    }
    assignment[character.id] = pool.length ? pool[next++ % pool.length].voiceURI : null;
  }
  return assignment;
}

export const findVoice = (voices, voiceURI) =>
  voices.find((voice) => voice.voiceURI === voiceURI) ?? null;
