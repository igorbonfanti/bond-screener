/* Monte Carlo della modalità «Affitto indicizzato»: la scala di titoli scelta dall'ottimizzatore più il resto del
   capitale in un ETF azionario globale (tipo All-World, ad accumulazione), su migliaia di percorsi d'inflazione e di
   borsa. Risponde a: con che probabilità l'affitto è pagato fino a un certo anno, e quanto patrimonio resta.

   Per ogni percorso:
   - inflazione annua (HICP; il FOI è uguale) con un AR(1): π_t = μ + φ(π_{t−1} − μ) + ε, ε ~ N(0, σ√(1−φ²));
   - l'affitto cresce con l'inflazione del percorso (stessa regola della scala: anno prima + spread reale);
   - i flussi della scala si ricalcolano con l'inflazione del percorso (BTP€i e BTP Italia seguono il loro CI;
     i nominali no), con le stesse regole fiscali e il bollo;
   - la liquidità in attesa sta sul conto XEON, con l'€STR che segue l'inflazione (€STR + 0,5 × (π − μ));
   - l'ETF rende ogni anno exp(ln(1 + m) + s·z) − 1 − TER, con z una t di Student a ν gradi di libertà
     normalizzata a varianza 1 (code grasse): m è il rendimento composto atteso; bollo 0,2% a fine anno;
   - a ogni rata si paga dal conto; se non basta si vende ETF (26% sulla plusvalenza, costo medio); le spese extra
     si pagano vendendo ETF (poi dal conto). Se non bastano nemmeno i due, la rata non è pagata: il percorso fallisce.
   Patrimonio, in euro di oggi: ETF al netto delle tasse sulla plusvalenza + conto + titoli della scala (flussi netti
   ancora da incassare scontati al rendimento netto di oggi della scala: valore teorico di titoli tenuti a scadenza).
   Generatore pseudo-casuale con seme fisso: stessi input, stessi risultati. */
import { day, parts } from '/home/user/bond-screener/src/core/dates.js';
import { series, rateFn } from '/home/user/bond-screener/src/core/indice.js';
import { buildInstruments, growthFor } from '/home/user/bond-screener/src/core/alm.js';
import { liabilities, deflator } from '/home/user/bond-screener/src/core/passivita.js';

export const MC_DEFAULT = {
  n: 2000, seed: 11,
  eqMu: 0.06, eqSd: 0.16, eqDf: 5, eqTer: 0.0015, taxEq: 0.26,
  inflMean: 0.023, inflSd: 0.012, inflAr: 0.6, infl0: null,       // null = l'inflazione base del primo anno
  extras: [],                                                    // [{ amount (€ di oggi l'anno), from, to }]
  stress: 'none'                                                 // 'none' | 'crollo' | 'stagflazione'
};

/** Generatore mulberry32 e normali di Box–Muller (deterministici dato il seme). */
export function rng(seed) {
  let a = seed >>> 0, spare = null;
  const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const normal = () => {
    if (spare != null) { const s = spare; spare = null; return s; }
    let x, y, r;
    do { x = 2 * u() - 1; y = 2 * u() - 1; r = x * x + y * y; } while (r === 0 || r >= 1);
    const k = Math.sqrt(-2 * Math.log(r) / r);
    spare = y * k; return x * k;
  };
  return { u, normal };
}

/** Un percorso: inflazione e rendimenti dell'ETF per gli anni y0..y1. */
export function drawPath(R, p, y0, y1) {
  const infl = {}, eq = {};
  let x = p.infl0;
  const sdE = p.inflSd * Math.sqrt(1 - p.inflAr * p.inflAr);
  const scaleT = Math.sqrt((p.eqDf - 2) / p.eqDf);
  for (let y = y0; y <= y1; y++) {
    if (y > y0) x = p.inflMean + p.inflAr * (x - p.inflMean) + sdE * R.normal();
    infl[y] = x;
    let chi = 0;
    for (let k = 0; k < p.eqDf; k++) { const g = R.normal(); chi += g * g; }
    const z = R.normal() / Math.sqrt(chi / p.eqDf) * scaleT;
    eq[y] = Math.exp(Math.log(1 + p.eqMu) + p.eqSd * z) - 1 - p.eqTer;
  }
  if (p.stress === 'crollo') { eq[y0 + 1] = -0.35; eq[y0 + 2] = -0.10; }
  if (p.stress === 'stagflazione') [0.08, 0.08, 0.07, 0.06, 0.05].forEach((v, k) => { infl[y0 + 1 + k] = v; eq[y0 + 1 + k] = Math.min(eq[y0 + 1 + k], 0); });
  return { infl, eq };
}

const pct = (arr, q) => { if (!arr.length) return NaN; const s = Float64Array.from(arr).sort(); const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };

/**
 * plan: risultato di planIndexed (positions, cash0, cfg, horizon, lam); infl: dati d'inflazione preparati;
 * total: capitale complessivo (scala + ETF); opts: parametri (MC_DEFAULT).
 */
export function monteCarlo(ds, plan, infl, total, opts = {}) {
  const p = { ...MC_DEFAULT, ...opts };
  const cfg = plan.cfg, f = cfg.fisco, settle = ds.settle;
  if (p.infl0 == null) p.infl0 = rateFn(cfg.inflBase)(cfg.yearFrom);
  const etf0 = total - plan.totalCost;
  if (!(etf0 >= 0)) return { error: `Il capitale complessivo (${Math.round(total)} €) è minore del costo della scala (${Math.round(plan.totalCost)} €).` };
  const y0 = parts(settle).y, yEnd = plan.horizon;
  const cfgL = { ...cfg, yearTo: plan.horizon };
  const lots = plan.positions.map(x => ({ b: x.b, k100: x.nominal / 100 }));
  const R = rng(p.seed);
  const disc = Number.isFinite(plan.irr) ? plan.irr : 0.03;
  const dues0 = liabilities(cfgL, { hicp: () => 0, foi: () => 0, estr: () => 0 });   // date delle rate
  const K = dues0.length;
  const years = []; for (let y = y0 + 1; y <= yEnd + 1; y++) years.push(y);

  const runs = [[], []];                         // 0 = scala + ETF, 1 = tutto in ETF
  for (let i = 0; i < p.n; i++) {
    const path = drawPath(R, p, y0, yEnd + 1); if (globalThis.__mcHook) globalThis.__mcHook.path(i, path);
    const hicp = rateFn(path.infl), foi = hicp;
    const fns = { hicp, foi, estr: y => Math.max(0, cfg.estr + 0.5 * (hicp(y) - p.inflMean)) };
    const sc = { id: 'p', fns, series: { HICP: series(infl.hicp, hicp), FOI: series(infl.foi, foi) }, G: growthFor(fns.estr, f) };
    const L = liabilities(cfgL, fns).map(l => ({ ...l, amount: l.amount * plan.lam }));
    const defl = deflator(fns, settle, cfg.liabIndex);
    const { items } = buildInstruments(lots.map(x => x.b), { settle, f, scen: [sc], bases: infl.bases, btpItalia: infl.btpItalia || null });
    const flows = [];
    items.forEach(it => { const k = lots.find(x => x.b.isin === it.b.isin).k100; for (const fl of it.flows.p) flows.push({ day: fl.day, net: fl.net * k, isin: it.b.isin, kind: fl.kind }); });
    const extras = [];
    for (const e of p.extras || []) for (let y = Math.max(e.from, y0 + 1); y <= Math.min(e.to ?? yEnd, yEnd); y++) extras.push({ day: day(y, 1, 1), amount: e.amount });
    if (globalThis.__mcHook) globalThis.__mcHook.inputs(i, { flows, L, extras, G: sc.G, defl, eq: path.eq, infl: path.infl, cash0: plan.cash0, etf0, settle, years, p, f, disc }); runs[0].push(walk(sc.G, path.eq, flows, L, extras, defl, plan.cash0, etf0, settle, years, p, f, disc));
    runs[1].push(walk(sc.G, path.eq, [], L, extras, defl, 0, total, settle, years, p, f, disc));
  }

  const summarize = rs => {
    const paidTo = dues0.map((_, k) => rs.filter(r => r.fail == null || r.fail > k).length / rs.length);
    const wealth = years.map((y, j) => ({ year: y, p10: pct(rs.map(r => r.w[j]), 0.1), p50: pct(rs.map(r => r.w[j]), 0.5), p90: pct(rs.map(r => r.w[j]), 0.9) }));
    const sold = rs.map(r => r.sold);
    return { pAll: paidTo[K - 1], paidTo, wealth, soldMedian: pct(sold, 0.5), soldShare: rs.filter(r => r.sold > 1).length / rs.length };
  };
  return { n: p.n, params: p, etf0, total, dues: dues0.map(l => ({ day: l.day, year: l.year, half: l.half })), mix: summarize(runs[0]), allEtf: summarize(runs[1]) };
}

/** Un percorso nel tempo: conto (XEON), ETF (valore e costo fiscale), rate, spese extra. */
export function walk(G, eq, flows, L, extras, defl, cash0, etf0, settle, years, p, f, disc) {
  const ev = [];
  for (const x of flows) ev.push({ day: x.day, t: 0, v: x.net });
  extras.forEach(x => ev.push({ day: x.day, t: 1, v: x.amount }));
  L.forEach((l, k) => ev.push({ day: l.day, t: 2, v: l.amount, k }));
  years.forEach((y, j) => ev.push({ day: day(y, 1, 1), t: 3, j }));
  ev.sort((a, b) => a.day - b.day || a.t - b.t);                // a parità di giorno: flussi, extra, rata, misura
  let cash = cash0, E = etf0, basis = etf0, now = settle, fail = null, sold = 0;
  const w = new Array(years.length).fill(0);
  const growEtf = to => {                                        // ETF dal giorno now al giorno to: rendimento dell'anno pro rata, bollo a fine anno
    let t = now;
    while (t < to) {
      const y = parts(t).y, end = Math.min(to, day(y + 1, 1, 1)), frac = (end - t) / (day(y + 1, 1, 1) - day(y, 1, 1));
      E *= Math.pow(1 + eq[y], frac);
      if (end === day(y + 1, 1, 1)) E *= 1 - f.bollo;
      t = end;
    }
  };
  const sell = need => {                                         // vende ETF per avere need netti; restituisce il netto ottenuto
    if (E <= 0 || need <= 0) return 0;
    const g = Math.max(0, 1 - basis / E);
    const gross = Math.min(need / (1 - p.taxEq * g), E);
    basis *= 1 - gross / E; E -= gross; sold += gross;
    return gross * (1 - p.taxEq * g);
  };
  for (const e of ev) {
    if (fail != null && e.t !== 3) continue;
    if (e.day > now) { cash *= G(now, e.day); growEtf(e.day); now = e.day; }
    const nominal = e.t === 1 ? e.v * defl(e.day) : e.v;         // le spese extra sono in euro di oggi
    if (e.t === 0) cash += e.v;
    else if (e.t === 1) { const got = sell(nominal); const rest = nominal - got; cash -= rest; if (cash < -0.5) { cash += sell(-cash); if (cash < -0.5) { const k = L.findIndex(l => l.day >= e.day); fail = k < 0 ? L.length - 1 : k; } } }
    else if (e.t === 2) { cash -= nominal; if (cash < -0.5) { cash += sell(-cash); if (cash < -0.5) fail = e.k; } }
    else {
      // titoli: flussi netti ancora da incassare, scontati al rendimento netto della scala di oggi (all'inizio valgono
      // quanto sono costati; valore teorico di titoli tenuti a scadenza, non il prezzo di borsa)
      let bonds = 0;
      for (const x of flows) if (x.day > e.day) bonds += x.net / Math.pow(1 + disc, (x.day - e.day) / 365.25);
      w[e.j] = fail != null ? 0 : (Math.max(0, cash) + bonds + E - p.taxEq * Math.max(0, E - basis)) / defl(e.day);
    }
  }
  return { fail, w, sold };
}
