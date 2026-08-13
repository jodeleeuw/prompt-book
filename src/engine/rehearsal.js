// The rehearsal state machine.
//
//   idle ──begin──► speaking ──utterance ends──► (next line)
//                      │                              │
//                      │                     your line │
//                      ▼                              ▼
//                   paused ◄──pause──          awaiting ──advance──► (next line)
//
// `speak` is injected rather than imported so the machine can be driven without
// a speech engine — which is also how it is tested.
//
// Every interruption (pause, stop, skip, restart) bumps a token. An in-flight
// utterance that resolves after its token is stale does nothing, so a paused
// rehearsal cannot be dragged forward by the line it was speaking when paused.

export function createRehearsal({ lines, isUserLine, speak, cancel, onChange }) {
  let status = 'idle';
  let index = 0;
  let token = 0;
  let error = null;

  const snapshot = () => ({
    status,
    index,
    error,
    total: lines.length,
    line: lines[index] ?? null,
    previous: index > 0 ? lines[index - 1] : null,
    isMine: lines[index] ? isUserLine(lines[index]) : false,
  });

  const emit = () => onChange?.(snapshot());

  const set = (next) => {
    status = next;
    emit();
  };

  const interrupt = () => {
    token += 1;
    cancel?.();
  };

  async function run(from) {
    const mine = ++token;
    index = Math.max(0, from);
    error = null;

    while (index < lines.length) {
      if (isUserLine(lines[index])) return set('awaiting');

      set('speaking');
      try {
        await speak(lines[index]);
      } catch (err) {
        if (token !== mine) return; // interrupted; the failure is moot
        error = err.message ?? String(err);
        return set('error');
      }
      if (token !== mine) return; // paused, stopped or skipped mid-utterance
      index += 1;
    }
    set('done');
  }

  return {
    get state() {
      return snapshot();
    },

    begin() {
      if (status === 'speaking') return;
      interrupt();
      run(status === 'paused' || status === 'error' ? index : 0);
    },

    /** Your line is finished — or you want past the one being spoken. */
    advance() {
      if (status === 'done' || status === 'idle') return;
      interrupt();
      run(index + 1);
    },

    back() {
      if (status === 'idle') return;
      interrupt();
      run(index - 1);
    },

    pause() {
      if (status !== 'speaking' && status !== 'awaiting') return;
      interrupt();
      set('paused');
    },

    resume() {
      if (status !== 'paused' && status !== 'error') return;
      run(index);
    },

    restart() {
      interrupt();
      run(0);
    },

    stop() {
      interrupt();
      index = 0;
      set('idle');
    },
  };
}

/** Flatten selected scenes into the single running order the engine walks. */
export function runningOrder(scenes) {
  return scenes.flatMap((scene) =>
    scene.lines.map((line) => ({
      id: line.id,
      characterId: line.characterId,
      text: line.text,
      sceneId: scene.id,
      sceneTitle: scene.title,
    })),
  );
}
