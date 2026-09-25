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

/* ---------- Formati (italiano) ----------
   Virgola decimale, segno meno tipografico (U+2212), "+" esplicito solo dove serve;
   un valore che arrotondato vale zero non ha segno ("0", mai "−0"). */
export const MINUS = '\u2212';
const nf = {};
function f(dec, opts = {}) {
  const key = dec + JSON.stringify(opts);
  return nf[key] || (nf[key] = new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec, ...opts }));
}
/** Valore assoluto già arrotondato e segno "vero" (falso se arrotonda a zero). */
function parts(n, dec) {
  const p = 10 ** dec, r = Math.round(Math.abs(n) * p) / p;
  return { s: f(dec).format(r), neg: n < 0 && r > 0, pos: n > 0 && r > 0 };
}
export const fmtNum = (n, dec = 0) => { if (!Number.isFinite(n)) return '—'; const c = parts(n, dec); return (c.neg ? MINUS : '') + c.s; };
export const fmtEur = (n, dec = 0) => Number.isFinite(n) ? `${fmtNum(n, dec)} €` : '—';
export const fmtPct = (n, dec = 2) => Number.isFinite(n) ? `${fmtNum(n, dec)}%` : '—';
export const fmtSigned = (n, dec = 0, unit = ' €') => {
  if (!Number.isFinite(n)) return '—';
  const c = parts(n, dec);
  return `${c.neg ? MINUS : c.pos ? '+' : ''}${c.s}${unit}`;
};
export function fmtCompactEur(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `${fmtNum(n / 1e6, 1)} mln €`;
  if (a >= 1e4) return `${fmtNum(n / 1e3, 0)}k €`;
  return fmtEur(n);
}

/** Variazione di PREZZO (o di valore): segno, freccia e colore su/giù. Zero: niente segno né colore. */
export function deltaEl(n, dec = 2, unit = '%') {
  if (!Number.isFinite(n)) return h('span', { class: 'muted', text: '—' });
  const c = parts(n, dec), txt = fmtSigned(n, dec, unit);
  if (!c.neg && !c.pos) return h('span', { text: txt });
  return h('span', { class: c.pos ? 'up' : 'down' }, `${c.pos ? '▲' : '▼'} ${txt}`);
}
/** Variazione che non è un prezzo (rendimento, differenza fra titoli): segno e freccia, in inchiostro. */
export function trendText(n, dec = 2, unit = '') {
  if (!Number.isFinite(n)) return '—';
  const c = parts(n, dec), txt = fmtSigned(n, dec, unit);
  return c.pos ? `▲ ${txt}` : c.neg ? `▼ ${txt}` : txt;
}

/* ---------- Badge di stato (forma + parola: si distinguono anche senza colore) ---------- */
const ST_SHAPES = {
  normal: () => s('rect', { x: 2, y: 5, width: 8, height: 2, fill: 'currentColor' }),
  watch: () => s('circle', { cx: 6, cy: 6, r: 4.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
  setup: () => s('path', { d: 'M6 11 L1 4 H11 Z', fill: 'currentColor' }),
  trig: () => s('path', { d: 'M6 1 L11 8 H1 Z', fill: 'currentColor' }),
  fail: () => s('path', { d: 'M2 2 L10 10 M10 2 L2 10', stroke: 'currentColor', 'stroke-width': 2 }),
  cool: () => s('g', null, s('circle', { cx: 6, cy: 6, r: 4.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }), s('path', { d: 'M6 3.5 V6 H8', stroke: 'currentColor', 'stroke-width': 1.5, fill: 'none' }))
};
export function badge(state, text) {
  return h('span', { class: `st st-${state}` }, s('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' }, (ST_SHAPES[state] || ST_SHAPES.normal)()), text);
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
