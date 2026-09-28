/* Scheda «Portafoglio»: i titoli che l'utente ha già, caricati dall'export della banca, incollati
   o inseriti a mano. Mostra valore, risultato, rendimenti dai prezzi di oggi e il calendario degli
   incassi (dove sono i buchi), e porta alle viste che costruiscono la scala attorno al portafoglio.
   Nessun calcolo di ottimizzazione qui. */
import { h, fmtEur, fmtPct, fmtNum, toast, badge, deltaEl, downloadFile, MINUS, parseUserNumber } from './dom.js';
import { openSheet, closeSheet } from './sheet.js';
import { dataTable, calendarPanel } from './results.js';
import { fmt, iso, parseDay, MONTHS } from '../core/dates.js';
import { isinOk, tableToHoldings, textToRows } from '../data/portfolio.js';
import { resolveHoldings, portfolioSummary, holdingYield, mergeHoldings, monthsFrom } from '../portfolio.js';
import { htmlRows, loadSheetJS } from '../data/xls.js';
import { RETAIL_BTP } from '../data/retail-btp.js';

let C = null;   // { root, ds, portfolio, zainetto, onChange(p, msg), onBuild(goal), readFile(file) }

export function renderPortfolio(root, ctx) {
  C = { ...ctx, root };
  paint();
}

const panel = (title, meta, ...body) => h('section', { class: 'panel' },
  h('div', { class: 'ph' }, h('h2', { text: title }), meta == null ? null : typeof meta === 'string' ? h('span', { class: 'meta', text: meta }) : meta), ...body);
const kpi = (k, v, s) => h('div', { class: 'kpi' }, h('span', { class: 'k', text: k }), h('span', { class: 'v num' }, v), s ? h('span', { class: 's' }, s) : null);
const mini = (text, onClick, attrs = {}) => h('button', { type: 'button', class: 'mini', ...attrs, on: { click: onClick } }, text);
const eur0 = v => fmtNum(v, 0);
const monthsText = b => b && b.months && b.months.length ? b.months.map(m => MONTHS[m - 1]).join(' · ') : 'zero coupon';

function paint() {
  const { ds, portfolio } = C;
  const holdings = portfolio.holdings;
  if (!ds) { C.root.replaceChildren(panel('Portafoglio', null, h('p', { class: 'note', style: { padding: '10px' }, text: 'Servono i dati del giorno per valutare il portafoglio: caricali dalla data EOD in alto.' }))); return; }
  if (!holdings.length) { C.root.replaceChildren(emptyView()); return; }
  const res = resolveHoldings(holdings, ds, { zainetto: C.zainetto });
  const sum = portfolioSummary(res, ds.settle);
  const next = sum.schedule.filter(f => f.kind === 'redemption').sort((a, b) => a.day - b.day)[0];
  const pnlPct = sum.pnl / sum.cost * 100;
  const kpis = h('div', { class: 'kpis' },
    kpi('Titoli', String(sum.count), `${fmtEur(sum.nominal)} di nominale${sum.incomplete ? ` · ${sum.incomplete} da completare` : ''}`),
    kpi('Valore oggi', fmtEur(sum.value), 'prezzi del file + rateo'),
    kpi('Risultato latente', Number.isFinite(sum.pnl) ? deltaEl(sum.pnl, 0, ' €') : '—', Number.isFinite(pnlPct) ? deltaEl(pnlPct, 2, '%') : 'serve il prezzo di carico'),
    kpi('Rendimento netto', fmtPct(sum.irr * 100), 'dai prezzi di oggi, tasse sul tuo carico'),
    kpi('Prossimo rimborso', next ? fmt(next.day) : '—', next ? `${fmtEur(next.net)} netti` : 'nessuno'));

  const notes = [];
  const missing = res.filter(r => r.status === 'missing'), matured = res.filter(r => r.status === 'matured');
  const retail = res.filter(r => r.status === 'retail'), manual = res.filter(r => r.status === 'manual');
  if (missing.length) notes.push(['watch', 'Incompleto', `${missing.map(r => r.h.desc || r.h.isin).join(', ')}: ${missing.length === 1 ? 'non è' : 'non sono'} nei dati STFI di oggi. Apri «Modifica» e indica scadenza e cedola, altrimenti ${missing.length === 1 ? 'resta' : 'restano'} fuori dai calcoli.`]);
  if (retail.length) notes.push(['normal', 'Nota', `${retail.map(r => r.bond.desc).join(', ')}: BTP per i risparmiatori. Cedole crescenti e premio fedeltà (solo con l'ISIN «con premio», quello del collocamento) dalla tabella dell'app; il valore di oggi dal prezzo di mercato.`]);
  if (manual.length) notes.push(['normal', 'Nota', `${manual.map(r => r.bond.desc).join(', ')}: caratteristiche inserite a mano.`]);
  if (matured.length) notes.push(['cool', 'Scaduto', `${matured.map(r => r.h.desc || r.h.isin).join(', ')}: già rimborsat${matured.length === 1 ? 'o' : 'i'}, fuori dai calcoli. Toglil${matured.length === 1 ? 'o' : 'i'} dal portafoglio.`]);
  if (!sum.costKnown) notes.push(['watch', 'Attenzione', 'Per alcuni titoli manca il prezzo medio di carico: la tassa a scadenza è stimata sul prezzo di oggi.']);
  notes.push(['normal', 'Privacy', 'Il portafoglio resta solo in questo browser: non viene inviato né salvato nel cloud.']);

  C.root.replaceChildren(...[
    h('div', { class: 'actions' },
      mini('Costruisci una scala attorno →', () => C.onBuild('capital')),
      mini('Rendita mensile attorno →', () => C.onBuild('income'))),
    kpis,
    panel('Da sapere', `${notes.length} ${notes.length === 1 ? 'nota' : 'note'}`, h('div', { class: 'pb' }, h('div', { class: 'states' },
      notes.map(([st, w, t]) => h('div', { class: 'srow' }, badge(st, w), h('span', { text: t })))))),
    holdingsPanel(res),
    sum.schedule.length ? calendarPanel(sum.schedule) : null,
    addPanel(true)
  ].filter(Boolean));
}

function holdingsPanel(res) {
  const settle = C.ds.settle;
  const rows = res.map(r => ({ r, y: holdingYield(r, settle), redemption: r.flows.length ? r.flows[r.flows.length - 1] : null }));
  const STATUS = { data: ['normal', 'Nei dati'], retail: ['normal', 'BTP retail'], manual: ['normal', 'A mano'], missing: ['watch', 'Incompleto'], matured: ['cool', 'Scaduto'] };
  const table = dataTable({
    label: 'Titoli in portafoglio', sortBy: 1, cls: 'compact',
    cols: [
      { label: 'Titolo', cls: 'wrap', sort: x => x.r.bond ? x.r.bond.desc : x.r.h.desc, cell: x => [h('span', { class: 'sym', text: x.r.h.isin }), h('span', { class: 'nm', text: x.r.bond ? x.r.bond.desc : (x.r.h.desc || '—') })] },
      { label: 'Scadenza', sort: x => x.r.bond ? x.r.bond.maturity : 9e9, cell: x => x.r.bond ? [h('span', { class: 'num', text: fmt(x.r.bond.maturity) }), h('span', { class: 'dsub', title: 'mesi in cui arriva la cedola', text: monthsText(x.r.bond) })] : '—' },
      { label: 'Nominale', r: 1, sort: x => x.r.h.nominal, dir: -1, cell: x => eur0(x.r.h.nominal) },
      { label: 'Carico', r: 1, sort: x => x.r.h.carico ?? -1, cell: x => Number.isFinite(x.r.h.carico) ? fmtNum(x.r.h.carico, 2) : '—' },
      { label: 'Prezzo oggi', r: 1, sort: x => x.r.bond ? x.r.bond.price : -1, cell: x => x.r.bond && Number.isFinite(x.r.bond.price)
        ? [fmtNum(x.r.bond.price, 2), Number.isFinite(x.r.h.carico) ? h('span', { class: 'dsub' }, deltaEl((x.r.bond.price / x.r.h.carico - 1) * 100, 2, '%')) : null] : '—' },
      { label: 'Cedola', r: 1, sort: x => x.r.bond ? x.r.bond.coupon : -1, cell: x => x.r.bond ? (x.r.bond.zc ? '—' : fmtPct(x.r.bond.coupon, 2)) : '—' },
      { label: 'Netto', r: 1, sort: x => Number.isFinite(x.y) ? x.y : -99, dir: -1, cell: x => h('span', { title: 'rendimento netto annuo da oggi a scadenza, con la tassa calcolata sul tuo prezzo di carico', text: fmtPct(x.y) }) },
      { label: 'Valore oggi', r: 1, sort: x => x.r.value, dir: -1, cell: x => eur0(x.r.value) },
      { label: 'Rimborso netto', r: 1, sort: x => x.redemption ? x.redemption.net : 0, cell: x => x.redemption ? eur0(x.redemption.net) : '—' },
      { label: 'Stato', cls: 'acts', cell: x => [badge(...(STATUS[x.r.status] || STATUS.data)),
        h('span', { class: 'row-acts' }, mini('Modifica', () => openEdit(x.r), { 'aria-label': `Modifica ${x.r.h.isin}` }))] }],
    rows
  });
  const head = h('span', { class: 'ph-end' }, h('span', { class: 'meta', text: `${rows.length} titoli · euro · netto da oggi, tasse sul tuo carico` }),
    h('span', { class: 'actions' },
      mini('Scarica CSV', () => downloadFile(`portafoglio-${iso(C.ds.refDate)}.csv`, toCsv(res))),
      mini('Svuota', clearAsk, { 'aria-label': 'Svuota il portafoglio' })));
  return panel('Titoli in portafoglio', head, table,
    h('p', { class: 'note', style: { padding: '6px 10px' } }, 'Rimborso netto: 100 meno la tassa sulla plusvalenza rispetto al tuo prezzo di carico (12,5% per Stati e sovranazionali), più l\'eventuale premio fedeltà. Verde e rosso con ▲ ▼: prezzo di oggi rispetto al carico.'));
}

/* ---------------- Caricare, incollare, aggiungere ---------------- */
function emptyView() {
  return h('div', { class: 'stack' },
    h('section', { class: 'intro', 'aria-label': 'Il tuo portafoglio' },
      h('p', null, 'Carica i titoli che hai già: l\'app li valuta con i prezzi di oggi e poi, nelle schede 1 e 2, ', h('b', { text: 'costruisce la scala attorno' }), ', comprando solo quello che manca e senza vendere nulla.'),
      h('ol', null,
        h('li', null, 'Scarica dalla banca l\'elenco dei titoli in Excel o CSV (su Fineco: Portafoglio, poi Esporta in Excel) e caricalo qui sotto.'),
        h('li', null, 'Oppure copia la tabella dal sito della banca e incollala, o aggiungi i titoli a mano con ISIN, nominale e prezzo di carico.'),
        h('li', null, 'Controlla i titoli segnati «Da completare», poi scegli la scala da costruire.')),
      h('p', { class: 'note', text: 'Il portafoglio resta solo in questo browser: non viene inviato né salvato nel cloud.' })),
    addPanel(false));
}

function addPanel(hasHoldings) {
  const file = h('input', { type: 'file', accept: '.xls,.xlsx,.csv,.txt,.tsv,.htm,.html,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv', hidden: true,
    on: { change: e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); } } });
  const prefetch = () => { loadSheetJS().catch(() => { /* riprova al caricamento */ }); };
  const drop = h('div', { class: 'drop', role: 'button', tabindex: 0, 'aria-label': 'Carica l\'export della banca: trascinalo qui oppure premi Invio per sceglierlo', on: {
    pointerenter: prefetch, focus: prefetch,
    click: () => file.click(), keydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } },
    dragover: e => { e.preventDefault(); drop.classList.add('drag'); }, dragleave: () => drop.classList.remove('drag'),
    drop: e => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); } } },
    h('b', { text: 'Carica l\'export della banca' }), h('span', { text: '.xls, .xlsx o .csv con ISIN, quantità o nominale e prezzo medio di carico' }));

  const area = h('textarea', { class: 'input text', id: 'ptfPaste', rows: 4, placeholder: 'Incolla qui la tabella copiata dal sito della banca (con le intestazioni), oppure righe «ISIN nominale prezzo»' });
  const readPaste = () => {
    const rows = textToRows(area.value);
    if (!rows.length) { toast('Incolla prima una tabella', 'err'); return; }
    preview(tableToHoldings(rows), 'testo incollato');
  };
  // una tabella copiata dal browser arriva anche come HTML: la leggiamo senza metterla nella pagina
  area.addEventListener('paste', e => {
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    if (html && /<table[\s>]/i.test(html)) {
      const rows = htmlRows(html);
      if (rows.some(r => r.some(isinOk))) { e.preventDefault(); area.value = rows.map(r => r.join('\t')).join('\n'); preview(tableToHoldings(rows), 'tabella incollata'); return; }
    }
    setTimeout(() => { if (/\b[A-Z]{2}[A-Z0-9]{9}\d\b/.test(area.value)) readPaste(); }, 0);
  });

  const isin = h('input', { class: 'input', id: 'ptfIsin', list: 'ptfIsinList', autocomplete: 'off', spellcheck: 'false', placeholder: 'IT0005…', maxlength: 12,
    on: { focus: ensureDatalist, input: () => { isin.value = isin.value.toUpperCase(); } } });
  const nominal = h('input', { class: 'input', id: 'ptfNom', inputmode: 'decimal', placeholder: '10.000' });
  const carico = h('input', { class: 'input', id: 'ptfCar', inputmode: 'decimal', placeholder: '98,50' });
  const addOne = () => {
    const code = isin.value.trim().toUpperCase(), n = parseUserNumber(nominal.value), c = parseUserNumber(carico.value);
    if (!isinOk(code)) { toast('ISIN non valido: controlla le 12 cifre', 'err'); isin.focus(); return; }
    if (!(n > 0)) { toast('Indica il valore nominale', 'err'); nominal.focus(); return; }
    const b = C.ds.bonds.find(x => x.isin === code);
    const next = mergeHoldings(C.portfolio.holdings, [{ isin: code, desc: b ? b.desc : '', nominal: n, carico: c > 0 && c < 1000 ? c : null }], 'add');
    C.onChange({ ...C.portfolio, holdings: next, source: C.portfolio.source || { kind: 'manual', at: new Date().toISOString() } }, `Aggiunto ${b ? b.desc : code}`);
  };
  const lbl = (id, t) => h('label', { class: 'lbl', for: id, text: t });
  return h('section', { class: 'panel', id: 'ptfAdd' },
    h('div', { class: 'ph' }, h('h2', { text: hasHoldings ? 'Aggiungi o aggiorna' : 'Carica il portafoglio' }), h('span', { class: 'meta', text: 'resta solo in questo browser' })),
    h('div', { class: 'pb stack' },
      drop, file,
      h('div', { class: 'field' }, lbl('ptfPaste', 'Oppure incolla una tabella'), area, h('div', { class: 'actions' }, mini('Leggi la tabella incollata', readPaste))),
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Oppure aggiungi un titolo a mano' }),
        h('div', { class: 'add-row' },
          h('div', { class: 'field' }, lbl('ptfIsin', 'ISIN'), isin),
          h('div', { class: 'field' }, lbl('ptfNom', 'Nominale €'), nominal),
          h('div', { class: 'field' }, lbl('ptfCar', 'Prezzo di carico'), carico),
          h('div', { class: 'field add-go' }, mini('Aggiungi', addOne))),
        h('p', { class: 'note', text: 'Il prezzo di carico (prezzo medio d\'acquisto, in % del nominale) serve per la tassa a scadenza; se non lo sai, lascialo vuoto.' }))));
}

function ensureDatalist() {
  if (document.getElementById('ptfIsinList')) return;
  const dl = h('datalist', { id: 'ptfIsinList' }, C.ds.bonds.map(b => h('option', { value: b.isin, label: b.desc })));
  document.body.appendChild(dl);
}

async function importFile(f) {
  try {
    const rows = await C.readFile(f);
    preview(tableToHoldings(rows, { fileName: f.name }), f.name);
  } catch (e) { toast(`Lettura non riuscita: ${e.message}`, 'err'); }
}

/** Anteprima di un import: cosa è stato letto, cosa è stato saltato, sostituire o aggiungere. */
function preview(parsed, origin) {
  const { holdings, skipped, notes, header } = parsed;
  if (!holdings.length) {
    openSheet({ title: 'Nessun titolo letto', sub: origin, body: h('div', { class: 'stack' },
      h('p', { text: 'Non ho trovato righe con un ISIN valido e un nominale. Servono almeno le colonne ISIN e quantità (o valore nominale).' }),
      notes.length ? h('ul', null, notes.map(n => h('li', { text: n }))) : null,
      skipped.length ? h('p', { class: 'note', text: `Righe saltate: ${skipped.slice(0, 8).map(s => `riga ${s.row} (${s.reason})`).join(', ')}${skipped.length > 8 ? '…' : ''}` }) : null) });
    return;
  }
  const by = new Map(C.ds.bonds.map(b => [b.isin, b]));
  const notInData = holdings.filter(x => !by.has(x.isin));
  const known = notInData.filter(x => RETAIL_BTP[x.isin]);         // BTP retail «con premio»: STFI ha solo l'ISIN di mercato
  const nom = holdings.reduce((s, x) => s + x.nominal, 0);
  const list = h('div', { class: 'tscroll' }, h('table', { class: 't compact', 'aria-label': 'Titoli letti' },
    h('thead', null, h('tr', null, ['Titolo', 'Nominale', 'Carico', 'Nei dati di oggi'].map((t, i) => h('th', { scope: 'col', class: i === 1 || i === 2 ? 'r' : null, text: t })))),
    h('tbody', null, holdings.map(x => h('tr', null,
      h('td', null, h('span', { class: 'sym', text: x.isin }), h('span', { class: 'nm', text: (by.get(x.isin) || {}).desc || x.desc || '' })),
      h('td', { class: 'num r', text: eur0(x.nominal) }),
      h('td', { class: 'num r', text: Number.isFinite(x.carico) ? fmtNum(x.carico, 3) : '—' }),
      h('td', null, RETAIL_BTP[x.isin] ? `BTP retail${RETAIL_BTP[x.isin].premio ? ', con premio' : ''}: dalla tabella dell'app` : by.has(x.isin) ? 'sì' : 'no: da completare'))))));
  const apply = mode => {
    const next = mergeHoldings(C.portfolio.holdings, holdings, mode);
    closeSheet();
    C.onChange({ ...C.portfolio, holdings: next, source: { kind: 'file', name: origin, at: new Date().toISOString() } },
      `${mode === 'add' ? 'Aggiunti' : 'Caricati'} ${holdings.length} titoli da ${origin}`);
  };
  const has = C.portfolio.holdings.length > 0;
  openSheet({
    title: `Letti ${holdings.length} titoli`, sub: `${origin}${header ? ` · intestazioni alla riga ${header}` : ''}`, wide: true,
    body: h('div', { class: 'stack' },
      h('p', null, `${fmtEur(nom)} di nominale. `, notInData.length ? `${notInData.length - known.length ? `${notInData.length - known.length} non ${notInData.length - known.length === 1 ? 'è' : 'sono'} nei dati STFI di oggi e ${notInData.length - known.length === 1 ? 'andrà completato' : 'andranno completati'} a mano. ` : ''}${known.length ? `${known.length} ${known.length === 1 ? 'è un BTP' : 'sono BTP'} per i risparmiatori, riconosciut${known.length === 1 ? 'o' : 'i'} dalla tabella dell'app.` : ''}` : 'Tutti i titoli sono nei dati di oggi.'),
      list,
      notes.length ? h('ul', null, notes.map(n => h('li', { text: n }))) : null,
      skipped.length ? h('p', { class: 'note', text: `Righe saltate: ${skipped.slice(0, 10).map(s => `riga ${s.row} ${s.text ? `(${s.text}) ` : ''}— ${s.reason}`).join('; ')}${skipped.length > 10 ? '…' : ''}` }) : null),
    foot: [mini('Annulla', () => closeSheet()), has ? mini('Aggiungi a quelli che ho', () => apply('add')) : null,
      h('button', { type: 'button', class: 'mini primary', 'data-autofocus': '', text: has ? 'Sostituisci il portafoglio' : 'Usa questi titoli', on: { click: () => apply('replace') } })].filter(Boolean)
  });
}

/* ---------------- Modificare un titolo ---------------- */
function openEdit(r) {
  const hh = r.h, inData = r.status === 'data' || r.status === 'matured';
  const spec = hh.manual || RETAIL_BTP[hh.isin] || null;
  const input = (id, value, attrs = {}) => h('input', { class: 'input', id, value: value ?? '', autocomplete: 'off', ...attrs });
  const nominal = input('edNom', fmtNum(hh.nominal, 0), { inputmode: 'decimal' });
  const carico = input('edCar', Number.isFinite(hh.carico) ? fmtNum(hh.carico, 3) : '', { inputmode: 'decimal', placeholder: 'es. 98,50' });
  const name = input('edName', spec ? spec.name : hh.desc, { class: 'input text' });
  const maturity = input('edMat', spec && spec.maturity ? spec.maturity : '', { type: 'date' });
  const coupon = input('edCpn', spec && Number.isFinite(+spec.coupon) ? fmtNum(+spec.coupon, 3) : '', { inputmode: 'decimal', placeholder: 'es. 3,25' });
  let freq = spec ? (spec.freq || 2) : 2, tax = spec && spec.tax === 0.26 ? 0.26 : 0.125;
  const premio = input('edPrem', spec && spec.premio ? fmtNum(spec.premio, 2) : '', { inputmode: 'decimal', placeholder: 'es. 0,8' });
  const steps = h('textarea', { class: 'input text', id: 'edSteps', rows: 3, placeholder: 'una riga per cambio: 10/10/2026 4,50' });
  steps.value = spec && spec.steps ? spec.steps.map(s => `${fmt(parseDay(s.from))} ${fmtNum(s.rate, 2)}`).join('\n') : '';
  const seg = (opts, get, set, label) => {
    const box = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    const draw = () => box.replaceChildren(...opts.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(get() === v), text: t, on: { click: () => { set(v); draw(); } } })));
    draw();
    return box;
  };
  const field = (id, label, control, note) => h('div', { class: 'field' }, h('label', { class: 'lbl', for: id, text: label }), control, note ? h('p', { class: 'note', text: note }) : null);
  const body = h('div', { class: 'form' },
    field('edNom', 'Valore nominale €', nominal),
    field('edCar', 'Prezzo medio di carico', carico, 'In % del nominale, come nell\'estratto della banca. Serve per la tassa a scadenza.'),
    inData ? h('p', { class: 'note', text: `${r.bond.desc}: scadenza, cedole e prezzo arrivano dai dati STFI di oggi.` }) : [
      h('p', { class: 'note', text: RETAIL_BTP[hh.isin] && !hh.manual ? 'BTP per i risparmiatori: dati dalla tabella dell\'app, modificabili.' : 'Il titolo non è nei dati STFI di oggi: descrivilo qui per includerlo nei calcoli.' }),
      field('edName', 'Nome', name),
      field('edMat', 'Scadenza', maturity),
      field('edCpn', 'Cedola annua lorda %', coupon, 'Per i titoli con cedole crescenti è la prima; i cambi vanno nelle righe sotto.'),
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Cedole all\'anno' }), seg([[1, '1'], [2, '2'], [4, '4 (trimestrali)']], () => freq, v => { freq = v; }, 'Cedole all\'anno')),
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Tassazione' }), seg([[0.125, '12,5% Stati'], [0.26, '26% altri']], () => tax, v => { tax = v; }, 'Tassazione')),
      field('edSteps', 'Cedole crescenti (facoltativo)', steps, 'Data da cui vale il nuovo tasso e tasso annuo lordo, una riga per cambio.'),
      field('edPrem', 'Premio a scadenza % (facoltativo)', premio, 'Premio fedeltà dei BTP Valore e simili, se lo hai sottoscritto al collocamento.')]);
  const specNow = () => JSON.stringify([name.value, maturity.value, coupon.value, freq, tax, steps.value, premio.value]);
  const specStart = specNow();
  const save = () => {
    const n = parseUserNumber(nominal.value), c = parseUserNumber(carico.value);
    if (!(n > 0)) { toast('Indica il valore nominale', 'err'); nominal.focus(); return; }
    const next = { ...hh, nominal: n, carico: c > 0 && c < 1000 ? c : null };
    // BTP retail dalla tabella: resta collegato alla tabella finché non se ne cambiano le caratteristiche
    if (!inData && !(r.status === 'retail' && specNow() === specStart)) {
      const mat = maturity.value;
      if (mat) {
        const stepList = steps.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
          const [d, rate] = l.split(/\s+/);
          const dd = parseDay(d);
          return dd != null && Number.isFinite(parseUserNumber(rate)) ? { from: iso(dd), rate: parseUserNumber(rate) } : null;
        }).filter(Boolean);
        const cp = parseUserNumber(coupon.value);
        next.manual = { name: name.value.trim() || hh.desc || hh.isin, maturity: mat, coupon: Number.isFinite(cp) ? cp : 0, freq, tax,
          steps: stepList.length ? [{ from: '1900-01-01', rate: Number.isFinite(cp) ? cp : 0 }, ...stepList] : [], premio: parseUserNumber(premio.value) || 0 };
      }
    }
    C.onChange({ ...C.portfolio, holdings: C.portfolio.holdings.map(x => x.isin === hh.isin ? next : x) }, 'Titolo aggiornato');
    closeSheet();
  };
  openSheet({ title: 'Modifica titolo', sub: `${hh.isin}${r.bond ? ' · ' + r.bond.desc : ''}`, body,
    foot: [mini('Togli dal portafoglio', () => { closeSheet(); removeOne(hh.isin); }, { class: 'mini push-left' }), mini('Annulla', () => closeSheet()),
      h('button', { type: 'button', class: 'mini primary', text: 'Salva', on: { click: save } })] });
}

function removeOne(isin) {
  C.onChange({ ...C.portfolio, holdings: C.portfolio.holdings.filter(x => x.isin !== isin) }, 'Titolo tolto dal portafoglio');
}

function clearAsk() {
  openSheet({ title: 'Svuotare il portafoglio?', sub: 'solo in questo browser', body: h('p', { text: 'Tutti i titoli caricati verranno tolti. I file della banca non vengono toccati: potrai ricaricarli quando vuoi.' }),
    foot: [mini('Annulla', () => closeSheet()), h('button', { type: 'button', class: 'mini primary', text: 'Svuota', on: { click: () => { closeSheet(); C.onChange({ ...C.portfolio, holdings: [], source: null }, 'Portafoglio svuotato'); } } })] });
}

function toCsv(res) {
  const n = (v, d) => Number.isFinite(v) ? fmtNum(v, d).replace(MINUS, '-') : '';
  const head = ['ISIN', 'Titolo', 'Scadenza', 'Nominale', 'Prezzo di carico', 'Prezzo oggi', 'Valore oggi', 'Rimborso netto'];
  const lines = res.map(r => [r.h.isin, r.bond ? r.bond.desc : r.h.desc, r.bond ? fmt(r.bond.maturity) : '', n(r.h.nominal, 0), n(r.h.carico, 3),
    r.bond ? n(r.bond.price, 3) : '', n(r.value, 2), r.flows.length ? n(r.flows[r.flows.length - 1].net, 2) : '']);
  return '﻿' + [head, ...lines].map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

export { monthsFrom };
