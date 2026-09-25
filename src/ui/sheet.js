/* Dialogo modale del sistema «Terminale ambra»: <dialog> nativo aperto con showModal()
   (il resto della pagina è inerte), intestazione ferma, Esc o clic fuori per chiudere,
   il focus torna a chi l'ha aperto. */
import { h } from './dom.js';

let current = null;

export function openSheet({ title, sub, body, foot, onClose, wide = false }) {
  closeSheet({ restore: false });
  const opener = document.activeElement;
  const closeBtn = h('button', { type: 'button', class: 'modal-close', 'aria-label': 'Chiudi', text: '×' });
  const dlg = h('dialog', { class: 'modal-card' + (wide ? ' wide' : ''), 'aria-label': title },
    h('div', { class: 'ph' }, h('h2', { text: title }), sub ? h('span', { class: 'meta', text: sub }) : null, closeBtn),
    h('div', { class: 'pb' }, body),
    foot ? h('div', { class: 'mfoot' }, foot) : null);
  const me = { dlg, restore: true, close: () => { if (dlg.open) dlg.close(); } };
  closeBtn.addEventListener('click', me.close);
  // clic sullo sfondo (fuori dal riquadro) chiude
  dlg.addEventListener('click', e => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) me.close();
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (current === me) current = null;
    if (onClose) onClose();
    if (me.restore && !current && opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true });
  });
  document.body.appendChild(dlg);
  current = me;
  dlg.showModal();
  const first = dlg.querySelector('[data-autofocus], input:not([type=file]):not([type=checkbox]), .mfoot .primary');
  (first || closeBtn).focus({ preventScroll: true });
  return me.close;
}

/** restore: false quando un altro dialogo prende subito il suo posto (il focus resta lì). */
export function closeSheet({ restore = true } = {}) {
  if (!current) return;
  const c = current;
  current = null;
  c.restore = restore;
  c.close();
}
