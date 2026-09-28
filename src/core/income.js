/* Modalità "Rendita mensile" (solo cedole, il capitale torna alle scadenze).
   Programmazione lineare in due passi:
   1. massimizza z = cedola netta del mese più povero (la rendita "garantita" ogni mese);
   2. fra i portafogli con rendita ≥ quota × z, massimizza il rendimento netto complessivo.
   Vincoli: capitale, tetto per emittente e per titolo, scadenze distribuite negli anni
   scelti (scala) oppure libere. Poi si tolgono le posizioni troppo piccole e si arrotonda
   ai lotti minimi, usando il capitale avanzato dove migliora la rendita.
   Portafoglio già posseduto (facoltativo, niente vendite): le sue cedole nette sono una base fissa
   di ogni mese (e_m) e il modello cerca il mese più povero di base + nuovo. Quote per emittente e
   per titolo e distribuzione delle scadenze contano anche i titoli posseduti (al valore di oggi).
   I titoli che scadono prima dell'orizzonte non contano nell'anno tipo: pagherebbero solo per poco. */
import { day, parts } from './dates.js';
import { cashflows, netCouponPerPeriod, scoreYield, xirr } from './bond.js';
import { solveLP } from './lp.js';
import { summarize } from './capital.js';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Portafoglio posseduto → base fissa per la rendita: cedole nette per mese dell'anno tipo (e), valore di oggi
    per emittente, per titolo e per anno di scadenza (quote e scala), titoli che scadono prima dell'orizzonte. */
function existingBase(holdings, settle, lo, hi) {
  const e = new Array(12).fill(0), Eiss = new Map(), Ey = new Map(), Ebond = new Map(), before = [], counted = [];
  let Eall = 0;
  for (const x of holdings) {
    const b = x.bond, v = x.value || 0;
    Eall += v;
    Eiss.set(b.issuer, (Eiss.get(b.issuer) || 0) + v);
    for (const i of new Set([x.isin, x.topUpIsin || x.isin])) Ebond.set(i, (Ebond.get(i) || 0) + v);
    if (b.maturity < lo || b.maturity <= settle + 90) { before.push(x); continue; }
    counted.push(x);
    if (b.maturity <= hi) { const y = parts(b.maturity).y; Ey.set(y, (Ey.get(y) || 0) + v); }
    if (!b.zc && b.freq) { const per = netCouponPerPeriod(b) * x.nominal / 100; for (const m of b.months) e[m - 1] += per; }
  }
  return { e, Eiss, Ey, Ebond, Eall, before, counted };
}

/** Scala con i titoli posseduti: la quota di ogni anno si calcola sul totale (posseduto che scade nell'anno +
    nuovo) e i limiti valgono sul nuovo. Se il capitale nuovo non basta a portare ogni anno al minimo, i minimi
    scendono in proporzione; la somma dei massimi supera sempre il capitale, quindi il modello resta risolvibile. */
function ladderBounds(years, C, Ey, sigma = 0.5) {
  const Eh = years.reduce((s, y) => s + (Ey.get(y) || 0), 0);
  const share = (Eh + C) / years.length;
  let lo = years.map(y => Math.max(0, (1 - sigma) * share - (Ey.get(y) || 0)));
  const hi = years.map(y => Math.max(0, (1 + sigma) * share - (Ey.get(y) || 0)));
  const sumLo = lo.reduce((a, b) => a + b, 0);
  const scaled = sumLo > C + 1e-9;
  if (scaled) lo = lo.map(v => v * C / sumLo);
  return { map: new Map(years.map((y, i) => [y, { lo: lo[i], hi: hi[i] }])), scaled };
}

function buildModel(cands, C, opt, stage, zStar) {
  const { issuerCap, bondCap, ladder, years, coverable, tradeoff, ex, bonus = 0 } = opt;
  const constraints = { budget: { equal: C } }, variables = {};
  const issuers = new Set(cands.map(c => c.bond.issuer));
  const aEff = Math.max(issuerCap, 1 / issuers.size + 1e-3);
  const gEff = Math.max(bondCap, 1 / cands.length + 1e-3);
  const W = ex ? C + ex.Eall : C;                                    // quote sul portafoglio complessivo
  for (const k of issuers) constraints['k_' + k] = { max: ex ? Math.max(0, aEff * W - (ex.Eiss.get(k) || 0)) : aEff * C };
  if (ladder && ex) {
    const yb = ladderBounds(years, C, ex.Ey).map;
    for (const y of years) { constraints['ylo' + y] = { min: yb.get(y).lo }; constraints['yhi' + y] = { max: yb.get(y).hi }; }
  } else if (ladder) {
    const share = C / years.length, sigma = 0.5;
    for (const y of years) { constraints['ylo' + y] = { min: (1 - sigma) * share }; constraints['yhi' + y] = { max: (1 + sigma) * share }; }
  }
  for (const m of coverable) {
    const e = ex ? ex.e[m - 1] : 0;                                  // cedole dei titoli posseduti nel mese
    constraints['m' + m] = stage === 1 ? { min: e ? -e : 0 } : { min: tradeoff * zStar * (1 - 1e-7) - e };
  }
  cands.forEach((c, i) => {
    const v = { budget: 1, ['k_' + c.bond.issuer]: 1, ['u' + i]: 1, yld: c.held ? c.y + bonus : c.y };
    constraints['u' + i] = { max: ex ? Math.max(0, gEff * W - (ex.Ebond.get(c.bond.isin) || 0)) : gEff * C };
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
 * cfg: { capital, yearFrom, yearTo, ladder=true, issuerCap=1/3, bondCap=0.2, tradeoff=1, zainetto=false, minPosition=0.03,
 *        holdings=[] titoli posseduti { isin, topUpIsin?, bond, nominal, value, flows },
 *        heldBonus=0 punti di rendimento regalati ai titoli posseduti nel secondo obiettivo, heldPool=[] }
 */
export function planIncome(ds, bonds, cfg) {
  const { capital: C, yearFrom, yearTo, ladder = true, issuerCap = 1 / 3, bondCap = 0.2,
    tradeoff = 1, zainetto = false, minPosition = 0.03, holdings = [], heldBonus = 0, heldPool = [] } = cfg;
  const settle = ds.settle;
  const lo = day(yearFrom, 1, 1), hi = day(yearTo, 12, 31);
  const ex = holdings.length ? existingBase(holdings, settle, lo, hi) : null;
  const heldSet = new Set(holdings.flatMap(x => [x.isin, x.topUpIsin || x.isin]));
  const pool = heldPool.length ? bonds.concat(heldPool.filter(b => !bonds.includes(b))) : bonds;
  let cands = pool.filter(b => !b.zc && b.freq > 0 && b.coupon > 0 && b.maturity >= lo && b.maturity <= hi &&
    b.maturity > settle + 90 && b.lot * b.cost / 100 <= Math.max(bondCap, 0.25) * C)
    .map(b => ex && heldSet.has(b.isin)
      ? { bond: b, r: netCouponPerPeriod(b) / b.cost, y: scoreYield(b, zainetto), months: b.months, year: parts(b.maturity).y, held: true }
      : { bond: b, r: netCouponPerPeriod(b) / b.cost, y: scoreYield(b, zainetto), months: b.months, year: parts(b.maturity).y })
    .filter(c => Number.isFinite(c.y) && c.r > 0);

  const warnings = [];
  if (!cands.length && !ex) return { mode: 'income', empty: true, positions: [], monthly: new Array(12).fill(0), warnings: ['Nessun titolo con cedola nel paniere per le scadenze scelte.'] };
  if (!cands.length || !(C > 0)) return existingOnly(ds, ex, holdings, C, cands.length ? [] : [C > 0 ? 'Nessun titolo con cedola nel paniere per le scadenze scelte: resta la rendita dei tuoi titoli.' : '']);

  const coverable = MONTHS.filter(m => cands.some(c => c.months.includes(m)));
  const uncovered = MONTHS.filter(m => !coverable.includes(m) && !(ex && ex.e[m - 1] > 0));
  const years = [...new Set(cands.map(c => c.year))].sort((a, b) => a - b);
  const opt = { issuerCap, bondCap, ladder, years, coverable, tradeoff, ex, bonus: heldBonus };
  if (ex && ladder && ladderBounds(years, C, ex.Ey).scaled) warnings.push('Il capitale nuovo non basta a portare ogni anno di scadenza alla sua quota: li riempio in proporzione.');

  // Posizioni troppo piccole: si tolgono e si ricalcola, ma senza mai lasciare scoperto un mese
  let sol = null, pruned = false;
  for (let round = 0; round < 20; round++) {
    sol = solveWeights(cands, C, opt);
    pruned = false;
    if (!sol && opt.ladder) { opt.ladder = false; warnings.push('Scadenze non distribuibili in modo regolare con questi filtri: distribuzione libera.'); sol = solveWeights(cands, C, opt); }
    if (!sol) return { mode: 'income', empty: true, positions: [], monthly: new Array(12).fill(0), warnings: ['Nessuna combinazione possibile con questi vincoli: allenta il limite per emittente o allarga il paniere.'] };
    // posizioni troppo piccole; per i titoli che hai già basta un lotto sensato (altri pezzi dello stesso titolo)
    const small = cands.map((c, i) => ({ c, x: sol.x[i] })).filter(p => p.x > 1e-6 && p.x < (p.c.held ? Math.min(1000, minPosition * C) : minPosition * C)).sort((a, b) => a.x - b.x);
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

  // Arrotondamento ai lotti. I pesi valgono per l'elenco di candidati che li ha prodotti (sol.cands).
  // 1) lotto più vicino al peso ottimo; 2) se si sfora il capitale, via i lotti che pesano meno sul
  // mese più povero; 3) scambi di un lotto fra due titoli finché il mese più povero sale;
  // 4) il capitale avanzato va, lotto per lotto, dove alza di più il mese più povero.
  // Passo minimo 100 € anche per i titoli con lotto 1, per avere importi ordinati.
  const pos = sol.cands.map((c, i) => ({ c, x: sol.x[i] })).filter(p => p.x > 1e-6).map(p => {
    const b = p.c.bond, step = b.lot >= 100 ? b.lot : 100;
    return { bond: b, c: p.c, step, k: Math.max(0, Math.round(p.x / b.cost * 100 / step)),
      inc: step / 100 * netCouponPerPeriod(b), stepCost: step * b.cost / 100 };
  });
  const capPos = Math.max(bondCap, 1 / Math.max(1, pos.length)) * C * 1.02;
  const monthlyNow = () => { const m = ex ? ex.e.slice() : new Array(12).fill(0); for (const p of pos) for (const mo of p.bond.months) m[mo - 1] += p.k * p.inc; return m; };
  const minOf = m => Math.min(...coverable.map(mo => m[mo - 1]));
  const costNow = () => pos.reduce((s, p) => s + p.k * p.stepCost, 0);
  const bump = (m, p, d) => { for (const mo of p.bond.months) m[mo - 1] += d * p.inc; };
  while (costNow() > C + 1e-6) {
    const m = monthlyNow();
    let best = null, bestV = -Infinity;
    for (const p of pos) {
      if (p.k <= 0) continue;
      bump(m, p, -1); const v = minOf(m); bump(m, p, +1);
      if (v > bestV + 1e-9 || (Math.abs(v - bestV) <= 1e-9 && best && p.c.y < best.c.y)) { bestV = v; best = p; }
    }
    if (!best) break;
    best.k--;
  }
  for (let it = 0; it < 400; it++) {
    const m = monthlyNow(), cur = minOf(m), budget = C - costNow();
    let move = null, bestV = cur + 1e-6;
    for (const a of pos) {
      if (a.k <= 0) continue;
      for (const b of pos) {
        if (a === b || b.stepCost - a.stepCost > budget + 1e-6 || (b.k + 1) * b.stepCost > capPos) continue;
        bump(m, a, -1); bump(m, b, +1);
        const v = minOf(m);
        bump(m, a, +1); bump(m, b, -1);
        if (v > bestV) { bestV = v; move = [a, b]; }
      }
    }
    if (!move) break;
    move[0].k--; move[1].k++;
  }
  for (let guard = 0; guard < 4000; guard++) {
    const left = C - costNow(), m = monthlyNow(), cur = minOf(m);
    let best = null, bestGain = -Infinity;
    for (const p of pos) {
      if (p.stepCost > left + 1e-6 || (p.k + 1) * p.stepCost > capPos) continue;
      bump(m, p, +1); const v = minOf(m); bump(m, p, -1);
      const gain = (v - cur) * 1e6 + p.c.y;
      if (gain > bestGain) { bestGain = gain; best = p; }
    }
    if (!best) break;
    best.k++;
  }
  for (const p of pos) p.nominal = p.k * p.step;

  const positions = pos.filter(p => p.nominal > 0).map(p => ({
    bond: p.bond, nominal: p.nominal, cost: p.nominal * p.bond.cost / 100, score: p.c.y,
    netPerPayment: p.nominal / 100 * netCouponPerPeriod(p.bond), months: p.bond.months, ...(p.c.held ? { topUp: true } : {})
  })).sort((a, b) => a.bond.maturity - b.bond.maturity);
  const totalCost = positions.reduce((s, p) => s + p.cost, 0);
  const monthly = ex ? ex.e.slice() : new Array(12).fill(0);
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

  if (uncovered.length) warnings.push(`Nessun titolo del paniere paga cedole in: ${uncovered.map(m => MONTH_NAMES[m - 1]).join(', ')}.`);

  const out = {
    mode: 'income', settle, capital: C, zainetto,
    positions, totalCost, cash: C - totalCost, monthly, annual,
    minMonth: covered.length ? Math.min(...covered.map(m => monthly[m - 1])) : 0,
    maxMonth: Math.max(...monthly), coveredMonths: covered.length,
    regularity: annual > 0 ? Math.min(...monthly) / (annual / 12) : 0,
    schedule, irr, capitalByYear: [...capitalByYear.entries()].sort((a, b) => a[0] - b[0]),
    candidates: cands.length, summary: summarize(positions, totalCost), warnings
  };
  if (ex) Object.assign(out, { coverable }, heldIncomeReport(out, ex, holdings, settle));
  return out;
}

const MONTH_NAMES = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** Solo i titoli posseduti (nessun capitale nuovo o nessun titolo comprabile): la loro rendita, così com'è. */
function existingOnly(ds, ex, holdings, C, warnings) {
  const monthly = ex.e.slice(), annual = monthly.reduce((s, v) => s + v, 0);
  const covered = monthly.map((v, i) => v > 0 ? i + 1 : 0).filter(Boolean);
  const out = {
    mode: 'income', settle: ds.settle, capital: C, zainetto: false, positions: [], totalCost: 0, cash: C, monthly, annual,
    minMonth: covered.length ? Math.min(...covered.map(m => monthly[m - 1])) : 0, maxMonth: Math.max(...monthly), coveredMonths: covered.length,
    regularity: annual > 0 ? Math.min(...monthly) / (annual / 12) : 0, schedule: [], irr: NaN, capitalByYear: [], candidates: 0,
    summary: summarize([], 0), warnings: warnings.filter(Boolean)
  };
  return Object.assign(out, heldIncomeReport(out, ex, holdings, ds.settle));
}

/** Il portafoglio nella rendita: prima e dopo, quanto pesa, cosa scade prima, capitale che torna, rendimenti. */
function heldIncomeReport(out, ex, holdings, settle) {
  const before = ex.e.slice(), annualBefore = before.reduce((s, v) => s + v, 0);
  const paid = before.map((v, i) => v > 0 ? i + 1 : 0).filter(Boolean);
  const heldSchedule = holdings.flatMap(x => x.flows.map(f => ({ day: f.day, isin: x.isin, bond: x.bond, kind: f.kind, gross: f.gross, net: f.net, held: true })))
    .sort((a, b) => a.day - b.day);
  const heldCapitalByYear = new Map();
  for (const f of heldSchedule) if (f.kind === 'redemption') { const y = parts(f.day).y; heldCapitalByYear.set(y, (heldCapitalByYear.get(y) || 0) + f.net); }
  const heldValue = holdings.reduce((s, x) => s + (x.value || 0), 0);
  const cash = f => ({ day: f.day, amount: f.net });
  const irrAll = heldValue + out.totalCost > 0 ? xirr([{ day: settle, amount: -(heldValue + out.totalCost) }]
    .concat(out.schedule.map(cash), heldSchedule.map(cash)).sort((a, b) => a.day - b.day)) : NaN;
  const beforeAnnual = ex.before.reduce((s, x) => s + (!x.bond.zc && x.bond.freq ? netCouponPerPeriod(x.bond) * x.nominal / 100 * x.bond.freq : 0), 0);
  return {
    holdings: holdings.map(x => ({ isin: x.isin, desc: x.bond.desc, bond: x.bond, nominal: x.nominal, value: x.value, status: x.status,
      counted: ex.counted.includes(x), netPerPayment: !x.bond.zc && x.bond.freq ? netCouponPerPeriod(x.bond) * x.nominal / 100 : 0 })),
    monthlyHeld: before, annualHeld: annualBefore,
    // confronto onesto fra prima e dopo: su tutti i 12 mesi, anche quelli a zero
    minMonthBefore: paid.length ? Math.min(...paid.map(m => before[m - 1])) : 0, zeroMonthsBefore: 12 - paid.length,
    minAllBefore: Math.min(...before), minAllAfter: Math.min(...out.monthly),
    heldShare: out.annual > 0 ? annualBefore / out.annual : 0,
    heldBefore: ex.before.map(x => ({ isin: x.isin, desc: x.bond.desc, maturity: x.bond.maturity, nominal: x.nominal })), heldBeforeAnnual: beforeAnnual,
    heldSchedule, heldCapitalByYear: [...heldCapitalByYear.entries()].sort((a, b) => a[0] - b[0]),
    heldValue, irrAll, topUps: out.positions.filter(p => p.topUp).length, newLines: out.positions.filter(p => !p.topUp).length
  };
}

/** Rendita desiderata con i titoli posseduti: il mese più povero non cresce in proporzione al capitale,
    quindi si cerca per bisezione il capitale nuovo che basta (sul valore del modello lineare, veloce),
    poi si fa il piano e, se lotti e pulizia lo lasciano sotto, si aggiunge capitale a piccoli passi. */
export function planIncomeTarget(ds, bonds, cfg, target) {
  const zero = planIncome(ds, bonds, { ...cfg, capital: 0 });
  if (zero.coveredMonths === 12 && zero.minMonth >= target) return { ...zero, monthlyTarget: target };
  // il mese più povero fra quelli che i titoli nuovi possono pagare (gli altri restano come sono)
  const reached = r => { const ms = r.coverable || []; return ms.length > 0 && Math.min(...ms.map(m => r.monthly[m - 1])) >= target - 1e-6; };
  const zAt = C => lpFloor(ds, bonds, { ...cfg, capital: C });
  let lo = 0, hi = 10000;
  while (zAt(hi) < target && hi < 5e6) { lo = hi; hi *= 2; }
  if (zAt(hi) < target) {
    const res = planIncome(ds, bonds, { ...cfg, capital: lo || 10000 });
    return { ...res, monthlyTarget: target, warnings: [...(res.warnings || []), 'Rendita desiderata non raggiungibile con i titoli del paniere: allarga il paniere o abbassa la cifra.'] };
  }
  // capitale minimo (a 1.000 €) con cui il modello lineare arriva a «goal»
  const bisect = (goal, a, b) => {
    while (zAt(b) < goal && b < 5e6) { a = b; b *= 2; }
    for (let k = 0; k < 30 && b - a > 500; k++) { const m = (a + b) / 2; if (zAt(m) >= goal) b = m; else a = m; }
    return Math.ceil(b / 1000) * 1000;
  };
  const minCov = r => Math.min(...(r.coverable || []).map(m => r.monthly[m - 1]));
  // pulizia delle posizioni piccole e lotti tolgono qualcosa al valore lineare: si misura quanto e si rialza la mira
  let goal = target, C = bisect(goal, lo, hi), res = planIncome(ds, bonds, { ...cfg, capital: C });
  for (let round = 0; round < 4 && !res.empty && !reached(res); round++) {
    const loss = Math.max(1e-6, minCov(res)) / Math.max(1e-6, zAt(C));
    goal = Math.max(goal * 1.01, target / Math.min(1, loss));
    const next = Math.max(C + 1000, bisect(goal, C, C * 2));
    C = next; res = planIncome(ds, bonds, { ...cfg, capital: C });
  }
  for (let k = 0; k < 8 && !res.empty && !reached(res); k++) {
    C += Math.max(1000, Math.ceil(C * 0.02 / 1000) * 1000);
    res = planIncome(ds, bonds, { ...cfg, capital: C });
  }
  return { ...res, monthlyTarget: target };
}

/** Valore del modello lineare (primo passo: il mese più povero) per un capitale nuovo: niente pulizia né lotti. */
function lpFloor(ds, bonds, cfg) {
  const { capital: C, yearFrom, yearTo, ladder = true, issuerCap = 1 / 3, bondCap = 0.2, zainetto = false, holdings = [], heldPool = [] } = cfg;
  const settle = ds.settle, lo = day(yearFrom, 1, 1), hi = day(yearTo, 12, 31);
  const ex = holdings.length ? existingBase(holdings, settle, lo, hi) : null;
  const pool = heldPool.length ? bonds.concat(heldPool.filter(b => !bonds.includes(b))) : bonds;
  const cands = pool.filter(b => !b.zc && b.freq > 0 && b.coupon > 0 && b.maturity >= lo && b.maturity <= hi &&
    b.maturity > settle + 90 && b.lot * b.cost / 100 <= Math.max(bondCap, 0.25) * C)
    .map(b => ({ bond: b, r: netCouponPerPeriod(b) / b.cost, y: scoreYield(b, zainetto), months: b.months, year: parts(b.maturity).y }))
    .filter(c => Number.isFinite(c.y) && c.r > 0);
  if (!cands.length) return -Infinity;
  const coverable = MONTHS.filter(m => cands.some(c => c.months.includes(m)));
  const opt = { issuerCap, bondCap, ladder, years: [...new Set(cands.map(c => c.year))].sort((a, b) => a - b), coverable, tradeoff: 1, ex };
  let lp = solveLP(buildModel(cands, C, opt, 1));
  if (!lp.feasible && ladder) { opt.ladder = false; lp = solveLP(buildModel(cands, C, opt, 1)); }
  return lp.feasible ? lp.x.z || 0 : -Infinity;                    // mese più povero fra quelli che i nuovi possono pagare
}
