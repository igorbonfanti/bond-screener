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
   - a ogni rata si paga dal conto; se non basta si vende ETF (26% sulla plusvalenza, costo medio), poi una parte dei
     titoli della scala; le spese extra si pagano vendendo ETF, poi dal conto e dai titoli (se non bastano restano in
     parte non pagate, contate a parte). Se non basta nulla, la rata non è pagata: il percorso fallisce.
   Patrimonio, in euro di oggi: ETF al netto delle tasse sulla plusvalenza + conto + titoli della scala (flussi ancora
   da incassare, con l'inflazione attesa e non quella del percorso, scontati al rendimento netto di oggi della scala).
   Generatore pseudo-casuale con seme fisso: stessi input, stessi risultati. */
import { day, parts } from './dates.js';
import { series, rateFn } from './indice.js';
import { buildInstruments, growthFor } from './alm.js';
import { liabilities, deflator } from './passivita.js';

export const MC_DEFAULT = {
  n: 2000, seed: 11,
  eqMu: 0.06, eqSd: 0.16, eqDf: 5, eqTer: 0.0015, taxEq: 0.26,
  inflMean: 0.023, inflSd: 0.012, inflAr: 0.6, infl0: null,       // null = l'inflazione base del primo anno
  extras: [],                                                    // [{ amount (€ di oggi l'anno), from, to }]
  stress: 'none'                                                 // 'none' | 'crollo' | 'stagflazione'
};

/** Generatore mulberry32 e normali di Box–Muller (deterministici dato il seme). */
function rng(seed) {
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

/** Un percorso: inflazione e rendimenti dell'ETF per gli anni y0..y1. L'inflazione del primo anno di rate (y0 + 1) è
    quella base (anche per i mesi che restano dell'anno in corso), poi segue l'AR(1). Le prove di stress forzano i
    primi anni interi (y0 + 1 …); dopo la stagflazione l'inflazione riparte dall'ultimo valore forzato. */
function drawPath(R, p, y0, y1) {
  const infl = {}, eq = {};
  const sdE = p.inflSd * Math.sqrt(1 - p.inflAr * p.inflAr);
  const scaleT = Math.sqrt((p.eqDf - 2) / p.eqDf);
  const stag = p.stress === 'stagflazione' ? [0.08, 0.08, 0.07, 0.06, 0.05] : [];
  let x = p.infl0;
  for (let y = y0; y <= y1; y++) {
    if (y > y0 + 1) x = p.inflMean + p.inflAr * (x - p.inflMean) + sdE * R.normal();
    const k = y - y0 - 1;
    if (k >= 0 && k < stag.length) x = stag[k];
    infl[y] = x;
    let chi = 0;
    for (let j = 0; j < p.eqDf; j++) { const g = R.normal(); chi += g * g; }
    const z = R.normal() / Math.sqrt(chi / p.eqDf) * scaleT;
    eq[y] = Math.exp(Math.log(1 + p.eqMu) + p.eqSd * z) - 1 - p.eqTer;
    if (k >= 0 && k < stag.length) eq[y] = Math.min(eq[y], -p.eqTer);          // borsa ferma (meno i costi)
  }
  if (p.stress === 'crollo') { eq[y0 + 1] = -0.35 - p.eqTer; eq[y0 + 2] = -0.10 - p.eqTer; }
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
  if (!(etf0 >= 0)) return { error: 'capitale', total, cost: plan.totalCost };
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
    const path = drawPath(R, p, y0, yEnd + 1);
    const hicp = rateFn(path.infl), foi = hicp;
    const fns = { hicp, foi, estr: y => Math.max(0, cfg.estr + 0.5 * (hicp(y) - p.inflMean)) };
    const sc = { id: 'p', fns, series: { HICP: series(infl.hicp, hicp), FOI: series(infl.foi, foi) }, G: growthFor(fns.estr, f) };
    const L = liabilities(cfgL, fns).map(l => ({ ...l, amount: l.amount * plan.lam }));
    const defl = deflator(fns, settle, cfg.liabIndex);
    const { items } = buildInstruments(lots.map(x => x.b), { settle, f, scen: [sc], bases: infl.bases, btpItalia: infl.btpItalia || null });
    const flows = [];
    items.forEach(it => { const k = lots.find(x => x.b.isin === it.b.isin).k100; for (const fl of it.flows.p) flows.push({ day: fl.day, net: fl.net * k, idx: it.type !== 'NOM' }); });
    const extras = [];
    for (const e of p.extras || []) for (let y = Math.max(e.from, y0 + 1); y <= Math.min(e.to ?? yEnd, yEnd); y++) extras.push({ day: day(y, 1, 1), amount: e.amount });
    runs[0].push(walk(sc.G, path.eq, flows, L, extras, defl, plan.cash0, etf0, settle, years, p, f, disc));
    runs[1].push(walk(sc.G, path.eq, [], L, extras, defl, 0, total, settle, years, p, f, disc));
  }

  const summarize = rs => {
    const paidTo = dues0.map((_, k) => rs.filter(r => r.fail == null || r.fail > k).length / rs.length);
    const wealth = years.map((y, j) => ({ year: y, p10: pct(rs.map(r => r.w[j]), 0.1), p50: pct(rs.map(r => r.w[j]), 0.5), p90: pct(rs.map(r => r.w[j]), 0.9) }));
    const sold = rs.map(r => r.sold);
    return { pAll: paidTo[K - 1], paidTo, wealth, soldMedian: pct(sold, 0.5), soldShare: rs.filter(r => r.sold > 1).length / rs.length,
      bondSaleShare: rs.filter(r => r.bondSold > 1).length / rs.length, extraShortShare: rs.filter(r => r.extraShort > 1).length / rs.length };
  };
  return { n: p.n, params: p, etf0, total, dues: dues0.map(l => ({ day: l.day, year: l.year, half: l.half })), mix: summarize(runs[0]), allEtf: summarize(runs[1]) };
}

/** Un percorso nel tempo: conto (XEON), ETF (valore e costo fiscale), titoli della scala, rate, spese extra.
    Ordine dei pagamenti: conto, poi ETF, poi titoli della scala venduti (in proporzione, al loro valore). */
function walk(G, eq, flows, L, extras, defl, cash0, etf0, settle, years, p, f, disc) {
  const ev = [];
  flows.forEach((x, i) => ev.push({ day: x.day, t: 0, i }));
  extras.forEach(x => ev.push({ day: x.day, t: 1, v: x.amount }));
  L.forEach((l, k) => ev.push({ day: l.day, t: 2, v: l.amount, k }));
  years.forEach((y, j) => ev.push({ day: day(y, 1, 1), t: 3, j }));
  ev.sort((a, b) => a.day - b.day || a.t - b.t);                // a parità di giorno: flussi, extra, rata, misura
  let cash = cash0, E = etf0, basis = etf0, now = settle, fail = null, sold = 0, bondSold = 0, extraShort = 0, share = 1;
  const fD = flows.map(x => (x.idx ? defl(x.day) : 1));           // inflazione cumulata del percorso alla data di ogni flusso (una volta sola)
  const w = new Array(years.length).fill(0);
  const growEtf = to => {                                        // ETF da now a to: rendimento dell'anno pro rata; bollo a fine anno per i giorni posseduti
    let t = now;
    while (t < to) {
      const y = parts(t).y, ys = day(y, 1, 1), ye = day(y + 1, 1, 1), end = Math.min(to, ye);
      E *= Math.pow(1 + eq[y], (end - t) / (ye - ys));
      if (end === ye) E *= 1 - f.bollo * (ye - Math.max(ys, settle)) / (ye - ys);
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
  // Valore dei titoli rimasti al giorno d senza conoscere il futuro del percorso: i flussi degli indicizzati si portano
  // all'inflazione attesa (media) invece di quella del percorso, poi tutto si sconta al rendimento netto di oggi della
  // scala. All'inizio, con inflazione attesa uguale a quella base, valgono circa quanto sono costati.
  const bondValue = d => {
    let v = 0;
    const dd = defl(d);
    for (let i = 0; i < flows.length; i++) {
      const x = flows[i];
      if (x.day <= d) continue;
      const yrs = (x.day - d) / 365.25;
      const adj = x.idx ? Math.pow(1 + p.inflMean, yrs) / (fD[i] / dd) : 1;
      v += x.net * adj / Math.pow(1 + disc, yrs);
    }
    return v * share;
  };
  const sellBonds = (need, d) => {                               // vende una quota dei titoli (tassa sul guadagno trascurata)
    if (need <= 0 || share <= 0) return 0;
    const V = bondValue(d);
    if (V <= 0) return 0;
    const q = Math.min(1, need / V);
    share *= 1 - q; bondSold += q * V;
    return q * V;
  };
  const cover = d => { if (cash < -0.5) cash += sell(-cash); if (cash < -0.5) cash += sellBonds(-cash, d); };
  for (const e of ev) {
    if (fail != null && e.t !== 3) continue;
    if (e.day > now) { cash *= G(now, e.day); growEtf(e.day); now = e.day; }
    if (e.t === 0) cash += flows[e.i].net * share;
    else if (e.t === 1) {                                        // spesa extra (euro di oggi): ETF, poi conto, poi titoli; quello che manca resta non pagato
      const nominal = e.v * defl(e.day);
      cash -= nominal - sell(nominal);
      cover(e.day);
      if (cash < -0.5) { extraShort += -cash; cash = 0; }
    } else if (e.t === 2) { cash -= e.v; cover(e.day); if (cash < -0.5) fail = e.k; }
    else w[e.j] = fail != null ? 0 : (Math.max(0, cash) + bondValue(e.day) + E - p.taxEq * Math.max(0, E - basis)) / defl(e.day);
  }
  return { fail, w, sold, bondSold, extraShort };
}
