/* Pannello impostazioni: 1 Obiettivo · 2 Importi e scadenze · 3 Titoli ammessi · Opzioni.
   Ogni modifica aggiorna lo stato e fa ricalcolare la proposta; le modifiche "strutturali"
   (cambio di modalità, chip…) ridisegnano il pannello mantenendo il focus. */
import { h, icon, parseUserNumber, fmtNum } from './dom.js';
import { AREAS, RATING_SCALE } from '../data/stfi.js';
import { issuerCatalog } from '../core/basket.js';
import { ratingScore } from '../data/stfi.js';
import { parts, MONTHS_LONG } from '../core/dates.js';

const RATING_OPTS = [['AA-', '≥ AA-'], ['A-', '≥ A-'], ['BBB+', '≥ BBB+'], ['BBB-', 'Investment grade']];
const LIQ_OPTS = [[0, 'Tutti'], [1, 'Scambiati'], [2, 'Buona'], [3, 'Alta']];
const CAP_OPTS = [[1, 'Libera'], [0.5, '≤ 50%'], [1 / 3, '≤ 33%'], [0.25, '≤ 25%']];
const PRICE_OPTS = [[102, '≤ 102'], [105, '≤ 105'], [110, '≤ 110'], [null, 'Qualsiasi']];

let ctx = null;
let advOpen = false;   // "Opzioni avanzate" resta aperto fra un ridisegno e l'altro

/** ctx: { root, st, ds, changed(structural) } */
export function mountSettings(c) { ctx = c; renderSettings(); }

export function renderSettings() {
  if (!ctx) return;
  const active = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
  const { st } = ctx;
  const root = ctx.root;
  root.replaceChildren(
    section(1, 'Obiettivo', goalSection(st)),
    section(2, st.goal === 'income' ? 'Capitale e scadenze' : 'Importi e scadenze', st.goal === 'income' ? incomeSection(st) : capitalSection(st)),
    section(3, 'Titoli ammessi', basketSection(st)),
    h('div', { class: 'sec' }, optionsSection(st))
  );
  if (active) { const el = root.querySelector(`[data-k="${CSS.escape(active)}"]`); if (el) el.focus({ preventScroll: true }); }
}

function section(n, title, body) {
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('span', { class: 'sec-num', text: String(n) }), h('h2', { class: 'sec-title', text: title })),
    h('div', { class: 'sec-body stack' }, body));
}

const set = (fn, structural = false) => { fn(ctx.st); ctx.changed(structural); if (structural) renderSettings(); };

function seg(k, options, value, onPick, label) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label || '' }, options.map(([v, text]) =>
    h('button', { type: 'button', 'aria-pressed': String(v === value), data: { k: `${k}:${v}` }, text, on: { click: () => onPick(v) } })));
}

function sw(k, checked, title, help, onToggle) {
  return h('label', { class: 'switch' },
    h('input', { type: 'checkbox', checked, data: { k }, on: { change: e => onToggle(e.target.checked) } }),
    h('span', { class: 'track' }),
    h('span', { class: 'sw-text' }, h('b', { text: title }), help ? h('span', { text: help }) : null));
}

function moneyInput(k, value, suffix, onValue, attrs = {}) {
  const input = h('input', { class: 'input', inputmode: 'decimal', value: fmtNum(value, 0), data: { k }, ...attrs });
  input.addEventListener('input', () => { const v = parseUserNumber(input.value); if (v > 0) onValue(v); });
  input.addEventListener('blur', () => { const v = parseUserNumber(input.value); input.value = v > 0 ? fmtNum(v, 0) : fmtNum(value, 0); });
  return h('div', { class: 'input-wrap' }, input, h('span', { class: 'suffix', text: suffix }));
}

function yearStepper(k, value, min, max, onValue) {
  const input = h('input', { inputmode: 'numeric', value: String(value), data: { k }, 'aria-label': 'anno' });
  const clamp = v => Math.max(min, Math.min(max, v));
  const commit = v => { v = clamp(v); input.value = String(v); onValue(v); };
  input.addEventListener('change', () => { const v = parseInt(input.value, 10); if (Number.isFinite(v)) commit(v); else input.value = String(value); });
  return h('div', { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': 'anno precedente', text: '−', on: { click: () => commit((parseInt(input.value, 10) || value) - 1) } }),
    input,
    h('button', { type: 'button', 'aria-label': 'anno successivo', text: '+', on: { click: () => commit((parseInt(input.value, 10) || value) + 1) } }));
}

function yearsRow(kPrefix, obj, minYear) {
  return h('div', { class: 'years' },
    yearStepper(kPrefix + 'from', obj.yearFrom, minYear, 2080, v => set(s => { s[kPrefix === 'c' ? 'capital' : 'income'].yearFrom = v; const o = s[kPrefix === 'c' ? 'capital' : 'income']; if (o.yearTo < v) o.yearTo = v; }, true)),
    h('span', { class: 'sep', text: 'al' }),
    yearStepper(kPrefix + 'to', obj.yearTo, minYear, 2080, v => set(s => { const o = s[kPrefix === 'c' ? 'capital' : 'income']; o.yearTo = v; if (o.yearFrom > v) o.yearFrom = v; }, true)));
}

/* ---------- 1. Obiettivo ---------- */
function goalSection(st) {
  return h('div', { class: 'goals' },
    goalCard('capital', 'capital', 'Capitale a scadenza', 'Somme disponibili a date precise o ogni anno', st.goal),
    goalCard('income', 'income', 'Rendita mensile', 'Cedole ogni mese, il capitale torna alle scadenze', st.goal));
}
export function goalCard(value, ic, title, text, current) {
  return h('button', { type: 'button', class: 'goal', 'aria-pressed': String(current === value), data: { k: 'goal:' + value },
    on: { click: () => set(s => { s.goal = value; }, true) } }, icon(ic), h('b', { text: title }), h('span', { text }));
}

/* ---------- 2a. Capitale a scadenza ---------- */
function capitalSection(st) {
  const c = st.capital, minYear = ctx.ds ? parts(ctx.ds.refDate).y : new Date().getFullYear();
  const out = [];
  out.push(h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Scadenze' }),
    seg('sched', [['yearly', 'Annuali'], ['semester', 'Semestrali'], ['dates', 'Date precise']], c.schedule, v => set(s => { s.capital.schedule = v; }, true), 'Tipo di scadenze')));
  if (c.schedule !== 'dates') {
    out.push(h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Parto da' }),
      seg('cstart', [['amounts', 'Importo che mi serve'], ['budget', 'Capitale che ho']], c.start, v => set(s => { s.capital.start = v; }, true))));
    out.push(h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Scadenze dal' }), yearsRow('c', c, minYear),
      h('span', { class: 'help', text: `Per ogni ${c.schedule === 'semester' ? 'semestre' : 'anno'} l'app sceglie il titolo migliore che scade in quel periodo.` })));
    out.push(c.start === 'budget'
      ? h('div', { class: 'field' }, h('label', { text: 'Capitale da investire' }), moneyInput('cbudget', c.budget, '€', v => set(s => { s.capital.budget = v; })),
          h('span', { class: 'help', text: 'Diviso in modo da ricevere la stessa somma a ogni scadenza.' }))
      : h('div', { class: 'field' }, h('label', { text: `Importo per ogni ${c.schedule === 'semester' ? 'semestre' : 'anno'}` }), moneyInput('camount', c.amount, '€', v => set(s => { s.capital.amount = v; }))));
  } else {
    const rows = c.dates.map((d, i) => h('div', { class: 'date-row' },
      h('input', { class: 'input text', value: d.label, placeholder: 'Descrizione', 'aria-label': 'descrizione', data: { k: `dl${i}` }, on: { input: e => set(s => { s.capital.dates[i].label = e.target.value; }) } }),
      h('input', { class: 'input', type: 'date', value: d.date, 'aria-label': 'data', data: { k: `dd${i}` }, on: { change: e => set(s => { s.capital.dates[i].date = e.target.value; }) } }),
      (() => { const inp = h('input', { class: 'input', inputmode: 'decimal', value: fmtNum(d.amount, 0), 'aria-label': 'importo', data: { k: `da${i}` } });
        inp.addEventListener('input', () => { const v = parseUserNumber(inp.value); if (v > 0) set(s => { s.capital.dates[i].amount = v; }); });
        inp.addEventListener('blur', () => { inp.value = fmtNum(parseUserNumber(inp.value) || d.amount, 0); }); return inp; })(),
      h('button', { type: 'button', class: 'del', 'aria-label': 'togli', text: '×', on: { click: () => set(s => { s.capital.dates.splice(i, 1); }, true) } })));
    out.push(h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Quando ti servono i soldi' }),
      h('div', { class: 'date-rows' }, rows),
      h('button', { type: 'button', class: 'link-btn', text: '+ Aggiungi una data', on: { click: () => set(s => {
        const last = s.capital.dates[s.capital.dates.length - 1];
        const y = last ? +last.date.slice(0, 4) + 1 : minYear + 2;
        s.capital.dates.push({ label: `Obiettivo ${s.capital.dates.length + 1}`, date: `${y}-${last ? last.date.slice(5) : '06-30'}`, amount: last ? last.amount : 10000 });
      }, true) } })));
    const flex = h('input', { type: 'range', min: 0, max: 24, step: 1, value: c.flexMonths, data: { k: 'flex' }, 'aria-label': 'mesi di anticipo ammessi' });
    const flexLbl = h('b', { text: `${c.flexMonths} mesi` });
    flex.addEventListener('input', () => { flexLbl.textContent = `${flex.value} mesi`; set(s => { s.capital.flexMonths = +flex.value; }); });
    out.push(h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Flessibilità'), h('span', { class: 'help' }, 'Il titolo può scadere fino a ', flexLbl, ' prima della data: più margine = più scelta e rendimenti migliori.'), flex));
  }
  out.push(sw('coupons', c.useCoupons, 'Usa le cedole per gli importi', c.useCoupons
    ? 'Per ogni scadenza contano le cedole del suo periodo (anno, semestre o 12 mesi prima della data): serve meno capitale. Quelle incassate prima sono un\'entrata in più.'
    : 'Gli importi arrivano solo dai rimborsi; le cedole sono un\'entrata in più.', v => set(s => { s.capital.useCoupons = v; })));
  return out;
}

/* ---------- 2b. Rendita mensile ---------- */
function incomeSection(st) {
  const i = st.income, minYear = ctx.ds ? parts(ctx.ds.refDate).y : new Date().getFullYear();
  const pr = Math.round((1 - i.tradeoff) * 100);
  const slider = h('input', { type: 'range', min: 0, max: 20, step: 1, value: pr, data: { k: 'tradeoff' }, 'aria-label': 'priorità tra rendita regolare e rendimento' });
  slider.addEventListener('input', () => set(s => { s.income.tradeoff = 1 - (+slider.value) / 100; }));
  return [
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Parto da' }),
      seg('istart', [['capital', 'Capitale che ho'], ['target', 'Rendita che voglio']], i.start, v => set(s => { s.income.start = v; }, true))),
    i.start === 'target'
      ? h('div', { class: 'field' }, h('label', { text: 'Rendita netta al mese (almeno)' }), moneyInput('itarget', i.monthlyTarget, '€', v => set(s => { s.income.monthlyTarget = v; })),
          h('span', { class: 'help', text: 'L\'app calcola il capitale necessario.' }))
      : h('div', { class: 'field' }, h('label', { text: 'Capitale da investire' }), moneyInput('icap', i.capital, '€', v => set(s => { s.income.capital = v; }))),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Scadenze dal' }), yearsRow('i', i, minYear),
      h('span', { class: 'help', text: 'Il capitale torna man mano che i titoli scadono in questo intervallo.' })),
    sw('ladder', i.ladder, 'Scadenze distribuite ogni anno', 'Come una scala: il capitale rientra un po\' ogni anno invece che tutto insieme.', v => set(s => { s.income.ladder = v; })),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Priorità' }), slider,
      h('div', { class: 'range-labels' }, h('span', { text: 'Rendita più regolare' }), h('span', { text: 'Più rendimento' })))
  ];
}

/* ---------- 3. Titoli ammessi ---------- */
function basketSection(st) {
  const b = st.basket;
  const catalog = ctx.ds ? issuerCatalog(ctx.ds) : [];
  const minScore = ratingScore(b.minRating) ?? 0;
  const excluded = new Set(b.excluded);
  const areaChip = (key, label) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!!b.groups[key]), data: { k: 'area:' + key },
    on: { click: () => set(s => { s.basket.groups[key] = !s.basket.groups[key]; }, true) } }, h('span', { text: label }));
  const groups = ['euro', 'sov', 'extra'].filter(a => b.groups[a]).map(area => {
    const list = catalog.filter(e => e.area === area);
    if (!list.length) return null;
    const chips = list.map(e => {
      const okRating = e.ratingScore != null && e.ratingScore >= minScore;
      const on = okRating && !excluded.has(e.issuer);
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), disabled: !okRating, data: { k: 'iss:' + e.issuer },
        title: okRating ? `${e.name}: ${e.count} titoli` : `${e.name}: rating ${e.rating || 'n.d.'} sotto la soglia`,
        on: { click: () => set(s => { const x = new Set(s.basket.excluded); x.has(e.issuer) ? x.delete(e.issuer) : x.add(e.issuer); s.basket.excluded = [...x]; }, true) } },
        h('span', { class: 'cc', text: e.area === 'sov' ? e.issuer.replace('SOV_', '').slice(0, 4) : e.country }),
        h('span', { text: e.name }), h('span', { class: 'rt', text: e.rating || 'NR' }));
    });
    const codes = list.map(e => e.issuer);
    return h('div', { class: 'chip-group' },
      h('div', { class: 'lbl' }, h('span', { text: AREAS[area] }), h('span', null,
        h('button', { type: 'button', text: 'tutti', on: { click: () => set(s => { s.basket.excluded = s.basket.excluded.filter(x => !codes.includes(x)); }, true) } }), ' · ',
        h('button', { type: 'button', text: 'nessuno', on: { click: () => set(s => { s.basket.excluded = [...new Set([...s.basket.excluded, ...codes])]; }, true) } }))),
      h('div', { class: 'chips' }, chips));
  });
  return [
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Emittenti' }),
      h('div', { class: 'area-toggles' }, areaChip('euro', 'Stati area euro'), areaChip('sov', 'Sovranazionali'), areaChip('extra', 'Altri Stati in euro'))),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Rischio: rating minimo' }),
      seg('rating', RATING_OPTS, b.minRating, v => set(s => { s.basket.minRating = v; }, true), 'Rating minimo')),
    groups.filter(Boolean).length ? h('div', null, groups) : h('div', { class: 'help', text: 'Scegli almeno un gruppo di emittenti.' }),
    sw('belowpar', b.belowPar, 'Solo titoli sotto la pari', 'Prezzo ≤ 100: a scadenza nessuna minusvalenza (che non si potrebbe compensare con le cedole).', v => set(s => { s.basket.belowPar = v; }, true)),
    b.belowPar ? null : h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Prezzo massimo' }),
      seg('maxprice', PRICE_OPTS, b.maxPrice ?? null, v => set(s => { s.basket.maxPrice = v; }, true))),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Liquidità minima' }),
      seg('liq', LIQ_OPTS, b.minLiquidity, v => set(s => { s.basket.minLiquidity = v; }, true), 'Liquidità minima'),
      h('span', { class: 'help', text: 'Classe di volume STFI (media 20 giorni): "Scambiati" esclude i titoli senza contrattazioni.' })),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Quota massima per emittente' }),
      seg('cap', CAP_OPTS, CAP_OPTS.find(([v]) => Math.abs(v - b.issuerCap) < 1e-6)?.[0] ?? b.issuerCap, v => set(s => { s.basket.issuerCap = v; }, true), 'Quota massima per emittente'))
  ];
}

/* ---------- Opzioni ---------- */
function optionsSection(st) {
  const b = st.basket;
  const items = [
    sw('zainetto', b.zainetto, 'Ho minusvalenze da recuperare', 'Usa il rendimento "super netto" di STFI: la plusvalenza a scadenza compensa lo zainetto fiscale e non viene tassata.', v => set(s => { s.basket.zainetto = v; })),
    sw('stepup', b.includeStepUp, 'Includi titoli step-up', 'BTP Valore, Futura, Più: cedola crescente. I flussi sono stimati con la cedola attuale (prudente).', v => set(s => { s.basket.includeStepUp = v; })),
    sw('infl', b.includeInflation, 'Includi BTP Italia e BTP€i', 'Nel file il loro rendimento è "senza indicizzazione": non è confrontabile con gli altri.', v => set(s => { s.basket.includeInflation = v; }))
  ];
  if (st.goal === 'capital' && st.capital.start !== 'budget') items.push(h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Arrotondamento ai lotti' }),
    seg('round', [['up', 'Almeno l\'importo'], ['nearest', 'Il più vicino']], st.capital.rounding, v => set(s => { s.capital.rounding = v; }, true))));
  if ((b.excludedIsins || []).length) items.push(h('div', { class: 'field' }, h('span', { class: 'lbl', text: `Titoli esclusi a mano (${b.excludedIsins.length})` }),
    h('button', { type: 'button', class: 'link-btn', text: 'Ripristina tutti', on: { click: () => set(s => { s.basket.excludedIsins = []; }, true) } })));
  const det = h('details', { class: 'adv', open: advOpen }, h('summary', { text: 'Opzioni avanzate' }), h('div', { class: 'stack' }, items));
  det.addEventListener('toggle', () => { advOpen = det.open; });
  return det;
}

export { RATING_SCALE, MONTHS_LONG };
