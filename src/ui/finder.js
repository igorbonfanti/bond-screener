/* Scheda «Un titolo»: per comprare un solo titolo senza costruire una scala. Filtri (emittente, aree,
   scadenze, rating, prezzo, liquidità, tipo di cedola, testo) e ordinamento (rendimento netto o super netto,
   cedola, prezzo, scadenza, durata, liquidità): il primo della lista è «il migliore». Per il titolo scelto,
   quanto si compra con l'importo indicato, quanto costa davvero e cosa si incassa (flussi netti dell'app).
   Le impostazioni restano nel browser. */
import { h, fmtEur, fmtPct, fmtNum, parseUserNumber, copyText, toast, downloadFile, MINUS } from './dom.js';
import { calendarPanel, dataTable } from './results.js';
import { issuerCatalog } from '../core/basket.js';
import { ratingScore } from '../data/stfi.js';
import { cashflows, scoreYield } from '../core/bond.js';
import { fmt, parts } from '../core/dates.js';

const KEY = 'bondladder.finder.v1';
const store = {
  get: () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set: v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* navigazione privata */ } }
};

export const SORTS = {
  net: { label: 'Rendimento netto', short: 'Rend. netto', dir: -1, v: b => scoreYield(b, false) },
  super: { label: 'Rendimento super netto (zainetto)', short: 'Super netto', dir: -1, v: b => scoreYield(b, true) },
  coupon: { label: 'Cedola più alta', short: 'Cedola', dir: -1, v: b => b.coupon },
  price: { label: 'Prezzo più basso', short: 'Prezzo', dir: 1, v: b => b.price },
  maturity: { label: 'Scadenza più vicina', short: 'Scadenza', dir: 1, v: b => b.maturity },
  duration: { label: 'Durata più breve', short: 'Duration', dir: 1, v: b => b.durGross },
  liquidity: { label: 'Più scambiato', short: 'Liquidità', dir: -1, v: b => b.liquidity * 1e12 + (b.volume || 0) }
};
const TYPES = [['all', 'Tutti'], ['fixed', 'Cedola fissa'], ['zc', 'Zero coupon'], ['stepup', 'Step-up'], ['infl', 'Indicizzati']];
const RATINGS = [['AA-', '≥ AA-'], ['A-', '≥ A-'], ['BBB+', '≥ BBB+'], ['BBB-', '≥ BBB-'], ['', 'Tutti']];
const PRICES = [[100, '≤ 100'], [102, '≤ 102'], [105, '≤ 105'], [null, 'Tutti']];
const LIQS = [[0, 'Nessuna'], [1, 'Bassa'], [2, 'Buona'], [3, 'Alta']];

export function finderDefaults(y) {
  return { issuer: '', areas: { euro: true, sov: true, extra: false }, from: y + 1, to: y + 5, minRating: 'BBB-', maxPrice: null,
    minLiq: 1, type: 'all', sort: 'net', amount: 10000, q: '', excludeRetail: false };
}

/** Titoli che passano i filtri, già ordinati (il primo è il migliore). Pura: la usano anche i test. */
export function findBonds(ds, f) {
  const s = SORTS[f.sort] || SORTS.net;
  const min = f.minRating ? ratingScore(f.minRating) : null;
  const q = (f.q || '').trim().toUpperCase();
  const out = ds.bonds.filter(b => {
    if (b.currency !== 'EUR' || b.group === 'corp' || b.anomaly) return false;
    if (b.status && !/^senior$/i.test(b.status)) return false;
    if (b.maturity <= ds.settle + 7) return false;
    if (f.issuer ? b.issuer !== f.issuer : !f.areas[b.area]) return false;
    const y = parts(b.maturity).y;
    if (y < f.from || y > f.to) return false;
    if (min != null && (b.ratingScore == null || b.ratingScore < min)) return false;
    if (f.maxPrice != null && b.price > f.maxPrice) return false;
    if (b.liquidity < f.minLiq) return false;
    if (f.type === 'zc' && !b.zc) return false;
    if (f.type === 'fixed' && (b.zc || b.stepUp || b.inflation)) return false;
    if (f.type === 'stepup' && !b.stepUp) return false;
    if (f.type === 'infl' && !b.inflation) return false;
    if (f.type !== 'infl' && f.type !== 'all' && b.inflation) return false;
    if (q && !(b.isin.includes(q) || b.desc.toUpperCase().includes(q) || (b.issuerName || '').toUpperCase().includes(q))) return false;
    return Number.isFinite(s.v(b));
  });
  // a parità sul criterio scelto vince il rendimento netto più alto
  return out.sort((a, b) => (s.v(a) - s.v(b)) * s.dir || scoreYield(b, false) - scoreYield(a, false));
}

/** Acquisto di un titolo con un importo: nominale a lotti interi, costo vero, incassi netti. */
export function purchase(b, settle, amount, zainetto = false) {
  const per100 = b.cost;
  const lots = Math.floor(amount / (per100 / 100 * b.lot) + 1e-9);
  const nominal = lots * b.lot;
  const cost = nominal * per100 / 100;
  const flows = cashflows(b, settle, { zainetto }).map(f => ({ ...f, isin: b.isin, bond: b,
    gross: f.gross * nominal / 100, tax: f.tax * nominal / 100, net: f.net * nominal / 100 }));
  const received = flows.reduce((s, f) => s + f.net, 0);
  const coupons = flows.filter(f => f.kind === 'coupon');
  return { nominal, cost, lotCost: per100 / 100 * b.lot, flows, received, gain: received - cost,
    couponsNet: coupons.reduce((s, f) => s + f.net, 0), yearlyCoupon: b.coupon * (1 - b.tax) * nominal / 100 };
}

let C = null;   // { root, ds, zainetto }

export function renderFinder(root, ctx) {
  C = { ...ctx, root, sel: null };
  const saved = store.get();
  const y = ctx.ds ? parts(ctx.ds.settle).y : new Date().getFullYear();
  C.f = { ...finderDefaults(y), ...(saved || {}), areas: { ...finderDefaults(y).areas, ...((saved && saved.areas) || {}) } };
  paint();
}

const panel = (title, meta, ...body) => h('section', { class: 'panel' },
  h('div', { class: 'ph' }, h('h2', { text: title }), meta ? h('span', { class: 'meta', text: meta }) : null), ...body);
const kpi = (k, v, s) => h('div', { class: 'kpi' }, h('span', { class: 'k', text: k }), h('span', { class: 'v num' }, v), s ? h('span', { class: 's', text: s }) : null);
let uid = 0;
function field(label, control, note) {
  const inp = control.tagName === 'INPUT' || control.tagName === 'SELECT' ? control : control.querySelector('input, select');
  const id = inp ? (inp.id || (inp.id = `fx${++uid}`)) : null;
  return h('div', { class: 'field' }, h(id ? 'label' : 'span', { class: 'lbl', for: id }, h('span', { text: label })), control, note ? h('p', { class: 'note', text: note }) : null);
}
function seg(k, options, value, onPick, label) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label }, options.map(([v, text]) =>
    h('button', { type: 'button', 'aria-pressed': String(v === value), data: { k: `${k}:${v}` }, text, on: { click: () => onPick(v) } })));
}
function set(fn, repaintSide = true) {
  fn(C.f); store.set(C.f); C.sel = null;
  if (repaintSide) paint(); else paintResults();
}
function yearInput(k, value, label, onValue) {
  const inp = h('input', { class: 'input', inputmode: 'numeric', value: String(value), data: { k }, 'aria-label': label, style: { width: '6em' } });
  inp.addEventListener('change', () => { const v = Math.round(parseUserNumber(inp.value)); if (v >= 2000 && v <= 2100) onValue(v); else inp.value = String(value); });
  return inp;
}

function paint() {
  const { ds } = C;
  if (!ds) { C.root.replaceChildren(panel('Un titolo', null, h('p', { class: 'note', style: { padding: '10px' }, text: 'Servono i dati del giorno: caricali dalla data EOD in alto.' }))); return; }
  const active = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
  const side = h('aside', { class: 'side stack', 'aria-label': 'Filtri' }, filtersPanel());
  C.res = h('div', { class: 'results stack', 'aria-live': 'polite' });
  C.root.replaceChildren(h('div', { class: 'layout' }, side, C.res));
  paintResults();
  if (active) { const el = C.root.querySelector(`[data-k="${CSS.escape(active)}"]`); if (el) el.focus({ preventScroll: true }); }
}

function filtersPanel() {
  const f = C.f;
  const cat = issuerCatalog(C.ds);
  const label = e => `${e.name}${e.rating ? ` · ${e.rating}` : ''} (${e.count})`;
  const groups = [['euro', 'Stati dell\'area euro'], ['sov', 'Sovranazionali'], ['extra', 'Altri Stati in euro']];
  const sel = h('select', { class: 'input', data: { k: 'issuer' } },
    h('option', { value: '', selected: !f.issuer, text: 'Tutti (secondo le aree)' }),
    groups.map(([g, t]) => h('optgroup', { label: t }, cat.filter(e => e.area === g).map(e => h('option', { value: e.issuer, selected: e.issuer === f.issuer, text: label(e) })))));
  sel.addEventListener('change', () => set(s => { s.issuer = sel.value; }));
  const q = h('input', { class: 'input', type: 'search', value: f.q, placeholder: 'es. BTP, Bund, Valore, un ISIN', data: { k: 'q' } });
  let t = null;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => set(s => { s.q = q.value; }, false), 250); });
  const sortSel = h('select', { class: 'input', data: { k: 'sort' } }, Object.entries(SORTS).map(([k, s]) => h('option', { value: k, selected: k === f.sort, text: s.label })));
  sortSel.addEventListener('change', () => set(s => { s.sort = sortSel.value; }));
  const amount = h('input', { class: 'input', inputmode: 'decimal', value: fmtNum(f.amount, 0), data: { k: 'amount' } });
  amount.addEventListener('change', () => { const v = parseUserNumber(amount.value); if (v > 0) set(s => { s.amount = v; }, false); else amount.value = fmtNum(f.amount, 0); });
  const areaBox = (k, text) => h('label', { class: 'kbopt' }, h('input', { type: 'checkbox', checked: !!f.areas[k], disabled: !!f.issuer, data: { k: `area:${k}` },
    on: { change: e => set(s => { s.areas[k] = e.target.checked; }) } }), h('span', null, h('b', { text })));
  return panel('Cerca un titolo', 'compri un solo titolo, niente scala',
    h('div', { class: 'pb form' },
      field('Ordina per', sortSel, 'Il primo della lista è il migliore per questo criterio; a parità vince il rendimento netto.'),
      field('Emittente', sel, f.issuer ? null : 'Per esempio Germania per i Bund, Italia per i BTP.'),
      f.issuer ? null : h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Aree' }), areaBox('euro', 'Area euro'), areaBox('sov', 'Sovranazionali (BEI, UE, ESM…)'), areaBox('extra', 'Altri Stati in euro')),
      field('Scadenza dal', h('div', { class: 'row', style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        yearInput('from', f.from, 'Dall\'anno', v => set(s => { s.from = v; if (s.to < v) s.to = v; })), h('span', { text: 'al' }),
        yearInput('to', f.to, 'All\'anno', v => set(s => { s.to = v; if (s.from > v) s.from = v; }))), 'Anni compresi.'),
      field('Tipo di cedola', seg('type', TYPES, f.type, v => set(s => { s.type = v; }), 'Tipo di cedola'),
        f.type === 'infl' ? 'BTP Italia e BTP€i: il rendimento del file è senza indicizzazione, non confrontabile con gli altri.' : null),
      field('Rating minimo', seg('rating', RATINGS, f.minRating, v => set(s => { s.minRating = v; }), 'Rating minimo')),
      field('Prezzo massimo', seg('price', PRICES, f.maxPrice, v => set(s => { s.maxPrice = v; }), 'Prezzo massimo'), '≤ 100: solo sotto la pari (a scadenza solo plusvalenze).'),
      field('Liquidità minima', seg('liq', LIQS, f.minLiq, v => set(s => { s.minLiq = v; }), 'Liquidità minima'), 'Classe di scambi STFI: con «Buona» o più il prezzo è più affidabile.'),
      field('Cerca nel nome', q),
      field('Importo da investire', h('div', { class: 'input-wrap' }, amount, h('span', { class: 'suffix', 'aria-hidden': 'true', text: '€' })),
        'Per sapere quanto nominale compri e cosa incassi.')));
}

function paintResults() {
  const { ds, f } = C;
  const list = findBonds(ds, f);
  const s = SORTS[f.sort] || SORTS.net;
  if (!list.length) {
    C.res.replaceChildren(panel('Nessun titolo', null, h('p', { class: 'note', style: { padding: '10px' },
      text: 'Nessun titolo passa tutti i filtri: allarga gli anni di scadenza, abbassa il rating o la liquidità minima, togli il limite di prezzo.' })));
    return;
  }
  const b = C.sel && list.find(x => x.isin === C.sel) || list[0];
  const best = b === list[0];
  const p = purchase(b, ds.settle, f.amount, f.sort === 'super');
  const y = scoreYield(b, f.sort === 'super');
  const kpis = h('div', { class: 'kpis' },
    kpi(best ? 'Il migliore' : 'Scelto', b.desc, `${b.isin} · ${b.issuerName}${b.rating ? ' · ' + b.rating : ''}`),
    kpi(f.sort === 'super' ? 'Rend. super netto' : 'Rendimento netto', fmtPct(y), 'annuo a scadenza, dopo le tasse'),
    kpi('Cedola', b.zc ? 'zero coupon' : fmtPct(b.coupon), b.zc ? 'guadagno solo a scadenza' : `lorda annua${b.stepUp ? ' (cresce: step-up)' : ''}`),
    kpi('Prezzo', fmtNum(b.price, 2), `scade il ${fmt(b.maturity)}`),
    kpi('Con ' + fmtEur(f.amount), p.nominal ? fmtEur(p.nominal) : '—', p.nominal ? `di nominale · costo ${fmtEur(p.cost, 2)}` : `il lotto minimo costa ${fmtEur(p.lotCost)}`),
    kpi('Incassi netti', p.nominal ? fmtEur(p.received) : '—', p.nominal ? `guadagno netto ${fmtEur(p.gain)}` : 'aumenta l\'importo'));
  const lead = h('p', { class: 'lead' }, `${list.length} ${list.length === 1 ? 'titolo passa' : 'titoli passano'} i filtri; ordinati per ${s.label.toLowerCase()}. `,
    best ? 'Il primo è ' : 'Hai scelto ', h('b', { text: b.desc }), p.nominal
      ? [': con ', h('b', { text: fmtEur(p.cost, 2) }), ` compri ${fmtEur(p.nominal)} di nominale${b.zc ? '' : ` (cedole nette ${fmtEur(p.yearlyCoupon)} l'anno)`} e fino al ${fmt(b.maturity)} incassi `, h('b', { text: fmtEur(p.received) }), ' netti.']
      : `: con ${fmtEur(f.amount)} non arrivi al lotto minimo (${fmtEur(p.lotCost)}).`);
  const notes = [];
  if (b.inflation) notes.push('Titolo indicizzato all\'inflazione: rendimento e flussi sono senza indicizzazione (minimo garantito), quindi prudenti.');
  if (b.stepUp && !b.steps) notes.push('Cedola crescente non in tabella: i flussi usano la cedola di oggi (prudente).');
  if (b.priceType === 'RP') notes.push('Nessuno scambio oggi: il prezzo è di riferimento, quello vero può essere diverso.');
  if (b.liquidity < 2) notes.push('Titolo poco scambiato: in acquisto lo spread denaro-lettera può pesare.');
  if (b.price > 100) notes.push('Sopra la pari: a scadenza una minusvalenza (recuperabile con plusvalenze entro 4 anni).');
  notes.push('Costo = prezzo + rateo, meno il credito d\'imposta sul rateo e sul disaggio maturato; esclusi commissioni e bollo.');
  const actions = h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'mini', text: 'Copia ISIN', on: { click: async () => toast(await copyText(b.isin) ? `ISIN ${b.isin} copiato` : b.isin, 'ok') } }),
    h('button', { type: 'button', class: 'mini', text: 'Esporta elenco CSV', on: { click: () => downloadFile(`titoli-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(list)) } }),
    best ? null : h('button', { type: 'button', class: 'mini', text: 'Torna al migliore', on: { click: () => { C.sel = null; paintResults(); } } }));
  const rows = list.slice(0, 100);
  const cols = [
    { label: '#', cell: x => String(list.indexOf(x) + 1) },
    { label: 'Titolo', sort: x => x.desc, cell: x => h('span', { class: 'ttl' }, h('b', { text: x.desc }), h('span', { class: 'code', text: x.isin })) },
    { label: 'Scadenza', r: true, sort: x => x.maturity, cell: x => fmt(x.maturity) },
    { label: 'Cedola', r: true, sort: x => x.coupon, dir: -1, cell: x => x.zc ? 'ZC' : fmtNum(x.coupon, 3) },
    { label: 'Prezzo', r: true, sort: x => x.price, cell: x => fmtNum(x.price, 2) },
    { label: 'Netto', r: true, sort: x => scoreYield(x, false), dir: -1, cell: x => fmtPct(scoreYield(x, false)) },
    { label: 'Super netto', r: true, sort: x => scoreYield(x, true), dir: -1, cell: x => fmtPct(scoreYield(x, true)) },
    { label: 'Duration', r: true, sort: x => x.durGross, cell: x => fmtNum(x.durGross, 1) },
    { label: 'Rating', sort: x => -(x.ratingScore ?? -1), cell: x => x.rating || 'NR' },
    { label: 'Liq.', r: true, sort: x => x.liquidity, dir: -1, cell: x => String(x.liquidity) },
    { label: 'Lotto', r: true, sort: x => x.lot, cell: x => fmtNum(x.lot, 0) }
  ];
  const table = dataTable({ cols, rows, label: 'Titoli che passano i filtri', cls: 'compact',
    rowAttrs: x => ({ class: x === b ? 'sel' : null, tabindex: 0, 'aria-label': `${x.desc}: usa questo`,
      on: { click: () => { C.sel = x.isin; paintResults(); }, keydown: e => { if (e.key === 'Enter') { C.sel = x.isin; paintResults(); } } } }) });
  C.res.replaceChildren(...[kpis, lead, actions,
    panel('Da sapere', `${notes.length} note`, h('div', { class: 'pb' }, h('ul', { class: 'note', style: { margin: 0, paddingLeft: '18px' } }, notes.map(n => h('li', { text: n }))))),
    panel('Titoli che passano i filtri', `${list.length > 100 ? 'i primi 100 di ' + list.length : list.length} · clic su una riga per vederla`, table),
    p.nominal ? calendarPanel(p.flows, `${b.desc} · ${fmtEur(p.nominal)} di nominale · euro netti`) : null
  ].filter(Boolean));
}

function toCsv(list) {
  const n = (v, d) => Number.isFinite(v) ? fmtNum(v, d).replace(MINUS, '-') : '';
  const head = ['ISIN', 'Titolo', 'Emittente', 'Scadenza', 'Cedola %', 'Prezzo', 'Rend. netto %', 'Super netto %', 'Duration', 'Rating', 'Liquidità', 'Lotto'];
  const rows = list.map(b => [b.isin, b.desc, b.issuerName, fmt(b.maturity), n(b.coupon, 3), n(b.price, 2), n(scoreYield(b, false), 2), n(scoreYield(b, true), 2), n(b.durGross, 2), b.rating || 'NR', b.liquidity, b.lot]);
  return [head, ...rows].map(r => r.map(c => /[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(';')).join('\n');
}
