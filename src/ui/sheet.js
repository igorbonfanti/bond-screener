/* Dialogo modale (su telefono sale dal basso). Esc o clic fuori per chiudere. */
import { h } from './dom.js';

let current = null;

export function openSheet({ title, sub, body, foot, onClose }) {
  closeSheet();
  const prevFocus = document.activeElement;
  const close = () => { closeSheet(); if (onClose) onClose(); if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); };
  const closeBtn = h('button', { class: 'close', 'aria-label': 'Chiudi', text: '×', on: { click: close } });
  const dlg = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('div', null, h('h3', { text: title }), sub ? h('div', { class: 'sub', text: sub }) : null), closeBtn),
    h('div', { class: 'sheet-body' }, body),
    foot ? h('div', { class: 'sheet-foot' }, foot) : null);
  const backdrop = h('div', { class: 'sheet-backdrop', on: { click: e => { if (e.target === backdrop) close(); } } }, dlg);
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  current = { backdrop, onKey };
  (dlg.querySelector('input:not([type=file]), button.alt, .sheet-foot .btn-primary') || closeBtn).focus({ preventScroll: true });
  return close;
}

export function closeSheet() {
  if (!current) return;
  document.removeEventListener('keydown', current.onKey);
  current.backdrop.remove();
  current = null;
}
