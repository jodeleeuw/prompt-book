import { h } from './dom.js';
import { loadScript } from '../store/library.js';
import { loadVoices, createSpeaker, isSupported } from '../speech/tts.js';
import { assignVoices, findVoice } from '../speech/voices.js';
import { createRehearsal, runningOrder } from '../engine/rehearsal.js';
import { navigate } from './router.js';

export async function renderRehearse(id) {
  const loaded = await loadScript(id);
  if (!loaded) return message('Not found', 'That script is no longer in your library.');

  const { script, scenes } = loaded;
  const chosen = script.sceneIds
    ? scenes.filter((scene) => script.sceneIds.includes(scene.id))
    : scenes;
  const lines = runningOrder(chosen);

  if (!script.userCharacterId || !lines.length) {
    navigate(`#/script/${script.id}/setup`);
    return message('Setting up…', 'Choose your character and scenes first.');
  }

  const lang = document.documentElement.lang || 'en';
  const voices = await loadVoices();
  const assignment = assignVoices(script.characters, voices, { lang });
  const nameById = new Map(script.characters.map((c) => [c.id, c.name]));

  // With no voices there is nothing to perform the other parts, so every line
  // becomes one you read and tap past, rather than failing on the first cue.
  const silent = !isSupported() || !voices.length;
  const isUserLine = silent ? () => true : (line) => line.characterId === script.userCharacterId;

  const speaker = createSpeaker({
    voiceFor: (line) => findVoice(voices, assignment[line.characterId]),
  });

  const counter = h('span', { class: 'counter' });
  const sceneLabel = h('span', { class: 'scene-label' });
  const stage = h('div', { class: 'stage', onclick: onStageClick });
  const transport = h('div', { class: 'transport' });

  const engine = createRehearsal({
    lines,
    isUserLine,
    speak: speaker.speak,
    cancel: speaker.cancel,
    onChange: paint,
  });

  function onStageClick() {
    const { status } = engine.state;
    if (status === 'idle') engine.begin();
    else if (status === 'awaiting') engine.advance();
    else if (status === 'done') engine.restart();
    else if (status === 'error') engine.resume();
  }

  function paint(state) {
    const position = Math.min(state.index + 1, state.total);
    counter.textContent = state.status === 'idle' ? `${state.total} lines` : `${position} / ${state.total}`;
    sceneLabel.textContent = state.line?.sceneTitle ?? '';
    stage.replaceChildren(stageContent(state));
    transport.replaceChildren(...transportContent(state));
    stage.classList.toggle('tappable', TAPPABLE.has(state.status));
  }

  const TAPPABLE = new Set(['idle', 'awaiting', 'done', 'error']);

  function stageContent(state) {
    if (state.status === 'idle') {
      return group(
        h('p', { class: 'cue' }, silent ? 'Silent run' : 'Ready'),
        h(
          'p',
          { class: 'hint' },
          silent
            ? 'No voices on this device — every line is yours to read. Tap to begin.'
            : 'Tap anywhere to begin.',
        ),
      );
    }
    if (state.status === 'done') {
      return group(h('p', { class: 'cue' }, 'End of the run.'), h('p', { class: 'hint' }, 'Tap to go again.'));
    }
    if (state.status === 'error') {
      return group(h('p', { class: 'cue' }, 'Speech stopped.'), h('p', { class: 'hint' }, state.error), h('p', { class: 'hint' }, 'Tap to carry on.'));
    }

    const mine = state.line.characterId === script.userCharacterId;
    return group(
      state.previous &&
        h(
          'p',
          { class: 'line previous' },
          h('span', { class: 'speaker' }, nameById.get(state.previous.characterId) ?? ''),
          h('span', { class: 'speech' }, state.previous.text),
        ),
      h(
        'p',
        { class: `line current${mine ? ' mine' : ''}` },
        h('span', { class: 'speaker' }, mine ? 'You' : (nameById.get(state.line.characterId) ?? '')),
        h('span', { class: 'speech' }, state.line.text),
      ),
      h('p', { class: 'hint' }, hintFor(state, mine)),
    );
  }

  const hintFor = (state, mine) => {
    if (state.status === 'paused') return 'Paused.';
    if (state.status === 'speaking') return 'Listening to your scene partner…';
    return mine ? 'Tap anywhere when you have finished the line.' : 'Tap to carry on.';
  };

  function transportContent(state) {
    const control = (label, onclick, disabled = false) =>
      h('button', { class: 'button', type: 'button', disabled, onclick }, label);

    if (state.status === 'idle') return [control('Begin', () => engine.begin())];
    if (state.status === 'done') return [control('Start again', () => engine.restart())];

    return [
      control('Back', () => engine.back(), state.index === 0),
      state.status === 'paused'
        ? control('Resume', () => engine.resume())
        : control('Pause', () => engine.pause(), state.status === 'error'),
      control('Skip', () => engine.advance()),
    ];
  }

  // Leaving the screen must silence the voice — a hash change alone does not
  // stop an utterance already handed to the synthesiser.
  const teardown = () => {
    engine.stop();
    speaker.cancel();
    window.removeEventListener('hashchange', teardown);
    window.removeEventListener('pagehide', teardown);
  };
  window.addEventListener('hashchange', teardown);
  window.addEventListener('pagehide', teardown);

  paint(engine.state);

  return h(
    'main',
    { class: 'page rehearsal' },
    h(
      'header',
      { class: 'rehearsal-bar' },
      h('a', { class: 'back', href: `#/script/${script.id}` }, '← Exit'),
      sceneLabel,
      counter,
    ),
    stage,
    transport,
  );
}

const group = (...children) => h('div', { class: 'stage-inner' }, ...children);

const message = (title, note) =>
  h(
    'main',
    { class: 'page' },
    h('h1', { class: 'title' }, title),
    h('p', { class: 'note' }, note),
    h('a', { class: 'button', href: '#/' }, 'Back to library'),
  );
