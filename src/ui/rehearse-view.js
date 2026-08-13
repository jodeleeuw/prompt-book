import { h } from './dom.js';
import { loadScript } from '../store/library.js';
import { loadVoices, createSpeaker, isSupported as canSpeak } from '../speech/tts.js';
import { createListener, isSupported as canListen } from '../speech/stt.js';
import { assignVoices, findVoice } from '../speech/voices.js';
import { createRehearsal, runningOrder } from '../engine/rehearsal.js';
import { createCueing } from '../engine/cueing.js';
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
  const silent = !canSpeak() || !voices.length;
  const isUserLine = silent ? () => true : (line) => line.characterId === script.userCharacterId;

  const speaker = createSpeaker({
    voiceFor: (line) => findVoice(voices, assignment[line.characterId]),
  });

  // ---- voice cueing -------------------------------------------------------

  let voiceWanted = canListen() && !silent;
  let micStatus = 'idle';
  let micDetail = null;
  let online = navigator.onLine !== false;

  const listener = canListen()
    ? createListener({
        lang: !lang || lang === 'en' ? 'en-US' : lang,
        onResult: (transcript) => cueing.heard(transcript),
        onStatus: (status, detail) => {
          micStatus = status;
          micDetail = detail ?? null;
          if (status === 'denied') cueing.cancel();
          paintVoice();
        },
      })
    : null;

  const cueing = createCueing({ listener, onAdvance: () => engine.advance() });

  const cueingAvailable = () =>
    voiceWanted && online && micStatus !== 'denied' && micStatus !== 'error';

  // ---- chrome -------------------------------------------------------------

  const counter = h('span', { class: 'counter' });
  const sceneLabel = h('span', { class: 'scene-label' });
  const voiceChip = h('button', { class: 'voice-chip', type: 'button', onclick: toggleVoice });
  const stage = h('div', { class: 'stage', onclick: onStageClick });
  const transport = h('div', { class: 'transport' });

  const engine = createRehearsal({
    lines,
    isUserLine,
    speak: speaker.speak,
    cancel: speaker.cancel,
    onChange: paint,
  });

  function toggleVoice() {
    if (!canListen() || silent) return;
    if (micStatus === 'denied' || micStatus === 'error') micStatus = 'idle'; // let them retry
    else voiceWanted = !voiceWanted;
    paint(engine.state);
  }

  function onStageClick() {
    const { status } = engine.state;
    if (status === 'idle') engine.begin();
    else if (status === 'awaiting') engine.advance();
    else if (status === 'done') engine.restart();
    else if (status === 'error') engine.resume();
  }

  function paint(state) {
    // The microphone is opened only while waiting on your line, so it is never
    // live while a voice is coming out of the speaker.
    if (state.status === 'awaiting' && cueingAvailable()) cueing.expect(state.line.text);
    else cueing.cancel();

    const position = Math.min(state.index + 1, state.total);
    counter.textContent =
      state.status === 'idle' ? `${state.total} lines` : `${position} / ${state.total}`;
    sceneLabel.textContent = state.line?.sceneTitle ?? '';
    stage.replaceChildren(stageContent(state));
    stage.classList.toggle('tappable', TAPPABLE.has(state.status));
    transport.replaceChildren(...transportContent(state));
    paintVoice();
  }

  function paintVoice() {
    const { label, tone, actionable } = voiceState();
    voiceChip.replaceChildren(h('span', { class: 'dot' }), label);
    voiceChip.className = `voice-chip ${tone}`;
    voiceChip.disabled = !actionable;
  }

  function voiceState() {
    if (silent) return { label: 'Silent run', tone: 'muted', actionable: false };
    if (!canListen()) {
      return { label: 'This browser cannot listen', tone: 'muted', actionable: false };
    }
    if (!online) return { label: 'Voice cueing needs a connection', tone: 'warn', actionable: false };
    if (micStatus === 'denied') {
      return { label: 'Microphone blocked — tap to retry', tone: 'warn', actionable: true };
    }
    if (micStatus === 'error') {
      return { label: `Microphone trouble: ${micDetail} — tap to retry`, tone: 'warn', actionable: true };
    }
    if (!voiceWanted) return { label: 'Voice cueing off', tone: 'muted', actionable: true };
    if (micStatus === 'listening') return { label: 'Listening', tone: 'live', actionable: true };
    return { label: 'Voice cueing on', tone: 'muted', actionable: true };
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
      return group(
        h('p', { class: 'cue' }, 'End of the run.'),
        h('p', { class: 'hint' }, 'Tap to go again.'),
      );
    }
    if (state.status === 'error') {
      return group(
        h('p', { class: 'cue' }, 'Speech stopped.'),
        h('p', { class: 'hint' }, state.error),
        h('p', { class: 'hint' }, 'Tap to carry on.'),
      );
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
    if (!mine) return 'Tap to carry on.';
    return cueingAvailable()
      ? 'Say your line — it moves on when you finish, or tap.'
      : 'Tap anywhere when you have finished the line.';
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

  // ---- lifetime -----------------------------------------------------------

  const setOnline = (value) => () => {
    online = value;
    paint(engine.state);
  };
  const goneOnline = setOnline(true);
  const goneOffline = setOnline(false);

  // Leaving the screen must silence the voice and close the microphone —
  // a hash change alone stops neither.
  const teardown = () => {
    engine.stop();
    speaker.cancel();
    cueing.cancel();
    listener?.stop();
    window.removeEventListener('hashchange', teardown);
    window.removeEventListener('pagehide', teardown);
    window.removeEventListener('online', goneOnline);
    window.removeEventListener('offline', goneOffline);
  };
  window.addEventListener('hashchange', teardown);
  window.addEventListener('pagehide', teardown);
  window.addEventListener('online', goneOnline);
  window.addEventListener('offline', goneOffline);

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
    voiceChip,
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
