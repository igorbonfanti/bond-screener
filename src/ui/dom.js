/* Piccoli strumenti per il DOM. Il testo entra sempre come textContent (mai innerHTML):
   descrizioni e nomi arrivano dal file dati e vanno trattati come non fidati. */

export const $ = (sel, root = document) => root.querySelector(sel);

/** h('div', {class, on:{click}, attrs, style, data}, ...figli) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'style') Object.assign(el.style, v);
      else if (k === 'data') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c) el.appendChild(c);
  return el;
}

/* ---------- Icone (tratti 1.75, colore del testo) ---------- */
const ICONS = {
  capital: ['M4 7h16v12H4z', 'M4 11h16', 'M8 3v4', 'M16 3v4', 'M8 15h3'],
  income: ['M3 12h3l2-5 4 10 3-7 2 2h4', 'M3 20h18'],
  save: ['M5 4h11l3 3v13H5z', 'M8 4v5h7V4', 'M8 20v-6h8v6'],
  share: ['M8.6 13.5l6.8 4', 'M15.4 6.5l-6.8 4', 'M18 5.5a2.5 2.5 0 1 1-.01 0', 'M6 12a2.5 2.5 0 1 1-.01 0', 'M18 18.5a2.5 2.5 0 1 1-.01 0'],
  download: ['M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'],
  print: ['M7 9V4h10v5', 'M6 17H4v-7h16v7h-2', 'M7 14h10v6H7z'],
  swap: ['M7 7h11l-3-3', 'M17 17H6l3 3'],
  upload: ['M12 20V9', 'M7 13l5-5 5 5', 'M5 4h14'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 5v6h-6'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  open: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
  data: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3']
};
export function icon(name) {
  const el = s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  for (const d of ICONS[name] || []) el.appendChild(s('path', { d }));
  return el;
}

export function logo() {
  return s('svg', { viewBox: '0 0 32 32', 'aria-hidden': 'true' },
    s('rect', { width: 32, height: 32, rx: 8, fill: 'var(--accent)' }),
    s('rect', { x: 7, y: 19, width: 4, height: 6, rx: 1.5, fill: 'var(--accent-ink)' }),
    s('rect', { x: 14, y: 14, width: 4, height: 11, rx: 1.5, fill: 'var(--accent-ink)' }),
    s('rect', { x: 21, y: 8, width: 4, height: 17, rx: 1.5, fill: 'var(--accent-ink)' }));
}

/* ---------- Formati (italiano) ---------- */
const nf = {};
function f(dec, opts = {}) {
  const key = dec + JSON.stringify(opts);
  return nf[key] || (nf[key] = new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec, ...opts }));
}
export const fmtNum = (n, dec = 0) => Number.isFinite(n) ? f(dec).format(n) : '—';
export const fmtEur = (n, dec = 0) => Number.isFinite(n) ? `${f(dec).format(n)} €` : '—';
export const fmtPct = (n, dec = 2) => Number.isFinite(n) ? `${f(dec).format(n)}%` : '—';
export const fmtSigned = (n, dec = 0, unit = ' €') => Number.isFinite(n) ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${f(dec).format(Math.abs(n))}${unit}` : '—';
export function fmtCompactEur(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `${f(1).format(n / 1e6)} mln €`;
  if (a >= 1e4) return `${f(0).format(n / 1e3)}k €`;
  return fmtEur(n);
}

/** Numero digitato all'italiana ("100.000", "2,5") → Number. */
export function parseUserNumber(v) {
  let t = String(v ?? '').trim().replace(/\s|€|%/g, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');   // 100.000 = centomila
  return Number(t);
}

export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast', class: 'toast', role: 'status' }); document.body.appendChild(el); }
  el.className = 'toast ' + kind;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3400);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

export function downloadFile(name, content, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
