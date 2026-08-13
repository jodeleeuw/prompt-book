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
  let listening = false;

  const disarm = () => {
    clearTimeout(timer);
    timer = null;
  };

  /**
   * Deliberately does not close the microphone. The run may be about to wait
   * on another line from the same character — a speech split by stage
   * directions is several consecutive lines — and closing it only to reopen it
   * a moment later is what made the recording indicator flicker. cancel() is
   * what closes it, and the run calls that the moment your turn is over.
   */
  const finish = () => {
    if (!matcher) return;
    matcher = null;
    disarm();
    onAdvance();
  };

  return {
    /** Start listening for the end of `text`. */
    expect(text) {
      matcher = createCueMatcher(text, { tailSize });
      disarm();
      if (!listening) {
        listener?.start();
        listening = true;
      }
      // Anything already heard belongs to the previous line, not this one.
      listener?.mark?.();
    },

    /** A transcript arrived. Ignored unless a line is actually expected. */
    heard(transcript) {
      if (!matcher) return;
      disarm();
      timer = setTimeout(finish, silenceMs);
      if (matcher.test(transcript)) finish();
    },

    /**
     * Close the microphone. Called whenever the run leaves your line —
     * including immediately before the app speaks, so the microphone is never
     * open while a voice is coming out of the speaker.
     *
     * Tracked with its own flag rather than inferred from the matcher: after
     * the tail lands there is no matcher left, and inferring from it would
     * leave the microphone open through the reply.
     */
    cancel() {
      matcher = null;
      disarm();
      if (!listening) return;
      listening = false;
      listener?.stop();
    },

    get expecting() {
      return Boolean(matcher);
    },

    get listening() {
      return listening;
    },
  };
}
