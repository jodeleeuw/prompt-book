import { h, plural } from './dom.js';
import { section, choice } from './controls.js';
import { loadScript, saveRehearsalSetup } from '../store/library.js';
import { loadVoices, createSpeaker, isSupported } from '../speech/tts.js';
import { assignVoices, voicePool, findVoice } from '../speech/voices.js';
import { navigate } from './router.js';

export async function renderSetup(id) {
  const loaded = await loadScript(id);
  if (!loaded) return notFound();

  const { script, scenes } = loaded;
  const lang = document.documentElement.lang || 'en';
  const voices = await loadVoices();
  const pool = voicePool(voices, lang);

  let userCharacterId = script.userCharacterId ?? script.characters[0]?.id ?? null;
  const chosenScenes = new Set(script.sceneIds ?? scenes.map((scene) => scene.id));
  const voiceByCharacterId = assignVoices(script.characters, voices, { lang });

  const body = h('div');
  const paint = () => body.replaceChildren(whoAmI(), sceneChoice(), voiceChoice(), begin());

  // ---- who am I -----------------------------------------------------------

  function whoAmI() {
    return section(
      'Who are you?',
      'The app performs everyone else and waits for you.',
      h(
        'div',
        { class: 'choices' },
        script.characters.map((character) =>
          choice('radio', 'user-character', character.name, userCharacterId === character.id, () => {
            userCharacterId = character.id;
            paint(); // your own character drops out of the voice list
          }),
        ),
      ),
    );
  }

  // ---- scenes -------------------------------------------------------------

  function sceneChoice() {
    return section(
      'Scenes',
      'Chosen scenes run back to back in this order.',
      h(
        'div',
        { class: 'choices' },
        scenes.map((scene) =>
          choice(
            'checkbox',
            'scene',
            `${scene.title} · ${plural(scene.lines.length, 'line')}`,
            chosenScenes.has(scene.id),
            (on) => {
              if (on) chosenScenes.add(scene.id);
              else chosenScenes.delete(scene.id);
              paint();
            },
          ),
        ),
      ),
    );
  }

  // ---- voices -------------------------------------------------------------

  function voiceChoice() {
    const others = script.characters.filter((character) => character.id !== userCharacterId);

    if (!isSupported() || !pool.length) {
      return section(
        'Voices',
        'This device reported no speech voices, so the other parts cannot be spoken. Rehearsal will still run — the lines appear on screen and you advance by tapping.',
      );
    }

    return section(
      'Voices',
      `Each character has been given a different voice${pool.length < others.length ? ', though this device has fewer voices than characters, so some are shared' : ''}.`,
      h(
        'div',
        { class: 'voice-rows' },
        others.map((character) => {
          const select = h('select', { class: 'voice-select', 'aria-label': `Voice for ${character.name}` });
          select.append(...pool.map((voice) => h('option', { value: voice.voiceURI }, voice.name)));
          select.value = voiceByCharacterId[character.id] ?? pool[0].voiceURI;
          select.addEventListener('change', () => {
            voiceByCharacterId[character.id] = select.value;
          });

          return h(
            'div',
            { class: 'voice-row' },
            h('span', { class: 'speaker' }, character.name),
            select,
            h(
              'button',
              {
                class: 'button',
                type: 'button',
                // Also the gesture that unlocks audio on a fresh page load.
                onclick: () => {
                  const speaker = createSpeaker({
                    voiceFor: () => findVoice(voices, select.value),
                  });
                  speaker.cancel();
                  speaker.speak({ text: sampleFor(character) }).catch(() => {});
                },
              },
              'Hear',
            ),
          );
        }),
      ),
    );
  }

  const sampleFor = (character) => {
    for (const scene of scenes) {
      const line = scene.lines.find((l) => l.characterId === character.id);
      if (line) return line.text.slice(0, 120);
    }
    return `I am ${character.name}.`;
  };

  // ---- begin --------------------------------------------------------------

  function begin() {
    const ready = Boolean(userCharacterId) && chosenScenes.size > 0;
    return h(
      'div',
      { class: 'actions sticky' },
      h(
        'button',
        {
          class: 'button primary',
          type: 'button',
          disabled: !ready,
          onclick: async () => {
            await saveRehearsalSetup(script.id, {
              userCharacterId,
              sceneIds: scenes.filter((s) => chosenScenes.has(s.id)).map((s) => s.id),
              voiceByCharacterId,
            });
            navigate(`#/script/${script.id}/rehearse`);
          },
        },
        'Continue',
      ),
      !ready && h('span', { class: 'note' }, 'Choose your character and at least one scene.'),
    );
  }

  paint();

  return h(
    'main',
    { class: 'page' },
    h('a', { class: 'back', href: `#/script/${script.id}` }, `← ${script.title}`),
    h('header', { class: 'masthead' }, h('h1', { class: 'title' }, 'Set up')),
    body,
  );
}


const notFound = () =>
  h(
    'main',
    { class: 'page' },
    h('h1', { class: 'title' }, 'Not found'),
    h('a', { class: 'button', href: '#/' }, 'Back to library'),
  );
