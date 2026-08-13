// Voice selection for the on-device neural model.
//
// Kokoro publishes a quality grade per voice and they vary a lot: the best
// American female voice is graded A, the best male voice C+. Ordering by grade
// alone would hand every part in a scene to a woman, so the list below
// alternates gender and accent while still working down from the best of each.
// Anything graded D or below is left out — it is worse than the device voices
// this feature exists to improve on.

export const KOKORO_VOICES = [
  { id: 'af_heart', label: 'Heart', accent: 'American', gender: 'Female', grade: 'A' },
  { id: 'am_michael', label: 'Michael', accent: 'American', gender: 'Male', grade: 'C+' },
  { id: 'bf_emma', label: 'Emma', accent: 'British', gender: 'Female', grade: 'B-' },
  { id: 'am_fenrir', label: 'Fenrir', accent: 'American', gender: 'Male', grade: 'C+' },
  { id: 'af_bella', label: 'Bella', accent: 'American', gender: 'Female', grade: 'A-' },
  { id: 'bm_george', label: 'George', accent: 'British', gender: 'Male', grade: 'C' },
  { id: 'af_nicole', label: 'Nicole', accent: 'American', gender: 'Female', grade: 'B-' },
  { id: 'am_puck', label: 'Puck', accent: 'American', gender: 'Male', grade: 'C+' },
  { id: 'bf_isabella', label: 'Isabella', accent: 'British', gender: 'Female', grade: 'C' },
  { id: 'bm_fable', label: 'Fable', accent: 'British', gender: 'Male', grade: 'C' },
  { id: 'af_aoede', label: 'Aoede', accent: 'American', gender: 'Female', grade: 'C+' },
  { id: 'af_kore', label: 'Kore', accent: 'American', gender: 'Female', grade: 'C+' },
];

const ids = new Set(KOKORO_VOICES.map((voice) => voice.id));

export const isKokoroVoice = (id) => ids.has(id);

export const kokoroVoice = (id) =>
  KOKORO_VOICES.find((voice) => voice.id === id) ?? KOKORO_VOICES[0];

/**
 * Map character id → voice id, dealt in order so a scene sounds like different
 * people. A saved choice is kept as long as it is still a voice we offer.
 */
export function assignKokoroVoices(characters) {
  const assignment = {};
  let next = 0;
  for (const character of characters) {
    if (character.kokoroVoice && ids.has(character.kokoroVoice)) {
      assignment[character.id] = character.kokoroVoice;
      continue;
    }
    assignment[character.id] = KOKORO_VOICES[next++ % KOKORO_VOICES.length].id;
  }
  return assignment;
}
