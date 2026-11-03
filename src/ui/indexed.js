/* Risultati della modalità «Affitto indicizzato» (passività indicizzata): la scala di titoli che paga un affitto che
   cresce con l'inflazione. Nessun calcolo finanziario qui: solo lettura del piano prodotto dal motore
   (src/core/alm-plan.js) e dei confronti (src/engine-indexed.js). Le divisioni per il deflatore servono solo a
   mostrare gli «euro di oggi». */
import { h, fmtEur, fmtPct, fmtNum, copyText, toast, downloadFile, MINUS } from './dom.js';
import { columnChart, legend } from './charts.js';
import { kpi, insight, notesPanel, panel, miniBtn, actionsBar, dataTable, calendarPanel } from './results.js';
import { fmt } from '../core/dates.js';

const eur0 = v => fmtNum(v, 0);
const isoFmt = x => { const t = Date.parse(x); return Number.isFinite(t) ? fmt(Math.floor(t / 864e5)) : '—'; };
const csvNum = (n, dec) => fmtNum(n, dec).replace(MINUS, '-');
const TYPE = { NOM: 'nominale', BTPEI: 'BTP€i', BTPITALIA: 'BTP Italia' };
const INDEX = { HICP: 'HICP area euro', FOI: 'FOI Italia', nominale: 'nessuno (tasso fisso)' };
const dueLabel = r => r.half ? `${r.half === 1 ? '1/1' : '1/7'}/${r.year}` : String(r.year);
const view = { scen: 'base', real: false };          // scelte dell'utente nella vista, tenute fra un ricalcolo e l'altro

export function renderIndexed(st, result, A) {
  const plan = result.plan;
  if (plan.empty) return [notesPanel((plan.warnings || ['Nessuna scala possibile con queste impostazioni.']).map(w => insight('warn', w)))];
  const cfg = plan.cfg;
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
      `${fmtEur(plan.bondCost)} in titoli · ${fmtEur(plan.cash0)} in liquidità`),
    maxscale
      ? kpi('Affitto sostenibile', fmtEur(lam * cfg.L0), `il primo anno · ${fmtNum(lam * 100, 0)}% di ${fmtEur(cfg.L0)}`)
      : kpi('Coperto fino al', String(plan.horizon), maxhor && plan.horizon < cfg.yearTo ? `chiesto fino al ${cfg.yearTo}` : `${N} ${N === 1 ? 'rata' : 'rate'} dal ${first.year}`),
    kpi('Prima e ultima rata', `${eur0(first.need)} → ${eur0(last.need)}`, `€ nominali, scenario base · ${eur0(last.need / last.defl)} € di oggi`),
    kpi('Quota indicizzata', fmtPct(plan.linkerShare * 100, 0), `${plan.positions.filter(p => p.type !== 'NOM').length} indicizzati su ${plan.positions.length} titoli`),
    kpi('Rendimento netto', fmtPct(plan.irr * 100), `scenario base · duration ${fmtNum(plan.duration, 1)} anni`),
    kpi('Scenari coperti', String(covered.length), covered.length === scen.length ? 'tutti' : `scoperti: ${scen.filter(s => plan.sims[s.id].first).map(s => s.label).join(', ')}`, `/ ${scen.length}`));

  const lead = h('p', { class: 'lead' },
    'Con ', h('b', { text: fmtEur(plan.totalCost) }), ' oggi paghi ',
    maxscale ? ['un affitto di ', h('b', { text: fmtEur(lam * cfg.L0) }), ` il primo anno`] : ['l\'affitto'],
    ` dal ${first.year} al ${plan.horizon}, che cresce con l'inflazione ${cfg.liabIndex === 'HICP' ? 'europea (HICP)' : 'italiana (FOI)'}`,
    cfg.realSpread ? ` più ${fmtNum(cfg.realSpread * 100, 1)}% l'anno` : '',
    ': da ', h('b', { text: fmtEur(first.need) }), ' a ', h('b', { text: fmtEur(last.need) }), ' nello scenario base. ',
    simB.first ? `Nello scenario base i soldi finiscono al ${dueLabel(simB.first)}.` : `Alla fine restano ${fmtEur(simB.bal[N - 1])} di liquidità nello scenario base.`);

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
    const parts3 = rows.map(r => {
      const red = Math.max(0, r.red) / d(r), cpn = Math.max(0, r.cpn) / d(r), need = r.need / d(r);
      const a = Math.min(red, need), b = Math.min(cpn, need - a);
      return { red, cpn, a, b, cash: Math.max(0, need - a - b), extra: Math.max(0, red + cpn - need), need };
    });
    scenSeg.replaceChildren(...scen.map(s => h('button', { type: 'button', 'aria-pressed': String(s.id === view.scen), text: s.label,
      on: { click: () => { view.scen = s.id; draw(); } } })));
    unitSeg.replaceChildren(...[[false, '€ nominali'], [true, '€ di oggi']].map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(v === view.real), text: t,
      on: { click: () => { view.real = v; draw(); } } })));
    columnChart(chartBox, {
      labels: rows.map(dueLabel), height: 260, yFormat: v => fmtNum(v, 0),
      series: [{ cls: 's1', values: parts3.map(p => p.a) }, { cls: 's2', values: parts3.map(p => p.b) }, { cls: 's3', values: parts3.map(p => p.cash) }],
      target: parts3.map(p => p.need),
      ariaLabel: `Affitto di ogni scadenza e da dove arriva, scenario ${scen.find(s => s.id === view.scen).label}`,
      tooltip: i => { const r = rows[i], p = parts3[i]; return { title: `Rata ${dueLabel(r)}`, meta: view.real ? '€ di oggi' : '€ nominali', rows: [
        { key: 'ink', label: 'Rimborsi', value: fmtEur(p.red) }, { key: 'chart-trail', label: 'Cedole', value: fmtEur(p.cpn) },
        { key: 'chart-line', label: 'Dalla liquidità', value: fmtEur(p.cash) }, { key: 'blue', label: 'Affitto', value: fmtEur(p.need) },
        { label: 'Avanzo messo da parte', value: fmtEur(p.extra) },
        { label: 'Liquidità dopo la rata', value: fmtEur(r.bal / d(r)) }] }; }
    });
    tableMeta.textContent = `scenario ${scen.find(s => s.id === view.scen).label} · ${view.real ? '€ di oggi' : '€ nominali'}`;
    tableBox.replaceChildren(dueTable(rows, d));
  }
  const ladder = panel('Da dove arriva ogni rata', h('span', { class: 'ph-end' }, scenSeg, unitSeg), chartBox,
    legend([{ key: 'ink', label: 'pagato con rimborsi' }, { key: 'chart-trail', label: 'pagato con cedole nette' }, { key: 'chart-line', label: 'pagato dalla liquidità (XEON)' },
      { type: 'line', key: 'blue', label: 'affitto da pagare' },
      { type: 'text', label: 'rimborsi e cedole arrivati dopo la rata precedente; l\'avanzo va in liquidità e paga le rate dopo' }]));
  requestAnimationFrame(draw);

  /* ---------------- osservazioni ---------------- */
  const ins = [];
  if (covered.length === scen.length) ins.push(insight('good', `La scala regge in tutti gli ${scen.length} scenari d'inflazione simulati.`));
  for (const s of scen) {
    const sm = plan.sims[s.id];
    if (sm.first) ins.push(insight(s.robust ? 'bad' : 'warn', `Scenario «${s.label}»: i soldi finiscono al ${dueLabel(sm.first)}. Per coprirlo servirebbero ${fmtEur(sm.extra)} in più oggi${s.robust ? '' : ' (non è fra gli scenari da coprire per forza)'}.`));
  }
  if (plan.relaxedCost != null && plan.totalCost - plan.relaxedCost > 50)
    ins.push(insight('info', `Comprare a lotti interi costa ${fmtEur(plan.totalCost - plan.relaxedCost)} in più della scala ideale «a pezzi».`));
  if (plan.linkerShare < 0.3 && cfg.minLinker === 0)
    ins.push(insight('info', 'Gli indicizzati pesano poco: la scala costa meno nello scenario base, ma regge meno se l\'inflazione sale. Prova «Quota minima indicizzata» o aggiungi «Alto» agli scenari da coprire.'));
  if (result.flat) {
    const fb = result.flat.sims.base, fa = result.flat.sims.alto;
    ins.push(insight('info', `Una scala a importo fisso con lo stesso capitale paga ${fmtEur(result.flat.perYear)} l'anno sempre uguali: ${fb && fb.first ? `nello scenario base i soldi finiscono al ${dueLabel(fb.first)}` : 'nello scenario base basta'}${fa ? (fa.first ? `, con inflazione alta al ${dueLabel(fa.first)}` : ', e anche con inflazione alta') : ''}.`));
  }
  for (const n of plan.notes || []) ins.push(insight('info', n));
  if (result.basketCount < 10) ins.push(insight('warn', `Solo ${result.basketCount} titoli rispettano i filtri: allarga il paniere.`));

  return [kpis, lead, actionsBar(false),
    h('div', { class: 'grid-side' }, ladder, notesPanel(ins)),
    stressPanel(plan, result),
    panel('Rata per rata', tableMeta, tableBox),
    compositionPanel(plan),
    cashPanel(plan, result),
    plan.calendar.length ? calendarPanel(plan.calendar, 'scenario base · euro netti, mese per mese') : null,
    purchasePanel(plan),
    assumptionsPanel(plan, result)].filter(Boolean);
}

/* ---------------- tabella delle rate ---------------- */
function dueTable(rows, d) {
  return dataTable({
    label: 'Rate dell\'affitto e flussi della scala',
    cols: [
      { label: 'Rata', sort: r => r.due, cell: r => h('span', { class: 'num', text: dueLabel(r) }) },
      { label: 'Affitto', r: 1, sort: r => r.need, cell: r => eur0(r.need / d(r)) },
      { label: 'Rimborsi', r: 1, sort: r => r.red, cell: r => eur0(r.red / d(r)) },
      { label: 'Cedole nette', r: 1, sort: r => r.cpn, cell: r => eur0(r.cpn / d(r)) },
      { label: 'Bollo e tasse', r: 1, sort: r => r.cost, cell: r => eur0(r.cost / d(r)) },
      { label: 'Liquidità dopo', r: 1, sort: r => r.bal, cell: r => h('span', { class: r.bal < -0.5 ? 'neg' : null, text: eur0(r.bal / d(r)) }) }],
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
      { label: 'Esito', cell: x => x.sm.first ? h('span', { class: 'neg', text: `soldi finiti al ${dueLabel(x.sm.first)}` }) : 'tutte pagate' },
      { label: 'Liquidità finale', r: 1, sort: x => x.sm.bal[N - 1], cell: x => eur0(x.sm.bal[N - 1]) },
      { label: 'Capitale che manca', r: 1, sort: x => x.sm.extra, cell: x => x.sm.extra > 0.5 ? eur0(x.sm.extra) : '—' },
      ...(flat ? [{ label: 'Scala a importo fisso', cell: x => !x.fl ? '—' : x.fl.first ? `finisce al ${dueLabel(x.fl.first)}` : 'basta' }] : [])],
    rows
  });
  return panel('Prova di stress', flat ? `stesso capitale · confronto con una scala a importo fisso di ${fmtEur(flat.perYear)} l'anno` : 'stesso capitale in ogni scenario', table,
    h('p', { class: 'note', text: '«Capitale che manca» è quanto andrebbe aggiunto oggi in liquidità per pagare tutte le rate in quello scenario. Gli scenari: inflazione base (impostata da te), alta 3,5% e bassa 1% ogni anno, shock 8% → 5% nei primi anni, FOI che supera l\'HICP di 0,5 punti.' }));
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
    insight('info', `La liquidità sta su un ETF monetario tipo XEON: rende circa ${fmtPct(c.xeon * 100)} netto l'anno (€STR ${fmtPct(c.estr * 100)} + 0,085% − costi 0,10%, tassato al 26%, meno bollo 0,2%).`),
    idle.length ? insight('info', `Nello scenario base la liquidità resta ferma fra una rata e l'altra in ${idle.length} periodi, in media ${fmtEur(avg)}.`) : insight('good', 'Nello scenario base fra una rata e l\'altra non resta liquidità ferma importante.'),
    better.length
      ? insight('warn', `Oggi ${better.length === 1 ? 'un titolo breve rende' : `${better.length} titoli brevi rendono`} più di XEON (netto, bollo compreso): ${better.slice(0, 3).map(b => `${b.desc} ${fmtPct(b.netAfterBollo)}`).join(', ')}. Per la liquidità che serve entro un anno può convenire un BOT.`)
      : insight('good', 'Oggi nessun BOT o titolo entro un anno rende più di XEON al netto di tasse e bollo.')];
  return panel('Liquidità: XEON o BOT', `€STR ${fmtPct(c.estr * 100)} · dato del ${isoFmt(c.estrDate)}`,
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
      { label: 'Titolo', sort: p => p.b.desc, cell: p => [h('span', { class: 'sym', text: p.b.isin }), h('span', { class: 'nm', text: p.b.desc })] },
      { label: 'Tipo', sort: p => p.type, cell: p => TYPE[p.type] || p.type },
      { label: 'Scadenza', sort: p => p.b.maturity, cell: p => h('span', { class: 'num', text: fmt(p.b.maturity) }) },
      { label: 'Nominale', r: 1, sort: p => p.nominal, cell: p => eur0(p.nominal) },
      { label: 'Prezzo', r: 1, sort: p => p.b.price, cell: p => fmtNum(p.b.price, 2) },
      { label: 'CI', r: 1, sort: p => p.ciSettle || 0, cell: p => p.ciSettle && p.type !== 'NOM' ? fmtNum(p.ciSettle, 5) : '—' },
      { label: 'Controvalore', r: 1, sort: p => p.cost, cell: p => eur0(p.cost) }],
    rows,
    foot: h('tr', { class: 'bench' }, h('td', null, h('b', { text: 'Totale titoli' })), h('td'), h('td'), h('td', { class: 'num r', text: eur0(totN) }), h('td'), h('td'), h('td', { class: 'num r', text: eur0(tot) }))
  });
  return panel('Lista d\'acquisto', h('span', { class: 'ph-end' }, h('span', { class: 'meta', text: `valuta ${fmt(plan.settle)} · più ${fmtEur(plan.cash0)} su XEON · commissioni escluse` }),
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
