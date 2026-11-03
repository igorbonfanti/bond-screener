/* Regia della modalità «Passività indicizzata»: scenari, universo, ottimizzazione nelle tre modalità, lotti,
   simulazione di tutti gli scenari e indicatori per l'interfaccia. Il solver (HiGHS) viene passato da fuori:
   nel Web Worker la build WebAssembly, nei test la stessa build caricata da Node. */
import { day, parts, years, fmt as fmtDay } from './dates.js';
import { xirr } from './bond.js';
import { series } from './indice.js';
import { FISCO_DEFAULT } from './fisco-parametri.js';
import { defaultScenarios, scenarioFns, liabilities, deflator } from './passivita.js';
import { buildInstruments, prepare, lpText, solveWith, simulate, growthFor } from './alm.js';

export const ALM_DEFAULT = {
  mode: 'mincost',            // 'mincost' | 'maxscale' | 'maxhorizon'
  budget: 300000,
  L0: 15000, yearFrom: 2027, yearTo: 2046, schedule: 'yearly', realSpread: 0.005, liabIndex: 'FOI',
  inflBase: { 2027: 0.026, 2028: 0.021, 2029: 0.023 },
  scenarios: ['base', 'alto', 'basso', 'shock', 'basis'],   // simulati e mostrati
  robust: ['base', 'alto', 'shock'],                        // da coprire per forza (vincolo)
  estr: 0.024,
  minLinker: 0, issuerCaps: {}, titleCap: 0,
  fisco: { ...FISCO_DEFAULT },
  fixedLots: {}, excluded: []
};

export function withDefaults(cfg0 = {}) {
  return { ...ALM_DEFAULT, ...cfg0, fisco: { ...FISCO_DEFAULT, ...(cfg0 && cfg0.fisco) } };
}

/** Scenari (con serie d'inflazione proiettate e crescita della liquidità) e contesto per i flussi. */
export function context(ds, cfg, infl) {
  const f = cfg.fisco;
  const all = defaultScenarios(cfg.inflBase);
  const baseSc = all[0];
  const wanted = new Set([...cfg.scenarios, ...cfg.robust, 'base']);
  const scen = all.filter(s => wanted.has(s.id)).map(s => {
    const fns = scenarioFns(s, cfg.estr, baseSc);
    return { ...s, fns, series: { HICP: series(infl.hicp, fns.hicp), FOI: series(infl.foi, fns.foi) }, G: growthFor(fns.estr, f) };
  });
  return { scen, ctx: { settle: ds.settle, f, scen, bases: infl.bases, btpItalia: infl.btpItalia || null } };
}

/** Valuta una scala data (titoli e nominali) contro la stessa passività: saldo per scenario (per il confronto con la
    scala a importo fisso). lots: [{ b, nominal }]. */
export function evaluateLadder(ds, cfg0, infl, lots, cash0 = 0) {
  const cfg = withDefaults(cfg0);
  const { ctx } = context(ds, cfg, infl);
  const { items } = buildInstruments(lots.map(x => x.b), ctx);
  const prep = prepare(items, ctx, cfg);
  const n = items.map(it => { const x = lots.find(l => l.b.isin === it.b.isin); return x ? x.nominal / it.b.lot : 0; });
  return simulate(items, prep, n, cash0);
}

/** Universo: titoli del paniere dell'app che scadono prima dell'ultima rata (tenuti a scadenza, niente vendite). */
function universe(bonds, settle, lastDue, excluded) {
  const ex = new Set(excluded || []);
  return bonds.filter(b => b.maturity > settle + 7 && b.maturity < lastDue && !ex.has(b.isin) && b.currency === 'EUR');
}

/**
 * ds: dati STFI (settle), bonds: titoli già filtrati dal paniere dell'app, cfg: ALM_DEFAULT modificato,
 * infl: { hicp: {mese: v}, foi: {mese: v}, bases: {isin: {irBase}}, btpItalia: fn | null, asOf }, highs: solver.
 */
export function planIndexed(ds, bonds, cfg0, infl, highs) {
  const cfg = withDefaults(cfg0);
  const settle = ds.settle;
  const { scen, ctx } = context(ds, cfg, infl);

  const run = yearTo => {
    const c = { ...cfg, yearTo };
    const L0 = liabilities(c, scen[0].fns);
    const lastDue = L0[L0.length - 1].day;
    const { items, skipped } = buildInstruments(universe(bonds, settle, lastDue, cfg.excluded), ctx);
    const prep = prepare(items, ctx, c);
    return { c, items, skipped, prep };
  };
  // senza indicizzati nel paniere la quota minima renderebbe impossibile comprare titoli: non si applica (e si dice)
  const noLinkers = !bonds.some(b => b.inflation);
  const optFor = (extra = {}) => ({ mode: 'mincost', robust: cfg.robust, minLinker: noLinkers ? 0 : cfg.minLinker, issuerCap: cfg.issuerCaps,
    titleCap: cfg.titleCap, fixed: cfg.fixedLots, ...extra });
  // il programma intero ha un limite di tempo: oltre, si tiene la migliore soluzione a lotti trovata
  const solve = (m, opt) => solveWith(highs, lpText(m.items, m.prep, opt), m.items.length, opt.ints ? { time_limit: cfg.mipSeconds || 4 } : {});

  // la prima rata deve venire dopo la data di regolamento dei prezzi
  if (day(cfg.yearFrom, 1, 1) <= settle)
    return { empty: true, cfg, warnings: [`La prima rata (1/1/${cfg.yearFrom}) non è dopo la data di regolamento dei prezzi (${fmtDay(settle)}): scegli come primo anno il ${parts(settle).y + 1} o dopo.`] };

  // Lotti: programma intero sui titoli (stessi vincoli, e il capitale come tetto quando c'è). Gira prima sui titoli
  // scelti dal rilassamento (pochi: veloce e, di fatto, lo stesso ottimo), poi su tutti; altrimenti per eccesso.
  const lots = (m, relaxed, intOpt, cap) => {
    const notes = [];
    const support = new Set([...relaxed.n.keys()].filter(i => relaxed.n[i] > 1e-7));
    let sol = support.size ? solve(m, { ...intOpt, only: support }) : { status: 'none' };
    if (sol.status !== 'Optimal') sol = solve(m, intOpt);
    if (sol.status === 'Optimal' && sol.timed) notes.push(`Lotti interi: il solver si è fermato al limite di tempo; la soluzione rispetta i vincoli ed è entro ${fmtGap(sol, relaxed)} dalla scala ideale «a pezzi».`);
    if (sol.status !== 'Optimal') {
      sol = { ...relaxed, n: relaxed.n.map(v => Math.ceil(v - 1e-9)) };
      notes.push('Lotti arrotondati per eccesso: il programma intero non ha chiuso.');
    }
    const cost = m.items.reduce((acc, it, i) => acc + sol.n[i] * it.b.lot / 100 * it.cost, 0) + sol.c0;
    return cap != null && cost > cap + 0.01 ? null : { sol, notes };
  };

  let m, relaxed = null, horizon = cfg.yearTo, lotted = null;
  if (cfg.mode === 'maxhorizon') {
    // ricerca binaria sull'ultimo anno coperto con il capitale dato (costo minimo, rilassato)
    const fits = T => { const mm = run(T); const s = solve(mm, optFor()); return s.status === 'Optimal' && s.obj <= cfg.budget + 0.01 ? { mm, s } : null; };
    let lo = cfg.yearFrom - 1, hi = cfg.yearTo, best = null;
    const top = fits(hi);
    if (top) { lo = hi; best = top; }
    else {
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; const r = fits(mid); if (r) { lo = mid; best = r; } else hi = mid; }
    }
    // a lotti interi il capitale può non bastare più per l'ultimo anno trovato: si scende di un anno alla volta
    while (best) {
      lotted = lots(best.mm, best.s, optFor({ ints: true, cap: cfg.budget }), cfg.budget);
      if (lotted) break;
      lo -= 1;
      best = lo >= cfg.yearFrom ? fits(lo) : null;
    }
    if (!best) return { empty: true, cfg, warnings: [`Con ${fmtEur0(cfg.budget)} non si copre nemmeno la rata del ${cfg.yearFrom}.`] };
    horizon = lo; m = best.mm; relaxed = best.s;
  } else {
    m = run(cfg.yearTo);
    relaxed = solve(m, cfg.mode === 'maxscale' ? optFor({ mode: 'maxscale', budget: cfg.budget }) : optFor());
    if (relaxed.status !== 'Optimal') return { empty: true, cfg, skipped: m.skipped, status: relaxed.status,
      warnings: [infeasibleText(relaxed.status, cfg)] };
    lotted = lots(m, relaxed, cfg.mode === 'maxscale' ? optFor({ mode: 'maxscale', budget: cfg.budget, ints: true }) : optFor({ ints: true }), null);
  }
  const sol = lotted.sol, note = lotted.notes;
  if (cfg.minLinker > 0 && !m.items.some(it => it.type !== 'NOM'))
    note.push('Nel paniere non ci sono titoli indicizzati (controlla rating ed emittenti): la quota minima indicizzata non si applica.');
  const lam = cfg.mode === 'maxscale' ? sol.lam : 1;
  return report(ds, cfg, m, sol, relaxed, lam, horizon, scen, note);
}

const fmtEur0 = v => `${Math.round(v).toLocaleString('it-IT')} €`;

function fmtGap(sol, relaxed) {
  const g = Math.abs(sol.obj - relaxed.obj) / Math.max(1, Math.abs(relaxed.obj));
  return `lo ${(g * 100).toFixed(2).replace('.', ',')}%`;
}

function infeasibleText(status, cfg) {
  if (status === 'Infeasible') return 'Nessuna combinazione di titoli rispetta tutti i vincoli: allenta la quota indicizzata o i tetti, oppure allarga il paniere.';
  return `Il solver non ha trovato una soluzione (${status}).`;
}

function report(ds, cfg, m, sol, relaxed, lam, horizon, scen, note) {
  const { items, prep, skipped, c } = m;
  const settle = ds.settle;
  const positions = [];
  items.forEach((it, i) => {
    const lots = Math.round(sol.n[i] * 1e6) / 1e6;
    if (lots <= 1e-9) return;
    const nominal = lots * it.b.lot;
    positions.push({ b: it.b, type: it.type, index: it.index, lots, nominal, cost: nominal / 100 * it.cost, ciSettle: it.ciSettle });
  });
  positions.sort((a, b) => a.b.maturity - b.b.maturity);
  const bondCost = positions.reduce((s, p) => s + p.cost, 0);
  const totalCost = bondCost + sol.c0;
  const sims = simulate(items, prep, sol.n, sol.c0, lam);

  // flussi della scala per scenario e per scadenza dell'affitto: rimborsi, cedole, bollo e tasse, nel periodo che li usa
  const byScen = {};
  for (const s of prep.scen) {
    const L = s.L;
    const rows = L.map(l => ({ due: l.day, year: l.year, half: l.half, need: lam * l.amount, red: 0, cpn: 0, cost: 0 }));
    items.forEach((it, i) => {
      if (!sol.n[i]) return;
      const k100 = sol.n[i] * it.b.lot / 100;
      for (const fl of it.flows[s.id]) {
        const k = L.findIndex(l => fl.day < l.day || (fl.day === l.day && fl.kind !== 'bollo'));
        if (k < 0) continue;
        const v = fl.net * k100;
        if (fl.kind === 'redemption' || fl.kind === 'rivalutazione') rows[k].red += v; else if (fl.kind === 'coupon') rows[k].cpn += v; else rows[k].cost += v;
      }
    });
    const sc = scen.find(x => x.id === s.id), defl = deflator(sc.fns, settle, cfg.liabIndex);
    rows.forEach((r, k) => { r.bal = sims[s.id].bal[k]; r.defl = defl(r.due); });
    byScen[s.id] = rows;
  }

  // rendimento interno netto della scala nello scenario base (costo oggi, tutti i flussi netti dei titoli)
  const base = prep.scen.find(s => s.id === 'base') || prep.scen[0];
  const flowsBase = [];
  items.forEach((it, i) => { if (sol.n[i]) for (const fl of it.flows[base.id]) flowsBase.push({ day: fl.day, amount: fl.net * sol.n[i] * it.b.lot / 100 }); });
  // flussi della scala nello scenario base, per il calendario degli incassi (cedole e rimborsi netti)
  const calendar = [];
  items.forEach((it, i) => { if (sol.n[i]) for (const fl of it.flows[base.id]) if (fl.kind === 'coupon' || fl.kind === 'redemption' || fl.kind === 'rivalutazione')
    calendar.push({ day: fl.day, kind: fl.kind, net: fl.net * sol.n[i] * it.b.lot / 100, isin: it.b.isin }); });
  const irr = bondCost > 0 ? xirr([{ day: settle, amount: -bondCost }].concat(flowsBase.sort((a, b) => a.day - b.day))) : NaN;
  const dur = bondCost > 0 ? flowsBase.reduce((s, x) => s + x.amount * years(settle, x.day), 0) / flowsBase.reduce((s, x) => s + x.amount, 0) : 0;

  const linkerCost = positions.filter(p => p.type !== 'NOM').reduce((s, p) => s + p.cost, 0);
  const group = key => { const mp = new Map(); for (const p of positions) mp.set(key(p), (mp.get(key(p)) || 0) + p.cost); return [...mp.entries()].map(([k, v]) => ({ k, v, share: bondCost ? v / bondCost : 0 })).sort((a, b) => b.v - a.v); };
  const scenMeta = scen.map(s => ({ id: s.id, label: s.label, robust: cfg.robust.includes(s.id) }));
  return {
    mode: 'indexed', cfg, settle, horizon, lam, positions, bondCost, cash0: sol.c0, totalCost,
    relaxedCost: cfg.mode === 'maxscale' ? null : relaxed.obj,
    linkerShare: bondCost ? linkerCost / bondCost : 0,
    byIssuer: group(p => p.b.issuerName), byRating: group(p => p.b.rating || 'NR'), byIndex: group(p => p.index || 'nominale'),
    irr, duration: dur, sims, byScen, scen: scenMeta, calendar: calendar.sort((a, b) => a.day - b.day),
    skipped: skipped.map(x => ({ isin: x.b.isin, desc: x.b.desc, why: x.why })), notes: note,
    universe: items.length, linkersInUniverse: items.filter(it => it.type !== 'NOM').length
  };
}
