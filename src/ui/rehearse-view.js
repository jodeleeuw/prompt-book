import { h } from './dom.js';
import { loadScript } from '../store/library.js';
import { getSettings, updateSettings, hideLevel as levelRecord, HIDE_LEVELS } from '../store/settings.js';
import { maskLine } from './mask.js';
import { loadVoices, createSpeaker, isSupported as canSpeak } from '../speech/tts.js';
import { createListener, isSupported as canListen } from '../speech/stt.js';
import { assignVoices, findVoice } from '../speech/voices.js';
import { assignKokoroVoices } from '../speech/kokoro-voices.js';
import { createRehearsal, runningOrder } from '../engine/rehearsal.js';
import { createCueing } from '../engine/cueing.js';
import { createWakeLock } from '../platform/wake-lock.js';
import { getLastRun, setLastRun, clearLastRun } from '../store/session.js';
import { navigate } from './router.js';

const PEEK_MS = 3000;
const TAPPABLE = new Set(['idle', 'awaiting', 'done', 'error']);

export async function renderRehearse(id) {
  const loaded = await loadScript(id);
  if (!loaded) return message('Not found', 'That script is no longer in your library.');

  const { script, scenes } = loaded;
  const chosen = script.sceneIds
    ? scenes.filter((scene) => script.sceneIds.includes(scene.id))
    : scenes;
  const lines = runningOrder(chosen);

  if (!script.userCharacterIds.length || !lines.length) {
    navigate(`#/script/${script.id}/setup`);
    return message('Setting up…', 'Choose your character and scenes first.');
  }

  const settings = getSettings();
  const lang = document.documentElement.lang || 'en';
  const nameById = new Map(script.characters.map((c) => [c.id, c.name]));
  const myIds = new Set(script.userCharacterIds);

  // ---- state --------------------------------------------------------------

  let hideLevel = settings.hideLevel;
  let peeking = false;
  let peekTimer = null;
  let lastIndex = -1;
  let lastAnnounced = null;

  let voiceWanted = false;
  let micStatus = 'idle';
  let micDetail = null;
  let online = navigator.onLine !== false;
  let cuedIndex = -1;

  // Assigned once the voice list resolves; every handler no-ops until then.
  let engine = null;
  let speaker = null;
  let highQuality = false;
  let voiceNote = null;
  let loadNote = null;
  let listener = null;
  let cueing = null;
  let silent = false;

  const wakeLock = createWakeLock();

  // With no voices at all every line becomes one you read and tap past, so the
  // whole run counts as yours. Reads `silent`, which init() settles.
  const isUserLine = (line) => silent || myIds.has(line.characterId);

  // Reading one part, "You" says everything. Reading several, it withholds the
  // one thing you need at the moment the line lands — which of them is speaking.
  const myLabel = (characterId) =>
    myIds.size > 1 ? `You · ${nameById.get(characterId) ?? ''}` : 'You';

  // Where this script was left, if it was left part-way through.
  const stored = getLastRun();
  const resumeIndex =
    stored?.scriptId === script.id && stored.index > 0 && stored.index < lines.length
      ? stored.index
      : null;

  // ---- chrome -------------------------------------------------------------

  const counter = h('span', { class: 'counter' });
  const sceneLabel = h('span', { class: 'scene-label' });
  const voiceChip = h('button', { class: 'voice-chip', type: 'button', onclick: toggleVoice });
  const hideChip = h('button', { class: 'hide-chip', type: 'button', onclick: cycleHideLevel });
  const transport = h('div', { class: 'transport' });
  const live = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });

  const loadingCue = h('p', { class: 'cue' });
  const loadingHint = h('p', { class: 'hint' });
  const loadingPanel = group(loadingCue, loadingHint);

  // Not a <button>: the stage holds paragraphs, which button may not contain.
  const stage = h('div', {
    class: 'stage',
    role: 'button',
    tabindex: '0',
    onclick: onAdvanceGesture,
    onkeydown: (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); // Space would otherwise scroll the stage
      onAdvanceGesture();
    },
  });

  // Rehearsal takes the whole surface: it swaps the palette to the stage
  // ground and suppresses the global offline banner, which would otherwise sit
  // on top of the transport.
  document.body.classList.add('rehearsing');

  paintLoading();
  init();

  async function init() {
    const voices = await loadVoices();
    const assignment = assignVoices(script.characters, voices, { lang });

    // With no voices there is nothing to perform the other parts, so every line
    // becomes one you read and tap past, rather than failing on the first cue.
    const deviceSpeaker = () =>
      createSpeaker({ voiceFor: (line) => findVoice(voices, assignment[line.characterId]) });

    if (settings.voiceQuality === 'high') {
      speaker = await highQualitySpeaker(deviceSpeaker);
    } else {
      speaker = deviceSpeaker();
    }

    // A neural voice does not depend on the device having any voices installed.
    silent = !highQuality && (!canSpeak() || !voices.length);
    voiceWanted = canListen() && !silent;

    listener = canListen()
      ? createListener({
          lang: !lang || lang === 'en' ? 'en-US' : lang,
          onResult: (transcript) => cueing?.heard(transcript),
          onStatus: (status, detail) => {
            micStatus = status;
            micDetail = detail ?? null;
            if (status === 'denied') cueing?.cancel();
            renderVoice();
          },
        })
      : null;

    cueing = createCueing({
      listener,
      onAdvance: () => engine.advance(),
      silenceMs: settings.silenceMs,
    });

    engine = createRehearsal({
      lines,
      isUserLine,
      speak: speaker.speak,
      cancel: speaker.cancel,
      onChange: sync,
    });

    sync(engine.state);
    // So the opening line is ready the moment they tap Begin.
    if (lines[0] && !isUserLine(lines[0])) speaker?.prefetch?.(lines[0]);
  }

  /**
   * Load the neural model, falling back to the device's own voices if it will
   * not run. The download is large and needs a connection, so failing here is
   * ordinary rather than exceptional — it must not cost you the rehearsal.
   */
  async function highQualitySpeaker(deviceSpeaker) {
    const { createKokoroSpeaker, loadKokoro, isSupported: canRun } = await import(
      '../speech/kokoro.js'
    );

    if (!canRun()) {
      voiceNote = 'This browser cannot run the high quality voice. Using device voices.';
      return deviceSpeaker();
    }

    const kokoro = assignKokoroVoices(script.characters);
    // Measured against the download's own total, not a constant: the size
    // depends on which weights this device gets, and they differ by 3.5x.
    const onProgress = ({ loaded, total }) => {
      const mb = (bytes) => Math.round(bytes / 1e6);
      loadNote = total ? `${mb(loaded)} MB of ${mb(total)} MB` : `${mb(loaded)} MB`;
      paintLoading();
    };

    try {
      loadNote = '0 MB';
      paintLoading();
      await loadKokoro({ onProgress });
      highQuality = true;
      loadNote = null;
      return createKokoroSpeaker({
        voiceFor: (line) => kokoro[line.characterId],
        onProgress,
      });
    } catch (error) {
      loadNote = null;
      voiceNote = `High quality voice unavailable (${error.message ?? error}). Using device voices.`;
      return deviceSpeaker();
    }
  }

  const cueingAvailable = () =>
    voiceWanted && online && micStatus !== 'denied' && micStatus !== 'error';

  // ---- controls -----------------------------------------------------------

  function begin(from) {
    wakeLock.request(); // taken from the tap, which is when browsers allow it
    engine.begin(from);
  }

  function onAdvanceGesture() {
    if (!engine) return;
    const { status } = engine.state;
    if (status === 'idle') begin(resumeIndex ?? 0);
    else if (status === 'awaiting') engine.advance();
    else if (status === 'done') engine.restart();
    else if (status === 'error') engine.resume();
  }

  function toggleVoice() {
    if (!engine || !canListen() || silent) return;
    if (micStatus === 'denied' || micStatus === 'error') micStatus = 'idle'; // let them retry
    else voiceWanted = !voiceWanted;
    sync(engine.state);
    // So the opening line is ready the moment they tap Begin.
    if (lines[0] && !isUserLine(lines[0])) speaker?.prefetch?.(lines[0]);
  }

  function cycleHideLevel() {
    const next = (HIDE_LEVELS.findIndex((l) => l.id === hideLevel) + 1) % HIDE_LEVELS.length;
    hideLevel = HIDE_LEVELS[next].id;
    updateSettings({ hideLevel });
    stopPeeking();
    if (engine) render(engine.state);
    else renderHide();
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

  // ---- painting -----------------------------------------------------------

  function paintLoading() {
    counter.textContent = `${lines.length} lines`;
    sceneLabel.textContent = chosen[0]?.title ?? '';

    loadingCue.textContent = loadNote ? 'Fetching the voice model…' : 'Finding voices…';
    loadingHint.textContent = loadNote
      ? `${loadNote} — downloaded once and kept for next time.`
      : 'Reading the voices installed on this device.';

    // Mounted once and then written into. Replacing the subtree restarts the
    // stage's entry animation, which is right for a line landing and wrong for
    // a number ticking: a hundred restarts during the download read as flicker.
    if (loadingPanel.parentNode !== stage) {
      stage.replaceChildren(loadingPanel);
      stage.classList.remove('tappable');
      stage.setAttribute('aria-label', 'Preparing rehearsal');
      transport.replaceChildren(
        h('button', { class: 'button', type: 'button', disabled: true }, 'Begin'),
      );
      // None of the chrome below says anything about progress, so it belongs
      // with the first paint rather than with every one.
      voiceChip.replaceChildren(h('span', { class: 'dot' }), 'Preparing');
      voiceChip.className = 'voice-chip muted';
      voiceChip.disabled = true;
      renderHide();
    }
  }

  /** State changed: reconcile the microphone, then draw. */
  function sync(state) {
    if (state.index !== lastIndex) {
      lastIndex = state.index;
      stopPeeking();
    }
    applyCueing(state);
    prefetchNext(state);
    remember(state);
    render(state);
  }

  /**
   * Generation runs at roughly 2.5x realtime, so a line started when it is
   * already due would arrive late. Building the next one while the current
   * one plays keeps it ahead of the scene.
   */
  function prefetchNext(state) {
    const next = lines[state.index + 1];
    if (next && !isUserLine(next)) speaker?.prefetch?.(next);
  }

  /** A finished run is not a place to come back to. */
  function remember(state) {
    if (state.status === 'done') clearLastRun(script.id);
    else if (state.status !== 'idle') {
      setLastRun({
        scriptId: script.id,
        index: state.index,
        total: state.total,
        sceneTitle: state.line?.sceneTitle ?? null,
      });
    }
  }

  /**
   * The microphone is opened only while waiting on your line, so it is never
   * live while a voice is coming out of the speaker. Keyed on the line index
   * so redrawing cannot restart a cue that is already running.
   */
  function applyCueing(state) {
    if (!cueing) return;
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
    stage.setAttribute('aria-label', stageAction(state));
    transport.replaceChildren(...transportContent(state));
    renderVoice();
    renderHide();
    announce(state);
  }

  /** What a tap or Enter does right now — the stage's accessible name. */
  function stageAction(state) {
    if (state.status === 'idle') return 'Begin the run';
    if (state.status === 'awaiting') return 'I have finished my line — continue';
    if (state.status === 'done') return 'Run the scene again';
    if (state.status === 'error') return 'Carry on after the speech error';
    return 'Rehearsal in progress';
  }

  /** Announce only whose turn it is, and only when it changes. */
  function announce(state) {
    let text = null;
    if (state.status === 'awaiting') {
      const as =
        myIds.size > 1 && myIds.has(state.line.characterId)
          ? ` as ${nameById.get(state.line.characterId)}`
          : '';
      text = `Your line${as}. ${state.line.text}`;
    }
    else if (state.status === 'speaking') text = `${nameById.get(state.line.characterId) ?? ''} speaking`;
    else if (state.status === 'done') text = 'End of the run.';
    else if (state.status === 'error') text = `Speech stopped. ${state.error ?? ''}`;

    const key = `${state.status}:${state.index}`;
    if (!text || key === lastAnnounced) return;
    lastAnnounced = key;
    live.textContent = text;
  }

  function renderVoice() {
    const { label, tone, actionable } = voiceState();
    voiceChip.replaceChildren(h('span', { class: 'dot' }), label);
    voiceChip.className = `voice-chip ${tone}`;
    voiceChip.disabled = !actionable;
  }

  function renderHide() {
    hideChip.replaceChildren(`Your lines: ${levelRecord(hideLevel).label.toLowerCase()}`);
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
      return { label: 'Microphone trouble — tap to retry', tone: 'warn', actionable: true };
    }
    if (!voiceWanted) return { label: 'Voice cueing off', tone: 'muted', actionable: true };
    if (micStatus === 'listening') return { label: 'Listening', tone: 'live', actionable: true };
    return { label: 'Voice cueing on', tone: 'muted', actionable: true };
  }

  const masked = (state) => {
    const mine = myIds.has(state.line.characterId);
    return mine && hideLevel !== 'full' && !peeking;
  };

  function stageContent(state) {
    if (state.status === 'idle') {
      return group(
        voiceNote && h('p', { class: 'hint warn-note' }, voiceNote),
        h('p', { class: 'cue' }, silent ? 'Silent run' : 'Ready'),
        h(
          'p',
          { class: 'hint' },
          silent
            ? 'No voices on this device — every line is yours to read. '
            : '',
          resumeIndex
            ? `You stopped at line ${resumeIndex + 1}. Tap anywhere to carry on from there.`
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
        h('p', { class: 'cue' }, 'The voice stopped.'),
        h('p', { class: 'hint' }, 'Your place is kept. Tap to carry on, or use Skip to move past this line.'),
      );
    }

    const mine = myIds.has(state.line.characterId);
    const entering = !state.previous || state.previous.sceneId !== state.line.sceneId;

    return group(
      entering
        ? h('p', { class: 'scene-mark' }, state.line.sceneTitle)
        : // An always-present slot, so the current line never shifts position.
          h(
            'p',
            { class: 'line previous' },
            state.previous &&
              h('span', { class: 'speaker' }, nameById.get(state.previous.characterId) ?? ''),
            state.previous?.text ?? '',
          ),
      h(
        'p',
        { class: `line current${mine ? ' mine' : ''}${masked(state) ? ' masked' : ''}` },
        h(
          'span',
          { class: 'speaker' },
          mine ? myLabel(state.line.characterId) : (nameById.get(state.line.characterId) ?? ''),
        ),
        h(
          'span',
          { class: 'speech' },
          masked(state) ? maskLine(state.line.text, hideLevel) : state.line.text,
        ),
      ),
      h('p', { class: 'hint' }, hintFor(state, mine)),
    );
  }

  const hintFor = (state, mine) => {
    if (state.status === 'paused') return 'Paused.';
    if (state.status === 'speaking') return 'Your scene partner is speaking…';
    if (!mine) return 'Tap to carry on.';
    return cueingAvailable()
      ? 'Say your line — it moves on when you finish, or tap.'
      : 'Tap anywhere when you have finished the line.';
  };

  /**
   * Four fixed slots. Peek is disabled rather than removed when it does not
   * apply, so the buttons never move under a thumb that already knows where
   * they are.
   */
  function transportContent(state) {
    const control = (label, onclick, disabled = false) =>
      h('button', { class: 'button', type: 'button', disabled, onclick }, label);

    if (state.status === 'idle') {
      return resumeIndex
        ? [
            control(`Resume at ${resumeIndex + 1}`, () => begin(resumeIndex)),
            control('From the top', () => begin(0)),
          ]
        : [control('Begin', () => begin(0))];
    }
    if (state.status === 'done') return [control('Start again', () => engine.restart())];

    const isMine = myIds.has(state.line?.characterId);
    return [
      control('Back', () => engine.back(), state.index === 0),
      state.status === 'paused'
        ? control('Resume', () => engine.resume())
        : control('Pause', () => engine.pause(), state.status === 'error'),
      control('Peek', peek, !masked(state)),
      control(
        state.status === 'awaiting' && isMine ? 'Next line' : 'Skip',
        () => engine.advance(),
      ),
    ];
  }

  // ---- lifetime -----------------------------------------------------------

  const setOnline = (value) => () => {
    online = value;
    if (engine) sync(engine.state);
  };
  const goneOnline = setOnline(true);
  const goneOffline = setOnline(false);

  // Leaving the screen must silence the voice, close the microphone and let the
  // screen sleep again — a hash change does none of them.
  const teardown = () => {
    engine?.stop();
    speaker?.close?.();
    speaker?.cancel();
    cueing?.cancel();
    listener?.stop();
    wakeLock.destroy();
    clearTimeout(peekTimer);
    document.body.classList.remove('rehearsing');
    window.removeEventListener('hashchange', teardown);
    window.removeEventListener('pagehide', teardown);
    window.removeEventListener('online', goneOnline);
    window.removeEventListener('offline', goneOffline);
  };
  window.addEventListener('hashchange', teardown);
  window.addEventListener('pagehide', teardown);
  window.addEventListener('online', goneOnline);
  window.addEventListener('offline', goneOffline);

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
    live,
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
