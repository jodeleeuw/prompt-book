import { h } from './dom.js';

export const section = (title, note, ...children) =>
  h(
    'section',
    { class: 'panel' },
    h('h2', { class: 'panel-title' }, title),
    note && h('p', { class: 'note' }, note),
    ...children,
  );

export function choice(type, name, label, checked, onChange, hint) {
  const input = h('input', { type, name, checked, onchange: () => onChange(input.checked) });
  return h(
    'label',
    { class: 'choice' },
    input,
    h('span', null, h('span', { class: 'choice-label' }, label), hint && h('span', { class: 'choice-hint' }, hint)),
  );
}
