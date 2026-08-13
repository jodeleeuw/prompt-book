# Design

The visual system as built. Written after the critique pass, so it describes
what ships rather than what was intended. See [PRODUCT.md](PRODUCT.md) for who
this is for and why.

## Theme

Two grounds, and they mean different things.

**Paper** is for browsing, importing, editing and settings — everything you do
sitting down, holding the device. It follows the device colour scheme, or an
explicit light/dark choice.

**Stage** is for rehearsal only. It is dark whatever the app theme says,
because the tablet sits about a metre away in a room that may be dim, and a lit
page at that distance is punishing to read from. It is a property of the
activity, not of the theme. Settings → *Rehearsal ground* opts out.

The stage is implemented as a token override on `body.rehearsing`, so every
rule written against the paper palette works unchanged on it. Nothing is
restyled per-ground.

## Color

Restrained: tinted neutrals plus one accent, which never decorates. The accent
marks exactly three things — your own line, your own character, and live
microphone state.

| Token | Paper light | Paper dark | Stage |
| --- | --- | --- | --- |
| `--paper` | `#faf8f4` | `#131211` | `#0d0c0b` |
| `--ink` | `#1a1917` | `#ece7de` | `#f2ede4` |
| `--muted` | `#6f6a62` | `#928c82` | `#9c958a` |
| `--faint` | `#736c66` | `#8f8880` | `#868078` |
| `--accent` | `#8a3324` | `#d18f6a` | `#e0a074` |
| `--danger` | `#8a3324` | `#d97a63` | `#d97a63` |
| `--rule` | `#e0dad0` | `#2b2825` | `#322e2a` |

Every token in that table except `--rule` carries text, and every one clears
WCAG AA (4.5:1) against its own ground. `--rule` draws hairlines only and is
exempt by intent, not by oversight.

`test/contrast.test.js` parses this out of `styles.css` and fails the build if
a value drifts below AA. It also asserts the two dark declarations — one for
the device preference, one for an explicit choice — have not diverged, which
they silently had once.

## Typography

Two families on a genuine contrast axis, split by what the text *is* rather
than by hierarchy level.

- **Serif** (`Iowan Old Style`, Palatino, Georgia) for script content: every
  line of dialogue, in the reading view and on the stage. This is the content
  the product exists to show.
- **Sans** (`system-ui` stack) for all chrome: labels, buttons, hints, counters,
  settings, speaker names.

Chrome uses a fixed rem scale — `2.25rem` page titles, `1.9rem` inline title
fields, `1.05rem` script body, `0.9rem` and below for labels. Fluid `clamp()`
survives in exactly one place, the rehearsal line, where the viewing distance
genuinely varies and the type should fill the room it has.

Speaker names are small-caps-styled sans at `0.68rem` with `0.13em` tracking.
`text-wrap: balance` on headings, `pretty` on prose and lines.

## Layout

- Paper screens use a `40rem` reading measure, centred.
- The rehearsal screen deliberately discards it: full width, `50rem` cap on the
  line itself, padding that scales with the viewport.
- The stage is a flex column with `min-height: 0` and its own `overflow-y`, so
  a long speech scrolls inside a stable frame instead of pushing the transport
  off-screen.
- The current line is **anchored, never centred**, with a fixed-height slot
  above it that is reserved whether or not a previous line exists. Centring
  moved the text on every turn and an actor a metre back lost their place.
- Touch targets are 44px minimum throughout.

## Components

- **Button** — one vocabulary everywhere: `.button`, plus `.primary` (filled
  ink) and `.danger` (accent-coloured label). Transport buttons are the same
  component at `flex: 1`.
- **Chip** — `.voice-chip` and `.hide-chip` on the rehearsal bar. Text buttons
  that state current status and toggle it.
- **Sheet** — `src/ui/confirm.js`, built on `<dialog>` for focus trapping,
  Escape and inertness. Replaces `confirm` / `prompt` / `alert`, which were
  unstyled OS surfaces appearing at the highest-stakes moments.
- **Toast** — undo, offered for 8 seconds after a destructive action. Undo is
  preferred over confirmation for anything reversible.
- **Inline editors** — title, scene title and line text edit in place and
  confirm with a brief "Saved", rather than taking effect silently on blur.

## Motion

Sparing and always stateful. Nothing announces itself on load.

- Line changes crossfade over 180 ms on `cubic-bezier(0.22, 1, 0.36, 1)`. The
  keyframe has a `from` only, so the line rests at its own style and is visible
  even if the animation never runs.
- Toasts rise 0.5 rem over 200 ms.
- The live-microphone dot pulses; nothing else moves.

Every animation has a `prefers-reduced-motion` alternative.

## What this system refuses

No card grids, no badges, no dashboard tiles, no uppercase eyebrows above
sections, no numbered section markers, no gradient text, no glassmorphism, no
side-stripe accents, no streaks or scores or celebration states. The detector
(`impeccable detect`) reports zero findings across `index.html` and `src/`.

The one place to stay alert: `--paper` is a warm near-white, which is the
saturated AI default for 2026. Measured it is OKLCH `L 0.980, C 0.0057` — just
outside the flagged band and effectively neutral, and the metaphor here is
literal. If it ever drifts warmer or more saturated, it stops being a page and
starts being a trend.
