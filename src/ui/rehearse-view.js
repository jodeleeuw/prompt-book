import { h } from './dom.js';
import { loadScript } from '../store/library.js';
import { getSettings, updateSettings, HIDE_LEVELS } from '../store/settings.js';
import { maskLine } from './mask.js';
import { loadVoices, createSpeaker, isSupported as canSpeak } from '../speech/tts.js';
import { createListener, isSupported as canListen } from '../speech/stt.js';
import { assignVoices, findVoice } from '../speech/voices.js';
import { createRehearsal, runningOrder } from '../engine/rehearsal.js';
import { createCueing } from '../engine/cueing.js';
import { createWakeLock } from '../platform/wake-lock.js';
import { navigate } from './router.js';

const PEEK_MS = 3000;

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

  const settings = getSettings();
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
  const wakeLock = createWakeLock();

  // ---- view state ---------------------------------------------------------

  let hideLevel = settings.hideLevel;
  let peeking = false;
  let peekTimer = null;
  let lastIndex = -1;

  let voiceWanted = canListen() && !silent;
  let micStatus = 'idle';
  let micDetail = null;
  let online = navigator.onLine !== false;
  let cuedIndex = -1;

  const listener = canListen()
    ? createListener({
        lang: !lang || lang === 'en' ? 'en-US' : lang,
        onResult: (transcript) => cueing.heard(transcript),
        onStatus: (status, detail) => {
          micStatus = status;
          micDetail = detail ?? null;
          if (status === 'denied') cueing.cancel();
          renderVoice();
        },
      })
    : null;

  const cueing = createCueing({
    listener,
    onAdvance: () => engine.advance(),
    silenceMs: settings.silenceMs,
  });

  const cueingAvailable = () =>
    voiceWanted && online && micStatus !== 'denied' && micStatus !== 'error';

  // ---- chrome -------------------------------------------------------------

  const counter = h('span', { class: 'counter' });
  const sceneLabel = h('span', { class: 'scene-label' });
  const voiceChip = h('button', { class: 'voice-chip', type: 'button', onclick: toggleVoice });
  const hideChip = h('button', { class: 'hide-chip', type: 'button', onclick: cycleHideLevel });
  const stage = h('div', { class: 'stage', onclick: onStageClick });
  const transport = h('div', { class: 'transport' });

  const engine = createRehearsal({
    lines,
    isUserLine,
    speak: speaker.speak,
    cancel: speaker.cancel,
    onChange: sync,
  });

  // ---- controls -----------------------------------------------------------

  function begin() {
    wakeLock.request(); // taken from the tap, which is when browsers allow it
    engine.begin();
  }

  function toggleVoice() {
    if (!canListen() || silent) return;
    if (micStatus === 'denied' || micStatus === 'error') micStatus = 'idle'; // let them retry
    else voiceWanted = !voiceWanted;
    sync(engine.state);
  }

  function cycleHideLevel() {
    const next = (HIDE_LEVELS.findIndex((l) => l.id === hideLevel) + 1) % HIDE_LEVELS.length;
    hideLevel = HIDE_LEVELS[next].id;
    updateSettings({ hideLevel });
    stopPeeking();
    render(engine.state);
  }

  function peek() {
    clearTimeout(peekTimer);
    peeking = true;
    // Deliberately not a full sync: re-running the cue would restart the
    // recogniser and throw away everything said so far.
    render(engine.state);
    peekTimer = setTimeout(() => {
      peeking = false;
      render(engine.state);
    }, PEEK_MS);
  }

  function stopPeeking() {
    clearTimeout(peekTimer);
    peeking = false;
  }

  function onStageClick() {
    const { status } = engine.state;
    if (status === 'idle') begin();
    else if (status === 'awaiting') engine.advance();
    else if (status === 'done') engine.restart();
    else if (status === 'error') engine.resume();
  }

  // ---- painting -----------------------------------------------------------

  /** State changed: reconcile the microphone, then draw. */
  function sync(state) {
    if (state.index !== lastIndex) {
      lastIndex = state.index;
      stopPeeking();
    }
    applyCueing(state);
    render(state);
  }

  /**
   * The microphone is opened only while waiting on your line, so it is never
   * live while a voice is coming out of the speaker. Keyed on the line index
   * so redrawing cannot restart a cue that is already running.
   */
  function applyCueing(state) {
    if (state.status === 'awaiting' && cueingAvailable()) {
      if (cuedIndex === state.index) return;
      cuedIndex = state.index;
      cueing.expect(state.line.text);
    } else {
      cuedIndex = -1;
      cueing.cancel();
    }
  }

  function render(state) {
    const position = Math.min(state.index + 1, state.total);
    counter.textContent =
      state.status === 'idle' ? `${state.total} lines` : `${position} / ${state.total}`;
    sceneLabel.textContent = state.line?.sceneTitle ?? '';
    stage.replaceChildren(stageContent(state));
    stage.classList.toggle('tappable', TAPPABLE.has(state.status));
    transport.replaceChildren(...transportContent(state));
    renderVoice();
    renderHide();
  }

  function renderVoice() {
    const { label, tone, actionable } = voiceState();
    voiceChip.replaceChildren(h('span', { class: 'dot' }), label);
    voiceChip.className = `voice-chip ${tone}`;
    voiceChip.disabled = !actionable;
  }

  function renderHide() {
    const level = HIDE_LEVELS.find((l) => l.id === hideLevel);
    hideChip.replaceChildren(`Your lines: ${level.label.toLowerCase()}`);
  }

  function voiceState() {
    if (silent) return { label: 'Silent run', tone: 'muted', actionable: false };
    if (!canListen()) {
      return { label: 'This browser cannot listen', tone: 'muted', actionable: false };
    }
    if (!online) {
      return { label: 'Voice cueing needs a connection', tone: 'warn', actionable: false };
    }
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

  const masked = (state) => {
    const mine = state.line.characterId === script.userCharacterId;
    return mine && hideLevel !== 'full' && !peeking;
  };

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
    const entering = !state.previous || state.previous.sceneId !== state.line.sceneId;

    return group(
      entering && h('p', { class: 'scene-mark' }, state.line.sceneTitle),
      !entering &&
        state.previous &&
        h(
          'p',
          { class: 'line previous' },
          h('span', { class: 'speaker' }, nameById.get(state.previous.characterId) ?? ''),
          h('span', { class: 'speech' }, state.previous.text),
        ),
      h(
        'p',
        { class: `line current${mine ? ' mine' : ''}${masked(state) ? ' masked' : ''}` },
        h('span', { class: 'speaker' }, mine ? 'You' : (nameById.get(state.line.characterId) ?? '')),
        h('span', { class: 'speech' }, masked(state) ? maskLine(state.line.text, hideLevel) : state.line.text),
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

    if (state.status === 'idle') return [control('Begin', begin)];
    if (state.status === 'done') return [control('Start again', () => engine.restart())];

    return [
      control('Back', () => engine.back(), state.index === 0),
      state.status === 'paused'
        ? control('Resume', () => engine.resume())
        : control('Pause', () => engine.pause(), state.status === 'error'),
      masked(state) && control('Peek', peek),
      control('Skip', () => engine.advance()),
    ].filter(Boolean);
  }

  // ---- lifetime -----------------------------------------------------------

  const setOnline = (value) => () => {
    online = value;
    sync(engine.state);
  };
  const goneOnline = setOnline(true);
  const goneOffline = setOnline(false);

  // Leaving the screen must silence the voice, close the microphone and let the
  // screen sleep again — a hash change does none of them.
  const teardown = () => {
    engine.stop();
    speaker.cancel();
    cueing.cancel();
    listener?.stop();
    wakeLock.destroy();
    clearTimeout(peekTimer);
    window.removeEventListener('hashchange', teardown);
    window.removeEventListener('pagehide', teardown);
    window.removeEventListener('online', goneOnline);
    window.removeEventListener('offline', goneOffline);
  };
  window.addEventListener('hashchange', teardown);
  window.addEventListener('pagehide', teardown);
  window.addEventListener('online', goneOnline);
  window.addEventListener('offline', goneOffline);

  sync(engine.state);

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
    h('div', { class: 'rehearsal-controls' }, voiceChip, hideChip),
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
