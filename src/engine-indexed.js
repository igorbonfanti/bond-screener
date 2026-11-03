/* Modalità «Passività indicizzata» dalle impostazioni dell'utente: paniere (gli stessi filtri dell'app, con il suo
   insieme di impostazioni), dati d'inflazione (data/inflazione/inflazione.json, aggiornato dalla GitHub Action),
   ottimizzazione con HiGHS e confronto con la scala a importo fisso dello stesso capitale. Asincrona: carica il
   solver WebAssembly la prima volta. Gira nel Web Worker (o nel thread principale come ripiego). */
import { applyBasket } from './core/basket.js';
import { basketFromSettings } from './engine.js';
import { planIndexed, evaluateLadder, withDefaults } from './core/alm-plan.js';
import { btpItaliaFlowsFor } from './core/btp-italia.js';
import { xeonNet } from './core/fisco-parametri.js';

let highsP = null, inflP = null;

/** Solver HiGHS (WebAssembly), caricato una volta sola. */
export function loadSolver() {
  if (!highsP) highsP = import('../vendor/highs/highs.mjs').then(m => m.default({
    locateFile: f => new URL(`../vendor/highs/${f}`, import.meta.url).href
  }));
  return highsP;
}

/** Dati d'inflazione pubblicati dalla GitHub Action. */
export function loadInflation() {
  if (!inflP) inflP = fetch(new URL('../data/inflazione/inflazione.json', import.meta.url), { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error(`dati d'inflazione non disponibili (${r.status})`); return r.json(); })
    .then(prepareInflation)
    .catch(e => { inflP = null; throw e; });
  return inflP;
}

/** Dal JSON pubblicato al formato del motore: serie mensili in base 2025 e IR di base per ISIN. */
export function prepareInflation(j) {
  const bases = {};
  for (const [isin, t] of Object.entries(j.titoli || {})) if (Number.isFinite(t.irBase)) bases[isin] = { irBase: t.irBase, indice: t.indice, tipo: t.tipo, sottotipo: t.sottotipo || null,
    freq: t.freq || null, mesiCedola: t.mesiCedola || null, cedolaReale: t.cedolaReale };
  return { asOf: j.aggiornato, hicp: j.hicp.valori, foi: j.foi.valori, bases, estr: j.estr ? j.estr.valore : null, meta: j,
    btpItalia: btpItaliaFlowsFor(j) };
}

export async function computeIndexed(ds, st, deps = {}) {
  const highs = deps.highs || await loadSolver();
  const infl = deps.infl || await loadInflation();
  const ix = st.indexed;
  const bk = basketFromSettings(ds, ix.basket);
  let { bonds, excluded } = applyBasket(ds, bk);
  const banned = new Set(ix.basket.excludedIsins || []);
  if (banned.size) bonds = bonds.filter(b => !banned.has(b.isin));
  const cfg = withDefaults({ ...ix.alm, estr: ix.alm.estr ?? infl.estr ?? 0.024 });
  const plan = planIndexed(ds, bonds, cfg, infl, highs);
  const out = { goal: 'indexed', plan, basketCount: bonds.length, excluded, refDate: ds.refDate, settle: ds.settle, infl: { asOf: infl.asOf, meta: infl.meta.controlli || null } };
  if (!plan.empty) {
    out.flat = flatCompare(ds, bonds, cfg, infl, plan, highs);
    out.cash = cashInfo(ds, bonds, cfg, infl, plan);
  }
  return out;
}

/** Scala a importo fisso con lo stesso capitale e i soli titoli nominali: la rata costante più alta (stesso modello,
    stesse date, stessa liquidità su XEON), poi valutata contro l'affitto che cresce in ogni scenario. */
function flatCompare(ds, bonds, cfg, infl, plan, highs) {
  const nominal = bonds.filter(b => !b.inflation);
  const fp = planIndexed(ds, nominal, { ...cfg, flat: true, mode: 'maxscale', budget: plan.totalCost, yearTo: plan.horizon,
    robust: ['base'], scenarios: ['base'], minLinker: 0 }, infl, highs);
  if (!fp || fp.empty || !fp.positions.length) return null;
  const lots = fp.positions.map(p => ({ b: p.b, nominal: p.nominal }));
  const sims = evaluateLadder(ds, { ...cfg, yearTo: plan.horizon }, infl, lots, fp.cash0);
  return { perYear: fp.lam * cfg.L0, cost: fp.totalCost, positions: fp.positions.length,
    sims: Object.fromEntries(Object.entries(sims).map(([k, v]) => [k, { first: v.first, extra: v.extra, deficit: v.deficit }])) };
}

/** Liquidità: rendimento netto di XEON oggi e titoli nominali entro un anno che rendono di più (netto, meno bollo). */
function cashInfo(ds, bonds, cfg, infl, plan) {
  const f = plan.cfg.fisco, estr = cfg.estr;
  const shorts = bonds.filter(b => !b.inflation && b.maturity > ds.settle + 30 && b.maturity <= ds.settle + 366 && Number.isFinite(b.ytmNet))
    .map(b => ({ isin: b.isin, desc: b.desc, maturity: b.maturity, netAfterBollo: b.ytmNet - f.bollo * 100 }))
    .sort((a, b) => b.netAfterBollo - a.netAfterBollo).slice(0, 5);
  return { estr, estrDate: infl.meta && infl.meta.estr ? infl.meta.estr.data : null, xeon: xeonNet(estr, f), shorts };
}
