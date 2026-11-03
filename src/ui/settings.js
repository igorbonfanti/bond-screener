/* Pannello impostazioni (colonna di sinistra) nei componenti del sistema «Terminale ambra»:
   pannelli .panel con titolo ambra, gruppi .seg per le scelte esclusive, caselle per i sì/no,
   chip per gli emittenti. L'obiettivo si sceglie dalle schede in alto (1 CAPITALE, 2 RENDITA).
   Ogni modifica aggiorna lo stato e fa ricalcolare la proposta; le modifiche "strutturali"
   (cambio di modalità, chip…) ridisegnano il pannello mantenendo il focus. */
import { h, parseUserNumber, fmtNum, fmtEur } from './dom.js';
import { AREAS, RATING_SCALE } from '../data/stfi.js';
import { issuerCatalog } from '../core/basket.js';
import { ratingScore } from '../data/stfi.js';
import { parts, MONTHS_LONG } from '../core/dates.js';

const RATING_OPTS = [['AA-', '≥ AA-'], ['A-', '≥ A-'], ['BBB+', '≥ BBB+'], ['BBB-', '≥ BBB-']];
const LIQ_OPTS = [[0, 'Nessuna'], [1, 'Bassa'], [2, 'Buona'], [3, 'Alta']];
const CAP_OPTS = [[1, 'Libera'], [0.5, '≤ 50%'], [1 / 3, '≤ 33%'], [0.25, '≤ 25%']];
const PRICE_OPTS = [[102, '≤ 102'], [105, '≤ 105'], [110, '≤ 110'], [null, 'Qualsiasi']];

let ctx = null;
let advOpen = false;   // "Opzioni avanzate" resta aperto fra un ridisegno e l'altro

/** ctx: { root, st, ds, changed(structural), basketMeta ("N su M titoli", scritto da main.js dopo ogni calcolo),
    portfolio: { count, value, incomplete } | null, onEditPortfolio() } */
export function mountSettings(c) { ctx = c; renderSettings(); }

export function renderSettings() {
  if (!ctx) return;
  const active = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
  const { st } = ctx;
  const root = ctx.root;
  const ptf = ctx.portfolio && ctx.portfolio.count ? ctx.portfolio : null;
  root.replaceChildren(...[
    ptf && st.goal !== 'indexed' ? panel('Il mio portafoglio', `${ptf.count} titoli · ${fmtEur(ptf.value)}`, portfolioSection(st, ptf)) : null,
    ...(st.goal === 'indexed' ? indexedSections(st) : [panel(st.goal === 'income' ? 'Capitale e scadenze' : 'Importi e scadenze', st.goal === 'income' ? 'rendita mensile' : 'capitale a scadenza',
      [st.goal === 'income' ? incomeSection(st) : capitalSection(st),
        ptf ? null : h('p', { class: 'note' }, 'Hai già dei titoli? ', h('button', { type: 'button', class: 'linkbtn', text: 'Caricali nel portafoglio', on: { click: () => ctx.onEditPortfolio && ctx.onEditPortfolio() } }), ': la scala si costruisce attorno, senza venderli.')])]),
    panel('Titoli ammessi', ctx.basketMeta || null, basketSection(st), 'basketMeta'),
    optionsSection(st)
  ].filter(Boolean));
  if (active) { const el = root.querySelector(`[data-k="${CSS.escape(active)}"]`); if (el) el.focus({ preventScroll: true }); }
}

function panel(title, meta, body, metaId) {
  return h('section', { class: 'panel' },
    h('div', { class: 'ph' }, h('h2', { text: title }), h('span', { class: 'meta', id: metaId || null, text: meta || '' })),
    h('div', { class: 'pb form' }, body));
}

const set = (fn, structural = false) => { fn(ctx.st); ctx.changed(structural); if (structural) renderSettings(); };

let uid = 0;
/** Campo con etichetta collegata al controllo (for/id) e nota facoltativa. */
function field(label, control, note, extra) {
  const inp = control && (control.tagName === 'INPUT' || control.tagName === 'SELECT' ? control : control.querySelector && control.querySelector('input'));
  const id = inp ? (inp.id || (inp.id = `f${++uid}`)) : null;
  return h('div', { class: 'field' },
    h(id ? 'label' : 'span', { class: 'lbl', for: id }, h('span', { text: label }), extra || null),
    control, note ? h('p', { class: 'note' }, note) : null);
}

function seg(k, options, value, onPick, label) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label || '' }, options.map(([v, text]) =>
    h('button', { type: 'button', 'aria-pressed': String(v === value), data: { k: `${k}:${v}` }, text, on: { click: () => onPick(v) } })));
}

/** Sì/no: casella con titolo e spiegazione (niente levette, regola del sistema). */
function sw(k, checked, title, help, onToggle) {
  return h('label', { class: 'kbopt' },
    h('input', { type: 'checkbox', checked, data: { k }, on: { change: e => onToggle(e.target.checked) } }),
    h('span', null, h('b', { text: title }), help ? h('span', { class: 'note', text: help }) : null));
}

function moneyInput(k, value, suffix, onValue, attrs = {}) {
  const input = h('input', { class: 'input', inputmode: 'decimal', value: fmtNum(value, 0), data: { k }, ...attrs });
  input.addEventListener('input', () => { const v = parseUserNumber(input.value); if (v > 0) onValue(v); });
  input.addEventListener('blur', () => { const v = parseUserNumber(input.value); input.value = v > 0 ? fmtNum(v, 0) : fmtNum(value, 0); });
  return h('div', { class: 'input-wrap' }, input, h('span', { class: 'suffix', 'aria-hidden': 'true', text: suffix }));
}

function yearStepper(k, value, min, max, onValue, label) {
  const input = h('input', { inputmode: 'numeric', value: String(value), data: { k }, 'aria-label': label });
  const clamp = v => Math.max(min, Math.min(max, v));
  const commit = v => { v = clamp(v); input.value = String(v); onValue(v); };
  input.addEventListener('change', () => { const v = parseInt(input.value, 10); if (Number.isFinite(v)) commit(v); else input.value = String(value); });
  return h('div', { class: 'step' },
    h('button', { type: 'button', 'aria-label': `${label}: anno precedente`, text: '−', on: { click: () => commit((parseInt(input.value, 10) || value) - 1) } }),
    input,
    h('button', { type: 'button', 'aria-label': `${label}: anno successivo`, text: '+', on: { click: () => commit((parseInt(input.value, 10) || value) + 1) } }));
}

function yearsRow(kPrefix, obj, minYear) {
  const key = kPrefix === 'c' ? 'capital' : 'income';
  return h('div', { class: 'years' },
    yearStepper(kPrefix + 'from', obj.yearFrom, minYear, 2080, v => set(s => { s[key].yearFrom = v; if (s[key].yearTo < v) s[key].yearTo = v; }, true), 'Primo anno'),
    h('span', { class: 'sep', text: 'al' }),
    yearStepper(kPrefix + 'to', obj.yearTo, minYear, 2080, v => set(s => { s[key].yearTo = v; if (s[key].yearFrom > v) s[key].yearFrom = v; }, true), 'Ultimo anno'));
}

/* ---------- 1. Il mio portafoglio (solo se c'è) ---------- */
const PREF_NOTES = {
  mine: 'Dove hai già un titolo che scade in quel periodo ne compro altri pezzi, anche se i filtri del paniere lo escluderebbero; titoli nuovi solo dove non ne hai.',
  balanced: 'Un titolo nuovo solo se rende almeno 0,10 punti più del tuo (circa 10 € l\'anno ogni 10.000 €); altrimenti altri pezzi del tuo.',
  yield: 'Il titolo che rende di più, anche se nuovo: a parità preferisco il tuo.'
};
function portfolioSection(st, ptf) {
  const on = st.usePortfolio !== false, pref = st.portfolioPref || 'balanced';
  return [
    sw('ptfon', on, 'Costruisci attorno al mio portafoglio', 'Tengo i titoli che hai e compro solo quello che manca: niente vendite.', v => set(s => { s.usePortfolio = v; }, true)),
    on ? field('Nuovi acquisti', seg('ptfpref', [['mine', 'I miei titoli'], ['balanced', 'Equilibrato'], ['yield', 'Rendimento']], pref, v => set(s => { s.portfolioPref = v; }, true), 'Nuovi acquisti'), PREF_NOTES[pref]) : null,
    on && st.goal !== 'income' ? sw('ptfcarry', st.portfolioCarry !== false, 'Usa le eccedenze per le scadenze dopo', st.portfolioCarry !== false
      ? 'Quello che i tuoi titoli danno in più in una scadenza (e i rimborsi che arrivano prima della scala) resta in cassa, senza interessi, e paga le scadenze successive: oggi compri meno.'
      : 'Le eccedenze dei tuoi titoli tornano a te, da spendere o reinvestire: le scadenze scoperte le copri con acquisti di oggi.', v => set(s => { s.portfolioCarry = v; }, true)) : null,
    ptf.incomplete ? h('p', { class: 'note' }, h('b', { text: `${ptf.incomplete} ${ptf.incomplete === 1 ? 'titolo' : 'titoli'} da completare` }), ': finché mancano scadenza e cedola restano fuori dai calcoli.') : null,
    h('button', { type: 'button', class: 'linkbtn', text: 'Modifica il portafoglio', on: { click: () => ctx.onEditPortfolio && ctx.onEditPortfolio() } })
  ];
}

/* ---------- 2a. Capitale a scadenza ---------- */
function capitalSection(st) {
  const c = st.capital, minYear = ctx.ds ? parts(ctx.ds.refDate).y : new Date().getFullYear();
  const out = [];
  out.push(field('Scadenze', seg('sched', [['yearly', 'Annuali'], ['semester', 'Semestrali'], ['dates', 'Date precise']], c.schedule, v => set(s => { s.capital.schedule = v; }, true), 'Tipo di scadenze')));
  if (c.schedule !== 'dates') {
    out.push(field('Parto da', seg('cstart', [['amounts', 'Importo che mi serve'], ['budget', 'Capitale che ho']], c.start, v => set(s => { s.capital.start = v; }, true), 'Parto da')));
    out.push(field('Scadenze dal', yearsRow('c', c, minYear), `Per ogni ${c.schedule === 'semester' ? 'semestre' : 'anno'} l'app sceglie, fra i titoli che scadono in quel periodo, quello che rende più economica tutta la scala.`));
    if (c.schedule === 'yearly') {
      // rette, tasse, rate: i soldi devono arrivare prima di un mese preciso, non in un momento qualsiasi dell'anno
      const M = c.byMonth >= 1 && c.byMonth <= 11 ? c.byMonth : 0;
      const sel = h('select', { class: 'input', data: { k: 'bymonth' }, on: { change: e => set(s => { s.capital.byMonth = +e.target.value; s.fixed = {}; }, true) } },
        h('option', { value: '0', text: 'in qualsiasi mese dell\'anno' }),
        MONTHS_LONG.slice(0, 11).map((m, i) => h('option', { value: String(i + 1), text: `entro fine ${m}` })));
      sel.value = String(M);
      out.push(field('Mi servono', sel, M
        ? `Il titolo di ogni anno scade fra ${MONTHS_LONG[M % 12]} dell'anno prima e fine ${MONTHS_LONG[M - 1]}: i soldi arrivano in tempo.`
        : 'Il titolo può scadere anche a dicembre. Se ti servono prima (rette, tasse), scegli il mese.'));
    }
    out.push(c.start === 'budget'
      ? field('Capitale da investire', moneyInput('cbudget', c.budget, '€', v => set(s => { s.capital.budget = v; })), 'Diviso in modo da ricevere la stessa somma a ogni scadenza.')
      : field(`Importo per ogni ${c.schedule === 'semester' ? 'semestre' : 'anno'}`, moneyInput('camount', c.amount, '€', v => set(s => { s.capital.amount = v; }))));
  } else {
    const rows = c.dates.map((d, i) => h('div', { class: 'date-row' },
      h('input', { class: 'input text', value: d.label, placeholder: 'Descrizione', 'aria-label': 'descrizione', data: { k: `dl${i}` }, on: { input: e => set(s => { s.capital.dates[i].label = e.target.value; }) } }),
      h('input', { class: 'input', type: 'date', value: d.date, 'aria-label': 'data', data: { k: `dd${i}` }, on: { change: e => set(s => { s.capital.dates[i].date = e.target.value; }) } }),
      (() => { const inp = h('input', { class: 'input', inputmode: 'decimal', value: fmtNum(d.amount, 0), 'aria-label': 'importo', data: { k: `da${i}` } });
        inp.addEventListener('input', () => { const v = parseUserNumber(inp.value); if (v > 0) set(s => { s.capital.dates[i].amount = v; }); });
        inp.addEventListener('blur', () => { inp.value = fmtNum(parseUserNumber(inp.value) || d.amount, 0); }); return inp; })(),
      h('button', { type: 'button', class: 'del', 'aria-label': `togli ${d.label || 'questa data'}`, text: '×', on: { click: () => set(s => { s.capital.dates.splice(i, 1); }, true) } })));
    out.push(h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Quando ti servono i soldi' }),
      h('div', { class: 'date-rows' }, rows),
      h('button', { type: 'button', class: 'mini', data: { k: 'adddate' }, text: '+ Aggiungi una data', on: { click: () => set(s => {
        const last = s.capital.dates[s.capital.dates.length - 1];
        const y = last ? +last.date.slice(0, 4) + 1 : minYear + 2;
        s.capital.dates.push({ label: `Obiettivo ${s.capital.dates.length + 1}`, date: `${y}-${last ? last.date.slice(5) : '06-30'}`, amount: last ? last.amount : 10000 });
      }, true) } })));
    const flex = h('input', { type: 'range', class: 'range', min: 0, max: 24, step: 1, value: c.flexMonths, data: { k: 'flex' }, 'aria-label': 'mesi di anticipo ammessi', 'aria-valuetext': `${c.flexMonths} mesi` });
    const flexLbl = h('b', { class: 'num', text: `${c.flexMonths} mesi` });
    flex.addEventListener('input', () => { flexLbl.textContent = `${flex.value} mesi`; flex.setAttribute('aria-valuetext', `${flex.value} mesi`); set(s => { s.capital.flexMonths = +flex.value; }); });
    out.push(field('Flessibilità', flex, ['Il titolo può scadere fino a ', flexLbl, ' prima della data: più margine = più scelta e rendimenti migliori.']));
  }
  out.push(sw('coupons', c.useCoupons, 'Usa le cedole per gli importi', c.useCoupons
    ? 'Per ogni scadenza contano le cedole del suo periodo (anno, semestre o 12 mesi prima della data): serve meno capitale. Quelle incassate prima sono un\'entrata in più.'
    : 'Gli importi arrivano solo dai rimborsi; le cedole sono un\'entrata in più.', v => set(s => { s.capital.useCoupons = v; }, true)));
  if (c.useCoupons) out.push(sw('accumulate', !!c.accumulate, 'Accantona le cedole di prima', c.accumulate
    ? 'Le cedole incassate prima della scala (o fra una data e l\'altra) restano in cassa, senza interessi, e pagano le prime scadenze: serve meno capitale, i primi titoli si riducono o non servono.'
    : 'Le cedole incassate prima della scala sono un\'entrata in più da spendere o reinvestire: ogni scadenza ha il suo titolo.', v => set(s => { s.capital.accumulate = v; }, true)));
  return out;
}

/* ---------- 2b. Rendita mensile ---------- */
function incomeSection(st) {
  const i = st.income, minYear = ctx.ds ? parts(ctx.ds.refDate).y : new Date().getFullYear();
  const pr = Math.round((1 - i.tradeoff) * 100);
  const slider = h('input', { type: 'range', class: 'range', min: 0, max: 20, step: 1, value: pr, data: { k: 'tradeoff' }, 'aria-label': 'priorità tra rendita regolare e rendimento' });
  slider.addEventListener('input', () => set(s => { s.income.tradeoff = 1 - (+slider.value) / 100; }));
  const money = i.start === 'target'
    ? moneyInput('itarget', i.monthlyTarget, '€', v => set(s => { s.income.monthlyTarget = v; }))
    : moneyInput('icap', i.capital, '€', v => set(s => { s.income.capital = v; }));
  const moneyField = i.start === 'target' ? field('Rendita netta al mese (almeno)', money, 'L\'app calcola il capitale necessario.') : field('Capitale da investire', money);
  return [
    field('Parto da', seg('istart', [['capital', 'Capitale che ho'], ['target', 'Rendita che voglio']], i.start, v => set(s => { s.income.start = v; }, true), 'Parto da')),
    moneyField,
    field('Scadenze dal', yearsRow('i', i, minYear), 'Il capitale torna man mano che i titoli scadono in questo intervallo.'),
    sw('ladder', i.ladder, 'Scadenze distribuite ogni anno', 'Come una scala: il capitale rientra un po\' ogni anno invece che tutto insieme.', v => set(s => { s.income.ladder = v; })),
    field('Priorità', slider, null),
    h('div', { class: 'range-labels', 'aria-hidden': 'true' }, h('span', { text: 'Rendita più regolare' }), h('span', { text: 'Più rendimento' }))
  ];
}

/* ---------- 2c. Passività indicizzata ---------- */
const SCEN_NAMES = [['base', 'Base'], ['alto', 'Alto 3,5%'], ['basso', 'Basso 1%'], ['shock', 'Shock 8→5%'], ['basis', 'FOI +0,5%']];

/** Percentuale: si scrive in punti (2,3) e si salva in decimali (0,023). */
function pctInput(k, value, onValue, { min = -5, max = 30, dec = 2 } = {}) {
  const input = h('input', { class: 'input', inputmode: 'decimal', value: fmtNum(value * 100, dec), data: { k } });
  input.addEventListener('change', () => {
    const v = parseUserNumber(input.value);
    if (Number.isFinite(v) && v >= min && v <= max) onValue(v / 100); else input.value = fmtNum(value * 100, dec);
  });
  return h('div', { class: 'input-wrap' }, input, h('span', { class: 'suffix', 'aria-hidden': 'true', text: '%' }));
}

function indexedSections(st) {
  const a = st.indexed.alm, minYear = ctx.ds ? parts(ctx.ds.refDate).y : new Date().getFullYear();
  const setA = (fn, structural = true) => set(s => fn(s.indexed.alm), structural);
  const years = h('div', { class: 'years' },
    yearStepper('xfrom', a.yearFrom, minYear, 2080, v => setA(x => { x.yearFrom = v; if (x.yearTo < v) x.yearTo = v; }), 'Primo anno'),
    h('span', { class: 'sep', text: 'al' }),
    yearStepper('xto', a.yearTo, minYear, 2080, v => setA(x => { x.yearTo = v; if (x.yearFrom > v) x.yearFrom = v; }), 'Ultimo anno'));
  const modeNote = {
    mincost: 'Il capitale minimo che paga l\'affitto ogni anno fino all\'ultimo anno, negli scenari che scegli di coprire.',
    maxhorizon: 'Con il capitale che hai: fino a che anno l\'affitto è pagato.',
    maxscale: 'Con il capitale che hai: quanto affitto puoi pagare fino all\'ultimo anno (lo stesso profilo di crescita).'
  }[a.mode];
  const liab = [
    field('Cosa cerco', seg('xmode', [['mincost', 'Capitale minimo'], ['maxhorizon', 'Fino a quando'], ['maxscale', 'Quanto affitto']], a.mode, v => setA(x => { x.mode = v; }), 'Cosa cerco'), modeNote),
    a.mode === 'mincost' ? null : field('Capitale da investire', moneyInput('xbudget', a.budget, '€', v => setA(x => { x.budget = v; }, false))),
    field('Affitto del primo anno', moneyInput('xl0', a.L0, '€', v => setA(x => { x.L0 = v; }, false)), 'Importo annuo nel primo anno; poi cresce con l\'inflazione.'),
    field('Anni da pagare', years, a.mode === 'maxhorizon' ? 'L\'ultimo anno è il massimo che cerco.' : null),
    field('Rate', seg('xsched', [['yearly', 'Annuali'], ['semester', 'Semestrali']], a.schedule, v => setA(x => { x.schedule = v; }), 'Rate'),
      a.schedule === 'yearly' ? 'Ogni anno di affitto dev\'essere in cassa il 1° gennaio (prudente).' : 'Ogni semestre di affitto dev\'essere in cassa il 1° gennaio e il 1° luglio.'),
    field('L\'affitto segue', seg('xidx', [['FOI', 'FOI (ISTAT)'], ['HICP', 'HICP area euro']], a.liabIndex, v => setA(x => { x.liabIndex = v; }), 'Indice dell\'affitto'),
      'L\'aggiornamento ISTAT dei canoni usa il FOI.'),
    field('Più, ogni anno', pctInput('xspread', a.realSpread, v => setA(x => { x.realSpread = v; }), { min: -5, max: 10 }), 'Crescita reale oltre l\'inflazione (0,5% = l\'affitto sale un po\' più dei prezzi).')
  ];
  const baseRates = a.inflBase;
  const y1 = minYear + 1, y2 = minYear + 2, y3 = minYear + 3;
  const scen = [
    field('Inflazione attesa (scenario base)', h('div', { class: 'years' },
      h('span', { class: 'sep', text: String(y1) }), pctInput('xi1', baseRates[y1] ?? 0.026, v => setA(x => { x.inflBase = { ...x.inflBase, [y1]: v }; })),
      h('span', { class: 'sep', text: String(y2) }), pctInput('xi2', baseRates[y2] ?? 0.021, v => setA(x => { x.inflBase = { ...x.inflBase, [y2]: v }; })),
      h('span', { class: 'sep', text: 'poi' }), pctInput('xi3', baseRates[y3] ?? 0.023, v => setA(x => { x.inflBase = { ...x.inflBase, [y3]: v }; }))),
      'HICP area euro. Il FOI dello scenario base è uguale; lo scenario «FOI +0,5%» lo alza di mezzo punto.'),
    field('Scenari da coprire per forza', h('div', { class: 'chips', role: 'group', 'aria-label': 'Scenari da coprire' },
      SCEN_NAMES.map(([id, name]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(a.robust.includes(id)), data: { k: 'rob:' + id }, disabled: id === 'base',
        on: { click: () => setA(x => { x.robust = x.robust.includes(id) ? x.robust.filter(r => r !== id) : [...x.robust, id]; }) } }, name))),
      'La scala deve pagare l\'affitto in tutti gli scenari scelti: costa di più, ma regge. Gli altri si simulano e si mostrano nel pannello stress.'),
    field('€STR (tasso della liquidità)', pctInput('xestr', a.estr ?? ctx.estr ?? 0.024, v => setA(x => { x.estr = v; }), { min: -1, max: 10 }),
      'Cedole e rimborsi in attesa restano su un ETF monetario (XEON): €STR − 0,015%, tassato al 26%, meno il bollo 0,2%. Negli scenari l\'€STR segue l\'inflazione (metà della differenza).')
  ];
  const caps = a.issuerCaps || {};
  const cons = [
    field('Quota minima di indicizzati', pctInput('xmin', a.minLinker, v => setA(x => { x.minLinker = Math.min(1, Math.max(0, v)); }), { min: 0, max: 100, dec: 0 }),
      'Sul costo dei titoli. 0 = decide l\'ottimizzatore. Oggi gli indicizzati in universo sono solo italiani (BTP€i e BTP Italia).'),
    field('Tetto per l\'Italia', pctInput('xcapit', caps.GOV_IT ?? 1, v => setA(x => { x.issuerCaps = { ...x.issuerCaps, GOV_IT: Math.min(1, Math.max(0, v)) }; }), { min: 0, max: 100, dec: 0 }),
      '100% = nessun tetto. Con un tetto all\'Italia la quota indicizzata non può superarlo.'),
    field('Tetto per singolo titolo', pctInput('xtcap', a.titleCap || 1, v => setA(x => { x.titleCap = v >= 1 ? 0 : Math.max(0, v); }), { min: 0, max: 100, dec: 0 }), '100% = nessun tetto.')
  ];
  return [panel('Affitto da pagare', 'passività indicizzata', liab), panel('Inflazione e scenari', null, scen), panel('Vincoli della scala', null, cons)];
}

/** Paniere in uso: la modalità «Passività indicizzata» ha il suo (indicizzati inclusi), le altre quello comune. */
const bk = s => s.goal === 'indexed' ? s.indexed.basket : s.basket;

/* ---------- 3. Titoli ammessi ---------- */
function basketSection(st) {
  const b = bk(st);
  const catalog = ctx.ds ? issuerCatalog(ctx.ds) : [];
  const minScore = ratingScore(b.minRating) ?? 0;
  const excluded = new Set(b.excluded);
  const areaChip = (key, label) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!!b.groups[key]), data: { k: 'area:' + key },
    on: { click: () => set(s => { bk(s).groups[key] = !bk(s).groups[key]; }, true) } }, label);
  const groups = ['euro', 'sov', 'extra'].filter(a => b.groups[a]).map(area => {
    const list = catalog.filter(e => e.area === area);
    if (!list.length) return null;
    const chips = list.map(e => {
      const okRating = e.ratingScore != null && e.ratingScore >= minScore;
      const on = okRating && !excluded.has(e.issuer);
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), disabled: !okRating, data: { k: 'iss:' + e.issuer },
        title: okRating ? `${e.name}: ${e.count} titoli` : `${e.name}: rating ${e.rating || 'n.d.'} sotto la soglia`,
        'aria-label': `${e.name}, rating ${e.rating || 'non disponibile'}${okRating ? '' : ', sotto la soglia'}`,
        on: { click: () => set(s => { const x = new Set(bk(s).excluded); x.has(e.issuer) ? x.delete(e.issuer) : x.add(e.issuer); bk(s).excluded = [...x]; }, true) } },
        h('span', { class: 'cc', text: e.area === 'sov' ? e.issuer.replace('SOV_', '').slice(0, 4) : e.country }),
        h('span', { text: e.name }), h('span', { class: 'rt', text: e.rating || 'NR' }));
    });
    const codes = list.map(e => e.issuer);
    return h('div', { class: 'chip-group', role: 'group', 'aria-label': AREAS[area] },
      h('div', { class: 'lbl' }, h('span', { text: AREAS[area] }), h('span', null,
        h('button', { type: 'button', class: 'linkbtn', text: 'tutti', 'aria-label': `${AREAS[area]}: tutti`, on: { click: () => set(s => { bk(s).excluded = bk(s).excluded.filter(x => !codes.includes(x)); }, true) } }), ' · ',
        h('button', { type: 'button', class: 'linkbtn', text: 'nessuno', 'aria-label': `${AREAS[area]}: nessuno`, on: { click: () => set(s => { bk(s).excluded = [...new Set([...bk(s).excluded, ...codes])]; }, true) } }))),
      h('div', { class: 'chips' }, chips));
  });
  return [
    field('Emittenti', h('div', { class: 'chips', role: 'group', 'aria-label': 'Gruppi di emittenti' }, areaChip('euro', 'Stati area euro'), areaChip('sov', 'Sovranazionali'), areaChip('extra', 'Altri Stati in euro'))),
    field('Rischio: rating minimo', seg('rating', RATING_OPTS, b.minRating, v => set(s => { bk(s).minRating = v; }, true), 'Rating minimo'),
      'Da BBB- in su è «investment grade»: i titoli con rating più basso, o senza rating, restano fuori.'),
    groups.filter(Boolean).length ? h('div', { class: 'form' }, groups) : h('p', { class: 'note', text: 'Scegli almeno un gruppo di emittenti.' }),
    sw('belowpar', b.belowPar, 'Solo titoli sotto la pari', 'Prezzo ≤ 100: a scadenza nessuna minusvalenza (che non si potrebbe compensare con le cedole).', v => set(s => { bk(s).belowPar = v; }, true)),
    b.belowPar ? null : field('Prezzo massimo', seg('maxprice', PRICE_OPTS, b.maxPrice ?? null, v => set(s => { bk(s).maxPrice = v; }, true), 'Prezzo massimo')),
    field('Liquidità minima', seg('liq', LIQ_OPTS, b.minLiquidity, v => set(s => { bk(s).minLiquidity = v; }, true), 'Liquidità minima'),
      'Classe di volume STFI (media 20 giorni): già «Bassa» esclude i titoli senza contrattazioni.'),
    st.goal === 'indexed' ? null : field('Quota massima per emittente', seg('cap', CAP_OPTS, CAP_OPTS.find(([v]) => Math.abs(v - b.issuerCap) < 1e-6)?.[0] ?? b.issuerCap, v => set(s => { bk(s).issuerCap = v; }, true), 'Quota massima per emittente'))
  ];
}

/* ---------- Opzioni ---------- */
function optionsSection(st) {
  const b = bk(st);
  const items = [
    sw('zainetto', b.zainetto, 'Ho minusvalenze da recuperare', 'Usa il rendimento "super netto" di STFI: la plusvalenza a scadenza compensa lo zainetto fiscale e non viene tassata.', v => set(s => { bk(s).zainetto = v; })),
    sw('stepup', b.includeStepUp, 'Includi titoli step-up', 'BTP Valore, Futura, Più: cedola crescente, flussi con il calendario degli scalini del Tesoro.', v => set(s => { bk(s).includeStepUp = v; })),
    sw('infl', b.includeInflation, 'Includi BTP Italia e BTP€i', 'Nel file il loro rendimento è "senza indicizzazione": non è confrontabile con gli altri.', v => set(s => { bk(s).includeInflation = v; }))
  ];
  if (st.goal === 'indexed') {
    // regole fiscali che le fonti non chiariscono: parametri espliciti (src/core/fisco-parametri.js), mai scelti in silenzio
    const fz = st.indexed.alm.fisco || {};
    const setF = (k, v) => set(s => { s.indexed.alm.fisco = { ...s.indexed.alm.fisco, [k]: v }; }, true);
    items.push(field('Rivalutazione dei BTP€i tassata', seg('xtax', [['scadenza', 'A scadenza'], ['annuale', 'Ogni anno']], fz.rivalutazioneBtpEi || 'scadenza',
      v => setF('rivalutazioneBtpEi', v), 'Quando si tassa la rivalutazione dei BTP€i'),
      "DA VERIFICARE. «A scadenza» segue la Nota MEF citata dall'Agenzia delle Entrate (Risposta 67/2022). «Ogni anno» anticipa l'uscita di cassa."));
    items.push(field('BTP€i: imposta a scadenza calcolata su', seg('xbase', [['emissione', 'Prezzo di emissione'], ['acquisto', 'Prezzo d\'acquisto']], fz.baseImponibileBtpEi || 'emissione',
      v => setF('baseImponibileBtpEi', v), 'Base imponibile del provento dei BTP€i'),
      "DA VERIFICARE con la banca. «Emissione» è prudente: chi compra sul secondario paga il 12,5% su tutta la rivalutazione dalla prima emissione; la minusvalenza che ne nasce non si usa."));
    items.push(field('BTP Italia: credito sulla rivalutazione già nel prezzo', seg('xriv', [['nessuno', 'No'], ['credito', 'Sì']], fz.rateoRivalutazioneBtpItalia || 'nessuno',
      v => setF('rateoRivalutazioneBtpItalia', v), 'Credito d\'imposta sulla rivalutazione maturata dei BTP Italia'),
      "DA VERIFICARE. «No» è prudente: la rivalutazione incassata alla prima cedola si tassa tutta, anche la parte pagata nel prezzo."));
  }
  if (st.goal === 'capital' && st.capital.start !== 'budget') items.push(field('Arrotondamento ai lotti',
    seg('round', [['up', 'Almeno l\'importo'], ['nearest', 'Il più vicino']], st.capital.rounding, v => set(s => { s.capital.rounding = v; }, true), 'Arrotondamento ai lotti')));
  if ((b.excludedIsins || []).length) items.push(h('div', { class: 'field' }, h('span', { class: 'lbl', text: `Titoli esclusi a mano (${b.excludedIsins.length})` }),
    h('button', { type: 'button', class: 'mini', data: { k: 'restore' }, text: 'Ripristina tutti', on: { click: () => set(s => { bk(s).excludedIsins = []; }, true) } })));
  const det = h('details', { class: 'panel adv', open: advOpen },
    h('summary', { class: 'ph' }, h('h2', { text: 'Opzioni avanzate' }), h('span', { class: 'meta', text: `${items.length} opzioni` })),
    h('div', { class: 'pb form' }, items));
  det.addEventListener('toggle', () => { advOpen = det.open; });
  return det;
}

export { RATING_SCALE, MONTHS_LONG };
