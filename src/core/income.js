/* Modalità "Rendita mensile" (solo cedole, il capitale torna alle scadenze).
   Programmazione lineare in due passi:
   1. massimizza z = cedola netta del mese più povero (la rendita "garantita" ogni mese);
   2. fra i portafogli con rendita ≥ quota × z, massimizza il rendimento netto complessivo.
   Vincoli: capitale, tetto per emittente e per titolo, scadenze distribuite negli anni
   scelti (scala) oppure libere. Poi si tolgono le posizioni troppo piccole e si arrotonda
   ai lotti minimi, usando il capitale avanzato dove migliora la rendita. */
import { day, parts } from './dates.js';
import { cashflows, netCouponPerPeriod, scoreYield, xirr } from './bond.js';
import { solveLP } from './lp.js';
import { summarize } from './capital.js';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function buildModel(cands, C, opt, stage, zStar) {
  const { issuerCap, bondCap, ladder, years, coverable, tradeoff } = opt;
  const constraints = { budget: { equal: C } }, variables = {};
  const issuers = new Set(cands.map(c => c.bond.issuer));
  const aEff = Math.max(issuerCap, 1 / issuers.size + 1e-3);
  const gEff = Math.max(bondCap, 1 / cands.length + 1e-3);
  for (const k of issuers) constraints['k_' + k] = { max: aEff * C };
  if (ladder) {
    const share = C / years.length, sigma = 0.5;
    for (const y of years) { constraints['ylo' + y] = { min: (1 - sigma) * share }; constraints['yhi' + y] = { max: (1 + sigma) * share }; }
  }
  for (const m of coverable) constraints['m' + m] = stage === 1 ? { min: 0 } : { min: tradeoff * zStar * (1 - 1e-7) };
  cands.forEach((c, i) => {
    const v = { budget: 1, ['k_' + c.bond.issuer]: 1, ['u' + i]: 1, yld: c.y };
    constraints['u' + i] = { max: gEff * C };
    if (ladder) { v['ylo' + c.year] = 1; v['yhi' + c.year] = 1; }
    for (const m of c.months) if (coverable.includes(m)) v['m' + m] = c.r;
    variables['x' + i] = v;
  });
  if (stage === 1) {
    const zv = { obj: 1 };
    for (const m of coverable) zv['m' + m] = -1;
    variables.z = zv;
  }
  return { objective: stage === 1 ? 'obj' : 'yld', sense: 'max', constraints, variables };
}

function solveWeights(cands, C, opt) {
  const lp1 = solveLP(buildModel(cands, C, opt, 1));
  if (!lp1.feasible) return null;
  const zStar = lp1.x.z || 0;
  const lp2 = solveLP(buildModel(cands, C, opt, 2, zStar));
  const sol = lp2.feasible ? lp2 : lp1;
  return { zStar, cands, x: cands.map((_, i) => sol.x['x' + i] || 0) };
}

/**
 * cfg: { capital, yearFrom, yearTo, ladder=true, issuerCap=1/3, bondCap=0.2, tradeoff=1, zainetto=false, minPosition=0.03 }
 */
export function planIncome(ds, bonds, cfg) {
  const { capital: C, yearFrom, yearTo, ladder = true, issuerCap = 1 / 3, bondCap = 0.2,
    tradeoff = 1, zainetto = false, minPosition = 0.03 } = cfg;
  const settle = ds.settle;
  const lo = day(yearFrom, 1, 1), hi = day(yearTo, 12, 31);
  let cands = bonds.filter(b => !b.zc && b.freq > 0 && b.coupon > 0 && b.maturity >= lo && b.maturity <= hi &&
    b.maturity > settle + 90 && b.lot * b.cost / 100 <= Math.max(bondCap, 0.25) * C)
    .map(b => ({ bond: b, r: netCouponPerPeriod(b) / b.cost, y: scoreYield(b, zainetto), months: b.months, year: parts(b.maturity).y }))
    .filter(c => Number.isFinite(c.y) && c.r > 0);

  const warnings = [];
  if (!cands.length) return { mode: 'income', empty: true, positions: [], monthly: new Array(12).fill(0), warnings: ['Nessun titolo con cedola nel paniere per le scadenze scelte.'] };

  const coverable = MONTHS.filter(m => cands.some(c => c.months.includes(m)));
  const uncovered = MONTHS.filter(m => !coverable.includes(m));
  const years = [...new Set(cands.map(c => c.year))].sort((a, b) => a - b);
  const opt = { issuerCap, bondCap, ladder, years, coverable, tradeoff };

  // Posizioni troppo piccole: si tolgono e si ricalcola, ma senza mai lasciare scoperto un mese
  let sol = null, pruned = false;
  for (let round = 0; round < 20; round++) {
    sol = solveWeights(cands, C, opt);
    pruned = false;
    if (!sol && opt.ladder) { opt.ladder = false; warnings.push('Scadenze non distribuibili in modo regolare con questi filtri: distribuzione libera.'); sol = solveWeights(cands, C, opt); }
    if (!sol) return { mode: 'income', empty: true, positions: [], monthly: new Array(12).fill(0), warnings: ['Nessuna combinazione possibile con questi vincoli: allenta il limite per emittente o allarga il paniere.'] };
    const small = cands.map((c, i) => ({ c, x: sol.x[i] })).filter(p => p.x > 1e-6 && p.x < minPosition * C).sort((a, b) => a.x - b.x);
    if (!small.length) break;
    const removed = new Set();
    for (const s of small) {
      const rest = cands.filter(c => c !== s.c && !removed.has(c));
      if (s.c.months.every(m => !coverable.includes(m) || rest.some(o => o.months.includes(m)))) removed.add(s.c);
    }
    if (!removed.size) break;
    cands = cands.filter(c => !removed.has(c));
    opt.years = [...new Set(cands.map(c => c.year))].sort((a, b) => a - b);
    pruned = true;
  }
  if (pruned) sol = solveWeights(cands, C, opt) || sol;   // giri esauriti dopo una potatura: ricalcolo finale

  // Arrotondamento ai lotti (per difetto) e uso del capitale avanzato.
  // I pesi valgono per l'elenco di candidati che li ha prodotti (sol.cands), non per quello potato dopo.
  const picked = sol.cands.map((c, i) => ({ c, x: sol.x[i] })).filter(p => p.x > 1e-6);
  const pos = picked.map(p => {
    const b = p.c.bond, nominal = Math.floor(p.x / b.cost * 100 / b.lot + 1e-9) * b.lot;
    return { bond: b, nominal, c: p.c };
  });
  const monthlyOf = () => {
    const m = new Array(12).fill(0);
    for (const p of pos) for (const mo of p.bond.months) m[mo - 1] += p.nominal / 100 * netCouponPerPeriod(p.bond);
    return m;
  };
  const costOf = () => pos.reduce((s, p) => s + p.nominal * p.bond.cost / 100, 0);
  for (let guard = 0; guard < 2000; guard++) {
    const left = C - costOf();
    const m = monthlyOf();
    const minM = Math.min(...coverable.map(mo => m[mo - 1]));
    let best = null, bestGain = -Infinity;
    for (const p of pos) {
      const lotCost = p.bond.lot * p.bond.cost / 100;
      if (lotCost > left) continue;
      if ((p.nominal + p.bond.lot) * p.bond.cost / 100 > Math.max(bondCap, 1 / pos.length) * C * 1.02) continue;
      // preferisci il lotto che alza il mese più povero; a parità il rendimento
      const add = p.bond.lot / 100 * netCouponPerPeriod(p.bond);
      const newMin = Math.min(...coverable.map(mo => m[mo - 1] + (p.bond.months.includes(mo) ? add : 0)));
      const gain = (newMin - minM) * 1e6 + p.c.y;
      if (gain > bestGain) { bestGain = gain; best = p; }
    }
    if (!best) break;
    best.nominal += best.bond.lot;
  }

  const positions = pos.filter(p => p.nominal > 0).map(p => ({
    bond: p.bond, nominal: p.nominal, cost: p.nominal * p.bond.cost / 100, score: p.c.y,
    netPerPayment: p.nominal / 100 * netCouponPerPeriod(p.bond), months: p.bond.months
  })).sort((a, b) => a.bond.maturity - b.bond.maturity);
  const totalCost = positions.reduce((s, p) => s + p.cost, 0);
  const monthly = new Array(12).fill(0);
  for (const p of positions) for (const mo of p.months) monthly[mo - 1] += p.netPerPayment;
  const annual = monthly.reduce((s, v) => s + v, 0);
  const covered = monthly.map((v, i) => v > 0 ? i + 1 : 0).filter(Boolean);

  const schedule = [];
  for (const p of positions) for (const f of cashflows(p.bond, settle, { zainetto }))
    schedule.push({ day: f.day, isin: p.bond.isin, bond: p.bond, kind: f.kind, gross: p.nominal / 100 * f.gross, tax: p.nominal / 100 * f.tax, net: p.nominal / 100 * f.net });
  schedule.sort((a, b) => a.day - b.day);
  const irr = totalCost > 0 ? xirr([{ day: settle, amount: -totalCost }].concat(schedule.map(f => ({ day: f.day, amount: f.net })))) : NaN;

  const capitalByYear = new Map();
  for (const f of schedule) if (f.kind === 'redemption') { const y = parts(f.day).y; capitalByYear.set(y, (capitalByYear.get(y) || 0) + f.net); }

  if (uncovered.length) warnings.push(`Nessun titolo del paniere paga cedole in: ${uncovered.map(m => ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'][m - 1]).join(', ')}.`);

  return {
    mode: 'income', settle, capital: C, zainetto,
    positions, totalCost, cash: C - totalCost, monthly, annual,
    minMonth: covered.length ? Math.min(...covered.map(m => monthly[m - 1])) : 0,
    maxMonth: Math.max(...monthly), coveredMonths: covered.length,
    regularity: annual > 0 ? Math.min(...monthly) / (annual / 12) : 0,
    schedule, irr, capitalByYear: [...capitalByYear.entries()].sort((a, b) => a[0] - b[0]),
    candidates: cands.length, summary: summarize(positions, totalCost), warnings
  };
}
