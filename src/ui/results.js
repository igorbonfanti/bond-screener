/* Risultati: la proposta spiegata. Capitale a scadenza e rendita mensile condividono
   sintesi, indicatori, mappa dei rendimenti, calendario degli incassi e lista d'acquisto. */
import { h, icon, fmtEur, fmtPct, fmtNum, fmtSigned, copyText, toast, downloadFile } from './dom.js';
import { columnChart, yieldMap, legend } from './charts.js';
import { fmt, fmtMonthYear, parts, MONTHS, MONTHS_LONG } from '../core/dates.js';

let A = {};   // azioni fornite da main.js

export function renderResults(root, { st, result, actions }) {
  A = actions || {};
  const plan = result && result.plan;
  if (!plan) { root.replaceChildren(); return; }
  if (plan.mode === 'capital') root.replaceChildren(...capitalView(st, result, plan));
  else root.replaceChildren(...incomeView(st, result, plan));
}

/* ------------------------------ comuni ------------------------------ */
const kpi = (label, value, sub) => h('div', { class: 'kpi' }, h('div', { class: 'k-label', text: label }),
  h('div', { class: 'k-value', text: value }), sub ? h('div', { class: 'k-sub', text: sub }) : null);
const insight = (kind, text) => h('div', { class: 'insight ' + kind },
  h('span', { class: 'ico', text: kind === 'good' ? '✓' : kind === 'warn' ? '!' : kind === 'bad' ? '×' : 'i' }), h('span', { text }));
const card = (title, sub, body, actions) => h('section', { class: 'card' },
  h('div', { class: 'card-head' }, h('h2', { text: title }), sub ? h('span', { class: 'sub', text: sub }) : null,
    actions ? h('div', { class: 'actions' }, actions) : null),
  h('div', { class: 'card-body' }, body));

const issCode = b => b.area === 'sov' ? b.issuer.replace('SOV_', '').slice(0, 4) : (b.country || b.issuer.slice(0, 3));
const liqDots = n => '●'.repeat(Math.max(0, Math.min(4, n))) + '○'.repeat(4 - Math.max(0, Math.min(4, n)));
const monthsText = b => b.months && b.months.length ? b.months.map(m => MONTHS[m - 1]).join(' · ') : 'zero coupon';

function bondTags(b, extra = []) {
  const t = [];
  t.push(b.price <= 100 ? h('span', { class: 'tag good', text: 'sotto la pari' }) : h('span', { class: 'tag warn', text: 'sopra la pari' }));
  if (b.stepUp) t.push(h('span', { class: 'tag', text: 'step-up' }));
  if (b.inflation) t.push(h('span', { class: 'tag warn', text: 'indicizzato' }));
  if (b.zc) t.push(h('span', { class: 'tag', text: 'zero coupon' }));
  if (b.priceType === 'RP') t.push(h('span', { class: 'tag', title: 'Nessuno scambio oggi: prezzo di riferimento', text: 'prezzo di rif.' }));
  return t.concat(extra);
}

function bondMain(b) {
  return h('div', { class: 'bond-main' },
    h('div', { class: 'bond-title' }, h('span', { class: 'iss', text: issCode(b) }), h('span', { class: 'name', text: b.desc })),
    h('div', { class: 'bond-meta' },
      h('span', null, 'Scade ', h('b', { text: fmt(b.maturity) })),
      h('span', null, 'Prezzo ', h('b', { text: fmtNum(b.price, 2) })),
      h('span', null, 'Netto ', h('b', { text: fmtPct(b.ytmNet) })),
      h('span', null, 'Cedola ', h('b', { text: b.zc ? '—' : fmtPct(b.coupon, 2) }), b.zc ? '' : ` (${monthsText(b)})`),
      h('span', null, 'Rating ', h('b', { text: b.rating || 'NR' })),
      h('span', { title: 'Classe di liquidità STFI (0-4)' }, 'Liquidità ', h('b', { text: liqDots(b.liquidity) }))),
    h('div', { class: 'bond-meta' },
      h('span', { class: 'isin-copy', title: 'Copia ISIN', text: b.isin, on: { click: async () => toast(await copyText(b.isin) ? `ISIN ${b.isin} copiato` : b.isin, 'ok') } }),
      h('span', { text: `lotto ${fmtNum(b.lot, 0)}` }), ...bondTags(b)));
}

function yieldMapCard(result, sel, bands, onPick, pickable) {
  const pts = (result.map || []).map(p => ({ ...p, sel: sel.has(p.isin), pickable: pickable ? pickable(p) : false }));
  const box = h('div');
  const body = [legend([{ type: 'dot', key: 'series-1', label: 'Titoli scelti' }, { type: 'dot', key: 'viz-deemph', label: 'Altri titoli del paniere' }]), box,
    h('p', { class: 'help', text: bands.length ? 'Le fasce colorate sono le finestre di scadenza: ogni punto dentro una fascia è un\'alternativa possibile per quella scadenza. Tocca un punto per usarlo.' : 'Ogni punto è un titolo del paniere: più in alto rende di più, più a destra scade più tardi.' })];
  requestAnimationFrame(() => yieldMap(box, {
    points: pts, bands, height: 280, ariaLabel: 'Rendimento netto per scadenza dei titoli del paniere',
    tooltip: p => ({ title: p.desc, rows: [{ label: 'Rendimento netto', value: fmtPct(p.y) }, { label: 'Scadenza', value: fmt(p.maturity) }, { label: 'Prezzo', value: fmtNum(p.price, 2) }, { label: 'Rating', value: p.rating || 'NR' }],
      note: p.sel ? 'Già nella proposta' : p.pickable ? 'Tocca per usarlo nella proposta' : null }),
    onPick
  }));
  return card('Mappa dei rendimenti', `${pts.length} titoli · rendimento netto per scadenza`, body);
}

function calendarCard(schedule) {
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
    h('td', { text: String(y) }),
    r.months.map((v, i) => h('td', { class: `cell h${lvl(v)}${r.redeem[i] ? ' redeem' : ''}`, title: v > 0 ? `${MONTHS_LONG[i]} ${y}: ${fmtEur(v)}${r.redeem[i] ? ' (con rimborso)' : ''}` : '', text: v > 0 ? fmtNum(v, 0) : '·' })),
    h('td', { class: 'r', text: fmtNum(r.total, 0) })));
  const table = h('div', { class: 'table-wrap' }, h('table', { class: 't heat' },
    h('thead', null, h('tr', null, h('th', { text: 'Anno' }), MONTHS.map(m => h('th', { class: 'r', text: m })), h('th', { class: 'r', text: 'Totale €' }))),
    h('tbody', null, rows)));
  const leg = h('div', { class: 'heat-legend' }, h('span', null, 'Incasso netto del mese: '),
    h('span', { class: 'ramp' }, [1, 2, 3, 4, 5].map(i => h('i', { style: { background: `var(--seq-${i})` } }))), h('span', { text: 'poco → molto' }),
    h('span', null, h('span', { class: 'mark' }), 'mese con un rimborso'));
  return card('Calendario degli incassi', 'euro netti, mese per mese', [table, leg]);
}

function purchaseCard(positions, settle, title = 'Lista d\'acquisto') {
  const rows = positions.slice().sort((a, b) => a.bond.maturity - b.bond.maturity);
  const tot = rows.reduce((s, p) => s + p.cost, 0), totN = rows.reduce((s, p) => s + p.nominal, 0);
  const csv = () => {
    const head = ['ISIN', 'Titolo', 'Scadenza', 'Nominale', 'Prezzo', 'Rateo lordo', 'Controvalore stimato', 'Rendimento netto %'];
    const lines = rows.map(p => [p.bond.isin, p.bond.desc, fmt(p.bond.maturity), fmtNum(p.nominal, 0), fmtNum(p.bond.price, 3),
      fmtNum(p.bond.cost - p.bond.price, 4), fmtNum(p.cost, 2), fmtNum(p.bond.ytmNet, 2)]);
    return '﻿' + [head, ...lines].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  };
  const table = h('div', { class: 'table-wrap' }, h('table', { class: 't' },
    h('thead', null, h('tr', null, ['ISIN', 'Titolo', 'Scadenza', 'Nominale', 'Prezzo', 'Controvalore'].map((t, i) => h('th', { class: i >= 3 ? 'r' : '', text: t })))),
    h('tbody', null, rows.map(p => h('tr', null, h('td', { class: 'mono', text: p.bond.isin }), h('td', { text: p.bond.desc }), h('td', { text: fmt(p.bond.maturity) }),
      h('td', { class: 'r', text: fmtNum(p.nominal, 0) }), h('td', { class: 'r', text: fmtNum(p.bond.price, 2) }), h('td', { class: 'r', text: fmtNum(p.cost, 0) })))),
    h('tfoot', null, h('tr', null, h('td', { text: 'Totale' }), h('td'), h('td'), h('td', { class: 'r', text: fmtNum(totN, 0) }), h('td'), h('td', { class: 'r', text: fmtNum(tot, 0) })))));
  const actions = [
    h('button', { class: 'btn btn-ghost btn-sm', on: { click: async () => toast(await copyText(rows.map(p => `${p.bond.isin}\t${p.nominal}`).join('\n')) ? 'Elenco ISIN e nominali copiato' : 'Copia non riuscita', 'ok') } }, 'Copia ISIN'),
    h('button', { class: 'btn btn-ghost btn-sm', on: { click: () => downloadFile(`lista-acquisto-${new Date().toISOString().slice(0, 10)}.csv`, csv()) } }, icon('download'), 'CSV'),
    h('button', { class: 'btn btn-ghost btn-sm', on: { click: () => window.print() } }, icon('print'), 'Stampa')
  ];
  return card(title, `valuta ${fmt(settle)} · prezzi del file, commissioni escluse`, table, actions);
}

function actionsBar() {
  return h('div', { class: 'actions-bar' },
    h('button', { class: 'btn btn-primary', on: { click: () => A.onSave && A.onSave() } }, icon('save'), 'Salva'),
    h('button', { class: 'btn btn-ghost', on: { click: () => A.onShare && A.onShare() } }, icon('share'), 'Condividi'),
    h('button', { class: 'btn btn-ghost', on: { click: () => window.print() } }, icon('print'), 'Stampa'));
}

function commonInsights(plan, result) {
  const out = [];
  const s = plan.summary;
  if (plan.positions.length) {
    if (s.belowParShare >= 0.999) out.push(insight('good', `Tutti i titoli sono sotto la pari: a scadenza solo plusvalenze (${fmtEur(s.gainAtMaturity)}, tassate all'aliquota del titolo).`));
    else if (s.lossAtMaturity > 0) out.push(insight('warn', `Minusvalenza a scadenza di ${fmtEur(s.lossAtMaturity)} sui titoli sopra la pari: finisce nello zainetto fiscale e non si compensa con le cedole.`));
    const top = s.byIssuer[0];
    if (top && top.share > 0.5) out.push(insight('info', `${top.name} pesa il ${fmtNum(top.share * 100, 0)}% del capitale: valuta un limite per emittente più stretto.`));
  }
  if (plan.positions.some(p => p.bond.stepUp)) out.push(insight('info', 'Alcuni titoli hanno cedola crescente (step-up): le cedole future saranno più alte di quelle stimate qui.'));
  for (const w of plan.warnings || []) out.push(insight('warn', w));
  if (result.basketCount < 10) out.push(insight('warn', `Solo ${result.basketCount} titoli rispettano i filtri: allarga il paniere per avere più scelta.`));
  return out;
}

/* ------------------------- Capitale a scadenza ------------------------- */
function capitalView(st, result, plan) {
  const c = st.capital;
  if (!plan.targets.length) return [h('div', { class: 'card card-pad' }, insight('warn', 'Nessuna scadenza futura nel periodo scelto: sposta gli anni in avanti.'))];
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
  const extraLine = [potUsed > 0.5 ? [', di cui ', h('strong', { text: fmtEur(potUsed) }), ' dalle cedole accantonate'] : [],
    extra > 0.5 ? [potUsed > 0.5 ? '; più ' : ', più ', h('strong', { text: fmtEur(extra) }), ` ${extraWhat}`] : []];
  const first = plan.targets[0].label, last = plan.targets[T - 1].label;
  const budgetMode = plan.budget != null;
  const perRung = T ? atTargets / T : 0;
  const hero = h('section', { class: 'card hero' },
    budgetMode
      ? h('div', null, h('div', { class: 'hero-figure' }, fmtEur(perRung), h('small', { text: `circa, per ${c.schedule === 'semester' ? 'semestre' : 'anno'}` })),
          h('p', { class: 'hero-line' }, 'Investendo ', h('strong', { text: fmtEur(plan.totalCost) }), ` ricevi ${T} somme dal ${first} al ${last}, per un totale di `, h('strong', { text: fmtEur(atTargets) }), ' netti', extraLine, '.'))
      : h('div', null, h('div', { class: 'hero-figure' }, fmtEur(plan.totalCost), h('small', { text: 'da investire oggi' })),
          h('p', { class: 'hero-line' }, 'Per avere ', h('strong', { text: fmtEur(plan.targets.reduce((s, t) => s + t.amount, 0)) }), ` in ${T} ${T === 1 ? 'scadenza' : 'scadenze'} (${first === last ? first : first + ' → ' + last}) ricevi `, h('strong', { text: fmtEur(atTargets) }), ' netti alle scadenze', extraLine, '.')),
    h('div', { class: 'kpis' },
      kpi('Rendimento netto', fmtPct(plan.irr * 100), 'annuo, dai flussi netti'),
      kpi('Guadagno netto', fmtSigned(received - plan.totalCost), 'incassi − investimento'),
      kpi('Scadenze coperte', `${covered}/${T}`, covered === T ? 'tutte' : `${T - covered} senza titolo`),
      kpi('Duration media', fmtNum(plan.summary.duration, 1), 'anni (modificata)'),
      kpi('Titoli', String(plan.positions.length), `${plan.summary.byIssuer.length} emittenti`)),
    actionsBar());

  const ins = [];
  if (covered === T) ins.push(insight('good', `Tutte le ${T} scadenze sono coperte.`));
  if (plan.useCoupons) {
    const cp = plan.targets.reduce((s, t) => s + t.coupons, 0), tot = plan.targets.reduce((s, t) => s + t.available, 0);
    const pct = v => fmtNum(v / tot * 100, 0) + '%';
    if (tot > 0) ins.push(insight('info', `Le cedole coprono il ${pct(cp + potUsed)} degli importi${potUsed > 0.5 ? ` (${pct(cp)} quelle del periodo, ${pct(potUsed)} quelle accantonate)` : ''}: per questo serve meno capitale dei ${fmtEur(plan.targets.reduce((s, t) => s + t.amount, 0))} da ricevere.`));
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
  if (!budgetMode && surplus > 0.03 * plan.targets.reduce((s, t) => s + t.amount, 0)) ins.push(insight('info', `Arrotondando ai lotti minimi ricevi ${fmtEur(surplus)} in più del necessario in totale.`));
  ins.push(...commonInsights(plan, result));

  // Grafico della scala
  const chartBox = h('div');
  const pooledUsed = plan.accumulate && plan.targets.some(t => t.fromPot > 0.5);
  const labels = plan.targets.map(t => t.label.length > 12 ? t.label.slice(0, 11) + '…' : t.label);
  requestAnimationFrame(() => columnChart(chartBox, {
    labels, height: 250, yFormat: v => v >= 1000 ? `${fmtNum(v / 1000, 0)}k` : fmtNum(v, 0),
    series: [{ cls: 's1', values: plan.targets.map(t => t.redemption) }, { cls: 's2', values: plan.targets.map(t => plan.useCoupons ? t.coupons : 0) },
      ...(pooledUsed ? [{ cls: 's3', values: plan.targets.map(t => t.fromPot) }] : [])],
    target: plan.targets.map(t => t.amount), ariaLabel: 'Importo disponibile per ogni scadenza',
    tooltip: i => { const t = plan.targets[i]; return { title: t.label, rows: [
      { key: 'series-1', label: 'Rimborso', value: fmtEur(t.redemption) }, { key: 'series-2', label: 'Cedole', value: fmtEur(plan.useCoupons ? t.coupons : 0) },
      ...(pooledUsed ? [{ key: 'series-3', label: 'Accantonate', value: fmtEur(t.fromPot) }] : []),
      { label: 'Disponibile', value: fmtEur(t.available) }, { label: 'Obiettivo', value: fmtEur(t.amount) }], note: t.bond ? t.bond.desc : 'Nessun titolo' }; },
    onClick: i => { const el = document.getElementById('rung-' + i); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }));
  const ladderCard = card('La tua scala', 'quanto ricevi a ogni scadenza', [
    legend([{ key: 'series-1', label: 'Rimborso del titolo' }, { key: 'series-2', label: plan.useCoupons ? 'Cedole incassate nel periodo' : 'Cedole (non usate)' },
      ...(pooledUsed ? [{ key: 'series-3', label: 'Cedole accantonate' }] : []), { type: 'line', label: 'Obiettivo' }]), chartBox]);

  // Gradini
  const rungs = h('div', { class: 'rungs' }, plan.targets.map((t, i) => rungCard(t, i, plan, c)));

  const sel = new Set(plan.positions.map(p => p.bond.isin));
  const bands = plan.targets.map(t => ({ from: t.start, to: t.end, label: t.label }));
  const bandOf = p => plan.targets.findIndex(t => p.maturity > t.start && p.maturity <= t.end);
  const map = yieldMapCard(result, sel, bands, p => { const i = bandOf(p); if (i >= 0 && !sel.has(p.isin) && A.onSwap) A.onSwap(plan.targets[i].label, p.isin); }, p => bandOf(p) >= 0 && !sel.has(p.isin));

  return [hero, ins.length ? h('div', { class: 'insights' }, ins) : null, ladderCard,
    card('Scadenze e titoli', `${plan.positions.length} titoli · puoi cambiare ogni scelta`, rungs), map,
    plan.schedule.length ? calendarCard(plan.schedule) : null, plan.positions.length ? purchaseCard(plan.positions, plan.settle) : null].filter(Boolean);
}

function rungCard(t, i, plan, c) {
  const when = t.need != null ? `${t.label} · entro il ${fmt(t.need)}` : t.label;
  const status = !t.bond && t.available < 0.5 ? h('span', { class: 'rung-status short', text: 'scoperta' })
    : t.available + 0.5 >= t.amount ? h('span', { class: 'rung-status ok', text: `✓ ${fmtEur(t.available)}` })
      : h('span', { class: 'rung-status short', text: `${fmtEur(t.available)} (${fmtSigned(t.available - t.amount)})` });
  const head = h('div', { class: 'rung-head' }, h('span', { class: 'rung-when', text: when }),
    h('span', { class: 'rung-goal', text: `obiettivo ${fmtEur(t.amount)}` }), status);
  if (!t.bond) {
    const pot = t.fromPot > 0.5 ? (t.available + 0.5 >= t.amount
      ? `Nessun titolo del paniere scade qui, ma le cedole accantonate (${fmtEur(t.fromPot)}) coprono l'obiettivo.`
      : `Le cedole accantonate ne coprono ${fmtEur(t.fromPot)}. `) : '';
    if (pot && t.available + 0.5 >= t.amount) return h('div', { class: 'rung', id: 'rung-' + i }, head, h('div', { class: 'rung-empty', text: pot }));
    return h('div', { class: 'rung', id: 'rung-' + i }, head, h('div', { class: 'rung-empty' }, pot,
      t.candidates.length ? 'Ci sono titoli in questo periodo ma il limite per emittente ne impedisce l\'uso: allenta la quota massima.'
        : t.need != null ? 'Nessun titolo del paniere scade in questa finestra: aumenta la flessibilità o allarga il paniere (rating, emittenti, prezzo).'
          : 'Nessun titolo del paniere scade in questo periodo: allarga il paniere (rating, emittenti, prezzo) o la liquidità minima.'));
  }
  const b = t.bond, cost = t.nominal * b.cost / 100;
  if (!t.nominal) {
    const byCoupons = t.available + 0.5 >= t.amount;
    const paid = t.fromPot > 0.5 ? `Le cedole accantonate (${fmtEur(t.fromPot)})${t.coupons > 0.5 ? ` e quelle del periodo (${fmtEur(t.coupons)})` : ''}`
      : `Le cedole incassate in questo periodo (${fmtEur(t.coupons)})`;
    return h('div', { class: 'rung', id: 'rung-' + i }, head, h('div', { class: 'rung-empty' },
      h('div', { text: byCoupons ? `${paid} coprono già l'obiettivo: non serve comprare un titolo.`
        : plan.budget != null ? `Il capitale non basta per il lotto minimo di ${b.desc} (${fmtNum(b.lot, 0)} di nominale): scegli un titolo con un lotto più piccolo o aumenta il capitale.`
          : `${b.desc} non scade in questo periodo: scegli un altro titolo.` }),
      h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } },
        byCoupons ? null : h('button', { class: 'btn btn-ghost btn-sm', on: { click: () => A.onAlternatives && A.onAlternatives(t, i) } }, icon('swap'), 'Cambia'),
        t.fixed ? h('button', { class: 'btn btn-ghost btn-sm', on: { click: () => A.onUnfix && A.onUnfix(t.label) } }, 'Automatico') : null)));
  }
  const tot = Math.max(1, t.redemption + (plan.useCoupons ? t.coupons : 0) + (t.fromPot || 0));
  const extra = t.fixed ? [h('span', { class: 'tag accent', text: 'scelto da te' })] : [];
  const rank = t.candidates.findIndex(x => x.bond.isin === b.isin);
  // Perché non il primo? Di solito perché i migliori sono di emittenti già al limite di quota.
  const better = rank > 0 ? [...new Set(t.candidates.slice(0, rank).map(x => x.bond.issuerName))] : [];
  const why = rank > 0 && !t.fixed && plan.issuerCap < 1 ? ` · i più redditizi (${better.slice(0, 3).join(', ')}) sono di emittenti già al limite di quota` : '';
  return h('div', { class: 'rung', id: 'rung-' + i }, head,
    h('div', { class: 'bond' }, h('div', null, bondMain(b), h('div', { class: 'bond-meta', style: { marginTop: '6px' } }, extra,
      h('span', { class: 'faint', text: rank === 0 ? `Il migliore fra ${t.candidates.length} titoli della finestra` : rank > 0 ? `${rank + 1}° per rendimento fra ${t.candidates.length}${why}` : '' }))),
      h('div', { class: 'bond-buy' },
        h('span', { class: 'small', text: 'Nominale da comprare' }), h('span', { class: 'big', text: fmtEur(t.nominal) }),
        h('span', { class: 'small', text: `costo ≈ ${fmtEur(cost)}` }),
        t.fromPot > 0.5 ? h('span', { class: 'small', text: `+ ${fmtEur(t.fromPot)} dalle cedole accantonate` }) : null,
        h('div', { class: 'compo', title: `rimborso ${fmtEur(t.redemption)} + cedole ${fmtEur(t.coupons)}${t.fromPot > 0.5 ? ` + accantonate ${fmtEur(t.fromPot)}` : ''}` },
          h('span', { class: 'c1', style: { width: `${t.redemption / tot * 100}%` } }), plan.useCoupons && t.coupons > 0 ? h('span', { class: 'c2', style: { width: `${t.coupons / tot * 100}%` } }) : null,
          t.fromPot > 0.5 ? h('span', { class: 'c3', style: { width: `${t.fromPot / tot * 100}%` } }) : null),
        h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
          h('button', { class: 'btn btn-ghost btn-sm', on: { click: () => A.onAlternatives && A.onAlternatives(t, i) } }, icon('swap'), 'Cambia'),
          t.fixed ? h('button', { class: 'btn btn-ghost btn-sm', on: { click: () => A.onUnfix && A.onUnfix(t.label) } }, 'Automatico') : null))));
}

/* ---------------------------- Rendita mensile ---------------------------- */
function incomeView(st, result, plan) {
  if (plan.empty) return [h('div', { class: 'card card-pad insights' }, (plan.warnings || []).map(w => insight('warn', w)))];
  const avg = plan.annual / 12;
  const target = plan.monthlyTarget;
  const hero = h('section', { class: 'card hero' },
    h('div', null, h('div', { class: 'hero-figure' }, fmtEur(avg), h('small', { text: 'al mese, netti (media)' })),
      h('p', { class: 'hero-line' },
        target ? ['Per avere almeno ', h('strong', { text: fmtEur(target) }), ' ogni mese servono ', h('strong', { text: fmtEur(plan.totalCost) }), `. Con ${plan.positions.length} titoli le cedole arrivano`]
          : ['Investendo ', h('strong', { text: fmtEur(plan.totalCost) }), ` in ${plan.positions.length} titoli le cedole arrivano`],
        ` in ${plan.coveredMonths} mesi su 12: da un minimo di `, h('strong', { text: fmtEur(plan.minMonth) }), ' a un massimo di ', h('strong', { text: fmtEur(plan.maxMonth) }), ' al mese.')),
    h('div', { class: 'kpis' },
      kpi('Rendita annua netta', fmtEur(plan.annual), 'solo cedole'),
      kpi('Regolarità', fmtPct(plan.regularity * 100, 0), 'mese più basso / media'),
      kpi('Rendimento netto', fmtPct(plan.irr * 100), 'annuo, cedole + rimborsi'),
      kpi('Duration media', fmtNum(plan.summary.duration, 1), 'anni (modificata)'),
      kpi('Liquidità residua', fmtEur(plan.cash), 'non investita (lotti)')),
    actionsBar());

  const ins = [];
  if (plan.coveredMonths === 12) ins.push(insight('good', 'Cedole in tutti i 12 mesi dell\'anno.'));
  ins.push(insight('info', `Il capitale torna man mano: ${plan.capitalByYear.map(([y, v]) => `${y} ${fmtEur(v)}`).join(' · ')}.`));
  ins.push(...commonInsights(plan, result));

  const monthsBox = h('div');
  const payers = MONTHS.map((_, m) => plan.positions.filter(p => p.months.includes(m + 1)));
  requestAnimationFrame(() => columnChart(monthsBox, {
    labels: MONTHS, height: 240, yFormat: v => fmtNum(v, 0), average: avg, averageLabel: `media ${fmtEur(avg)}`,
    series: [{ cls: 's1', values: plan.monthly }], ariaLabel: 'Cedole nette per mese',
    tooltip: m => ({ title: `${MONTHS_LONG[m]}: ${fmtEur(plan.monthly[m])}`, rows: payers[m].map(p => ({ label: p.bond.desc.length > 30 ? p.bond.desc.slice(0, 29) + '…' : p.bond.desc, value: fmtEur(p.netPerPayment) })), note: payers[m].length ? null : 'Nessuna cedola' })
  }));

  const capBox = h('div');
  requestAnimationFrame(() => columnChart(capBox, {
    labels: plan.capitalByYear.map(([y]) => String(y)), height: 200, yFormat: v => v >= 1000 ? `${fmtNum(v / 1000, 0)}k` : fmtNum(v, 0),
    series: [{ cls: 's1', values: plan.capitalByYear.map(([, v]) => v) }], ariaLabel: 'Capitale rimborsato per anno',
    tooltip: i => { const y = plan.capitalByYear[i][0]; const ps = plan.positions.filter(p => parts(p.bond.maturity).y === y);
      return { title: `${y}: ${fmtEur(plan.capitalByYear[i][1])}`, rows: ps.map(p => ({ label: fmtMonthYear(p.bond.maturity) + ' · ' + p.bond.issuerName, value: fmtEur(p.nominal) })) }; }
  }));

  const list = h('div', { class: 'rungs' }, plan.positions.map(p => h('div', { class: 'rung' },
    h('div', { class: 'bond' }, h('div', null, bondMain(p.bond),
      h('div', { class: 'months', style: { marginTop: '6px' } }, p.months.map(m => h('span', { text: MONTHS[m - 1] })))),
      h('div', { class: 'bond-buy' },
        h('span', { class: 'small', text: 'Nominale da comprare' }), h('span', { class: 'big', text: fmtEur(p.nominal) }),
        h('span', { class: 'small', text: `costo ≈ ${fmtEur(p.cost)} · ${fmtNum(p.cost / plan.totalCost * 100, 0)}%` }),
        h('span', { class: 'small', text: `cedola netta per stacco ${fmtEur(p.netPerPayment)}` }),
        h('button', { class: 'btn btn-ghost btn-sm', title: 'Togli questo titolo e ricalcola', on: { click: () => A.onExclude && A.onExclude(p.bond.isin, p.bond.desc) } }, 'Escludi'))))));

  const sel = new Set(plan.positions.map(p => p.bond.isin));
  return [hero, h('div', { class: 'insights' }, ins),
    card('Cedole nette, mese per mese', 'anno tipo, dopo le tasse', [monthsBox]),
    card('I titoli', `${plan.positions.length} titoli · ordinati per scadenza`, list),
    card('Capitale che torna', 'rimborsi netti per anno', [capBox]),
    yieldMapCard(result, sel, [], null, null),
    calendarCard(plan.schedule), purchaseCard(plan.positions, plan.settle)];
}
