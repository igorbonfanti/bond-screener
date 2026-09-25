/* Grafici SVG disegnati a mano, stile «Terminale ambra»: fondo nero, griglia sottile, testo degli
   assi in mono ink-3, barre squadrate. Colori solo per classi CSS: serie in grigi (s1 ink, s2, s3),
   obiettivo in blu (il segnale del progetto), media e titoli in evidenza in ambra.
   Passando sopra (o con il focus da tastiera) un elemento, gli altri scendono al 16%; il riquadro
   informativo (.tip) resta dentro il grafico. Disegnati alla larghezza reale del contenitore. */
import { h, s } from './dom.js';
import { parts } from '../core/dates.js';

const MONO_CHAR = 7;     // avanzamento misurato di un carattere IBM Plex Mono a 10,5px

function niceTicks(min, max, count = 5) {
  if (!(max > min)) max = min + 1;
  const raw = (max - min) / count, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step, out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}

function mountFrame(container, cfg, render) {
  container.classList.add('chart');
  container.__cfg = cfg;
  container.__render = render;
  if (!container.__ro && 'ResizeObserver' in window) {
    let last = 0;
    container.__ro = new ResizeObserver(() => {
      const w = Math.round(container.clientWidth);
      if (Math.abs(w - last) > 2) { last = w; container.__render(container, container.__cfg); }
    });
    container.__ro.observe(container);
  }
  render(container, cfg);
}

function tipEl(container) {
  let tt = container.querySelector(':scope > .tip');
  if (!tt) { tt = h('div', { class: 'tip', role: 'tooltip', hidden: true }); container.appendChild(tt); }
  return tt;
}

function showTip(container, content, px, py) {
  const tt = tipEl(container);
  tt.replaceChildren();
  if (content.title) tt.appendChild(h('div', { class: 'row' }, h('b', { text: content.title }), content.meta ? h('span', { text: content.meta }) : null));
  for (const r of content.rows || []) {
    tt.appendChild(h('div', { class: 'row' },
      h('span', null, r.key ? h('span', { class: 'kl', style: { background: `var(--${r.key})` } }) : null, r.label),
      h('b', { text: r.value })));
  }
  if (content.note) tt.appendChild(h('div', { class: 'note', text: content.note }));
  tt.hidden = false;
  const cw = container.clientWidth, ch = container.clientHeight, tw = tt.offsetWidth, th = tt.offsetHeight;
  let left = px + 14, top = py - th - 10;
  if (left + tw > cw) left = Math.max(0, px - tw - 14);          // a sinistra del puntatore se a destra non c'è spazio
  if (top < 0) top = Math.min(py + 14, Math.max(0, ch - th));
  tt.style.left = `${left}px`; tt.style.top = `${top}px`;
}
function hideTip(container) { const tt = container.querySelector(':scope > .tip'); if (tt) tt.hidden = true; }

/* -------------------------------------------------------------------------- */
/* Colonne (impilate o singole), tacche dell'obiettivo e linea media           */
/* -------------------------------------------------------------------------- */
export function columnChart(container, cfg) { mountFrame(container, cfg, renderColumns); }

function renderColumns(container, cfg) {
  const { labels, series, target = null, average = null, height = 240, yFormat = v => String(v), tooltip, onClick, ariaLabel } = cfg;
  const n = labels.length;
  const W = Math.max(300, (container.clientWidth || 600) - 12);
  const sums = labels.map((_, i) => series.reduce((a, sr) => a + Math.max(0, sr.values[i] || 0), 0));
  const top = Math.max(1, ...sums, ...(target || []).map(v => v || 0), average || 0) * 1.08;
  const ticks = niceTicks(0, top, 4);
  const yMax = ticks[ticks.length - 1];
  const avgTag = average != null && average > 0 ? (cfg.averageLabel || 'media') : '';
  const left = 8 + Math.max(...ticks.map(t => yFormat(t).length)) * MONO_CHAR;
  const right = avgTag ? 10 + avgTag.length * MONO_CHAR + 8 : 6;
  const M = { l: left, r: right, t: 12, b: 24 };
  const pw = W - M.l - M.r, ph = height - M.t - M.b;
  const y = v => M.t + ph - (v / yMax) * ph;
  const band = pw / Math.max(1, n), bw = Math.max(4, Math.min(22, band * 0.6));
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, height, role: 'group', 'aria-label': ariaLabel || '' });

  for (const t of ticks) {
    svg.appendChild(s('line', { class: t === 0 ? 'base' : 'gridl', x1: M.l, x2: W - M.r, y1: y(t), y2: y(t) }));
    svg.appendChild(s('text', { class: 'axt', x: M.l - 6, y: y(t) + 3.5, 'text-anchor': 'end', text: yFormat(t) }));
  }

  // etichette dell'asse x: una ogni k perché non si sovrappongano
  const maxLab = Math.max(...labels.map(l => l.length)) * MONO_CHAR + 10;
  const every = Math.max(1, Math.ceil(maxLab / band));
  labels.forEach((l, i) => {
    if (i % every !== 0) return;
    svg.appendChild(s('text', { class: 'axt', x: M.l + band * (i + 0.5), y: height - 7, 'text-anchor': 'middle', text: l }));
  });

  const cols = [];
  labels.forEach((l, i) => {
    const cx = M.l + band * (i + 0.5), x0 = cx - bw / 2;
    const g = s('g', { class: 'col', tabindex: 0, role: 'img', 'aria-label': `${l}: ${yFormat(sums[i])}` });
    g.appendChild(s('rect', { class: 'hit', x: M.l + band * i, y: M.t, width: band, height: ph }));
    let base = 0;
    const segs = series.map(sr => ({ cls: sr.cls, v: Math.max(0, sr.values[i] || 0) })).filter(sg => sg.v > 0);
    segs.forEach((sg, k) => {
      const yTop = y(base + sg.v), yBot = y(base) - (k > 0 ? 2 : 0);    // 2px di stacco (nero) tra i segmenti
      const hh = yBot - yTop;
      if (hh > 0.5) g.appendChild(s('rect', { class: sg.cls, x: x0, y: yTop, width: bw, height: hh }));
      base += sg.v;
    });
    if (target && target[i] > 0) g.appendChild(s('line', { class: 'target', x1: x0 - 5, x2: x0 + bw + 5, y1: y(target[i]), y2: y(target[i]) }));
    const show = (px, py) => tooltip && showTip(container, tooltip(i), px, py);
    const on = () => { container.classList.add('dim'); g.classList.add('focus'); };
    const off = () => { container.classList.remove('dim'); g.classList.remove('focus'); hideTip(container); };
    g.addEventListener('pointermove', e => { on(); const r = container.getBoundingClientRect(); show(e.clientX - r.left, e.clientY - r.top); });
    g.addEventListener('pointerleave', off);
    g.addEventListener('focus', () => { on(); const sc = container.clientWidth / W; show(cx * sc, y(Math.max(sums[i], (target && target[i]) || 0)) * sc + 8); });
    g.addEventListener('blur', off);
    if (onClick) {
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => onClick(i));
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(i); } });
    }
    cols.push(g);
  });
  cols.forEach(g => svg.appendChild(g));

  if (avgTag) {
    const ya = y(average);
    svg.appendChild(s('line', { class: 'avg', x1: M.l, x2: W - M.r, y1: ya, y2: ya }));
    const tw = avgTag.length * MONO_CHAR + 10;
    svg.appendChild(s('rect', { class: 'avgtag', x: W - M.r + 4, y: ya - 8, width: tw, height: 16 }));
    svg.appendChild(s('text', { class: 'avgtxt', x: W - M.r + 9, y: ya + 3.5, text: avgTag }));
  }
  container.querySelector(':scope > svg')?.remove();
  container.insertBefore(svg, container.firstChild);
}

/* -------------------------------------------------------------------------- */
/* Mappa dei rendimenti: scadenza × rendimento netto (titoli scelti in ambra)  */
/* -------------------------------------------------------------------------- */
export function yieldMap(container, cfg) { mountFrame(container, cfg, renderMap); }

function renderMap(container, cfg) {
  const { points, bands = [], height = 280, tooltip, onPick, ariaLabel, yFormat = v => String(v) } = cfg;
  const W = Math.max(300, (container.clientWidth || 600) - 12);
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, height, role: 'img', 'aria-label': ariaLabel || '' });
  if (!points.length) { container.querySelector(':scope > svg')?.remove(); container.insertBefore(svg, container.firstChild); return; }
  const xs = points.map(p => p.maturity).concat(bands.flatMap(b => [b.from, b.to]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ys = points.map(p => p.y);
  const yt = niceTicks(Math.min(...ys) - 0.1, Math.max(...ys) + 0.1, 4);
  const yLo = yt[0], yHi = yt[yt.length - 1];
  const M = { l: 10 + Math.max(...yt.map(t => yFormat(t).length)) * MONO_CHAR, r: 8, t: 10, b: 24 };
  const pw = W - M.l - M.r, ph = height - M.t - M.b;
  const X = d => M.l + (d - x0) / Math.max(1, x1 - x0) * pw;
  const Y = v => M.t + ph - (v - yLo) / (yHi - yLo) * ph;

  bands.forEach((b, i) => svg.appendChild(s('rect', { class: 'band' + (i % 2 ? ' alt' : ''), x: X(b.from), y: M.t, width: Math.max(1, X(b.to) - X(b.from)), height: ph })));
  for (const t of yt) {
    svg.appendChild(s('line', { class: 'gridl', x1: M.l, x2: W - M.r, y1: Y(t), y2: Y(t) }));
    svg.appendChild(s('text', { class: 'axt', x: M.l - 6, y: Y(t) + 3.5, 'text-anchor': 'end', text: yFormat(t) }));
  }

  // anni sull'asse x
  const y0 = parts(x0).y, y1 = parts(x1).y;
  const yearsN = y1 - y0 + 1, every = Math.max(1, Math.ceil((4 * MONO_CHAR + 14) / (pw / Math.max(1, yearsN))));
  for (let yy = y0; yy <= y1 + 1; yy++) {
    const d = Date.UTC(yy, 0, 1) / 86400000;
    if (d < x0 || d > x1) continue;
    svg.appendChild(s('line', { class: 'base', x1: X(d), x2: X(d), y1: M.t + ph, y2: M.t + ph + 4 }));
    if ((yy - y0) % every === 0) svg.appendChild(s('text', { class: 'axt', x: X(d) + 3, y: height - 7, text: String(yy) }));
  }
  svg.appendChild(s('line', { class: 'base', x1: M.l, x2: W - M.r, y1: M.t + ph, y2: M.t + ph }));

  const back = points.filter(p => !p.sel), front = points.filter(p => p.sel);
  for (const p of back) svg.appendChild(s('circle', { class: 'dot', cx: X(p.maturity), cy: Y(p.y), r: 2.6 }));
  for (const p of front) svg.appendChild(s('circle', { class: 'dot sel', cx: X(p.maturity), cy: Y(p.y), r: 5 }));
  const ring = s('circle', { class: 'xring', r: 8, visibility: 'hidden' });
  svg.appendChild(ring);

  const nearest = (mx, my) => {
    let best = null, bd = 24 * 24;
    for (const p of points) {
      const dx = X(p.maturity) - mx, dy = Y(p.y) - my, d = dx * dx + dy * dy;
      if (d < bd || (d === bd && p.sel)) { bd = d; best = p; }
    }
    return best;
  };
  const toLocal = e => { const r = svg.getBoundingClientRect(), c = container.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (height / r.height), e.clientX - c.left, e.clientY - c.top]; };
  const clear = () => { ring.setAttribute('visibility', 'hidden'); hideTip(container); svg.style.cursor = ''; };
  svg.addEventListener('pointermove', e => {
    const [mx, my, px, py] = toLocal(e), p = nearest(mx, my);
    if (!p) { clear(); return; }
    ring.setAttribute('cx', X(p.maturity)); ring.setAttribute('cy', Y(p.y)); ring.setAttribute('visibility', 'visible');
    svg.style.cursor = onPick && p.pickable ? 'pointer' : '';
    if (tooltip) showTip(container, tooltip(p), px, py);
  });
  svg.addEventListener('pointerleave', clear);
  if (onPick) svg.addEventListener('click', e => { const [mx, my] = toLocal(e); const p = nearest(mx, my); if (p) onPick(p); });
  container.querySelector(':scope > svg')?.remove();
  container.insertBefore(svg, container.firstChild);
}

/** Legenda del pannello: un quadratino (.kb) per aree e punti, un trattino (.kl) per le linee.
    Ogni colore usato ha la sua voce; key = nome del token (ink, chart-trail, blue, amber…). */
export function legend(items) {
  return h('div', { class: 'legend' }, items.map(it => it.type === 'text'
    ? h('span', { class: 'muted', text: it.label })
    : h('span', null, it.el || h('span', { class: it.type === 'line' ? 'kl' : 'kb', style: { background: `var(--${it.key})` } }), it.label)));
}
