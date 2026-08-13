import { h, plural } from './dom.js';
import { segmentParens } from '../parse/lines.js';
import { parseScript, detectFormat, FORMATS } from '../parse/index.js';
import { commitDraft } from '../parse/draft.js';
import { createScript } from '../store/library.js';
import { promptForText, notify } from './confirm.js';
import { SAMPLE_SCRIPT, SAMPLE_TITLE } from './sample-script.js';
import { takePendingImport } from './pending-import.js';
import { navigate } from './router.js';

const DIRECTION = '__direction';
const NEW_CHARACTER = '__new';

export async function renderImport() {
  // Draft lives only in this view. Nothing is written until Save.
  let draft = null;
  const body = h('div');

  const update = () => {
    const y = window.scrollY;
    body.replaceChildren(draft ? preview() : source());
    window.scrollTo(0, y);
  };

  // `raw` is kept so switching format re-reads the original source rather than
  // trying to reinterpret an already-parsed draft.
  const build = (text, format, fallbackTitle, scan = null) => {
    const parsed = parseScript(text, format);
    if (!parsed.scenes.length) {
      notify({
        title: 'Nothing to import',
        body: 'No dialogue was recognised. Plain text needs a character name and a colon, like “MIRA: Breathe.”',
      });
      return;
    }
    draft = {
      raw: text,
      format,
      scan,
      title: parsed.title || fallbackTitle,
      scenes: parsed.scenes,
      characters: parsed.characters,
    };
    update();
  };

  const load = (text, filename) =>
    build(
      text,
      detectFormat(text, filename),
      filename.replace(/\.[^.]+$/, '').trim() || 'Untitled script',
    );

  // ---- step one: pick a source -------------------------------------------

  function source() {
    const file = h('input', {
      type: 'file',
      accept: '.txt,.text,.md,.fountain,text/plain',
      class: 'file-input',
      id: 'file',
      onchange: async () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        load(await chosen.text(), chosen.name);
      },
    });

    const pasted = h('textarea', {
      class: 'paste',
      rows: 12,
      placeholder: 'HAMLET: To be, or not to be, that is the question.\n\nHORATIO: My lord?',
      'aria-label': 'Paste a script',
    });

    return h(
      'div',
      null,
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'panel-title' }, 'From a file'),
        h('p', { class: 'note' }, 'Plain text or Fountain (.txt, .fountain).'),
        file,
        h('label', { class: 'button', for: 'file' }, 'Choose file'),
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'panel-title' }, 'Or paste it'),
        pasted,
        h(
          'button',
          {
            class: 'button',
            type: 'button',
            onclick: () => {
              if (!pasted.value.trim()) return;
              load(pasted.value, '');
            },
          },
          'Parse',
        ),
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'panel-title' }, 'From photos'),
        h(
          'p',
          { class: 'note' },
          'Photograph the pages of a paper script. Reading happens on this device.',
        ),
        h('a', { class: 'button', href: '#/scan' }, 'Scan pages'),
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'panel-title' }, 'Or try one'),
        h(
          'p',
          { class: 'note' },
          'A two-hander to see how a run works before importing anything of your own.',
        ),
        h(
          'button',
          {
            class: 'button',
            type: 'button',
            onclick: () => build(SAMPLE_SCRIPT, 'text', SAMPLE_TITLE),
          },
          `Load “${SAMPLE_TITLE}”`,
        ),
      ),
    );
  }

  // ---- step two: review what the parser guessed ---------------------------

  function preview() {
    const lines = draft.scenes.flatMap((s) => s.lines);
    const dialogueCount = lines.filter((l) => l.kind === 'dialogue').length;
    const directionCount = lines.length - dialogueCount;
    const parenCount = lines.reduce((n, l) => n + (l.kind === 'dialogue' ? l.parens.length : 0), 0);

    const titleField = h('input', {
      class: 'title-input',
      type: 'text',
      value: draft.title,
      'aria-label': 'Script title',
      oninput: () => {
        draft.title = titleField.value;
      },
    });

    return h(
      'div',
      null,
      titleField,
      draft.scan && scanSummary(draft.scan),
      formatToggle(),
      h(
        'p',
        { class: 'note' },
        `${plural(dialogueCount, 'line')} of dialogue across ${plural(draft.scenes.length, 'scene')}. `,
        directionCount
          ? `${plural(directionCount, 'line')} read as stage directions and will be dropped — tap one to reassign it to a character. `
          : '',
        parenCount
          ? 'Greyed parentheticals will be removed too; tap one to keep it.'
          : '',
      ),
      draft.scenes.map(sceneSection),
      h(
        'div',
        { class: 'actions sticky' },
        h('button', { class: 'button primary', type: 'button', onclick: save }, 'Save to library'),
        h(
          'button',
          {
            class: 'button',
            type: 'button',
            onclick: () => {
              draft = null;
              update();
            },
          },
          'Start over',
        ),
      ),
    );
  }

  /**
   * OCR guesses far more than the parser does, so the preview says where it was
   * least sure rather than presenting every line with equal confidence.
   */
  function scanSummary(scan) {
    const bits = [`Read from ${plural(scan.pageCount, 'photo')}.`];
    if (scan.shaky?.length) {
      const pages = scan.shaky.map((s) => s.page).join(', ');
      bits.push(
        `The recogniser was least sure of ${scan.shaky.length > 1 ? 'pages' : 'page'} ${pages} — worth reading those closely.`,
      );
    }
    if (scan.dropped?.length) {
      bits.push(`${plural(scan.dropped.length, 'line')} of page furniture removed.`);
    }
    bits.push('Tap any line to change who says it; you can fix the words after saving.');
    return h('p', { class: 'note scan-summary' }, bits.join(' '));
  }

  // Format detection is a guess for pasted text, so it is shown and reversible
  // rather than silently applied.
  function formatToggle() {
    const select = h('select', { class: 'format-select', 'aria-label': 'Script format' });
    select.append(...FORMATS.map((f) => h('option', { value: f.id }, f.label)));
    select.value = draft.format;
    select.addEventListener('change', () => build(draft.raw, select.value, draft.title));

    return h(
      'p',
      { class: 'note' },
      'Read as ',
      select,
      ' — switching re-reads the source and discards corrections made here.',
    );
  }

  function sceneSection(scene) {
    const title = h('input', {
      class: 'scene-title-input',
      type: 'text',
      value: scene.title,
      'aria-label': 'Scene title',
      oninput: () => {
        scene.title = title.value;
      },
    });
    return h('section', { class: 'scene' }, title, h('div', { class: 'script-body' }, scene.lines.map(lineRow)));
  }

  function lineRow(line) {
    const row = h('div', { class: `row ${line.kind}` });
    const redraw = () => row.replaceWith(lineRow(line));

    const select = h('select', { class: 'speaker-select', 'aria-label': 'Character' });
    select.append(
      ...draft.characters.map((name) => h('option', { value: name }, name)),
      h('option', { value: DIRECTION }, '— stage direction —'),
      h('option', { value: NEW_CHARACTER }, '+ new character…'),
    );
    select.value = line.kind === 'direction' ? DIRECTION : line.character;
    select.addEventListener('change', async () => {
      if (select.value === DIRECTION) {
        line.kind = 'direction';
        line.character = null;
        redraw();
      } else if (select.value === NEW_CHARACTER) {
        select.value = line.kind === 'direction' ? DIRECTION : line.character; // until it is named
        const name = await promptForText({
          title: 'New character',
          label: 'Character name',
          confirmLabel: 'Add character',
        });
        if (!name) return;
        if (!draft.characters.includes(name)) draft.characters.push(name);
        assign(line, name);
        update(); // every other select needs the new option
      } else {
        assign(line, select.value);
        redraw();
      }
    });

    row.append(select, speech(line, redraw));
    return row;
  }

  // Giving a line to a character means you want it spoken. A line read as a
  // stage direction is usually bracketed end to end, so keep its parentheticals
  // rather than showing text that strikes itself out entirely.
  function assign(line, character) {
    if (line.kind === 'direction') line.parens.forEach((paren) => (paren.keep = true));
    line.kind = 'dialogue';
    line.character = character;
  }

  function speech(line, redraw) {
    if (line.kind === 'direction') return h('span', { class: 'speech struck' }, line.text);
    return h(
      'span',
      { class: 'speech' },
      segmentParens(line.text).map((seg) =>
        seg.type === 'text'
          ? seg.value
          : h(
              'button',
              {
                type: 'button',
                class: `paren${line.parens[seg.index]?.keep ? ' kept' : ''}`,
                title: line.parens[seg.index]?.keep ? 'Kept — tap to remove' : 'Will be removed — tap to keep',
                onclick: () => {
                  const paren = line.parens[seg.index];
                  paren.keep = !paren.keep;
                  redraw();
                },
              },
              seg.value,
            ),
      ),
    );
  }

  async function save() {
    const committed = commitDraft(draft);
    if (!committed.scenes.length) {
      notify({
        title: 'Nothing to save',
        body: 'Every line is currently marked as a stage direction. Assign at least one to a character first.',
      });
      return;
    }
    const id = await createScript(committed);
    navigate(`#/script/${id}`);
  }

  // A scan hands its text over in memory and lands straight in the preview.
  const scanned = takePendingImport();
  if (scanned) build(scanned.text, 'text', scanned.title, scanned);
  else update();

  return h(
    'main',
    { class: 'page' },
    h('a', { class: 'back', href: '#/' }, '← Library'),
    h('header', { class: 'masthead' }, h('h1', { class: 'title' }, 'Import')),
    body,
  );
}
