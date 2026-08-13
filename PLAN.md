# Prompt Book — Scope & Plan

A progressive web app for rehearsing lines. You import a script, mark which character
is yours, and the app performs every other part aloud while listening for your cues.

Named for the stage manager's annotated master script.

---

## 1. Decisions

| Area | Decision |
| --- | --- |
| Primary target | Android tablet, Chrome. Scales up to desktop; iOS is not a v1 concern. |
| Stack | Vanilla JS + Vite. No UI framework. |
| Hosting | GitHub Pages via Actions, from this repo. |
| Script input | File import (`.txt`, `.fountain`) or paste, followed by an editable preview. |
| Rehearsal loop | Full duet — TTS reads all other characters, app listens for your lines. |
| Turn detection | Tail-match on the last words of your line, with a silence timeout fallback and tap-to-advance always available. |
| Accuracy checking | None. The app is a scene partner, not a grader. |
| Voices | Distinct voice auto-assigned per character from the device's voice list, overridable. |
| Line visibility | Three levels — full text → first letters → hidden — plus a peek control. |
| Stage directions | Stripped, but only after you confirm the import preview. |
| Library | Scripts contain named scenes; scenes can be queued into one run. Stored in IndexedDB. |
| Offline | Full PWA shell. Offline you keep the library, the script, TTS, and manual advance — but not voice cueing (see §5). |
| Visual tone | Typographic / editorial. The script is the interface. |

---

## 2. Platform constraints that shape the build

These are properties of the browser APIs, not choices:

1. **`webkitSpeechRecognition` is server-side.** Chrome streams microphone audio to
   Google and returns transcripts. Hands-free cueing therefore requires a network
   connection. This is the single hardest limit on the product.
2. **Recognition stops on its own.** Chrome ends a recognition session after a stretch
   of silence, even with `continuous = true`. The engine needs a restart loop with
   backoff, not a single `start()` call.
3. **The microphone hears the speakers.** Recognition must be hard-gated off while
   `speechSynthesis` is speaking, or the app cues itself.
4. **`getVoices()` is async and initially empty.** Voice assignment has to wait on the
   `voiceschanged` event, and the available set differs per device.
5. **Audio needs a user gesture.** The first `speak()` must originate from a tap.
   A single "Begin" button covers this.
6. **Screens sleep.** A tablet on a stand will blank mid-scene. The Screen Wake Lock
   API is required, and must be re-acquired on visibility change.
7. **HTTPS is mandatory** for microphone access, which is why local file:// use is out
   and GitHub Pages is in.

---

## 3. Data model

```
Script  { id, title, author?, createdAt, scenes: SceneId[], characters: Character[] }
Scene   { id, scriptId, title, order, lines: Line[] }
Line    { id, characterId, text }
Character { id, name, voiceURI?, rate?, pitch? }
Settings  { userCharacterByScript, hideLevel, silenceTimeoutMs, theme }
```

Stage directions are discarded at import, so no line type discriminator is needed.
Everything persists in IndexedDB through a thin hand-rolled wrapper — no dependency.

---

## 4. Architecture

Five modules, deliberately separable:

**`parse/`** — `txt.js` and `fountain.js`, each a pure function from string to a
draft scene list. The txt parser handles both `CHARACTER: dialogue` and a character
name alone on a line followed by its dialogue. Scene breaks come from Fountain scene
headings, `INT.`/`EXT.` lines, `ACT`/`SCENE` headers, or an explicit `---` marker.
Pure functions mean these are the easiest part of the app to unit test, and parsing
is where the bugs will live.

**`store/`** — IndexedDB wrapper plus the library CRUD operations.

**`speech/`** — two thin adapters. `tts.js` wraps `speechSynthesis` with a promise-
returning `speak()`, voice enumeration, and per-character voice assignment.
`stt.js` wraps `webkitSpeechRecognition` with the restart loop, backoff, and an
event stream of interim and final transcripts. Neither knows about rehearsal.

**`engine/`** — the rehearsal state machine, the core of the app:

```
IDLE ──begin──► SPEAKING ──utterance end──► LISTENING ──match / timeout / tap──► next line
                    ▲                            │
                    └──────── next line is not yours ────┘

PAUSED and ERROR are reachable from SPEAKING and LISTENING.
```

Transitions are explicit and the engine emits events; the UI only renders state.
This keeps the timing-sensitive audio logic out of the view layer, which is the
main reason for choosing vanilla JS here.

Tail-matching: normalize both sides (lowercase, strip punctuation, expand common
contractions, spell out digits), take the last three tokens of your line — fewer for
short lines — and slide that window over incoming interim transcripts with a small
edit-distance tolerance. On match, advance immediately. If no match arrives, a
silence timer since the last interim result fires and advances anyway, so paraphrasing
or dropping a line never strands you.

**`ui/`** — five screens: Library, Import Preview, Scene Setup, Rehearse, Settings.

---

## 5. Degraded modes

Each has a defined behavior, not a crash:

| Condition | Behavior |
| --- | --- |
| Offline | Banner: "Voice cueing needs a connection." Rehearsal continues with TTS and tap-to-advance. |
| Mic permission denied | Same manual mode, with a control to re-request. |
| No `SpeechRecognition` (e.g. Firefox) | Manual mode, stated once at load rather than on every scene. |
| No voices for the document language | Fall back to the default system voice for all characters, with a notice in Scene Setup. |
| Recognition erroring repeatedly | Back off, then drop to manual mode rather than looping. |

---

## 6. Milestones

1. **Skeleton** — Vite project, IndexedDB store, library CRUD, `.txt` parser, import preview with per-line character correction.
2. **Parsing** — Fountain parser, scene splitting, scene reordering and renaming.
3. **Performance without the mic** — TTS engine, voice auto-assignment, full scene playback with tap-to-advance. *At this point the app is already useful.*
4. **Hands-free** — recognition adapter, restart loop, tail-match, silence fallback, mic status indicator.
5. **Rehearsal craft** — hide levels, peek, wake lock, multi-scene queueing, typographic design pass, dark theme.
6. **Ship** — manifest, icons, service worker precache, offline banner, GitHub Pages workflow.

Milestone 3 is the first genuinely usable build and worth testing on the actual
tablet before going further — device voice quality varies enough that it may change
choices in milestone 4.

---

## 7. Deferred

Explicitly out of v1, listed so they aren't rediscovered as omissions: accuracy
scoring and word-level diffs; playing multiple characters in one scene; pacing and
rate controls; rehearsal history and stats; PDF and `.docx` import; recording and
playing back your own delivery; sharing or syncing scripts between devices.
