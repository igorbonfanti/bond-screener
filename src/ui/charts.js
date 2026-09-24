/* Grafici SVG, senza librerie. Colori solo tramite classi CSS (s1, s2, deemph…): cambiano
   da soli con il tema. Regole: colonne ≤ 24px con estremità arrotondata di 4px, 2px di
   stacco tra segmenti, griglia a filo sottile, tooltip su ogni colonna (area sensibile =
   tutta la fascia), tastiera: ogni colonna è focalizzabile e mostra lo stesso tooltip. */
import { h, s } from './dom.js';
import { parts } from '../core/dates.js';

const MONO_CHAR = 6.8;   // larghezza media di un carattere JetBrains Mono 11px

function niceTicks(min, max, count = 5) {
  if (!(max > min)) max = min + 1;
  const raw = (max - min) / count, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step, out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}

/** Rettangolo con angoli superiori arrotondati (estremità dati), base squadrata. */
function topRounded(x, y, w, hgt, r) {
  if (hgt <= 0) return '';
  r = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
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

function tooltipEl(container) {
  let tt = container.querySelector(':scope > .tooltip');
  if (!tt) { tt = h('div', { class: 'tooltip', role: 'tooltip', hidden: true }); container.appendChild(tt); }
  return tt;
}

function showTooltip(container, content, px, py) {
  const tt = tooltipEl(container);
  tt.replaceChildren();
  if (content.title) tt.appendChild(h('div', { class: 'tt-title', text: content.title }));
  for (const r of content.rows || []) {
    tt.appendChild(h('div', { class: 'tt-row' },
      r.key ? h('span', { class: 'tt-key', style: { background: `var(--${r.key})` } }) : null,
      h('span', { text: r.label }), h('b', { text: r.value })));
  }
  if (content.note) tt.appendChild(h('div', { class: 'tt-note', text: content.note }));
  tt.hidden = false;
  const cw = container.clientWidth, tw = tt.offsetWidth, th = tt.offsetHeight;
  let left = px + 14, top = py - th - 10;
  if (left + tw > cw) left = Math.max(0, px - tw - 14);
  if (top < 0) top = py + 14;
  tt.style.left = `${left}px`; tt.style.top = `${top}px`;
}
function hideTooltip(container) { const tt = container.querySelector(':scope > .tooltip'); if (tt) tt.hidden = true; }

/* -------------------------------------------------------------------------- */
/* Colonne (impilate o singole) con tacche obiettivo e linea media facoltative */
/* -------------------------------------------------------------------------- */
export function columnChart(container, cfg) { mountFrame(container, cfg, renderColumns); }

function renderColumns(container, cfg) {
  const { labels, series, target = null, average = null, height = 240, yFormat = v => String(v), tooltip, onClick, ariaLabel } = cfg;
  const n = labels.length;
  const W = Math.max(280, container.clientWidth || 600);
  const sums = labels.map((_, i) => series.reduce((a, sr) => a + Math.max(0, sr.values[i] || 0), 0));
  const top = Math.max(1, ...sums, ...(target || []).map(v => v || 0), average || 0) * 1.08;
  const ticks = niceTicks(0, top, 4);
  const yMax = ticks[ticks.length - 1];
  const left = 10 + Math.max(...ticks.map(t => yFormat(t).length)) * MONO_CHAR;
  const M = { l: left, r: 8, t: 14, b: 26 };
  const pw = W - M.l - M.r, ph = height - M.t - M.b;
  const y = v => M.t + ph - (v / yMax) * ph;
  const band = pw / Math.max(1, n), bw = Math.max(4, Math.min(24, band * 0.62));
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, height, role: 'group', 'aria-label': ariaLabel || '' });

  const grid = s('g', { class: 'grid' });
  for (const t of ticks) {
    grid.appendChild(s('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t) }));
    svg.appendChild(s('text', { x: M.l - 8, y: y(t) + 4, 'text-anchor': 'end', text: yFormat(t) }));
  }
  svg.insertBefore(grid, svg.firstChild);
  svg.appendChild(s('g', { class: 'axis' }, s('line', { x1: M.l, x2: W - M.r, y1: y(0), y2: y(0) })));

  // etichette asse x: una ogni k per non sovrapporle
  const maxLab = Math.max(...labels.map(l => l.length)) * MONO_CHAR + 10;
  const every = Math.max(1, Math.ceil(maxLab / band));
  labels.forEach((l, i) => {
    if (i % every !== 0) return;
    svg.appendChild(s('text', { x: M.l + band * (i + 0.5), y: height - 8, 'text-anchor': 'middle', text: l }));
  });

  labels.forEach((l, i) => {
    const cx = M.l + band * (i + 0.5), x0 = cx - bw / 2;
    const g = s('g', { class: 'col', tabindex: 0, role: 'img', 'aria-label': `${l}: ${yFormat(sums[i])}` });
    g.appendChild(s('rect', { class: 'hit', x: M.l + band * i, y: M.t, width: band, height: ph }));
    let base = 0;
    const segs = series.map(sr => ({ cls: sr.cls, v: Math.max(0, sr.values[i] || 0) })).filter(sg => sg.v > 0);
    segs.forEach((sg, k) => {
      const yTop = y(base + sg.v), yBot = y(base) - (k > 0 ? 2 : 0);    // 2px di stacco tra i segmenti
      const hh = yBot - yTop;
      if (hh > 0.5) {
        if (k === segs.length - 1) g.appendChild(s('path', { class: sg.cls, d: topRounded(x0, yTop, bw, hh, 4) }));
        else g.appendChild(s('rect', { class: sg.cls, x: x0, y: yTop, width: bw, height: hh }));
      }
      base += sg.v;
    });
    if (target && target[i] > 0) {
      g.appendChild(s('line', { class: 'target', x1: cx - bw / 2 - 5, x2: cx + bw / 2 + 5, y1: y(target[i]), y2: y(target[i]) }));
    }
    const show = (px, py) => tooltip && showTooltip(container, tooltip(i), px, py);
    g.addEventListener('pointermove', e => { const r = container.getBoundingClientRect(); show(e.clientX - r.left, e.clientY - r.top); });
    g.addEventListener('pointerleave', () => hideTooltip(container));
    g.addEventListener('focus', () => { g.classList.add('focus'); show(cx, y(Math.max(sums[i], (target && target[i]) || 0))); });
    g.addEventListener('blur', () => { g.classList.remove('focus'); hideTooltip(container); });
    if (onClick) {
      g.addEventListener('click', () => onClick(i));
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(i); } });
    }
    svg.appendChild(g);
  });

  if (average != null && average > 0) {
    svg.appendChild(s('line', { class: 'avg', x1: M.l, x2: W - M.r, y1: y(average), y2: y(average) }));
    svg.appendChild(s('text', { class: 'avg-label', x: W - M.r, y: y(average) - 6, 'text-anchor': 'end', text: cfg.averageLabel || 'media' }));
  }
  container.querySelector(':scope > svg')?.remove();
  container.insertBefore(svg, container.firstChild);
}

/* -------------------------------------------------------------------------- */
/* Mappa dei rendimenti: scadenza × rendimento netto (enfasi sui titoli scelti) */
/* -------------------------------------------------------------------------- */
export function yieldMap(container, cfg) { mountFrame(container, cfg, renderMap); }

function renderMap(container, cfg) {
  const { points, bands = [], height = 280, tooltip, onPick, ariaLabel } = cfg;
  const W = Math.max(280, container.clientWidth || 600);
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, height, role: 'img', 'aria-label': ariaLabel || '' });
  if (!points.length) { container.querySelector(':scope > svg')?.remove(); container.insertBefore(svg, container.firstChild); return; }
  const xs = points.map(p => p.maturity).concat(bands.flatMap(b => [b.from, b.to]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ys = points.map(p => p.y);
  const yt = niceTicks(Math.min(...ys) - 0.1, Math.max(...ys) + 0.1, 4);
  const yLo = yt[0], yHi = yt[yt.length - 1];
  const fmtY = v => `${v.toFixed(1).replace('.', ',')}%`;
  const M = { l: 12 + Math.max(...yt.map(t => fmtY(t).length)) * MONO_CHAR, r: 10, t: 12, b: 26 };
  const pw = W - M.l - M.r, ph = height - M.t - M.b;
  const X = d => M.l + (d - x0) / Math.max(1, x1 - x0) * pw;
  const Y = v => M.t + ph - (v - yLo) / (yHi - yLo) * ph;

  const grid = s('g', { class: 'grid' });
  for (const t of yt) {
    grid.appendChild(s('line', { x1: M.l, x2: W - M.r, y1: Y(t), y2: Y(t) }));
    svg.appendChild(s('text', { x: M.l - 8, y: Y(t) + 4, 'text-anchor': 'end', text: fmtY(t) }));
  }
  svg.insertBefore(grid, svg.firstChild);
  bands.forEach((b, i) => svg.appendChild(s('rect', { class: 'band' + (i % 2 ? ' alt' : '') + (b.hl ? ' hl' : ''), x: X(b.from), y: M.t, width: Math.max(1, X(b.to) - X(b.from)), height: ph })));

  // anni sull'asse x
  const y0 = parts(x0).y, y1 = parts(x1).y;
  const yearsN = y1 - y0 + 1, every = Math.max(1, Math.ceil((5 * MONO_CHAR + 12) / (pw / Math.max(1, yearsN))));
  for (let yy = y0; yy <= y1 + 1; yy++) {
    const d = Date.UTC(yy, 0, 1) / 86400000;
    if (d < x0 || d > x1) continue;
    svg.appendChild(s('g', { class: 'axis' }, s('line', { x1: X(d), x2: X(d), y1: M.t + ph, y2: M.t + ph + 4 })));
    if ((yy - y0) % every === 0) svg.appendChild(s('text', { x: X(d) + 3, y: height - 8, text: String(yy) }));
  }
  svg.appendChild(s('g', { class: 'axis' }, s('line', { x1: M.l, x2: W - M.r, y1: M.t + ph, y2: M.t + ph })));

  const back = points.filter(p => !p.sel), front = points.filter(p => p.sel);
  for (const p of back) svg.appendChild(s('circle', { class: 'deemph', cx: X(p.maturity), cy: Y(p.y), r: 3 }));
  for (const p of front) svg.appendChild(s('circle', { class: 's1 dot sel', cx: X(p.maturity), cy: Y(p.y), r: 5.5 }));
  const hl = s('circle', { r: 8, fill: 'none', stroke: 'var(--text)', 'stroke-width': 1.5, visibility: 'hidden' });
  svg.appendChild(hl);

  const nearest = (mx, my) => {
    let best = null, bd = 24 * 24;
    for (const p of points) {
      const dx = X(p.maturity) - mx, dy = Y(p.y) - my, d = dx * dx + dy * dy;
      if (d < bd || (d === bd && p.sel)) { bd = d; best = p; }
    }
    return best;
  };
  const toLocal = e => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (height / r.height), e.clientX - container.getBoundingClientRect().left, e.clientY - container.getBoundingClientRect().top]; };
  svg.addEventListener('pointermove', e => {
    const [mx, my, px, py] = toLocal(e), p = nearest(mx, my);
    if (!p) { hl.setAttribute('visibility', 'hidden'); hideTooltip(container); svg.style.cursor = ''; return; }
    hl.setAttribute('cx', X(p.maturity)); hl.setAttribute('cy', Y(p.y)); hl.setAttribute('visibility', 'visible');
    svg.style.cursor = onPick && p.pickable ? 'pointer' : '';
    if (tooltip) showTooltip(container, tooltip(p), px, py);
  });
  svg.addEventListener('pointerleave', () => { hl.setAttribute('visibility', 'hidden'); hideTooltip(container); });
  if (onPick) svg.addEventListener('click', e => { const [mx, my] = toLocal(e); const p = nearest(mx, my); if (p) onPick(p); });
  container.querySelector(':scope > svg')?.remove();
  container.insertBefore(svg, container.firstChild);
}

/** Legenda HTML (sempre presente con due o più serie). */
export function legend(items) {
  return h('div', { class: 'chart-legend' }, items.map(it => h('span', { class: 'k' },
    it.type === 'line' ? h('span', { class: 'ln' }) : it.type === 'dot' ? h('span', { class: 'dt', style: { background: `var(--${it.key})` } })
      : h('span', { class: 'sw', style: { background: `var(--${it.key})` } }),
    h('span', { text: it.label }))));
}
