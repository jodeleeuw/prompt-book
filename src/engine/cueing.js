import { createCueMatcher } from './match.js';

/**
 * Turns transcripts into a single decision: your line is over, carry on.
 *
 * Two ways that happens. The tail of your line is heard — the normal case, and
 * the one that feels like a partner picking up a cue. Or you stop talking and
 * the silence timer runs out, which covers paraphrasing, drying, and every line
 * the recogniser simply gets wrong.
 *
 * The timer only arms once you have said something. Silence before you start is
 * you thinking, and the app should wait through it for as long as you like.
 */
export function createCueing({ listener, onAdvance, silenceMs = 2500, tailSize = 3 }) {
  let matcher = null;
  let timer = null;

  const disarm = () => {
    clearTimeout(timer);
    timer = null;
  };

  const finish = () => {
    if (!matcher) return;
    matcher = null;
    disarm();
    listener?.stop();
    onAdvance();
  };

  return {
    /** Start listening for the end of `text`. */
    expect(text) {
      matcher = createCueMatcher(text, { tailSize });
      disarm();
      listener?.start();
    },

    /** A transcript arrived. Ignored unless a line is actually expected. */
    heard(transcript) {
      if (!matcher) return;
      disarm();
      timer = setTimeout(finish, silenceMs);
      if (matcher.test(transcript)) finish();
    },

    /**
     * Stop listening. Called whenever the run leaves your line — including
     * immediately before the app speaks, so the microphone is never open while
     * a voice is coming out of the speaker.
     */
    cancel() {
      if (!matcher && !timer) return;
      matcher = null;
      disarm();
      listener?.stop();
    },

    get expecting() {
      return Boolean(matcher);
    },
  };
}
