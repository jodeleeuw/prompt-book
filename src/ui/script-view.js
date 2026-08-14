import { h, plural } from './dom.js';
import {
  loadScript,
  deleteScript,
  renameScript,
  renameScene,
  moveScene,
  deleteScene,
  snapshotScript,
  restoreScript,
  updateLine,
} from '../store/library.js';
import { clearLastRun } from '../store/session.js';
import { offerUndo } from './confirm.js';
import { navigate, refresh } from './router.js';

export async function renderScript(id) {
  const loaded = await loadScript(id);
  if (!loaded) {
    return h(
      'main',
      { class: 'page' },
      h('h1', { class: 'title' }, 'Not found'),
      h('p', { class: 'note' }, 'That script is no longer in your library.'),
      h('a', { class: 'button', href: '#/' }, 'Back to library'),
    );
  }

  const { script, scenes } = loaded;
  const nameById = new Map(script.characters.map((c) => [c.id, c.name]));
  const myIds = new Set(script.userCharacterIds);
  const configured = Boolean(myIds.size && script.sceneIds?.length);
  const yourLines = scenes.reduce(
    (n, scene) => n + scene.lines.filter((l) => myIds.has(l.characterId)).length,
    0,
  );

  const saved = h('span', { class: 'saved', role: 'status', 'aria-live': 'polite' });
  const flashSaved = () => {
    saved.textContent = 'Saved';
    clearTimeout(flashSaved.timer);
    flashSaved.timer = setTimeout(() => {
      saved.textContent = '';
    }, 1600);
  };

  const titleField = h('input', {
    class: 'title-input',
    type: 'text',
    value: script.title,
    'aria-label': 'Script title',
    onchange: async () => {
      await renameScript(script.id, titleField.value);
      flashSaved();
    },
  });

  // ---- a line you can correct ---------------------------------------------

  function lineRow(scene, line) {
    const row = h('p', { class: 'line' });
    const speaker = nameById.get(line.characterId) ?? 'Unknown';
    const mine = myIds.has(line.characterId);

    const read = () =>
      row.replaceChildren(
        h('span', { class: `speaker${mine ? ' mine' : ''}` }, speaker),
        h(
          'button',
          {
            class: 'speech editable',
            type: 'button',
            'aria-label': `Edit ${speaker}'s line: ${line.text}`,
            onclick: edit,
          },
          line.text,
        ),
      );

    function edit() {
      const field = h('textarea', {
        class: 'line-editor',
        rows: Math.max(2, Math.ceil(line.text.length / 48)),
        value: line.text,
        'aria-label': `${speaker}'s line`,
      });

      const commit = async () => {
        const next = field.value.trim();
        if (next && next !== line.text) {
          line.text = next;
          await updateLine(scene.id, line.id, next);
          flashSaved();
        }
        read();
      };

      row.replaceChildren(
        h('span', { class: `speaker${mine ? ' mine' : ''}` }, speaker),
        field,
        h(
          'span',
          { class: 'line-editor-actions' },
          h('button', { class: 'button', type: 'button', onclick: read }, 'Cancel'),
          h('button', { class: 'button primary', type: 'button', onclick: commit }, 'Save line'),
        ),
      );
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }

    read();
    return row;
  }

  // ---- scenes -------------------------------------------------------------

  const sceneSection = (scene, i) => {
    const title = h('input', {
      class: 'scene-title-input',
      type: 'text',
      value: scene.title,
      'aria-label': 'Scene title',
      onchange: async () => {
        await renameScene(scene.id, title.value);
        flashSaved();
      },
    });

    const move = (delta, label, glyph) =>
      h(
        'button',
        {
          class: 'icon',
          type: 'button',
          'aria-label': `Move ${scene.title} ${label}`,
          disabled: delta < 0 ? i === 0 : i === scenes.length - 1,
          onclick: async () => {
            await moveScene(script.id, scene.id, delta);
            refresh();
          },
        },
        glyph,
      );

    return h(
      'section',
      { class: 'scene' },
      h(
        'div',
        { class: 'scene-controls' },
        title,
        move(-1, 'up', '↑'),
        move(1, 'down', '↓'),
        h(
          'button',
          {
            class: 'icon danger',
            type: 'button',
            'aria-label': `Delete ${scene.title}`,
            // Undo rather than confirm: free when you meant it, one tap when
            // you did not.
            onclick: async () => {
              const before = await snapshotScript(script.id);
              await deleteScene(script.id, scene.id);
              await refresh();
              offerUndo({
                message: `Deleted “${scene.title}”`,
                onUndo: async () => {
                  await restoreScript(before);
                  refresh();
                },
              });
            },
          },
          '×',
        ),
      ),
      h(
        'div',
        { class: 'script-body' },
        scene.lines.map((line) => lineRow(scene, line)),
      ),
    );
  };

  return h(
    'main',
    { class: 'page' },
    h('a', { class: 'back', href: '#/' }, '← Library'),
    h(
      'header',
      { class: 'masthead' },
      titleField,
      h(
        'p',
        { class: 'subtitle' },
        [
          plural(scenes.length, 'scene'),
          configured ? `${plural(yourLines, 'line')} yours` : plural(script.characters.length, 'character'),
        ].join(' · '),
        saved,
      ),
    ),
    h(
      'p',
      { class: 'cast' },
      script.characters.map((c) =>
        h('span', { class: `chip${myIds.has(c.id) ? ' mine' : ''}` }, c.name),
      ),
    ),
    scenes.length
      ? h(
          'div',
          { class: 'actions' },
          // Straight into the run once setup exists; it used to insist on the
          // setup screen every time, for answers it had already stored.
          h(
            'a',
            {
              class: 'button primary',
              href: `#/script/${script.id}/${configured ? 'rehearse' : 'setup'}`,
            },
            configured ? 'Rehearse' : 'Set up rehearsal',
          ),
          configured && h('a', { class: 'button', href: `#/script/${script.id}/setup` }, 'Change setup'),
        )
      : h('p', { class: 'note' }, 'Every scene has been deleted. Import the script again to start over.'),
    h('p', { class: 'hint reading-hint' }, 'Tap any line to correct its text.'),
    scenes.map(sceneSection),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          class: 'button danger',
          type: 'button',
          onclick: async () => {
            const before = await snapshotScript(script.id);
            await deleteScript(script.id);
            clearLastRun(script.id);
            navigate('#/');
            offerUndo({
              message: `Deleted “${script.title}”`,
              onUndo: async () => {
                await restoreScript(before);
                navigate(`#/script/${script.id}`);
              },
            });
          },
        },
        'Delete script',
      ),
    ),
  );
}
