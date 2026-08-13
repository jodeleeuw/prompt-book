import { h } from './dom.js';

/**
 * Replaces window.confirm / prompt / alert.
 *
 * Those are unstyled OS sheets that appeared at the highest-stakes moments in
 * the app, and prompt() is blocked outright in some embedded contexts — which
 * would have made "new character" silently do nothing.
 *
 * Built on <dialog>, which brings focus trapping, Escape, and inertness for
 * free. Reinventing that would be the actual anti-pattern.
 */
function openDialog(render) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      dialog.close();
    };

    const dialog = h('dialog', {
      class: 'sheet',
      onclose: () => {
        finish(null); // Escape, or the backdrop
        dialog.remove();
      },
      onclick: (event) => {
        if (event.target === dialog) finish(null); // clicked outside the panel
      },
    });

    dialog.append(h('div', { class: 'sheet-panel' }, render(finish)));
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** @returns true if confirmed, false or null otherwise. */
export const confirmAction = ({ title, body, confirmLabel = 'Delete', tone = 'danger' }) =>
  openDialog((finish) =>
    h(
      'div',
      null,
      h('h2', { class: 'sheet-title' }, title),
      body && h('p', { class: 'note' }, body),
      h(
        'div',
        { class: 'sheet-actions' },
        h('button', { class: 'button', type: 'button', onclick: () => finish(false) }, 'Cancel'),
        h(
          'button',
          { class: `button ${tone}`, type: 'button', onclick: () => finish(true) },
          confirmLabel,
        ),
      ),
    ),
  );

/** @returns the entered string, or null if dismissed. */
export const promptForText = ({ title, label, value = '', confirmLabel = 'Add' }) =>
  openDialog((finish) => {
    const field = h('input', { class: 'sheet-input', type: 'text', value, 'aria-label': label });
    const submit = () => finish(field.value.trim() || null);

    queueMicrotask(() => field.focus());
    return h(
      'form',
      {
        method: 'dialog',
        onsubmit: (event) => {
          event.preventDefault();
          submit();
        },
      },
      h('h2', { class: 'sheet-title' }, title),
      field,
      h(
        'div',
        { class: 'sheet-actions' },
        h('button', { class: 'button', type: 'button', onclick: () => finish(null) }, 'Cancel'),
        h('button', { class: 'button primary', type: 'submit' }, confirmLabel),
      ),
    );
  });

/** A one-sentence message with a single way out. Replaces alert(). */
export const notify = ({ title, body }) =>
  openDialog((finish) =>
    h(
      'div',
      null,
      h('h2', { class: 'sheet-title' }, title),
      body && h('p', { class: 'note' }, body),
      h(
        'div',
        { class: 'sheet-actions' },
        h('button', { class: 'button primary', type: 'button', onclick: () => finish(true) }, 'OK'),
      ),
    ),
  );

let liveToast = null;

/**
 * Undo beats confirm for anything reversible: it costs nothing when you meant
 * it, and costs one tap when you did not.
 */
export function offerUndo({ message, onUndo, seconds = 8 }) {
  liveToast?.remove();

  const dismiss = () => {
    clearTimeout(timer);
    toast.remove();
    if (liveToast === toast) liveToast = null;
  };

  const toast = h(
    'div',
    { class: 'toast', role: 'status', 'aria-live': 'polite' },
    h('span', null, message),
    h(
      'button',
      {
        class: 'toast-undo',
        type: 'button',
        onclick: async () => {
          dismiss();
          await onUndo();
        },
      },
      'Undo',
    ),
  );

  const timer = setTimeout(dismiss, seconds * 1000);
  liveToast = toast;
  document.body.append(toast);
  return dismiss;
}
