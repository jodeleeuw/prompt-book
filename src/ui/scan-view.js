import { h, plural } from './dom.js';
import { prepare } from '../ocr/preprocess.js';
import { pageToScript } from '../ocr/layout.js';
import { joinPages } from '../ocr/pages.js';
import { setPendingImport } from './pending-import.js';
import { notify } from './confirm.js';
import { navigate } from './router.js';

// Below this the recogniser was guessing, and the page is worth a second look.
const SHAKY_CONFIDENCE = 78;

export async function renderScan() {
  // One control serves both devices: on Android the picker offers the camera,
  // on a laptop it offers the filesystem. No branching, no getUserMedia.
  let pages = []; // { id, blob, url, rotation, name }
  let busy = false;
  let progress = null;

  const list = h('div', { class: 'pages' });
  const status = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
  const actions = h('div', { class: 'actions sticky' });

  const picker = h('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    class: 'file-input',
    id: 'pages',
    onchange: () => {
      addFiles([...picker.files]);
      picker.value = ''; // so the same file can be chosen again after removal
    },
  });

  function addFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      pages.push({
        id: crypto.randomUUID(),
        blob: file,
        url: URL.createObjectURL(file),
        rotation: 0,
        name: file.name,
      });
    }
    paint();
  }

  function removePage(id) {
    const page = pages.find((p) => p.id === id);
    if (page) URL.revokeObjectURL(page.url);
    pages = pages.filter((p) => p.id !== id);
    paint();
  }

  function movePage(id, delta) {
    const from = pages.findIndex((p) => p.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= pages.length) return;
    const [moved] = pages.splice(from, 1);
    pages.splice(to, 0, moved);
    paint();
  }

  // ---- reading ------------------------------------------------------------

  async function read() {
    if (!pages.length || busy) return;
    busy = true;
    progress = { page: 1, of: pages.length, stage: 'starting', fraction: 0 };
    paint();

    try {
      const { recognise, release, isSupported } = await import('../ocr/engine.js');
      if (!isSupported()) {
        throw new Error('This browser cannot run the text recogniser.');
      }

      const results = [];
      for (const [index, page] of pages.entries()) {
        progress = { page: index + 1, of: pages.length, stage: 'reading', fraction: 0 };
        paint();

        const image = await prepare(page.blob, page.rotation);
        const recognised = await recognise(image, {
          onProgress: ({ stage, progress: fraction }) => {
            progress = { page: index + 1, of: pages.length, stage, fraction };
            paintStatus();
          },
        });
        results.push(pageToScript(recognised));
      }

      await release(); // hand back the several megabytes

      const shaky = results
        .map((result, i) => ({ page: i + 1, confidence: result.confidence }))
        .filter((r) => r.confidence && r.confidence < SHAKY_CONFIDENCE);

      const { text, dropped } = joinPages(results.map((r) => r.text));
      if (!text.trim()) {
        await notify({
          title: 'No text found',
          body: 'Nothing legible came back. Try again with the page filling the frame, lit evenly and square to the camera.',
        });
        return;
      }

      setPendingImport({
        text,
        title: 'Scanned script',
        source: 'photos',
        pageCount: pages.length,
        shaky,
        dropped,
      });
      navigate('#/import');
    } catch (error) {
      await notify({
        title: 'Could not read the pages',
        body: `${error.message ?? error} The photos are still here — nothing was lost.`,
      });
    } finally {
      busy = false;
      progress = null;
      paint();
    }
  }

  // ---- painting -----------------------------------------------------------

  function paintStatus() {
    if (!progress) {
      status.textContent = pages.length
        ? `${plural(pages.length, 'page')} ready. Reading happens on this device — the photos are never uploaded.`
        : '';
      return;
    }
    const percent = Math.round((progress.fraction ?? 0) * 100);
    status.textContent = `Page ${progress.page} of ${progress.of} — ${progress.stage} ${percent}%`;
  }

  function pageCard(page, index) {
    const control = (label, glyph, onclick, disabled = false) =>
      h('button', { class: 'icon', type: 'button', 'aria-label': label, disabled, onclick }, glyph);

    return h(
      'div',
      { class: 'page-card' },
      h('img', {
        class: 'page-thumb',
        src: page.url,
        alt: `Page ${index + 1}`,
        style: `transform: rotate(${page.rotation * 90}deg)`,
      }),
      h(
        'div',
        { class: 'page-controls' },
        h('span', { class: 'page-number' }, `Page ${index + 1}`),
        control('Move earlier', '↑', () => movePage(page.id, -1), index === 0 || busy),
        control('Move later', '↓', () => movePage(page.id, 1), index === pages.length - 1 || busy),
        control('Rotate', '⟳', () => {
          page.rotation = (page.rotation + 1) % 4;
          paint();
        }, busy),
        control('Remove', '×', () => removePage(page.id), busy),
      ),
    );
  }

  function paint() {
    list.replaceChildren(...pages.map(pageCard));
    actions.replaceChildren(
      h('label', { class: `button${busy ? ' disabled' : ''}`, for: 'pages' }, pages.length ? 'Add more' : 'Choose photos'),
      pages.length &&
        h(
          'button',
          { class: 'button primary', type: 'button', disabled: busy, onclick: read },
          busy ? 'Reading…' : `Read ${plural(pages.length, 'page')}`,
        ),
    );
    paintStatus();
  }

  paint();

  // Object URLs outlive the view unless they are revoked.
  const teardown = () => {
    pages.forEach((page) => URL.revokeObjectURL(page.url));
    window.removeEventListener('hashchange', teardown);
  };
  window.addEventListener('hashchange', teardown);

  return h(
    'main',
    { class: 'page' },
    h('a', { class: 'back', href: '#/import' }, '← Import'),
    h('header', { class: 'masthead' }, h('h1', { class: 'title' }, 'Scan a script')),
    h(
      'p',
      { class: 'note' },
      'Photograph each page square to the camera, filling the frame, lit as evenly as you can manage. Order them here, then read them all in one pass. Everything happens on this device.',
    ),
    picker,
    status,
    list,
    actions,
  );
}
