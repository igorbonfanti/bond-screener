/* Risultati nel sistema «Terminale ambra»: prima il riepilogo (fila di KPI e una frase), poi il
   dettaglio in pannelli (grafico, tabella principale, mappa, calendario, lista d'acquisto) e,
   accanto al grafico, ciò che richiede attenzione con il motivo. Nessun calcolo qui: solo lettura
   della proposta prodotta dal motore. */
import { h, fmtEur, fmtPct, fmtNum, fmtSigned, copyText, toast, downloadFile, badge, MINUS } from './dom.js';
import { columnChart, yieldMap, legend } from './charts.js';
import { fmt, fmtMonthYear, parts, MONTHS, MONTHS_LONG } from '../core/dates.js';

let A = {};   // azioni fornite da main.js

export function renderResults(root, { st, result, actions }) {
  A = actions || {};
  const plan = result && result.plan;
  if (!plan) { root.replaceChildren(); return; }
  if (plan.mode === 'capital') root.replaceChildren(...(plan.holdings ? portfolioCapitalView(st, result, plan) : capitalView(st, result, plan)));
  else root.replaceChildren(...(plan.holdings ? portfolioIncomeView(st, result, plan) : incomeView(st, result, plan)));
}

/* ------------------------------ comuni ------------------------------ */
const kpi = (k, v, sub, small) => h('div', { class: 'kpi' }, h('span', { class: 'k', text: k }),
  h('span', { class: 'v num' }, v, small ? [' ', h('small', { text: small })] : null), sub ? h('span', { class: 's', text: sub }) : null);

/** Osservazione: tipo → badge di stato (forma + parola) e motivo accanto. */
const KIND = { good: ['trig', 'OK'], warn: ['watch', 'Attenzione'], info: ['normal', 'Nota'], bad: ['fail', 'Problema'] };
const insight = (kind, text) => ({ kind, text });
function notesPanel(items) {
  return panel('Da sapere', `${items.length} ${items.length === 1 ? 'nota' : 'note'}`,
    h('div', { class: 'pb' }, h('div', { class: 'states' }, items.map(it => h('div', { class: 'srow' }, badge(...KIND[it.kind]), h('span', { text: it.text }))))));
}

function panel(title, meta, ...body) {
  return h('section', { class: 'panel' },
    h('div', { class: 'ph' }, h('h2', { text: title }), meta == null ? null : typeof meta === 'string' ? h('span', { class: 'meta', text: meta }) : meta),
    ...body);
}

const miniBtn = (text, onClick, attrs = {}) => h('button', { type: 'button', class: 'mini', ...attrs, on: { click: onClick } }, text);
const liqDots = n => '●'.repeat(Math.max(0, Math.min(4, n))) + '○'.repeat(4 - Math.max(0, Math.min(4, n)));
const monthsText = b => b.months && b.months.length ? b.months.map(m => MONTHS[m - 1]).join(' · ') : 'zero coupon';
const csvNum = (n, dec) => fmtNum(n, dec).replace(MINUS, '-');   // nel CSV il meno ASCII: i fogli di calcolo lo leggono come numero
const eur0 = v => fmtNum(v, 0);

function bondTags(b, extra = []) {
  const t = [];
  if (b.price > 100) t.push(h('span', { class: 'tag', text: 'sopra la pari' }));
  if (b.stepUp) t.push(h('span', { class: 'tag', text: 'step-up' }));
  if (b.inflation) t.push(h('span', { class: 'tag', text: 'indicizzato' }));
  if (b.zc) t.push(h('span', { class: 'tag', text: 'zero coupon' }));
  if (b.priceType === 'RP') t.push(h('span', { class: 'tag', title: 'Nessuno scambio oggi: prezzo di riferimento', text: 'prezzo di rif.' }));
  const all = t.concat(extra);
  return all.length ? h('span', { class: 'tags' }, all) : null;
}

/** Titolo in una cella: nome, ISIN (si copia con un clic) ed etichette. */
function bondCell(b, extra) {
  return h('span', { class: 'ttl' },
    h('b', { text: b.desc }),
    h('span', { class: 'tags' }, h('span', { class: 'code', role: 'button', tabindex: -1, title: 'Copia ISIN', text: b.isin,
      on: { click: async e => { e.stopPropagation(); toast(await copyText(b.isin) ? `ISIN ${b.isin} copiato` : b.isin, 'ok'); } } }),
      [...((bondTags(b, extra) || {}).childNodes || [])]));
}

/** Tabella del sistema: intestazioni ordinabili (▲ ▼, aria-sort), numeri a destra, riga dei totali in fondo. */
export function dataTable({ cols, rows, sortBy = null, dir = 1, rowAttrs = () => ({}), foot = null, label, cls = '' }) {
  let key = sortBy, d = dir;
  const tbody = h('tbody');
  const cmp = (a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), 'it');
  const ths = cols.map((c, i) => {
    const th = h('th', { class: c.r ? 'r' : null, scope: 'col' });
    if (c.sort) {
      const btn = h('button', { type: 'button' });
      btn.addEventListener('click', () => { if (key === i) d = -d; else { key = i; d = c.dir || 1; } paint(); });
      th.appendChild(btn); th._btn = btn;
    } else th.textContent = c.label;
    return th;
  });
  function paint() {
    ths.forEach((th, i) => {
      const c = cols[i];
      if (!c.sort) return;
      const on = key === i;
      th._btn.textContent = c.label + (on ? (d > 0 ? ' ▲' : ' ▼') : '');
      if (on) th.setAttribute('aria-sort', d > 0 ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort');
    });
    const list = key != null && cols[key].sort ? rows.slice().sort((a, b) => cmp(cols[key].sort(a), cols[key].sort(b)) * d) : rows;
    tbody.replaceChildren(...list.map(x => h('tr', rowAttrs(x), cols.map(c => h('td', { class: c.cls || (c.r ? 'num r' : null) }, c.cell(x))))));
  }
  paint();
  return h('div', { class: 'tscroll' }, h('table', { class: cls ? 't ' + cls : 't', 'aria-label': label },
    h('thead', null, h('tr', null, ths)), tbody, foot ? h('tfoot', null, foot) : null));
}

/** Riga cliccabile (Invio o clic), senza scattare quando si preme un pulsante al suo interno. */
function clickable(fn, label) {
  const go = e => { if (e.target.closest('button, a, input, [role="button"]')) return; fn(); };
  return { tabindex: 0, 'aria-label': label, on: { click: go, keydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); fn(); } } } };
}

function yieldMapPanel(result, sel, bands, onPick, pickable) {
  const pts = (result.map || []).map(p => ({ ...p, sel: sel.has(p.isin), pickable: pickable ? pickable(p) : false }));
  const box = h('div');
  requestAnimationFrame(() => yieldMap(box, {
    points: pts, bands, height: 280, ariaLabel: 'Rendimento netto per scadenza dei titoli del paniere', yFormat: v => fmtPct(v, 1),
    tooltip: p => ({ title: p.desc, rows: [{ label: 'Rendimento netto', value: fmtPct(p.y) }, { label: 'Scadenza', value: fmt(p.maturity) }, { label: 'Prezzo', value: fmtNum(p.price, 2) }, { label: 'Rating', value: p.rating || 'NR' }],
      note: p.sel ? 'già nella proposta' : p.pickable ? 'clic per usarlo nella proposta' : null }),
    onPick
  }));
  return panel('Mappa dei rendimenti', `${pts.length} titoli · rendimento netto per scadenza`,
    box,
    legend([{ key: 'amber', label: 'titoli della proposta' }, { key: 'chart-trail', label: 'altri titoli del paniere' },
      bands.length ? { el: h('span', { class: 'kb', style: { background: 'var(--band)', opacity: 0.12 } }), label: 'finestre delle scadenze' } : null,
      { type: 'text', label: bands.length ? 'un punto dentro una fascia è un\'alternativa per quella scadenza: clic per usarlo' : 'più in alto rende di più, più a destra scade più tardi' }].filter(Boolean)));
}

export function calendarPanel(schedule, meta = 'euro netti, mese per mese') {
  const byYear = new Map();
  for (const f of schedule) {
    const { y, m } = parts(f.day);
    if (!byYear.has(y)) byYear.set(y, { months: new Array(12).fill(0), redeem: new Array(12).fill(false), total: 0 });
    const r = byYear.get(y); r.months[m - 1] += f.net; r.total += f.net; if (f.kind === 'redemption') r.redeem[m - 1] = true;
  }
  const all = [...byYear.values()].flatMap(r => r.months).filter(v => v > 0).sort((a, b) => a - b);
  const q = p => all.length ? all[Math.min(all.length - 1, Math.floor(p * all.length))] : 0;
  const cuts = [q(0.2), q(0.4), q(0.6), q(0.8)];
  const lvl = v => v <= 0 ? 0 : 1 + cuts.filter(c => v > c).length;
  const rows = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([y, r]) => h('tr', null,
    h('td', null, h('span', { class: 'sym', text: String(y) })),
    r.months.map((v, i) => h('td', { class: `cell num h${lvl(v)}${r.redeem[i] ? ' redeem' : ''}`, title: v > 0 ? `${MONTHS_LONG[i]} ${y}: ${fmtEur(v)}${r.redeem[i] ? ' (con rimborso)' : ''}` : '', text: v > 0 ? eur0(v) : '·' })),
    h('td', { class: 'num r', text: eur0(r.total) })));
  const table = h('div', { class: 'tscroll' }, h('table', { class: 't heat', 'aria-label': 'Incassi netti per mese e anno, in euro' },
    h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Anno' }), MONTHS.map(m => h('th', { class: 'r', scope: 'col', text: m })), h('th', { class: 'r', scope: 'col', text: 'Totale' }))),
    h('tbody', null, rows)));
  return panel('Calendario degli incassi', meta, table,
    legend([{ el: h('span', { class: 'ramp' }, [1, 2, 3, 4, 5].map(i => h('i', { class: `h${i}` }))), label: 'incasso del mese, da poco a molto' },
      { el: h('span', { class: 'kb frame' }), label: 'mese con un rimborso' }]));
}

function purchasePanel(positions, settle, title = 'Lista d\'acquisto') {
  const rows = positions.slice();
  const tot = rows.reduce((s, p) => s + p.cost, 0), totN = rows.reduce((s, p) => s + p.nominal, 0);
  const csv = () => {
    const head = ['ISIN', 'Titolo', 'Scadenza', 'Nominale', 'Prezzo', 'Rateo lordo', 'Controvalore stimato', 'Rendimento netto %'];
    const lines = rows.slice().sort((a, b) => a.bond.maturity - b.bond.maturity).map(p => [p.bond.isin, p.bond.desc, fmt(p.bond.maturity), csvNum(p.nominal, 0), csvNum(p.bond.price, 3),
      csvNum(p.bond.cost - p.bond.price, 4), csvNum(p.cost, 2), csvNum(p.bond.ytmNet, 2)]);
    return '﻿' + [head, ...lines].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  };
  const table = dataTable({
    label: 'Lista d\'acquisto', sortBy: 1,
    cols: [
      { label: 'Titolo', sort: p => p.bond.desc, cell: p => [h('span', { class: 'sym', text: p.bond.isin }), h('span', { class: 'nm', text: p.bond.desc }),
        p.topUp ? h('span', { class: 'tags' }, h('span', { class: 'tag', title: 'Titolo che hai già: ne compri altri pezzi', text: 'ne hai già' })) : null] },
      { label: 'Scadenza', sort: p => p.bond.maturity, cell: p => h('span', { class: 'num', text: fmt(p.bond.maturity) }) },
      { label: 'Nominale', r: 1, sort: p => p.nominal, cell: p => eur0(p.nominal) },
      { label: 'Prezzo', r: 1, sort: p => p.bond.price, cell: p => fmtNum(p.bond.price, 2) },
      { label: 'Controvalore', r: 1, sort: p => p.cost, cell: p => eur0(p.cost) }],
    rows,
    foot: h('tr', { class: 'bench' }, h('td', null, h('b', { text: 'Totale' })), h('td'), h('td', { class: 'num r', text: eur0(totN) }), h('td'), h('td', { class: 'num r', text: eur0(tot) }))
  });
  return panel(title, h('span', { class: 'ph-end' }, h('span', { class: 'meta', text: `valuta ${fmt(settle)} · euro · prezzi del file, commissioni escluse` }),
    h('span', { class: 'actions' },
      miniBtn('Copia ISIN e nominali', async () => toast(await copyText(rows.map(p => `${p.bond.isin}\t${p.nominal}`).join('\n')) ? 'Elenco ISIN e nominali copiato' : 'Copia non riuscita', 'ok')),
      miniBtn('Scarica CSV', () => downloadFile(`lista-acquisto-${new Date().toISOString().slice(0, 10)}.csv`, csv())),
      miniBtn('Stampa', () => window.print()))), table);
}

function actionsBar() {
  return h('div', { class: 'actions' },
    miniBtn('Salva la scala', () => A.onSave && A.onSave()),
    miniBtn('Condividi il link', () => A.onShare && A.onShare()),
    miniBtn('Stampa', () => window.print()));
}

function commonInsights(plan, result) {
  const out = [];
  const s = plan.summary, ptf = !!plan.holdings;
  if (plan.positions.length) {
    if (s.belowParShare >= 0.999) out.push(insight('good', `Tutti i titoli ${ptf ? 'da comprare ' : ''}sono sotto la pari: a scadenza solo plusvalenze (${fmtEur(s.gainAtMaturity)}, tassate all'aliquota del titolo).`));
    else if (s.lossAtMaturity > 0) out.push(insight('warn', `Minusvalenza a scadenza di ${fmtEur(s.lossAtMaturity)} sui titoli ${ptf ? 'da comprare ' : ''}sopra la pari: finisce nello zainetto fiscale e non si compensa con le cedole.`));
    // con il portafoglio conta il peso sul totale (titoli posseduti + nuovi), al nominale
    let top = s.byIssuer[0];
    if (ptf) {
      const m = new Map();
      for (const x of plan.holdings.concat(plan.positions)) { const e = m.get(x.bond.issuer) || { name: x.bond.issuerName, n: 0 }; e.n += x.nominal; m.set(x.bond.issuer, e); }
      const tot = [...m.values()].reduce((a, e) => a + e.n, 0);
      const e = [...m.values()].sort((a, b) => b.n - a.n)[0];
      top = e && tot > 0 && !(plan.issuerOver || []).length ? { name: e.name, share: e.n / tot } : null;
    }
    if (top && top.share > 0.5) out.push(insight('info', `${top.name} pesa il ${fmtNum(top.share * 100, 0)}% ${ptf ? 'del portafoglio complessivo (tuoi titoli e nuovi)' : 'del capitale'}: valuta un limite per emittente più stretto.`));
  }
  if (plan.positions.some(p => p.bond.stepUp)) out.push(insight('info', 'Alcuni titoli hanno cedola crescente (step-up): le cedole future saranno più alte di quelle stimate qui.'));
  for (const w of plan.warnings || []) out.push(insight('warn', w));
  if (result.basketCount < 10) out.push(insight('warn', `Solo ${result.basketCount} titoli rispettano i filtri: allarga il paniere per avere più scelta.`));
  return out;
}

/* ------------------------- Capitale a scadenza ------------------------- */
function capitalView(st, result, plan) {
  const c = st.capital;
  if (!plan.targets.length) return [notesPanel([insight('warn', 'Nessuna scadenza futura nel periodo scelto: sposta gli anni in avanti.')])];
  // Coperta: c'è un titolo da comprare, oppure bastano le cedole del periodo
  const covered = plan.targets.filter(t => (t.bond && t.nominal > 0) || t.available + 0.5 >= t.amount).length, T = plan.targets.length;
  const received = plan.schedule.reduce((s, f) => s + f.net, 0);
  const atTargets = plan.targets.reduce((s, t) => s + t.available, 0);
  const extra = Math.max(0, received - atTargets);                 // cedole che non servono agli importi
  const pre = plan.preCoupons || 0, gap = plan.gapCoupons || 0;
  const extraWhat = plan.accumulate ? 'di cedole accantonate che avanzano'
    : !plan.useCoupons || (pre <= 0.5 && gap <= 0.5) ? 'di cedole'
      : pre > 0.5 && gap > 0.5 ? 'di cedole incassate prima della scala e fra una data e l\'altra'
        : gap > 0.5 ? 'di cedole incassate fra una data e l\'altra' : 'di cedole incassate prima della scala';
  const potUsed = plan.accumulate ? plan.targets.reduce((s, t) => s + (t.fromPot || 0), 0) : 0;
  const extraLine = [potUsed > 0.5 ? [', di cui ', h('b', { text: fmtEur(potUsed) }), ' dalle cedole accantonate'] : [],
    extra > 0.5 ? [potUsed > 0.5 ? '; più ' : ', più ', h('b', { text: fmtEur(extra) }), ` ${extraWhat}`] : []];
  const first = plan.targets[0].label, last = plan.targets[T - 1].label;
  const budgetMode = plan.budget != null;
  const perRung = T ? atTargets / T : 0;
  const totalAmount = plan.targets.reduce((s, t) => s + t.amount, 0);
  const span = first === last ? first : `${first} → ${last}`;

  const kpis = h('div', { class: 'kpis' },
    budgetMode
      ? kpi(`Somma per ${c.schedule === 'semester' ? 'semestre' : 'anno'}`, fmtEur(perRung), `circa · ${T} somme ${span}`)
      : kpi('Da investire oggi', fmtEur(plan.totalCost), `per ${fmtEur(totalAmount)} in ${T} ${T === 1 ? 'scadenza' : 'scadenze'}`),
    budgetMode
      ? kpi('Da investire', fmtEur(plan.totalCost), `su ${fmtEur(plan.budget)} di capitale`)
      : kpi('Ricevi alle scadenze', fmtEur(atTargets), span),
    kpi('Rendimento netto', fmtPct(plan.irr * 100), 'annuo, dai flussi netti'),
    kpi('Guadagno netto', fmtSigned(received - plan.totalCost), 'incassi − investimento'),
    kpi('Scadenze coperte', String(covered), covered === T ? 'tutte' : `${T - covered} senza titolo`, `/ ${T}`),
    kpi('Duration media', fmtNum(plan.summary.duration, 1), `anni · ${plan.positions.length} titoli, ${plan.summary.byIssuer.length} emittenti`));
  const lead = h('p', { class: 'lead' }, budgetMode
    ? ['Investendo ', h('b', { text: fmtEur(plan.totalCost) }), ` ricevi ${T} somme dal ${first} al ${last}, per un totale di `, h('b', { text: fmtEur(atTargets) }), ' netti', extraLine, '.']
    : ['Per avere ', h('b', { text: fmtEur(totalAmount) }), ` in ${T} ${T === 1 ? 'scadenza' : 'scadenze'} (${span}) ricevi `, h('b', { text: fmtEur(atTargets) }), ' netti alle scadenze', extraLine, '.']);

  const ins = [];
  if (covered === T) ins.push(insight('good', `Tutte le ${T} scadenze sono coperte.`));
  if (plan.useCoupons) {
    const cp = plan.targets.reduce((s, t) => s + t.coupons, 0), tot = atTargets;
    const pct = v => fmtNum(v / tot * 100, 0) + '%';
    if (tot > 0) ins.push(insight('info', `Le cedole coprono il ${pct(cp + potUsed)} degli importi${potUsed > 0.5 ? ` (${pct(cp)} quelle del periodo, ${pct(potUsed)} quelle accantonate)` : ''}: per questo serve meno capitale dei ${fmtEur(totalAmount)} da ricevere.`));
    if (pre > 0.5 || gap > 0.5) {
      const where = [pre > 0.5 ? `prima della scala (${fmtEur(pre)} fino al ${fmt(plan.preUntil)})` : '', gap > 0.5 ? `fra una data e l'altra (${fmtEur(gap)})` : ''].filter(Boolean).join(' e ');
      if (plan.accumulate) {
        const used = plan.targets.filter(t => t.fromPot > Math.max(0.5, 0.02 * t.amount));   // i ritocchi da arrotondamento non contano
        const names = used.map(t => t.label + (t.nominal > 0 ? ' (in parte)' : ''));
        const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' e ' + names[names.length - 1] : names[0] || '';
        ins.push(insight('info', `Accantoni le cedole incassate ${where}: ${used.length ? `pagano ${used.length === 1 ? 'la scadenza' : 'le scadenze'} ${list}` : 'non servono a nessuna scadenza'}${plan.potLeft > 0.5 ? `, e ne avanzano ${fmtEur(plan.potLeft)}` : ''}. Restano ferme fino ad allora, senza interessi.`));
      } else {
        ins.push(insight('info', `Per ogni scadenza contano solo le cedole del suo periodo. Quelle incassate ${where} resterebbero ferme per anni: non le conto negli importi, sono un'entrata in più da spendere o reinvestire. Se vuoi usarle per le prime scadenze, attiva «Accantona le cedole di prima».`));
      }
    }
  }
  const surplus = plan.targets.filter(t => t.bond).reduce((s, t) => s + Math.max(0, t.surplus), 0);
  if (!budgetMode && surplus > 0.03 * totalAmount) ins.push(insight('info', `Arrotondando ai lotti minimi ricevi ${fmtEur(surplus)} in più del necessario in totale.`));
  ins.push(...commonInsights(plan, result));

  // Grafico della scala: grigi per le fonti, blu per l'obiettivo
  const chartBox = h('div');
  const pooledUsed = plan.accumulate && plan.targets.some(t => t.fromPot > 0.5);
  const labels = plan.targets.map(t => t.label.length > 12 ? t.label.slice(0, 11) + '…' : t.label);
  requestAnimationFrame(() => columnChart(chartBox, {
    labels, height: 250, yFormat: v => fmtNum(v, 0),
    series: [{ cls: 's1', values: plan.targets.map(t => t.redemption) }, { cls: 's2', values: plan.targets.map(t => plan.useCoupons ? t.coupons : 0) },
      ...(pooledUsed ? [{ cls: 's3', values: plan.targets.map(t => t.fromPot) }] : [])],
    target: plan.targets.map(t => t.amount), ariaLabel: 'Importo disponibile per ogni scadenza, con l\'obiettivo',
    tooltip: i => { const t = plan.targets[i]; return { title: t.label, meta: t.bond ? t.bond.desc : 'nessun titolo', rows: [
      { key: 'ink', label: 'Rimborso', value: fmtEur(t.redemption) }, { key: 'chart-trail', label: 'Cedole', value: fmtEur(plan.useCoupons ? t.coupons : 0) },
      ...(pooledUsed ? [{ key: 'chart-line', label: 'Accantonate', value: fmtEur(t.fromPot) }] : []),
      { label: 'Disponibile', value: fmtEur(t.available) }, { key: 'blue', label: 'Obiettivo', value: fmtEur(t.amount) }] }; },
    onClick: i => { const el = document.getElementById('rung-' + i); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); } }
  }));
  const ladder = panel('La tua scala', 'quanto ricevi a ogni scadenza · euro netti', chartBox,
    legend([{ key: 'ink', label: 'rimborso del titolo' }, { key: 'chart-trail', label: plan.useCoupons ? 'cedole del periodo' : 'cedole (non usate)' },
      ...(pooledUsed ? [{ key: 'chart-line', label: 'cedole accantonate' }] : []), { type: 'line', key: 'blue', label: 'obiettivo' },
      { type: 'text', label: 'clic su una colonna per andare alla riga' }]));

  const sel = new Set(plan.positions.map(p => p.bond.isin));
  const bands = plan.targets.map(t => ({ from: t.start, to: t.end, label: t.label }));
  const bandOf = p => plan.targets.findIndex(t => p.maturity > t.start && p.maturity <= t.end);
  const map = yieldMapPanel(result, sel, bands, p => { const i = bandOf(p); if (i >= 0 && !sel.has(p.isin) && A.onSwap) A.onSwap(plan.targets[i].label, p.isin); }, p => bandOf(p) >= 0 && !sel.has(p.isin));

  return [kpis, lead, actionsBar(),
    h('div', { class: 'grid-2' }, ladder, notesPanel(ins)),
    rungsPanel(plan),
    map,
    plan.schedule.length ? calendarPanel(plan.schedule) : null,
    plan.positions.length ? purchasePanel(plan.positions, plan.settle) : null].filter(Boolean);
}

/* ------------- Capitale a scadenza attorno al portafoglio posseduto ------------- */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const listText = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1] : a[0] || '';

function portfolioCapitalView(st, result, plan) {
  const c = st.capital;
  if (!plan.targets.length) return [notesPanel([insight('warn', 'Nessuna scadenza futura nel periodo scelto: sposta gli anni in avanti.')])];
  const T = plan.targets.length, first = plan.targets[0].label, last = plan.targets[T - 1].label;
  const span = first === last ? first : `${first} → ${last}`;
  const covered = plan.targets.filter(t => t.available + 0.5 >= t.amount).length;
  const atTargets = plan.targets.reduce((s, t) => s + Math.min(t.available, t.amount), 0);
  const totalAmount = plan.targets.reduce((s, t) => s + t.amount, 0);
  const budgetMode = plan.budget != null;
  const perRung = T ? totalAmount / T : 0;
  const nHeld = plan.holdings.length;
  const buys = plan.positions.length
    ? [plural(plan.newLines, 'titolo nuovo', 'titoli nuovi'), plan.topUps ? plural(plan.topUps, 'rabbocco', 'rabbocchi') : ''].filter(Boolean).join(' + ')
    : 'niente da comprare';
  const kpis = h('div', { class: 'kpis' },
    budgetMode
      ? kpi(`Somma per ${c.schedule === 'semester' ? 'semestre' : 'anno'}`, fmtEur(perRung), `circa · ${T} somme ${span}`)
      : kpi('Nuovi acquisti', fmtEur(plan.totalCost), buys),
    budgetMode
      ? kpi('Nuovi acquisti', fmtEur(plan.totalCost), `su ${fmtEur(plan.budget)} · ${buys}`)
      : kpi('Ricevi alle scadenze', fmtEur(atTargets), span),
    kpi('Dai tuoi titoli', fmtPct(plan.heldCover * 100, 0), `degli importi · ${plural(nHeld, 'titolo', 'titoli')}`),
    kpi('Rendimento netto', fmtPct(plan.irrAll * 100), plan.positions.length ? `tutta la scala · nuovi ${fmtPct(plan.irr * 100)}` : 'tutta la scala, dai prezzi di oggi'),
    kpi('Scadenze coperte', String(covered), covered === T ? 'tutte' : `${T - covered} sotto l'obiettivo`, `/ ${T}`),
    kpi('Senza acquisti', String(plan.coveredByHeld), 'scadenze pagate dai tuoi titoli', `/ ${T}`));

  const b = t => h('b', { text: t });
  const lead = h('p', { class: 'lead' }, budgetMode
    ? ['Con i tuoi ', b(plural(nHeld, 'titolo', 'titoli')), plan.totalCost > 0.5 ? [' e ', b(fmtEur(plan.totalCost)), ' di nuovi acquisti'] : ', senza comprare nulla,',
      ` ricevi ${T} somme da circa `, b(fmtEur(perRung)), ` netti (${span}). Non vendi nulla.`]
    : ['Con i tuoi ', b(plural(nHeld, 'titolo', 'titoli')), plan.totalCost > 0.5 ? [' e ', b(fmtEur(plan.totalCost)), ' di nuovi acquisti'] : ', senza comprare nulla,',
      ' ricevi ', b(fmtEur(atTargets)), ` netti in ${plural(T, 'scadenza', 'scadenze')} (${span}). Non vendi nulla.`]);

  const ins = [];
  if (covered === T) ins.push(insight('good', `Tutte le ${T} scadenze sono coperte.`));
  const own = plan.targets.filter(t => t.coveredByHeld).map(t => t.label);
  if (own.length) ins.push(insight('good', `${own.length === 1 ? 'La scadenza' : 'Le scadenze'} ${listText(own)} ${own.length === 1 ? 'è pagata' : 'sono pagate'} dai tuoi titoli: lì non compri nulla.`));
  if (plan.topUps) ins.push(insight('info', `Per ${plan.topUps === 1 ? 'una scadenza' : `${plan.topUps} scadenze`} compri altri pezzi di titoli che hai già: meno linee da seguire.`));
  for (const e of plan.issuerOver || []) ins.push(insight('warn', `${e.name} pesa già il ${fmtNum(e.heldShare * 100, 0)}% del portafoglio complessivo, oltre il limite per emittente del ${fmtNum(plan.issuerCap * 100, 0)}%: non compro altri suoi titoli. Il limite si cambia nel paniere.`));
  if (plan.heldBefore > 0.5) ins.push(insight('info', `${fmtEur(plan.heldBefore)} dai tuoi titoli arrivano prima della scala: restano in cassa e pagano le prime scadenze.`));
  const y = Number.isFinite(plan.irrAll) && plan.irrAll > 0 ? plan.irrAll : 0.03;
  const alt = plan.alt, per = c.schedule === 'semester' ? 'semestre' : 'anno';
  const altText = !alt ? '' : budgetMode ? `circa ${fmtEur(alt.perTarget)} per ${per}` : `${fmtEur(alt.totalCost)} di acquisti oggi`;
  if (plan.carry && plan.idleEuroYears > 50) {
    ins.push(insight('info', [`Eccedenze e rimborsi in anticipo restano in cassa, senza interessi, fino alla scadenza che li usa: è come tenere fermi ${fmtEur(plan.idleEuroYears)} per un anno, circa ${fmtEur(plan.idleEuroYears * y)} di interessi persi al ${fmtPct(y * 100)}.`,
      alt ? ` Se preferisci riaverle e reinvestirle tu, con le stesse scadenze ti servono ${altText}: spegni «Usa le eccedenze per le scadenze dopo».` : ' Quando arrivano puoi parcheggiarli in un titolo breve.'].join('')));
  }
  if (!plan.carry) {
    const back = plan.heldSurplus + plan.heldOutRedemptions;
    if (back > 0.5) ins.push(insight('info', `${fmtEur(back)} dai tuoi titoli (eccedenze delle scadenze coperte e rimborsi fuori dalla scala) tornano a te, da spendere o reinvestire.${alt ? ` Usandoli per le scadenze dopo ti basterebbero ${altText}, ma resterebbero fermi senza interessi.` : ''}`));
  }
  if (plan.heldOutCoupons > 0.5) ins.push(insight('info', `Le cedole dei tuoi titoli incassate prima della scala${c.schedule === 'dates' ? ' o fra una data e l\'altra' : ''} (${fmtEur(plan.heldOutCoupons)}) sono un'entrata in più.${plan.useCoupons ? ' Con «Accantona le cedole di prima» pagano le prime scadenze.' : ''}`));
  if (plan.heldAfter > 0.5) ins.push(insight('info', `${fmtEur(plan.heldAfter)} dai tuoi titoli (rimborsi e cedole) arrivano dopo l'ultima scadenza: restano a te, fuori dalla scala.`));
  if (plan.potLeft > 0.5) ins.push(insight('info', `Alla fine della scala avanzano ${fmtEur(plan.potLeft)} in cassa: eccedenze dei tuoi titoli e arrotondamenti ai lotti.`));
  const info = result.portfolio || {};
  if (info.missing && info.missing.length) ins.push(insight('warn', `${plural(info.missing.length, 'titolo del portafoglio non è', 'titoli del portafoglio non sono')} nei dati di oggi e ${info.missing.length === 1 ? 'resta' : 'restano'} fuori dal calcolo: ${info.missing.length === 1 ? 'completalo' : 'completali'} nella scheda Portafoglio.`));
  if (info.matured && info.matured.length) ins.push(insight('info', `${plural(info.matured.length, 'titolo del portafoglio è già scaduto', 'titoli del portafoglio sono già scaduti')}: puoi toglierli dalla scheda Portafoglio.`));
  if (plan.holdings.some(x => x.bond && x.bond.inflation)) ins.push(insight('info', 'Per i BTP Italia conto la cedola reale senza inflazione futura: incasserai un po\' di più.'));
  ins.push(...commonInsights(plan, result));

  const chartBox = h('div');
  const labels = plan.targets.map(t => t.label.length > 12 ? t.label.slice(0, 11) + '…' : t.label);
  const potUsed = plan.targets.some(t => t.fromPot > 0.5);
  requestAnimationFrame(() => columnChart(chartBox, {
    labels, height: 250, yFormat: v => fmtNum(v, 0),
    series: [{ cls: 's4', values: plan.targets.map(t => t.heldIn) }, { cls: 's1', values: plan.targets.map(t => t.redemption) },
      { cls: 's2', values: plan.targets.map(t => plan.useCoupons ? t.coupons : 0) }, ...(potUsed ? [{ cls: 's3', values: plan.targets.map(t => t.fromPot) }] : [])],
    target: plan.targets.map(t => t.amount), ariaLabel: 'Importo disponibile per ogni scadenza: dai tuoi titoli, dai nuovi acquisti e dalla cassa, con l\'obiettivo',
    tooltip: i => { const t = plan.targets[i]; return { title: t.label, meta: t.bond && t.nominal ? t.bond.desc : t.coveredByHeld ? 'coperta dai tuoi titoli' : 'nessun acquisto', rows: [
      { key: 'amber-fill', label: 'Dai tuoi titoli', value: fmtEur(t.heldIn) },
      { key: 'ink', label: 'Rimborso nuovo', value: fmtEur(t.redemption) }, { key: 'chart-trail', label: 'Cedole nuove', value: fmtEur(plan.useCoupons ? t.coupons : 0) },
      ...(potUsed ? [{ key: 'chart-line', label: 'Dalla cassa', value: fmtEur(t.fromPot) }] : []),
      { label: 'Disponibile', value: fmtEur(t.available) }, { key: 'blue', label: 'Obiettivo', value: fmtEur(t.amount) }] }; },
    onClick: i => { const el = document.getElementById('rung-' + i); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); } }
  }));
  const ladder = panel('La tua scala', 'quanto ricevi a ogni scadenza · euro netti', chartBox,
    legend([{ key: 'amber-fill', label: 'dai tuoi titoli' }, { key: 'ink', label: 'rimborso dei nuovi' }, { key: 'chart-trail', label: plan.useCoupons ? 'cedole dei nuovi' : 'cedole (non usate)' },
      ...(potUsed ? [{ key: 'chart-line', label: 'dalla cassa' }] : []), { type: 'line', key: 'blue', label: 'obiettivo' },
      { type: 'text', label: 'clic su una colonna per andare alla riga' }]));

  const sel = new Set(plan.positions.map(p => p.bond.isin));
  const bands = plan.targets.map(t => ({ from: t.start, to: t.end, label: t.label }));
  const bandOf = p => plan.targets.findIndex(t => p.maturity > t.start && p.maturity <= t.end);
  const map = yieldMapPanel(result, sel, bands, p => { const i = bandOf(p); if (i >= 0 && !sel.has(p.isin) && A.onSwap) A.onSwap(plan.targets[i].label, p.isin); }, p => bandOf(p) >= 0 && !sel.has(p.isin));
  const allFlows = plan.schedule.concat(plan.heldSchedule).sort((a, b2) => a.day - b2.day);

  return [kpis, lead, actionsBar(),
    h('div', { class: 'grid-2' }, ladder, notesPanel(ins)),
    rungsPanel(plan),
    map,
    allFlows.length ? calendarPanel(allFlows, 'tuoi titoli e nuovi acquisti · euro netti, mese per mese') : null,
    plan.positions.length ? purchasePanel(plan.positions, plan.settle, 'Da comprare') : null].filter(Boolean);
}

/** Tabella principale: una riga per scadenza, con il titolo scelto e da dove arriva l'importo. */
function rungsPanel(plan) {
  const ptf = !!plan.holdings;                                        // proposta costruita attorno al portafoglio
  const pooled = (plan.accumulate || ptf) && plan.targets.some(t => t.fromPot > 0.5);
  const potLabel = ptf ? 'Dalla cassa' : 'Accantonate';
  const budgetMode = plan.budget != null;
  // stesso obiettivo per tutte le scadenze (anni o semestri): lo dice l'intestazione, non serve una colonna
  const oneGoal = plan.targets.length > 0 && plan.targets.every(t => Math.abs(t.amount - plan.targets[0].amount) < 0.5);
  const head = ['Scadenza', 'Titolo', 'Prezzo', 'Netto', 'Rating', 'Nominale', 'Costo', ...(ptf ? ['Tuoi titoli'] : []), 'Rimborso', plan.useCoupons ? 'Cedole' : 'Cedole (extra)', ...(pooled ? [potLabel] : []), 'Disponibile', ...(oneGoal ? [] : ['Obiettivo']), 'Stato'];
  const R = new Set(['Prezzo', 'Netto', 'Nominale', 'Costo', 'Tuoi titoli', 'Rimborso', 'Cedole', 'Cedole (extra)', 'Accantonate', 'Dalla cassa', 'Disponibile', 'Obiettivo']);
  const rows = plan.targets.map((t, i) => {
    const b = t.bond, cost = b ? t.nominal * b.cost / 100 : 0;
    const ok = t.available + 0.5 >= t.amount;
    const state = !b && t.available < 0.5 ? badge('fail', 'Scoperta') : ok ? badge('trig', 'Coperta') : badge('watch', 'Sotto');
    const rank = b ? t.candidates.findIndex(x => x.bond.isin === b.isin) : -1;
    const better = rank > 0 ? [...new Set(t.candidates.slice(0, rank).map(x => x.bond.issuerName))] : [];
    const mine = ptf && rank > 0 && t.candidates[rank].held;
    const why = mine ? 'preferito perché ce l\'hai già (vedi «Nuovi acquisti» nelle impostazioni)'
      : rank > 0 && !t.fixed && plan.issuerCap < 1 ? `i più redditizi (${better.slice(0, 3).join(', ')}) sono di emittenti già al limite di quota` : '';
    const rankTag = rank >= 0 ? h('span', { class: 'tag', title: why || (rank === 0 ? 'il rendimento più alto della finestra' : ''), text: `${rank + 1}° di ${t.candidates.length}` }) : null;
    // i tuoi titoli che scadono nel periodo, uno per riga
    const heldLine = ptf && t.held && t.held.length
      ? h('span', { class: 'held-list', title: 'tuoi titoli che scadono in questo periodo' }, t.held.map(x => h('span', { class: 'dsub' }, h('span', { class: 'mine', text: 'tuo' }), ` ${x.desc} · ${eur0(x.nominal)}`))) : null;
    let titleCell;
    if (ptf && t.coveredByHeld) {
      titleCell = h('span', { class: 'ttl' }, h('b', { text: t.heldIn > 0.5 ? 'Coperta dai tuoi titoli' : 'Coperta dalla cassa' }),
        t.fromPot > 0.5 ? h('span', { class: 'code', text: `dalla cassa ${fmtEur(t.fromPot)}: eccedenze e rimborsi arrivati prima` }) : null, heldLine);
    } else if (!b) {
      titleCell = h('span', { class: 'ttl' }, h('b', { text: t.fromPot > 0.5 ? (ptf ? 'Coperta in parte dalla cassa' : 'Coperta dalle cedole accantonate') : 'Nessun titolo' }),
        h('span', { class: 'code', text: t.candidates.length ? 'il limite per emittente impedisce di usare quelli della finestra' : t.need != null ? 'nessun titolo del paniere scade nella finestra' : 'nessun titolo del paniere scade in questo periodo' }), heldLine);
    } else if (!t.nominal) {
      titleCell = h('span', { class: 'ttl' }, h('b', { text: ok ? 'Nessun acquisto: bastano le cedole' : b.desc }),
        h('span', { class: 'code', text: ok ? (t.fromPot > 0.5 ? `cedole accantonate ${fmtEur(t.fromPot)}${t.coupons > 0.5 ? ` e del periodo ${fmtEur(t.coupons)}` : ''}` : `cedole del periodo ${fmtEur(t.coupons)}`)
          : budgetMode ? `il capitale non basta per il lotto minimo (${eur0(b.lot)})` : 'il titolo scelto non scade in questo periodo' }),
        t.fixed ? h('span', { class: 'tags' }, h('span', { class: 'tag', text: 'scelto da te' })) : null, heldLine);
    } else {
      titleCell = bondCell(b, [t.topUp ? h('span', { class: 'tag', title: 'Titolo che hai già: ne compri altri pezzi', text: 'ne hai già' }) : null,
        t.fixed ? h('span', { class: 'tag', text: 'scelto da te' }) : null, rankTag].filter(Boolean));
      if (heldLine) titleCell.appendChild(heldLine);
    }
    const n = (v, show = true) => show ? eur0(v) : '—';
    const diff = t.available - t.amount;
    const cells = [
      h('td', null, h('span', { class: 'sym', text: t.label }), t.need != null ? h('span', { class: 'dsub', text: `entro il ${fmt(t.need)}` }) : null),
      h('td', null, titleCell),
      h('td', { class: 'num r' }, b && t.nominal ? fmtNum(b.price, 2) : ''),
      h('td', { class: 'num r' }, b && t.nominal ? fmtPct(b.ytmNet) : ''),
      h('td', null, b && t.nominal ? (b.rating || 'NR') : ''),
      h('td', { class: 'num r' }, n(t.nominal, t.nominal > 0)),
      h('td', { class: 'num r' }, n(cost, t.nominal > 0)),
      ...(ptf ? [h('td', { class: 'num r' }, n(t.heldIn, t.heldIn > 0.5))] : []),
      h('td', { class: 'num r' }, n(t.redemption), b && t.nominal ? h('span', { class: 'dsub', title: 'data del rimborso', text: fmt(b.maturity) }) : null),
      h('td', { class: 'num r' }, n(t.coupons)),
      ...(pooled ? [h('td', { class: 'num r' }, n(t.fromPot))] : []),
      h('td', { class: 'num r' }, eur0(t.available), !ok && t.available > 0.5 ? h('span', { class: 'dsub', title: 'differenza rispetto all\'obiettivo', text: fmtNum(diff, 0) }) : null),
      oneGoal ? null : h('td', { class: 'num r' }, eur0(t.amount)),
      h('td', { class: 'acts' }, state,
        h('span', { class: 'row-acts' },
          b || t.candidates.length ? h('button', { type: 'button', class: 'mini', 'aria-label': `Cambia il titolo di ${t.label}`, text: 'Cambia', on: { click: () => A.onAlternatives && A.onAlternatives(t, i) } }) : null,
          t.fixed ? h('button', { type: 'button', class: 'mini', 'aria-label': `Torna alla scelta automatica per ${t.label}`, text: 'Automatico', on: { click: () => A.onUnfix && A.onUnfix(t.label) } }) : null))
    ];
    const can = b || t.candidates.length;
    return h('tr', { id: 'rung-' + i, 'data-sym': t.label, ...(can ? clickable(() => A.onAlternatives && A.onAlternatives(t, i), `${t.label}: ${b ? b.desc : 'nessun titolo'}. Invio per cambiare titolo`) : { tabindex: -1 }) }, cells);
  });
  const sum = k => plan.targets.reduce((s, t) => s + (t[k] || 0), 0);
  const costTot = plan.positions.reduce((s, p) => s + p.cost, 0);
  const foot = h('tr', { class: 'bench' },
    h('td', null, h('b', { text: 'Totale' })), h('td', { text: ptf ? `${plan.positions.length} da comprare` : `${plan.positions.length} titoli` }), h('td'), h('td', { class: 'num r', text: fmtPct(plan.irr * 100) }), h('td'),
    h('td', { class: 'num r', text: eur0(plan.positions.reduce((s, p) => s + p.nominal, 0)) }), h('td', { class: 'num r', text: eur0(costTot) }),
    ...(ptf ? [h('td', { class: 'num r', text: eur0(sum('heldIn')) })] : []),
    h('td', { class: 'num r', text: eur0(sum('redemption')) }), h('td', { class: 'num r', text: eur0(sum('coupons')) }),
    ...(pooled ? [h('td', { class: 'num r', text: eur0(sum('fromPot')) })] : []),
    h('td', { class: 'num r', text: eur0(sum('available')) }), oneGoal ? null : h('td', { class: 'num r', text: eur0(sum('amount')) }), h('td'));
  const table = h('div', { class: 'tscroll' }, h('table', { class: 't rungs', 'aria-label': 'Scadenze e titoli' },
    h('thead', null, h('tr', null, head.map((x, i) => h('th', { scope: 'col', class: R.has(x) ? 'r' : null, 'aria-sort': i === 0 ? 'ascending' : null, text: x })))),
    h('tbody', null, rows), h('tfoot', null, foot)));
  const note = ptf
    ? ['Netto: rendimento netto annuo del titolo nuovo (STFI). Tuoi titoli: rimborsi e cedole nette dei titoli che hai già, nel periodo della scadenza (la tassa sulla plusvalenza è calcolata sul tuo prezzo di carico). Rimborso e Cedole: dei nuovi acquisti.',
      pooled ? ' Dalla cassa: eccedenze delle scadenze precedenti e rimborsi arrivati fuori dai periodi, senza interessi.' : '', ' Costo: nominale al prezzo del file più il rateo, valuta ', fmt(plan.settle), '.']
    : ['Netto: rendimento netto annuo del titolo (STFI). Disponibile: rimborso e cedole che arrivano nel periodo della scadenza', pooled ? ', più le cedole accantonate' : '', '. Costo: nominale al prezzo del file più il rateo, valuta ', fmt(plan.settle), '.'];
  return panel('Scadenze e titoli', `${ptf ? `${plan.positions.length} da comprare` : `${plan.positions.length} titoli`} · ${oneGoal ? `obiettivo ${fmtEur(plan.targets[0].amount)} a scadenza · ` : ''}euro netti · riga o Cambia per scegliere un altro titolo`, table,
    h('p', { class: 'note', style: { padding: '6px 10px' } }, ...note));
}

/* ---------------------------- Rendita mensile ---------------------------- */
function incomeView(st, result, plan) {
  if (plan.empty) return [notesPanel((plan.warnings || []).map(w => insight('warn', w)))];
  const avg = plan.annual / 12;
  const target = plan.monthlyTarget;
  const kpis = h('div', { class: 'kpis' },
    kpi('Rendita al mese', fmtEur(avg), 'media netta, dopo le tasse'),
    kpi('Mese più basso', fmtEur(plan.minMonth), `il più alto ${fmtEur(plan.maxMonth)}`),
    kpi('Rendita annua', fmtEur(plan.annual), 'netta, solo cedole'),
    kpi('Regolarità', fmtPct(plan.regularity * 100, 0), 'mese più basso / media'),
    kpi('Rendimento netto', fmtPct(plan.irr * 100), 'annuo, cedole + rimborsi'),
    kpi('Da investire', fmtEur(plan.totalCost), target ? `per almeno ${fmtEur(target)} al mese` : `non investiti ${fmtEur(plan.cash)} (lotti)`));
  const lead = h('p', { class: 'lead' },
    target ? ['Per avere almeno ', h('b', { text: fmtEur(target) }), ' ogni mese servono ', h('b', { text: fmtEur(plan.totalCost) }), `. Con ${plan.positions.length} titoli le cedole arrivano`]
      : ['Investendo ', h('b', { text: fmtEur(plan.totalCost) }), ` in ${plan.positions.length} titoli le cedole arrivano`],
    ` in ${plan.coveredMonths} mesi su 12: da un minimo di `, h('b', { text: fmtEur(plan.minMonth) }), ' a un massimo di ', h('b', { text: fmtEur(plan.maxMonth) }), ` al mese. Duration media ${fmtNum(plan.summary.duration, 1)} anni.`);

  const ins = [];
  if (plan.coveredMonths === 12) ins.push(insight('good', 'Cedole in tutti i 12 mesi dell\'anno.'));
  ins.push(insight('info', `Il capitale torna man mano: ${plan.capitalByYear.map(([y, v]) => `${y} ${fmtEur(v)}`).join(' · ')}.`));
  ins.push(...commonInsights(plan, result));

  const monthsBox = h('div');
  const payers = MONTHS.map((_, m) => plan.positions.filter(p => p.months.includes(m + 1)));
  requestAnimationFrame(() => columnChart(monthsBox, {
    labels: MONTHS, height: 240, yFormat: v => fmtNum(v, 0), average: avg, averageLabel: `MEDIA ${fmtNum(avg, 0)} €`,
    series: [{ cls: 's1', values: plan.monthly }], ariaLabel: 'Cedole nette per mese',
    tooltip: m => ({ title: MONTHS_LONG[m], meta: fmtEur(plan.monthly[m]), rows: payers[m].map(p => ({ label: p.bond.desc.length > 30 ? p.bond.desc.slice(0, 29) + '…' : p.bond.desc, value: fmtEur(p.netPerPayment) })), note: payers[m].length ? null : 'nessuna cedola' })
  }));
  const monthsPanel = panel('Cedole nette mese per mese', 'anno tipo, dopo le tasse', monthsBox,
    legend([{ key: 'ink', label: 'cedole nette del mese' }, { type: 'line', key: 'amber', label: 'media' }, { type: 'text', label: 'passa sopra un mese per vedere chi paga' }]));

  const capBox = h('div');
  requestAnimationFrame(() => columnChart(capBox, {
    labels: plan.capitalByYear.map(([y]) => String(y)), height: 200, yFormat: v => fmtNum(v, 0),
    series: [{ cls: 's1', values: plan.capitalByYear.map(([, v]) => v) }], ariaLabel: 'Capitale rimborsato per anno',
    tooltip: i => { const y = plan.capitalByYear[i][0]; const ps = plan.positions.filter(p => parts(p.bond.maturity).y === y);
      return { title: String(y), meta: fmtEur(plan.capitalByYear[i][1]), rows: ps.map(p => ({ label: fmtMonthYear(p.bond.maturity) + ' · ' + p.bond.issuerName, value: fmtEur(p.nominal) })) }; }
  }));

  const maxShare = Math.max(...plan.positions.map(p => p.cost / plan.totalCost));
  const table = dataTable({
    label: 'Titoli della rendita', sortBy: 1, cls: 'compact',
    cols: [
      { label: 'Titolo', cls: 'wrap', sort: p => p.bond.desc, cell: p => [h('span', { class: 'sym', text: p.bond.isin }), h('span', { class: 'nm', text: p.bond.desc }), bondTags(p.bond)] },
      { label: 'Scadenza', sort: p => p.bond.maturity, cell: p => [h('span', { class: 'num', text: fmt(p.bond.maturity) }), h('span', { class: 'dsub', title: 'mesi in cui arriva la cedola', text: monthsText(p.bond) })] },
      { label: 'Prezzo', r: 1, sort: p => p.bond.price, cell: p => fmtNum(p.bond.price, 2) },
      { label: 'Netto', r: 1, sort: p => p.bond.ytmNet, dir: -1, cell: p => fmtPct(p.bond.ytmNet) },
      { label: 'Cedola', r: 1, sort: p => p.bond.coupon, dir: -1, cell: p => p.bond.zc ? '—' : fmtPct(p.bond.coupon, 2) },
      { label: 'Rating', cell: p => [p.bond.rating || 'NR', h('span', { class: 'dsub liq', title: `classe di liquidità STFI ${p.bond.liquidity} su 4`, text: liqDots(p.bond.liquidity) })] },
      { label: 'Nominale', r: 1, sort: p => p.nominal, dir: -1, cell: p => eur0(p.nominal) },
      { label: 'Costo', r: 1, sort: p => p.cost, dir: -1, cell: p => eur0(p.cost) },
      { label: 'Quota', sort: p => p.cost, dir: -1, cls: 'num', cell: p => [h('span', { class: 'wbar' }, h('i', { style: { width: `${(p.cost / plan.totalCost) / maxShare * 100}%` } })), h('span', { class: 'num', text: fmtPct(p.cost / plan.totalCost * 100, 0) })] },
      { label: 'Stacco netto', r: 1, sort: p => p.netPerPayment, dir: -1, cell: p => eur0(p.netPerPayment) },
      { label: '', cls: 'acts', cell: p => h('button', { type: 'button', class: 'mini', 'aria-label': `Escludi ${p.bond.desc} e ricalcola`, text: 'Escludi', on: { click: () => A.onExclude && A.onExclude(p.bond.isin, p.bond.desc) } }) }],
    rows: plan.positions
  });

  const sel = new Set(plan.positions.map(p => p.bond.isin));
  return [kpis, lead, actionsBar(),
    h('div', { class: 'grid-2' }, monthsPanel, notesPanel(ins)),
    panel('I titoli', `${plan.positions.length} titoli · euro · Escludi toglie un titolo e ricalcola`, table,
      h('p', { class: 'note', style: { padding: '6px 10px' } }, 'Sotto la scadenza, i mesi in cui arriva la cedola; sotto il rating, la liquidità STFI (da ○○○○ a ●●●●). Netto: rendimento netto annuo. Stacco netto: quanto incassi, dopo le tasse, a ogni pagamento della cedola.')),
    panel('Capitale che torna', 'rimborsi netti per anno · euro', capBox, legend([{ key: 'ink', label: 'rimborsi dell\'anno' }])),
    yieldMapPanel(result, sel, [], null, null),
    calendarPanel(plan.schedule), purchasePanel(plan.positions, plan.settle)];
}

/* ---------------- Rendita mensile attorno al portafoglio posseduto ---------------- */
function portfolioIncomeView(st, result, plan) {
  const avg = plan.annual / 12, target = plan.monthlyTarget, nHeld = plan.holdings.length;
  const newAnnual = plan.annual - plan.annualHeld;
  const kpis = h('div', { class: 'kpis' },
    kpi('Rendita al mese', fmtEur(avg), `media netta · prima ${fmtEur(plan.annualHeld / 12)}`),
    kpi('Mese più basso', fmtEur(plan.minMonth), plan.zeroMonthsBefore ? `prima ${plural(plan.zeroMonthsBefore, 'mese', 'mesi')} a zero` : `prima ${fmtEur(plan.minAllBefore)}`),
    kpi('Dai tuoi titoli', fmtPct(plan.heldShare * 100, 0), `delle cedole · ${plural(nHeld, 'titolo', 'titoli')}`),
    kpi('Rendimento netto', fmtPct(plan.irrAll * 100), plan.positions.length ? `tutto il portafoglio · nuovi ${fmtPct(plan.irr * 100)}` : 'tutto il portafoglio'),
    kpi('Nuovi acquisti', fmtEur(plan.totalCost), target ? `per almeno ${fmtEur(target)} al mese` : plan.positions.length ? `${plural(plan.newLines, 'titolo nuovo', 'titoli nuovi')}${plan.topUps ? ` + ${plural(plan.topUps, 'rabbocco', 'rabbocchi')}` : ''}` : 'niente da comprare'),
    kpi('Mesi pagati', String(plan.coveredMonths), plan.coveredMonths === 12 ? 'tutti' : `${12 - plan.coveredMonths} senza cedole`, '/ 12'));
  const b = t => h('b', { text: t });
  const lead = h('p', { class: 'lead' },
    'Con i tuoi ', b(plural(nHeld, 'titolo', 'titoli')), plan.totalCost > 0.5 ? [' e ', b(fmtEur(plan.totalCost)), ' di nuovi acquisti'] : [],
    ` le cedole arrivano in ${plan.coveredMonths} mesi su 12: da un minimo di `, b(fmtEur(plan.minMonth)), ' a un massimo di ', b(fmtEur(plan.maxMonth)), ' al mese',
    plan.totalCost > 0.5 ? ['; oggi, con i soli tuoi titoli, ', b(fmtEur(plan.annualHeld / 12)), ' al mese in media.'] : '. Non vendi nulla.');

  const ins = [];
  if (plan.coveredMonths === 12) ins.push(insight('good', plan.zeroMonthsBefore ? `Cedole in tutti i 12 mesi: prima ${plan.zeroMonthsBefore === 1 ? 'un mese era' : `${plan.zeroMonthsBefore} mesi erano`} a zero.` : 'Cedole in tutti i 12 mesi dell\'anno.'));
  if (plan.positions.length && newAnnual > 0.5) ins.push(insight('info', `I nuovi acquisti aggiungono ${fmtEur(newAnnual)} l'anno di cedole nette${plan.minAllAfter > plan.minAllBefore + 0.5 ? ` e portano il mese più basso da ${fmtEur(plan.minAllBefore)} a ${fmtEur(plan.minAllAfter)}` : ''}.`));
  if (plan.topUps) ins.push(insight('info', `Per ${plan.topUps === 1 ? 'un titolo' : `${plan.topUps} titoli`} compri altri pezzi di quello che hai già.`));
  if (plan.heldBefore.length) {
    const first = Math.min(...plan.heldBefore.map(x => x.maturity));
    ins.push(insight('info', `${plural(plan.heldBefore.length, 'tuo titolo scade', 'tuoi titoli scadono')} prima dell'orizzonte scelto (${plan.heldBefore.length === 1 ? 'il' : 'dal'} ${fmt(first)}): ${plan.heldBefore.length === 1 ? 'la sua cedola' : 'le loro cedole'} (${fmtEur(plan.heldBeforeAnnual)} l'anno) non ${plan.heldBefore.length === 1 ? 'conta' : 'contano'} nella rendita dei mesi, perché smetterebbero presto di arrivare.`));
  }
  const cap = st.basket.issuerCap, W = plan.heldValue + plan.totalCost;
  if (cap < 1 && W > 0) {
    const m = new Map();
    for (const x of plan.holdings) { const e = m.get(x.bond.issuer) || { name: x.bond.issuerName, v: 0 }; e.v += x.value || 0; m.set(x.bond.issuer, e); }
    for (const e of m.values()) if (e.v / W > cap + 1e-9) ins.push(insight('warn', `${e.name} pesa già il ${fmtNum(e.v / W * 100, 0)}% del portafoglio complessivo, oltre il limite per emittente del ${fmtNum(cap * 100, 0)}%: non compro altri suoi titoli. Il limite si cambia nel paniere.`));
  }
  const info = result.portfolio || {};
  if (info.missing && info.missing.length) ins.push(insight('warn', `${plural(info.missing.length, 'titolo del portafoglio non è', 'titoli del portafoglio non sono')} nei dati di oggi e ${info.missing.length === 1 ? 'resta' : 'restano'} fuori dal calcolo: ${info.missing.length === 1 ? 'completalo' : 'completali'} nella scheda Portafoglio.`));
  if (plan.holdings.some(x => x.bond && x.bond.inflation)) ins.push(insight('info', 'Per i BTP Italia conto la cedola reale senza inflazione futura: incasserai un po\' di più.'));
  if (plan.capitalByYear.length || plan.heldCapitalByYear.length) {
    const years = [...new Set(plan.capitalByYear.map(([y]) => y).concat(plan.heldCapitalByYear.map(([y]) => y)))].sort((a, c) => a - c);
    const tot = y => (plan.capitalByYear.find(([k]) => k === y) || [0, 0])[1] + (plan.heldCapitalByYear.find(([k]) => k === y) || [0, 0])[1];
    ins.push(insight('info', `Il capitale torna man mano (tuoi titoli e nuovi): ${years.map(y => `${y} ${fmtEur(tot(y))}`).join(' · ')}.`));
  }
  ins.push(...commonInsights(plan, result));

  const monthsBox = h('div');
  const payers = MONTHS.map((_, m) => plan.positions.filter(p => p.months.includes(m + 1)));
  const heldPayers = MONTHS.map((_, m) => plan.holdings.filter(x => x.counted && x.bond.months && x.bond.months.includes(m + 1) && x.netPerPayment > 0));
  const newMonthly = plan.monthly.map((v, i) => v - plan.monthlyHeld[i]);
  requestAnimationFrame(() => columnChart(monthsBox, {
    labels: MONTHS, height: 240, yFormat: v => fmtNum(v, 0), average: avg, averageLabel: `MEDIA ${fmtNum(avg, 0)} €`,
    series: [{ cls: 's4', values: plan.monthlyHeld }, { cls: 's1', values: newMonthly }], ariaLabel: 'Cedole nette per mese: dai tuoi titoli e dai nuovi',
    tooltip: m => ({ title: MONTHS_LONG[m], meta: fmtEur(plan.monthly[m]), rows: [
      ...heldPayers[m].map(x => ({ key: 'amber-fill', label: 'tuo · ' + (x.desc.length > 26 ? x.desc.slice(0, 25) + '…' : x.desc), value: fmtEur(x.netPerPayment) })),
      ...payers[m].map(p => ({ key: 'ink', label: p.bond.desc.length > 30 ? p.bond.desc.slice(0, 29) + '…' : p.bond.desc, value: fmtEur(p.netPerPayment) }))],
    note: payers[m].length || heldPayers[m].length ? null : 'nessuna cedola' })
  }));
  const monthsPanel = panel('Cedole nette mese per mese', 'anno tipo, dopo le tasse', monthsBox,
    legend([{ key: 'amber-fill', label: 'dai tuoi titoli' }, { key: 'ink', label: 'dai nuovi acquisti' }, { type: 'line', key: 'amber', label: 'media' }, { type: 'text', label: 'passa sopra un mese per vedere chi paga' }]));

  const years = [...new Set(plan.capitalByYear.map(([y]) => y).concat(plan.heldCapitalByYear.map(([y]) => y)))].sort((a, c) => a - c);
  const valOf = (list, y) => (list.find(([k]) => k === y) || [0, 0])[1];
  const capBox = h('div');
  requestAnimationFrame(() => columnChart(capBox, {
    labels: years.map(String), height: 200, yFormat: v => fmtNum(v, 0),
    series: [{ cls: 's4', values: years.map(y => valOf(plan.heldCapitalByYear, y)) }, { cls: 's1', values: years.map(y => valOf(plan.capitalByYear, y)) }],
    ariaLabel: 'Capitale rimborsato per anno: tuoi titoli e nuovi',
    tooltip: i => ({ title: String(years[i]), meta: fmtEur(valOf(plan.heldCapitalByYear, years[i]) + valOf(plan.capitalByYear, years[i])), rows: [
      { key: 'amber-fill', label: 'tuoi titoli', value: fmtEur(valOf(plan.heldCapitalByYear, years[i])) }, { key: 'ink', label: 'nuovi', value: fmtEur(valOf(plan.capitalByYear, years[i])) }] })
  }));

  const out = [kpis, lead, actionsBar(), h('div', { class: 'grid-2' }, monthsPanel, notesPanel(ins))];
  if (plan.positions.length) {
    const maxShare = Math.max(...plan.positions.map(p => p.cost / plan.totalCost));
    out.push(panel('Titoli da comprare', `${plan.positions.length} titoli · euro · Escludi toglie un titolo e ricalcola`, dataTable({
      label: 'Titoli da comprare per la rendita', sortBy: 1, cls: 'compact',
      cols: [
        { label: 'Titolo', cls: 'wrap', sort: p => p.bond.desc, cell: p => [h('span', { class: 'sym', text: p.bond.isin }), h('span', { class: 'nm', text: p.bond.desc }),
          bondTags(p.bond, p.topUp ? [h('span', { class: 'tag', title: 'Titolo che hai già: ne compri altri pezzi', text: 'ne hai già' })] : [])] },
        { label: 'Scadenza', sort: p => p.bond.maturity, cell: p => [h('span', { class: 'num', text: fmt(p.bond.maturity) }), h('span', { class: 'dsub', title: 'mesi in cui arriva la cedola', text: monthsText(p.bond) })] },
        { label: 'Prezzo', r: 1, sort: p => p.bond.price, cell: p => fmtNum(p.bond.price, 2) },
        { label: 'Netto', r: 1, sort: p => p.bond.ytmNet, dir: -1, cell: p => fmtPct(p.bond.ytmNet) },
        { label: 'Cedola', r: 1, sort: p => p.bond.coupon, dir: -1, cell: p => p.bond.zc ? '—' : fmtPct(p.bond.coupon, 2) },
        { label: 'Rating', cell: p => [p.bond.rating || 'NR', h('span', { class: 'dsub liq', title: `classe di liquidità STFI ${p.bond.liquidity} su 4`, text: liqDots(p.bond.liquidity) })] },
        { label: 'Nominale', r: 1, sort: p => p.nominal, dir: -1, cell: p => eur0(p.nominal) },
        { label: 'Costo', r: 1, sort: p => p.cost, dir: -1, cell: p => eur0(p.cost) },
        { label: 'Quota', sort: p => p.cost, dir: -1, cls: 'num', cell: p => [h('span', { class: 'wbar' }, h('i', { style: { width: `${(p.cost / plan.totalCost) / maxShare * 100}%` } })), h('span', { class: 'num', text: fmtPct(p.cost / plan.totalCost * 100, 0) })] },
        { label: 'Stacco netto', r: 1, sort: p => p.netPerPayment, dir: -1, cell: p => eur0(p.netPerPayment) },
        { label: '', cls: 'acts', cell: p => h('button', { type: 'button', class: 'mini', 'aria-label': `Escludi ${p.bond.desc} e ricalcola`, text: 'Escludi', on: { click: () => A.onExclude && A.onExclude(p.bond.isin, p.bond.desc) } }) }],
      rows: plan.positions
    }), h('p', { class: 'note', style: { padding: '6px 10px' } }, 'Solo i titoli nuovi: i tuoi restano come sono. Sotto la scadenza, i mesi in cui arriva la cedola. Stacco netto: quanto incassi a ogni pagamento, dopo le tasse.')));
  }
  out.push(panel('I tuoi titoli nella rendita', `${plural(nHeld, 'titolo', 'titoli')} · cedole nette a ogni stacco`, dataTable({
    label: 'I tuoi titoli nella rendita', sortBy: 1, cls: 'compact',
    cols: [
      { label: 'Titolo', cls: 'wrap', sort: x => x.desc, cell: x => [h('span', { class: 'sym', text: x.isin }), h('span', { class: 'nm', text: x.desc })] },
      { label: 'Scadenza', sort: x => x.bond.maturity, cell: x => [h('span', { class: 'num', text: fmt(x.bond.maturity) }), h('span', { class: 'dsub', text: monthsText(x.bond) })] },
      { label: 'Nominale', r: 1, sort: x => x.nominal, dir: -1, cell: x => eur0(x.nominal) },
      { label: 'Stacco netto', r: 1, sort: x => x.netPerPayment, dir: -1, cell: x => x.netPerPayment > 0 ? eur0(x.netPerPayment) : '—' },
      { label: 'Nella rendita', cell: x => x.counted ? badge('trig', 'Conta') : badge('normal', 'Scade prima') }],
    rows: plan.holdings
  })));
  out.push(panel('Capitale che torna', 'rimborsi netti per anno · euro', capBox, legend([{ key: 'amber-fill', label: 'tuoi titoli' }, { key: 'ink', label: 'nuovi acquisti' }])));
  out.push(yieldMapPanel(result, new Set(plan.positions.map(p => p.bond.isin)), [], null, null));
  const allFlows = plan.schedule.concat(plan.heldSchedule).sort((a, c) => a.day - c.day);
  if (allFlows.length) out.push(calendarPanel(allFlows, 'tuoi titoli e nuovi acquisti · euro netti, mese per mese'));
  if (plan.positions.length) out.push(purchasePanel(plan.positions, plan.settle, 'Da comprare'));
  return out;
}
