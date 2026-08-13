# Product

## Register

product

## Users

A single actor rehearsing their own lines, most often alone. The primary device
is an Android tablet on a music stand roughly a metre away, in a room that may
be dimly lit; a laptop is the secondary case. They are frequently standing,
moving, holding a prop, or in the middle of speaking — so the interface is
glanced at rather than read, and touched rarely.

The job: run a scene aloud, repeatedly, until the lines are in the body. The
app performs every other character and waits for them. Success is that the
actor forgets the app is there.

## Product Purpose

Prompt Book replaces the scene partner you do not have at eleven at night. You
import a script, mark which character is yours, and the app speaks the other
parts and listens for the end of yours.

It is a rehearsal tool, not a memorisation game and not a grader. It does not
score delivery, track streaks, or measure progress. The only thing it judges is
when a line has finished, and even that is designed to be wrong gracefully —
tapping always works.

Success looks like: a scene run end to end without touching the screen, and a
line ladder (full text → first two words → hidden) that the actor climbs over
several sessions without the app ever commenting on it.

## Brand Personality

Calm, literary, unobtrusive.

The script is the interface. Type carries the design; chrome retreats to the
edges. The voice is plain and direct, closer to a stage manager's note than to
product copy — it states what is happening and what will happen next, without
enthusiasm, congratulation, or exclamation marks. Where something has gone
wrong it says so in one sentence and says what still works.

## Anti-references

- **Gamified learning apps.** No streaks, scores, XP, mascots, confetti, or
  celebration states. Rehearsal is work, and progress here is not a number.
- **Productivity SaaS.** No card grids, badge pills, dashboard tiles, sidebar
  navigation, or an accent-coloured call to action on every screen.
- Also to avoid, though not named by the user: the app must not read as an
  unfinished document viewer. Restraint has to look decided, not absent.

## Design Principles

1. **The script is the interface.** The actor's own words are the largest,
   most contrasted thing on screen at any moment. Everything else is chrome and
   should behave like it.
2. **Glanceable at a metre.** Every rehearsal-time decision is made by someone
   standing back from the device, mid-speech. If it cannot be read or hit from
   a metre away, it does not belong on the rehearsal screen.
3. **Degrade honestly, never silently.** Offline, no microphone, no voices, a
   refused permission — each has a defined behaviour and says which part is
   lost and which part still works.
4. **Never lose the actor's words.** Nothing the user assigned, corrected, or
   spoke may be discarded without being shown first. This is why the import
   preview exists and why stripping is confirmed rather than applied.
5. **A partner, not a judge.** The app decides only one thing — when a line has
   ended — and a tap always overrides it.

## Accessibility & Inclusion

The stated priority is **legibility at arm's length**: the tablet sits about a
metre away, possibly in low light, and is read by someone who is standing and
speaking. Rehearsal type is sized for glancing, and touch targets are at least
44px.

WCAG AA contrast (4.5:1 body, 3:1 large text) is treated as the floor rather
than a goal, since it is the minimum that arm's-length reading requires anyway;
muted hint text and disabled states are included in that, not exempt from it.

Keyboard operation and reduced-motion alternatives were not named as
requirements. They are respected where free but are not currently guaranteed
across the app, and this is a known gap rather than a decision.
