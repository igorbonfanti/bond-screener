/* Risultati della modalità «Affitto indicizzato» (passività indicizzata): la scala di titoli che paga un affitto che
   cresce con l'inflazione. Nessun calcolo finanziario qui: solo lettura del piano prodotto dal motore
   (src/core/alm-plan.js) e dei confronti (src/engine-indexed.js). Le divisioni per il deflatore servono solo a
   mostrare gli «euro di oggi». */
import { h, s as svg, fmtEur, fmtPct, fmtNum, copyText, toast, downloadFile, MINUS } from './dom.js';
import { columnChart, legend } from './charts.js';
import { kpi, insight, notesPanel, panel, miniBtn, dataTable, calendarPanel } from './results.js';
import { fmt } from '../core/dates.js';

const eur0 = v => fmtNum(v, 0);
const isoFmt = x => { const t = Date.parse(x); return Number.isFinite(t) ? fmt(Math.floor(t / 864e5)) : '—'; };
const csvNum = (n, dec) => fmtNum(n, dec).replace(MINUS, '-');
const TYPE = { NOM: 'nominale', BTPEI: 'BTP€i', BTPITALIA: 'BTP Italia' };
const INDEX = { HICP: 'HICP area euro', FOI: 'FOI Italia', nominale: 'nessuno (tasso fisso)' };
const dueLabel = r => r.half ? `${r.half === 1 ? '1/1' : '1/7'}/${r.year}` : String(r.year);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const span = (a, b) => (a === b ? `nel ${a}` : `dal ${a} al ${b}`);
const cleanDesc = d => d.replace(/\s*\(senza indicizzazione\)/i, '');
/** Rate scoperte in uno scenario: quante, dalla prima, e il capitale che manca oggi. */
const gapText = (sm, rows) => {
  const n = sm.bal.filter(v => v < -0.5).length;
  return `${plural(n, 'rata scoperta', 'rate scoperte')} su ${rows.length}, dalla ${dueLabel(sm.first)}`;
};
/** +1 se la scala a importo fisso regge peggio di quella indicizzata nello scenario, −1 se meglio, 0 se uguale:
    conta il capitale che mancherebbe oggi per pagare tutte le rate. */
const cmpFlat = (ours, flat) => {
  if (!ours || !flat) return 0;
  const a = ours.extra || 0, b = flat.extra || 0;
  return Math.abs(a - b) <= Math.max(50, 0.01 * Math.max(a, b)) ? 0 : b > a ? 1 : -1;
};
const view = { scen: 'base', real: false };          // scelte dell'utente nella vista, tenute fra un ricalcolo e l'altro

export function renderIndexed(st, result, A) {
  const plan = result.plan;
  if (plan.empty) return [notesPanel((plan.warnings || ['Nessuna scala possibile con queste impostazioni.']).map(w => insight('warn', w)))];
  const cfg = plan.cfg;
  if (!plan.positions.length)
    return [notesPanel([insight('bad', 'Nessun titolo rispetta insieme filtri e vincoli: la «scala» sarebbe solo liquidità sul conto XEON. Allarga il paniere (emittenti, rating) o allenta quota minima di indicizzati e tetti.'),
      ...(plan.notes || []).map(n => insight('warn', n))])];
  if (!plan.byScen[view.scen]) view.scen = 'base';
  const base = plan.byScen.base, simB = plan.sims.base;
  const N = base.length, perYear = cfg.schedule === 'semester' ? 2 : 1;
  const lam = plan.lam;
  const first = base[0], last = base[N - 1];
  const scen = plan.scen;
  const covered = scen.filter(s => !plan.sims[s.id].first);
  const maxscale = cfg.mode === 'maxscale', maxhor = cfg.mode === 'maxhorizon';

  /* ---------------- fila di KPI e frase ---------------- */
  const kpis = h('div', { class: 'kpis' },
    kpi(maxscale || maxhor ? 'Capitale usato' : 'Capitale da investire', fmtEur(plan.totalCost),
      `${fmtEur(plan.bondCost)} in titoli · ${fmtEur(plan.cash0)} sul conto XEON`),
    maxscale
      ? kpi('Affitto sostenibile', fmtEur(lam * cfg.L0), `il primo anno · ${fmtNum(lam * 100, 0)}% di ${fmtEur(cfg.L0)}`)
      : kpi('Coperto fino al', String(plan.horizon), maxhor && plan.horizon < cfg.yearTo ? `chiesto fino al ${cfg.yearTo}` : `${plural(N, 'rata', 'rate')} ${span(first.year, plan.horizon)}`),
    kpi('Prima e ultima rata', `${eur0(first.need)} → ${eur0(last.need)}`, `€ nominali, scenario base · ${eur0(last.need / last.defl)} € di oggi`),
    kpi('Quota indicizzata', fmtPct(plan.linkerShare * 100, 0), `${plan.positions.filter(p => p.type !== 'NOM').length} indicizzati su ${plural(plan.positions.length, 'titolo', 'titoli')}`),
    kpi('Rendimento netto', fmtPct(plan.irr * 100), `scenario base · incassi in media fra ${fmtNum(plan.duration, 1)} anni`),
    kpi('Scenari coperti', String(covered.length), covered.length === scen.length ? 'tutti' : `scoperti: ${scen.filter(s => plan.sims[s.id].first).map(s => s.label).join(', ')}`, `/ ${scen.length}`));

  const lead = h('p', { class: 'lead' },
    'Con ', h('b', { text: fmtEur(plan.totalCost) }), ' oggi paghi ',
    maxscale ? ['un affitto di ', h('b', { text: fmtEur(lam * cfg.L0) }), ` il primo anno`] : ['l\'affitto'],
    ` ${span(first.year, plan.horizon)}, che cresce con l'inflazione ${cfg.liabIndex === 'HICP' ? 'europea (HICP)' : 'italiana (FOI)'}`,
    cfg.realSpread ? ` più ${fmtNum(cfg.realSpread * 100, 1)}% l'anno` : '',
    ': da ', h('b', { text: fmtEur(first.need) }), ' a ', h('b', { text: fmtEur(last.need) }), ' nello scenario base. ',
    simB.first ? `Nello scenario base: ${gapText(simB, base)}.` : `Alla fine restano ${fmtEur(simB.bal[N - 1])} sul conto XEON nello scenario base.`);

  /* ---------------- grafico: da dove arriva ogni rata ---------------- */
  const chartBox = h('div');
  const scenSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Scenario d\'inflazione mostrato' });
  const unitSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Unità degli importi' });
  const tableBox = h('div');
  const tableMeta = h('span', { class: 'meta' });
  function draw() {
    const rows = plan.byScen[view.scen], d = r => view.real ? r.defl : 1;
    // ogni colonna è l'affitto: la parte pagata da rimborsi e cedole arrivati nel periodo e quella presa dalla liquidità.
    // Quello che avanza (p. es. un grosso rimborso) va in liquidità: è nel riquadro e nella tabella, non allunga la colonna.
    // Se il conto non basta (scenario scoperto) la parte che manca è «non pagata», non presa dal conto.
    const parts3 = rows.map(r => {
      const red = Math.max(0, r.red) / d(r), cpn = Math.max(0, r.cpn) / d(r), need = r.need / d(r), bal = r.bal / d(r);
      const a = Math.min(red, need), b = Math.min(cpn, need - a), rest = need - a - b;
      const cash = Math.min(rest, Math.max(0, bal + rest));
      return { red, cpn, a, b, cash, unpaid: rest - cash, extra: Math.max(0, red + cpn - need), need, bal };
    });
    const anyUnpaid = parts3.some(p => p.unpaid > 0.5);
    scenSeg.replaceChildren(...scen.map(s => h('button', { type: 'button', 'aria-pressed': String(s.id === view.scen), text: s.label,
      on: { click: () => { view.scen = s.id; draw(); } } })));
    unitSeg.replaceChildren(...[[false, '€ nominali'], [true, '€ di oggi']].map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(v === view.real), text: t,
      on: { click: () => { view.real = v; draw(); } } })));
    columnChart(chartBox, {
      labels: rows.map(dueLabel), height: 260, yFormat: v => fmtNum(v, 0),
      series: [{ cls: 's1', values: parts3.map(p => p.a) }, { cls: 's2', values: parts3.map(p => p.b) }, { cls: 's3', values: parts3.map(p => p.cash) },
        ...(anyUnpaid ? [{ cls: 's-unpaid', values: parts3.map(p => p.unpaid) }] : [])],
      target: parts3.map(p => p.need),
      ariaLabel: `Affitto di ogni scadenza e da dove arriva, scenario ${scen.find(s => s.id === view.scen).label}`,
      tooltip: i => { const r = rows[i], p = parts3[i]; return { title: `Rata ${dueLabel(r)}`, meta: view.real ? '€ di oggi' : '€ nominali', rows: [
        { key: 'ink', label: 'Rimborsi', value: fmtEur(p.red) }, { key: 'chart-trail', label: 'Cedole', value: fmtEur(p.cpn) },
        { key: 'chart-line', label: 'Dal conto XEON', value: fmtEur(p.cash) },
        ...(p.unpaid > 0.5 ? [{ label: 'Non pagato', value: fmtEur(p.unpaid) }] : []),
        { key: 'blue', label: 'Affitto', value: fmtEur(p.need) },
        { label: 'Avanzo messo sul conto', value: fmtEur(p.extra) },
        { label: 'Conto XEON dopo la rata', value: fmtEur(p.bal) }] }; }
    });
    tableMeta.textContent = `scenario ${scen.find(s => s.id === view.scen).label} · ${view.real ? '€ di oggi' : '€ nominali'}`;
    tableBox.replaceChildren(dueTable(rows, d, plan.cash0));
    legendBox.replaceChildren(legend([{ key: 'ink', label: 'pagato con rimborsi' }, { key: 'chart-trail', label: 'pagato con cedole nette' }, { key: 'chart-line', label: 'pagato dal conto XEON' },
      ...(anyUnpaid ? [{ el: h('span', { class: 'kb unpaid' }), label: 'non pagato: il conto è vuoto' }] : []),
      { type: 'line', key: 'blue', label: 'affitto da pagare' },
      { type: 'text', label: view.real ? '€ di oggi: importi divisi per l\'inflazione da oggi alla data della rata (scenario mostrato)' : 'rimborsi e cedole arrivati dopo la rata precedente; l\'avanzo va sul conto XEON e paga le rate dopo' }]));
  }
  const legendBox = h('div');
  const ladder = panel('Da dove arriva ogni rata', h('span', { class: 'ph-end' }, scenSeg, unitSeg), chartBox, legendBox);
  requestAnimationFrame(draw);

  /* ---------------- osservazioni ---------------- */
  const ins = [];
  if (covered.length === scen.length) ins.push(insight('good', `La scala regge in tutti e ${scen.length} gli scenari d'inflazione simulati.`));
  for (const s of scen) {
    const sm = plan.sims[s.id];
    if (sm.first) ins.push(insight(s.robust ? 'bad' : 'warn', `Scenario «${s.label}»: ${gapText(sm, plan.byScen[s.id])}. Per coprirlo servirebbero ${fmtEur(sm.extra)} in più oggi${s.robust ? '' : ' (non è fra gli scenari da coprire per forza)'}.`));
  }
  if (cfg.minLinker > 0 && plan.linkerShare < cfg.minLinker - 0.01)
    ins.push(insight('bad', `Quota indicizzata ${fmtPct(plan.linkerShare * 100, 0)}, sotto il minimo chiesto (${fmtPct(cfg.minLinker * 100, 0)}): i vincoli non si possono rispettare insieme con questo paniere.`));
  if (plan.relaxedCost != null && plan.totalCost - plan.relaxedCost > 50)
    ins.push(insight('info', `Comprare a lotti interi costa ${fmtEur(plan.totalCost - plan.relaxedCost)} in più della scala ideale «a pezzi».`));
  if (plan.linkersInUniverse > 0 && plan.linkerShare < 0.3 && cfg.minLinker === 0) {
    const missing = ['alto', 'shock'].filter(id => !cfg.robust.includes(id)).map(id => `«${scen.find(s => s.id === id)?.label || id}»`);
    ins.push(insight('info', `Gli indicizzati pesano poco: la scala regge meno se l'inflazione sale. ${missing.length ? `Aggiungi ${missing.join(' e ')} agli scenari da coprire` : 'Prova a chiedere una «Quota minima di indicizzati»'}.`));
  }
  if (result.flat) {
    const better = scen.filter(s => cmpFlat(plan.sims[s.id], result.flat.sims[s.id]) > 0).map(s => `«${s.label}»`);
    const worse = scen.filter(s => cmpFlat(plan.sims[s.id], result.flat.sims[s.id]) < 0).map(s => `«${s.label}»`);
    ins.push(insight('info', `Con lo stesso capitale, una scala a importo fisso (${fmtEur(result.flat.perYear)} l'anno, sempre uguali) ${better.length ? `regge peggio negli scenari ${better.join(', ')}` : 'non regge peggio in nessuno scenario'}${worse.length ? ` e meglio in ${worse.join(', ')}` : ''}: vedi la prova di stress.`));
  }
  for (const n of plan.notes || []) ins.push(insight('info', n));
  if (result.basketCount < 10) ins.push(insight('warn', `Solo ${result.basketCount} titoli rispettano i filtri: allarga il paniere.`));

  const bar = h('div', { class: 'actions' },
    miniBtn('Condividi il link', () => A.onShare && A.onShare()), miniBtn('Stampa', () => window.print()));
  return [kpis, lead, bar,
    h('div', { class: 'grid-side' }, ladder, notesPanel(ins)),
    stressPanel(plan, result),
    result.mc ? mcPanel(result.mc, plan) : null,
    panel('Rata per rata', tableMeta, tableBox),
    compositionPanel(plan),
    cashPanel(plan, result),
    plan.calendar.length ? calendarPanel(plan.calendar, 'scenario base · euro netti, mese per mese') : null,
    purchasePanel(plan),
    assumptionsPanel(plan, result)].filter(Boolean);
}

/* ---------------- tabella delle rate ---------------- */
function dueTable(rows, d, cash0) {
  // interessi netti del conto XEON nel periodo: quello che fa tornare il saldo (saldo prima + entrate − affitto)
  const it = rows.map((r, k) => r.bal - (k ? rows[k - 1].bal : cash0) - r.red - r.cpn - r.cost + r.need);
  const idx = new Map(rows.map((r, k) => [r, k]));
  return dataTable({
    label: 'Rate dell\'affitto e flussi della scala',
    cols: [
      { label: 'Rata', sort: r => r.due, cell: r => h('span', { class: 'num', text: dueLabel(r) }) },
      { label: 'Affitto', r: 1, sort: r => r.need, cell: r => eur0(r.need / d(r)) },
      { label: 'Rimborsi', r: 1, sort: r => r.red, cell: r => eur0(r.red / d(r)) },
      { label: 'Cedole nette', r: 1, sort: r => r.cpn, cell: r => eur0(r.cpn / d(r)) },
      { label: 'Bollo e tasse', r: 1, sort: r => r.cost, cell: r => eur0(r.cost / d(r)) },
      { label: 'Interessi XEON', r: 1, sort: r => it[idx.get(r)], cell: r => eur0(it[idx.get(r)] / d(r)) },
      { label: 'Conto XEON dopo', r: 1, sort: r => r.bal, cell: r => h('span', { class: r.bal < -0.5 ? 'neg' : null, text: eur0(r.bal / d(r)) }) }],
    rows
  });
}

/* ---------------- prova di stress ---------------- */
function stressPanel(plan, result) {
  const N = plan.byScen.base.length;
  const flat = result.flat;
  const rows = plan.scen.map(s => ({ s, sm: plan.sims[s.id], rows: plan.byScen[s.id], fl: flat && flat.sims[s.id] }));
  const table = dataTable({
    label: 'La scala in ogni scenario d\'inflazione',
    cols: [
      { label: 'Scenario', cell: x => [h('b', { text: x.s.label }), ' ', x.s.robust ? h('span', { class: 'tags' }, h('span', { class: 'tag', title: 'Scenario da coprire per forza (vincolo dell\'ottimizzazione)', text: 'da coprire' })) : null] },
      { label: 'Ultima rata', r: 1, sort: x => x.rows[N - 1].need, cell: x => eur0(x.rows[N - 1].need) },
      { label: 'Esito', cell: x => x.sm.first ? h('span', { class: 'neg', text: gapText(x.sm, x.rows) }) : 'tutte pagate' },
      { label: 'Conto XEON alla fine', r: 1, sort: x => x.sm.bal[N - 1], cell: x => eur0(x.sm.bal[N - 1]) },
      { label: 'Capitale che manca', r: 1, sort: x => x.sm.extra, cell: x => x.sm.extra > 0.5 ? eur0(x.sm.extra) : '—' },
      ...(flat ? [{ label: 'Scala a importo fisso', cell: x => {
        if (!x.fl) return '—';
        const t = x.fl.first ? `scoperta dalla ${dueLabel(x.fl.first)}, mancano ${eur0(x.fl.extra)} €` : 'tutte pagate';
        const c = cmpFlat(x.sm, x.fl);
        return [t, c ? h('span', { class: 'tags' }, h('span', { class: 'tag', text: c > 0 ? 'regge peggio' : 'regge meglio' })) : null];
      } }] : [])],
    rows
  });
  return panel('Prova di stress', flat ? `stesso capitale · confronto con una scala a importo fisso di ${fmtEur(flat.perYear)} l'anno` : 'stesso capitale in ogni scenario', table,
    h('p', { class: 'note', text: '«Capitale che manca» è quanto andrebbe aggiunto oggi sul conto XEON per pagare tutte le rate in quello scenario. Gli scenari: inflazione base (impostata da te), alta 3,5% e bassa 1% ogni anno, shock 8% → 5% nei primi anni, FOI che supera l\'HICP di 0,5 punti.' }));
}

/* ---------------- composizione ---------------- */
function compositionPanel(plan) {
  const block = (title, rows, label = k => k) => h('div', { class: 'tscroll' }, h('table', { class: 't', 'aria-label': `Composizione per ${title.toLowerCase()}` },
    h('thead', null, h('tr', null, h('th', { scope: 'col', text: title }), h('th', { class: 'r', scope: 'col', text: 'Euro' }), h('th', { class: 'r', scope: 'col', text: 'Quota' }))),
    h('tbody', null, rows.map(r => h('tr', null, h('td', { text: label(r.k) }), h('td', { class: 'num r', text: eur0(r.v) }), h('td', { class: 'num r', text: fmtPct(r.share * 100, 0) }))))));
  return panel('Composizione', 'sul costo dei titoli',
    h('div', { class: 'grid-3' }, block('Indice', plan.byIndex, k => INDEX[k] || k), block('Emittente', plan.byIssuer), block('Rating', plan.byRating)));
}

/* ---------------- liquidità: XEON o BOT ---------------- */
function cashPanel(plan, result) {
  const c = result.cash;
  if (!c) return null;
  const rows = plan.byScen.base;
  // periodi con liquidità ferma (dopo una rata, fino alla successiva) e titoli brevi che rendono più di XEON
  const idle = rows.map((r, k) => ({ from: r.due, to: rows[k + 1] ? rows[k + 1].due : null, bal: r.bal })).filter(x => x.to && x.bal > 2000);
  const better = (c.shorts || []).filter(b => b.netAfterBollo > c.xeon * 100 + 0.05);
  const avg = idle.length ? idle.reduce((s, x) => s + x.bal, 0) / idle.length : 0;
  const items = [
    insight('info', `Cedole e rimborsi che arrivano prima che servano restano su un conto in un ETF monetario tipo XEON: rende circa ${fmtPct(c.xeon * 100)} netto l'anno (€STR ${fmtPct(c.estr * 100)} + 0,085% − costi 0,10%, tassato al 26%, meno bollo 0,2%).`),
    idle.length ? insight('info', `Nello scenario base sul conto restano soldi fermi fra una rata e l'altra in ${plural(idle.length, 'periodo', 'periodi')}, in media ${fmtEur(avg)}.`) : insight('good', 'Nello scenario base fra una rata e l\'altra sul conto non restano somme importanti.'),
    better.length
      ? insight('warn', `Oggi ${better.length === 1 ? 'un titolo di Stato in scadenza entro un anno rende' : `${better.length} titoli di Stato in scadenza entro un anno rendono`} più di XEON (rendimento netto meno bollo): ${better.slice(0, 3).map(b => `${b.desc} → ${fmtPct(b.netAfterBollo)}`).join('; ')}. Per i soldi che servono entro un anno può convenire un BOT o un titolo simile.`)
      : insight('good', 'Oggi nessun titolo di Stato in scadenza entro un anno rende più di XEON al netto di tasse e bollo.')];
  return panel('Conto XEON o BOT', `€STR ${fmtPct(c.estr * 100)} · dato del ${isoFmt(c.estrDate)}`,
    h('div', { class: 'pb prose' }, items.map(it => h('p', { class: it.kind === 'warn' ? 'hl' : null, text: it.text }))));
}

/* ---------------- lista d'acquisto ---------------- */
function purchasePanel(plan) {
  const rows = plan.positions.slice();
  const tot = rows.reduce((s, p) => s + p.cost, 0), totN = rows.reduce((s, p) => s + p.nominal, 0);
  const csv = () => {
    const head = ['ISIN', 'Titolo', 'Tipo', 'Scadenza', 'Nominale', 'Prezzo (reale per gli indicizzati)', 'CI al regolamento', 'Controvalore stimato'];
    const lines = rows.map(p => [p.b.isin, p.b.desc, TYPE[p.type] || p.type, fmt(p.b.maturity), csvNum(p.nominal, 0), csvNum(p.b.price, 3), p.ciSettle ? csvNum(p.ciSettle, 5) : '', csvNum(p.cost, 2)]);
    return '﻿' + [head, ...lines].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  };
  const table = dataTable({
    label: 'Lista d\'acquisto', sortBy: 2,
    cols: [
      { label: 'Titolo', sort: p => p.b.desc, cell: p => [h('span', { class: 'sym', text: p.b.isin }), h('span', { class: 'nm', text: cleanDesc(p.b.desc) })] },
      { label: 'Tipo', sort: p => p.type, cell: p => TYPE[p.type] || p.type },
      { label: 'Scadenza', sort: p => p.b.maturity, cell: p => h('span', { class: 'num', text: fmt(p.b.maturity) }) },
      { label: 'Nominale', r: 1, sort: p => p.nominal, cell: p => eur0(p.nominal) },
      { label: 'Prezzo', r: 1, sort: p => p.b.price, cell: p => fmtNum(p.b.price, 2) },
      { label: 'CI', r: 1, sort: p => p.ciSettle || 0, cell: p => p.ciSettle && p.type !== 'NOM' ? fmtNum(p.ciSettle, 5) : '—' },
      { label: 'Controvalore', r: 1, sort: p => p.cost, cell: p => eur0(p.cost) }],
    rows,
    foot: h('tr', { class: 'bench' }, h('td', null, h('b', { text: 'Totale titoli' })), h('td'), h('td'), h('td', { class: 'num r', text: eur0(totN) }), h('td'), h('td'), h('td', { class: 'num r', text: eur0(tot) }))
  });
  return panel('Lista d\'acquisto', h('span', { class: 'ph-end' }, h('span', { class: 'meta', text: `valuta ${fmt(plan.settle)} · più ${fmtEur(plan.cash0)} sul conto XEON · commissioni escluse` }),
    h('span', { class: 'actions' },
      miniBtn('Copia ISIN e nominali', async () => toast(await copyText(rows.map(p => `${p.b.isin}\t${p.nominal}`).join('\n')) ? 'Elenco ISIN e nominali copiato' : 'Copia non riuscita', 'ok')),
      miniBtn('Scarica CSV', () => downloadFile(`scala-affitto-${new Date().toISOString().slice(0, 10)}.csv`, csv())))), table,
    h('p', { class: 'note', text: 'Per gli indicizzati il prezzo è «reale» (senza inflazione): il controvalore è prezzo × CI più il rateo. CI = coefficiente d\'indicizzazione alla data di regolamento.' }));
}

/* ---------------- ipotesi e dati ---------------- */
function assumptionsPanel(plan, result) {
  const f = plan.cfg.fisco, items = [];
  items.push(insight('info', `Dati d'inflazione aggiornati al ${isoFmt(result.infl && result.infl.asOf)}; prezzi dei titoli del ${fmt(result.refDate)}.`));
  const ctl = result.infl && result.infl.meta;
  if (ctl && ctl.ci && ctl.ci.righe) {
    const ok = ctl.ci.righe.filter(r => r.esito === 'ok').length;
    items.push(insight(ctl.ci.ok ? 'good' : 'bad', `Controllo del ${isoFmt(ctl.ci.giorno)}: ${ok} coefficienti d'indicizzazione ricalcolati su ${ctl.ci.righe.length} coincidono con quelli ufficiali MEF.`));
  }
  for (const e of (ctl && ctl.errori) || []) items.push(insight('bad', `Dati d'inflazione: ${e}`));
  const age = result.infl && result.infl.asOf ? (Date.now() - Date.parse(result.infl.asOf)) / 864e5 : 0;
  if (age > 4) items.push(insight('warn', `I dati d'inflazione hanno ${Math.floor(age)} giorni: l'aggiornamento automatico potrebbe essersi fermato.`));
  items.push(insight('warn', `DA VERIFICARE · rivalutazione dei BTP€i tassata ${f.rivalutazioneBtpEi === 'annuale' ? 'ogni anno' : 'a scadenza'}; base imponibile a scadenza: ${f.baseImponibileBtpEi === 'acquisto' ? 'prezzo d\'acquisto' : 'prezzo di emissione (prudente)'}. Le minusvalenze che ne nascono non sono usate.`));
  items.push(insight('warn', `DA VERIFICARE · BTP Italia comprati sul secondario: ${f.rateoRivalutazioneBtpItalia === 'credito' ? 'credito d\'imposta' : 'nessun credito d\'imposta'} sulla rivalutazione già maturata nel prezzo. I premi fedeltà non spettano (solo all'emissione).`));
  items.push(insight('info', 'Le rate sono pagate all\'inizio del periodo (1/1, o 1/1 e 1/7). Bollo 0,2% l\'anno sul valore stimato dei titoli. I titoli si tengono fino a scadenza.'));
  for (const s of plan.skipped || []) items.push(insight('warn', `${s.desc} (${s.isin}) escluso: ${s.why}.`));
  return notesPanel(items);
}

/* ---------------- Monte Carlo: la scala + il resto del capitale in ETF ---------------- */
function mcPanel(mc, plan) {
  const nTxt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (mc.error) return panel('Monte Carlo: scala + ETF', null, h('div', { class: 'pb prose' }, h('p', { class: 'hl',
    text: `Il capitale complessivo (${fmtEur(mc.total)}) è minore del costo della scala (${fmtEur(mc.cost)}): alzalo nel pannello «Resto del capitale» per simulare il resto in ETF.` })));
  const a = mc.mix, b = mc.allEtf, K = mc.dues.length;
  const lastY = mc.dues[K - 1].year;
  const p = v => fmtPct(v * 100, 1);
  const kpis = h('div', { class: 'kpis' },
    kpi('Affitto pagato fino al ' + lastY, p(a.pAll), `scala + ETF · tutto in ETF: ${p(b.pAll)}`),
    kpi('In ETF all\'inizio', fmtEur(mc.etf0), `su ${fmtEur(mc.total)} · scala ${fmtEur(plan.totalCost)}`),
    kpi('Percorsi che vendono ETF', p(a.soldShare), a.bondSaleShare > 0.0005 ? `e ${p(a.bondSaleShare)} vendono anche titoli della scala` : 'per pagare l\'affitto o le spese extra'),
    ...(mc.params.extras && mc.params.extras.length ? [kpi('Spese extra non pagate', p(a.extraShortShare), `percorsi con una parte non pagata · tutto in ETF: ${p(b.extraShortShare)}`)] : []),
    kpi(`Patrimonio nel ${a.wealth[a.wealth.length - 1].year}`, fmtEur(a.wealth[a.wealth.length - 1].p50), `mediana · 10% peggiore ${fmtEur(a.wealth[a.wealth.length - 1].p10)}`));
  const survBox = h('div', { class: 'chart' }), fanBox = h('div', { class: 'chart' });
  requestAnimationFrame(() => {
    lineChart(survBox, { xs: mc.dues.map(d => d.year + (d.half === 2 ? 0.5 : 0)), series: [{ cls: 'mc-a', ys: a.paidTo }, { cls: 'mc-b', ys: b.paidTo }],
      yMin: Math.min(0.9, ...a.paidTo, ...b.paidTo), yMax: 1, yFmt: v => fmtPct(v * 100, 0), label: 'Probabilità che l\'affitto sia pagato fino a ogni anno' });
    lineChart(fanBox, { xs: a.wealth.map(w => w.year), bands: [{ cls: 'mc-a', lo: a.wealth.map(w => w.p10), hi: a.wealth.map(w => w.p90), mid: a.wealth.map(w => w.p50) }],
      series: [{ cls: 'mc-b', ys: b.wealth.map(w => w.p50) }, { cls: 'mc-b thin', ys: b.wealth.map(w => w.p10) }, { cls: 'mc-b thin', ys: b.wealth.map(w => w.p90) }],
      yMin: 0, yFmt: v => fmtNum(v, 0), label: 'Patrimonio in euro di oggi: mediana e fascia fra il 10% peggiore e il 10% migliore' });
  });
  const leg = legend([{ el: h('span', { class: 'kb mc-a' }), label: 'scala + ETF (linea: mediana; fascia: dal 10% peggiore al 10% migliore)' }, { el: h('span', { class: 'kb mc-b' }), label: 'tutto il capitale in ETF, affitto pagato vendendo (tratteggio: mediana, 10% e 90%)' }]);
  const params = mc.params;
  const note = `${nTxt(mc.n)} percorsi, seme fisso. Se conto ed ETF non bastano si vende una parte dei titoli della scala (al loro valore). ETF: ${fmtPct(params.eqMu * 100, 1)} composto atteso, volatilità ${fmtPct(params.eqSd * 100, 0)}, code grasse, TER 0,15%, 26% sulle plusvalenze quando si vende, bollo 0,2%. Inflazione: media ${fmtPct(params.inflMean * 100, 1)}, deviazione ${fmtPct(params.inflSd * 100, 1)}, persistenza 0,6.${params.stress === 'crollo' ? ' Stress: borsa −35% e −10% nei primi due anni interi.' : params.stress === 'stagflazione' ? ' Stress: inflazione 8→5% per cinque anni, borsa ferma.' : ''} Patrimonio in euro di oggi: ETF al netto delle tasse, conto XEON e titoli della scala (flussi ancora da incassare con l'inflazione attesa, scontati al rendimento della scala di oggi). I numeri dipendono dalle ipotesi: servono a confrontare scelte, non a prevedere.`;
  return panel('Monte Carlo: scala + ETF', `${nTxt(mc.n)} percorsi di inflazione e borsa`, kpis,
    h('div', { class: 'grid-2' },
      h('div', null, h('h3', { class: 'mc-h', text: 'Probabilità che l\'affitto sia pagato fino a ogni anno' }), survBox),
      h('div', null, h('h3', { class: 'mc-h', text: 'Patrimonio (euro di oggi): mediana e 10%–90%' }), fanBox)),
    leg, h('p', { class: 'note', text: note }));
}

/** Linee e fasce semplici in SVG (asse x anni). */
function lineChart(box, { xs, series = [], bands = [], yMin, yMax, yFmt, label }) {
  const W = Math.max(280, box.clientWidth || 500), H = 220, M = { l: 48, r: 14, t: 10, b: 22 };
  const all = [...series.flatMap(x => x.ys), ...bands.flatMap(x => [...x.lo, ...x.hi])].filter(Number.isFinite);
  // tacche tonde: passo 1, 2 o 5 × 10^k
  const lo0 = yMin ?? Math.min(...all), hi0 = yMax ?? (Math.max(...all) || 1);
  const raw = (hi0 - lo0) / 4 || 1, mag = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 5, 10].map(k => k * mag).find(v => v >= raw);
  const lo = Math.floor(lo0 / st + 1e-9) * st, hi = Math.ceil(hi0 / st - 1e-9) * st;
  const nT = Math.round((hi - lo) / st);
  M.l = 10 + Math.max(...Array.from({ length: nT + 1 }, (_, k) => yFmt(lo + st * k).length)) * 7;
  const X = x => M.l + (x - xs[0]) / Math.max(1e-9, xs[xs.length - 1] - xs[0]) * (W - M.l - M.r);
  const Y = y => M.t + (1 - (y - lo) / Math.max(1e-9, hi - lo)) * (H - M.t - M.b);
  const path = (px, py) => px.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(py[i]).toFixed(1)}`).join('');
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': label });
  for (let k = 0; k <= nT; k++) {
    const v = lo + st * k, y = Y(v);
    el.appendChild(svg('line', { class: 'gridl', x1: M.l, x2: W - M.r, y1: y, y2: y }));
    el.appendChild(svg('text', { class: 'axt', x: M.l - 6, y: y + 3, 'text-anchor': 'end', text: yFmt(v) }));
  }
  const step = Math.max(1, Math.ceil(xs.length / 6));
  xs.forEach((x, i) => { if ((i % step === 0 || i === xs.length - 1) && Number.isInteger(x) && (i === xs.length - 1 || xs.length - 1 - i >= step / 2)) el.appendChild(svg('text', { class: 'axt', x: X(x), y: H - 6, 'text-anchor': 'middle', text: String(x) })); });
  for (const b of bands) {
    el.appendChild(svg('path', { class: `band ${b.cls}`, d: path(xs, b.hi) + xs.slice().reverse().map(x => `L${X(x).toFixed(1)},${Y(b.lo[xs.indexOf(x)]).toFixed(1)}`).join('') + 'Z' }));
    el.appendChild(svg('path', { class: `ln ${b.cls}`, d: path(xs, b.mid) }));
  }
  for (const sr of series) el.appendChild(svg('path', { class: `ln ${sr.cls}`, d: path(xs, sr.ys) }));
  box.replaceChildren(el);
}
