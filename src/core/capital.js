/* Modalità "Capitale a scadenza" (cash-flow matching).
   1. Ogni obiettivo ha una finestra di scadenze ammesse: un periodo (scala regolare)
      oppure "fino a N mesi prima" di una data precisa.
   2. Per ogni obiettivo si sceglie il titolo migliore della finestra (selectPerSlot):
      scala regolare → rendimento netto; data precisa → rendimento effettivo alla data
      (se il titolo scade prima, i soldi restano fermi fino alla data: conta anche questo).
   3. Nominali calcolati all'indietro, dall'ultima scadenza alla prima: l'importo di ogni
      obiettivo = rimborso del suo titolo + cedole incassate nel suo periodo da tutti i titoli.
      Il periodo è l'anno o il semestre della scadenza (per le date precise, i 12 mesi prima):
      le cedole incassate prima della scala, o fra due date lontane, non contano per gli
      importi (resterebbero ferme per anni e in una scala che parte tardi toglierebbero il
      primo titolo): restano all'investitore, che le spende o le reinveste.
      Con l'opzione "accantona" quelle cedole restano invece da parte (senza interessi) e
      pagano, in ordine, le prime scadenze; l'eventuale avanzo passa alla scadenza dopo.
   4. Nominali arrotondati al lotto minimo (per eccesso se parti dagli importi, per difetto
      se parti dal capitale; il capitale avanzato viene poi usato lotto per lotto). */
import { day, parts, addMonths, years, fmt, fmtMonthYear } from './dates.js';
import { cashflows, scoreYield, xirr } from './bond.js';
import { selectPerSlot } from './select.js';

/** Scala regolare: un obiettivo per periodo (anno, semestre o trimestre). */
export function regularTargets({ yearFrom, yearTo, everyMonths = 12, amount = 10000 }, settle) {
  const out = [];
  for (let y = yearFrom; y <= yearTo; y++) {
    for (let k = 0; k < 12 / everyMonths; k++) {
      const m0 = k * everyMonths;                                   // mese iniziale (0-based)
      const start = day(y, m0 + 1, 1) - 1;                          // esclusivo
      const end = addMonths(day(y, m0 + 1, 1), everyMonths) - 1;    // inclusivo
      if (end <= settle) continue;
      const label = everyMonths === 12 ? String(y)
        : everyMonths === 6 ? `${k + 1}° sem ${y}` : `${k + 1}° trim ${y}`;
      out.push({ label, start: Math.max(start, settle), end, need: null, amount });
    }
  }
  return out;
}

/** Date precise: il titolo deve scadere tra (data − flessibilità) e la data. */
export function dateTargets(list, flexMonths, settle) {
  const sorted = list.filter(x => x.day > settle && x.amount > 0).sort((a, b) => a.day - b.day);
  return sorted.map((x, i) => {
    const prev = i ? sorted[i - 1].day : settle;
    return { label: x.label || fmt(x.day), start: Math.max(prev, addMonths(x.day, -flexMonths) - 1), end: x.day, need: x.day, amount: x.amount };
  });
}

/** Periodo di ogni obiettivo ({lo} escluso, {hi} incluso): solo i flussi che arrivano qui
    contano per il suo importo. Scala regolare: il suo anno o semestre. Data precisa: i 12 mesi
    prima della data (o tutta la finestra di scadenza, se più lunga), mai prima dell'obiettivo
    precedente. */
export function periods(targets, settle) {
  return targets.map((t, i) => {
    const hi = t.need ?? t.end;
    const prev = i ? (targets[i - 1].need ?? targets[i - 1].end) : settle;
    const lo = t.need == null ? Math.max(prev, t.start) : Math.max(prev, Math.min(t.start, addMonths(hi, -12)));
    return { lo, hi };
  });
}

function candidatesFor(t, bonds, settle, zainetto, approxAmount) {
  const out = [];
  for (const b of bonds) {
    if (b.maturity <= t.start || b.maturity > t.end) continue;
    if (b.lot * b.cost / 100 > approxAmount * 1.05) continue;        // lotto minimo troppo grande
    const y = scoreYield(b, zainetto) / 100;
    if (!Number.isFinite(y)) continue;
    let score = y;
    if (t.need != null) score = Math.pow(1 + y, years(settle, b.maturity) / years(settle, t.need)) - 1;
    out.push({ bond: b, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

const roundLot = (x, lot, mode) => {
  if (!(x > 0)) return 0;
  const q = x / lot;
  return (mode === 'up' ? Math.ceil(q - 1e-9) : mode === 'down' ? Math.floor(q + 1e-9) : mode === 'nearest' ? Math.round(q) : q) * lot;
};

/** Nominali all'indietro. amounts[t] = importo voluto; draws[t] = parte pagata dalle cedole accantonate;
    flows[s][k].p = periodo in cui cade il flusso (−1 = nessuno). */
function sizeBackward(choice, flows, amounts, useCoupons, rounding, draws = null) {
  const T = amounts.length;
  const sumIn = (t, fl, kinds) => fl.reduce((s, f) => s + (f.p === t && kinds.includes(f.kind) ? f.net : 0), 0);
  const nominal = new Array(T).fill(0);
  for (let t = T - 1; t >= 0; t--) {
    if (!choice[t]) continue;
    let others = 0;
    if (useCoupons) for (let s = t + 1; s < T; s++) if (nominal[s]) others += nominal[s] / 100 * sumIn(t, flows[s], ['coupon']);
    const own = sumIn(t, flows[t], useCoupons ? ['coupon', 'redemption'] : ['redemption']);
    const residual = amounts[t] - others - (draws ? draws[t] : 0);
    nominal[t] = residual > 0 && own > 0 ? roundLot(residual / own * 100, choice[t].bond.lot, rounding) : 0;
  }
  return nominal;
}

/** Cassa di ogni obiettivo, dati i nominali. Le cedole fuori dai periodi (prima della scala o
    fra due date lontane; flows[s][k].q = obiettivo successivo) sono un'entrata in più, oppure,
    se accantonate, pagano in ordine le prime scadenze che ne hanno bisogno. */
function cashPlan(choice, flows, nominal, amounts, useCoupons, pooled) {
  const rows = amounts.map(() => ({ redemption: 0, coupons: 0 }));
  const outside = amounts.map(() => 0);
  let after = 0;
  choice.forEach((c, s) => {
    if (!c || !nominal[s]) return;
    for (const f of flows[s]) {
      const v = nominal[s] / 100 * f.net;
      if (f.p >= 0) { if (f.kind === 'redemption') rows[f.p].redemption += v; else rows[f.p].coupons += v; }
      else if (f.kind === 'coupon') { if (f.q >= 0) outside[f.q] += v; else after += v; }
    }
  });
  let pot = 0;
  return {
    rows: rows.map((r, t) => {
      const own = r.redemption + (useCoupons ? r.coupons : 0);
      let fromPot = 0;
      if (pooled) { pot += outside[t]; fromPot = Math.min(pot, Math.max(0, amounts[t] - own)); pot -= fromPot; }
      return { ...r, fromPot, available: own + fromPot, extraCoupons: useCoupons ? 0 : r.coupons };
    }),
    before: outside[0], between: outside.slice(1).reduce((a, b) => a + b, 0) + after, potLeft: pooled ? pot + after : 0
  };
}

/** Cedole accantonate: quanto ne usa ogni obiettivo (prima le scadenze più vicine). La cassa dipende
    dai titoli (le loro cedole) e i titoli dalla cassa: iterazione a punto fisso, smorzata. */
function potDraws(choice, flows, amounts) {
  const T = amounts.length, tol = 1e-7 * Math.max(1, ...amounts);
  let draws = amounts.map(() => 0);
  for (let it = 0; it < 300; it++) {
    const x = sizeBackward(choice, flows, amounts, true, 'none', draws);
    const inflow = amounts.map(() => 0), others = amounts.map(() => 0);
    choice.forEach((c, s) => {
      if (!c || !x[s]) return;
      for (const f of flows[s]) {
        if (f.kind !== 'coupon') continue;
        const v = x[s] / 100 * f.net;
        if (f.p < 0) { if (f.q >= 0) inflow[f.q] += v; }
        else if (f.p < s) others[f.p] += v;
      }
    });
    let pot = 0, delta = 0;
    const next = amounts.map((a, t) => { pot += inflow[t]; const d = Math.min(pot, Math.max(0, a - others[t])); pot -= d; return d; });
    draws = draws.map((d, t) => { const nd = d + 0.5 * (next[t] - d); delta = Math.max(delta, Math.abs(nd - d)); return nd; });
    if (delta < tol) break;
  }
  return draws;
}

/**
 * @param ds       dataset (settle)
 * @param bonds    titoli del paniere
 * @param cfg      { targets, useCoupons=true, zainetto=false, issuerCap=1, budget=null,
 *                   fixed={} (indice → isin), rounding='up'|'nearest' }
 */
export function planCapital(ds, bonds, cfg) {
  const { targets, useCoupons = true, accumulate = false, zainetto = false, issuerCap = 1, budget = null, fixed = {}, rounding = 'up' } = cfg;
  const pooled = !!(accumulate && useCoupons);
  const settle = ds.settle, T = targets.length;
  if (!T) return { empty: true, targets: [], positions: [], warnings: ['Nessuna scadenza futura nel periodo scelto.'] };
  const weightSum = targets.reduce((s, t) => s + t.amount, 0);
  const approx = t => budget ? budget * t.amount / weightSum : t.amount;

  const allCands = targets.map(t => candidatesFor(t, bonds, settle, zainetto, approx(t)));
  // Titoli fissati dall'utente: fuori dall'ottimizzazione, ma pesano sul limite per emittente
  const choice = new Array(T).fill(null), preIss = new Map(), preIsin = [];
  const free = [];
  targets.forEach((t, i) => {
    const isin = fixed[i];
    const c = isin ? allCands[i].find(x => x.bond.isin === isin) || (() => {
      const b = bonds.find(x => x.isin === isin); return b ? { bond: b, score: scoreYield(b, zainetto) / 100 } : null;
    })() : null;
    if (c) { choice[i] = { ...c, fixed: true }; preIsin.push(c.bond.isin); preIss.set(c.bond.issuer, (preIss.get(c.bond.issuer) || 0) + t.amount); }
    else free.push(i);
  });
  const sel = selectPerSlot(free.map(i => ({ weight: targets[i].amount, cands: allCands[i] })),
    { issuerCap, totalWeight: weightSum, preUsedIsins: preIsin, preIssuerWeights: preIss });
  free.forEach((i, k) => { choice[i] = sel.choice[k]; });

  const per = periods(targets, settle);
  const periodOf = d => per.findIndex(q => d > q.lo && d <= q.hi);
  const nextOf = d => per.findIndex(q => d <= q.lo);                  // per le cedole fuori dai periodi
  const flows = choice.map(c => c ? cashflows(c.bond, settle, { zainetto }).map(f => {
    const p = periodOf(f.day);
    return { ...f, p, q: p >= 0 ? p : nextOf(f.day) };
  }) : []);
  let amounts = targets.map(t => t.amount), nominal;
  const plan = (n, a) => cashPlan(choice, flows, n, a, useCoupons, pooled);
  if (budget) {
    // Tutto è proporzionale agli importi (anche la cassa accantonata): basta scalare la soluzione unitaria
    const unitDraws = pooled ? potDraws(choice, flows, amounts) : null;
    const unit = sizeBackward(choice, flows, amounts, useCoupons, 'none', unitDraws);
    const unitCost = unit.reduce((s, n, i) => s + (choice[i] ? n * choice[i].bond.cost / 100 : 0), 0);
    const f = unitCost > 0 ? budget / unitCost : 0;
    amounts = amounts.map(a => a * f);
    nominal = sizeBackward(choice, flows, amounts, useCoupons, 'down', unitDraws && unitDraws.map(d => d * f));
    // Capitale avanzato dall'arrotondamento: un lotto alla volta dove manca di più
    const costOf = () => nominal.reduce((s, n, i) => s + (choice[i] ? n * choice[i].bond.cost / 100 : 0), 0);
    for (let guard = 0; guard < 500; guard++) {
      const left = budget - costOf();
      const comp = plan(nominal, amounts).rows;
      let bestI = -1, bestGap = 0;
      choice.forEach((c, i) => {
        if (!c || c.bond.lot * c.bond.cost / 100 > left) return;
        const gap = (amounts[i] - comp[i].available) / amounts[i];
        if (gap > bestGap) { bestGap = gap; bestI = i; }
      });
      if (bestI < 0) break;
      nominal[bestI] += choice[bestI].bond.lot;
    }
  } else {
    const draws = pooled ? potDraws(choice, flows, amounts) : null;
    nominal = sizeBackward(choice, flows, amounts, useCoupons, rounding === 'nearest' ? 'nearest' : 'up', draws);
    if (pooled && rounding !== 'nearest') {
      // Con la cassa accantonata l'arrotondamento può lasciare scoperto qualche euro: i lotti che mancano…
      for (let guard = 0; guard < 100; guard++) {
        const rows = plan(nominal, amounts).rows;
        const i = rows.findIndex((r, t) => choice[t] && r.available + 0.5 < amounts[t]);
        if (i < 0) break;
        const perLot = choice[i].bond.lot / 100 * flows[i].reduce((s, f) => s + (f.p === i ? f.net : 0), 0);
        nominal[i] += choice[i].bond.lot * Math.max(1, Math.ceil((amounts[i] - rows[i].available) / Math.max(perLot, 1e-9) - 1e-9));
      }
      // …oppure lotti di troppo (la cassa ha più cedole del previsto): si restituiscono, dalle scadenze più vicine.
      // Togliere lotti non aumenta mai la cassa di nessuna scadenza: ricerca binaria sul numero di lotti.
      const base = plan(nominal, amounts).rows;
      const holds = () => plan(nominal, amounts).rows.every((r, t) => r.available + 0.5 >= Math.min(amounts[t], base[t].available));
      for (let t = 0; t < nominal.length; t++) {
        const lot = choice[t] ? choice[t].bond.lot : 0, orig = nominal[t];
        if (!lot || orig < lot) continue;
        let lo = 0, hi = Math.floor(orig / lot + 1e-9);
        while (lo < hi) {
          const m = (lo + hi + 1) >> 1;
          nominal[t] = orig - m * lot;
          if (holds()) lo = m; else hi = m - 1;
        }
        nominal[t] = orig - lo * lot;
      }
    }
  }

  const { rows: comp, before, between, potLeft } = plan(nominal, amounts);
  const positions = [];
  choice.forEach((c, i) => {
    if (!c || !nominal[i]) return;
    positions.push({ target: i, bond: c.bond, nominal: nominal[i], cost: nominal[i] * c.bond.cost / 100, score: c.score, fixed: !!c.fixed });
  });
  const totalCost = positions.reduce((s, p) => s + p.cost, 0);

  // Calendario completo dei flussi
  const schedule = [];
  choice.forEach((c, i) => {
    if (!c || !nominal[i]) return;
    for (const f of flows[i]) schedule.push({ day: f.day, isin: c.bond.isin, bond: c.bond, kind: f.kind,
      gross: nominal[i] / 100 * f.gross, tax: nominal[i] / 100 * f.tax, net: nominal[i] / 100 * f.net });
  });
  schedule.sort((a, b) => a.day - b.day);
  const irr = totalCost > 0 ? xirr([{ day: settle, amount: -totalCost }].concat(schedule.map(f => ({ day: f.day, amount: f.net })))) : NaN;

  const warnings = [];
  targets.forEach((t, i) => {
    if (!allCands[i].length) warnings.push(`${t.label}: nessun titolo del paniere scade ${t.need != null ? `tra ${fmt(t.start + 1)} e ${fmt(t.end)}` : 'in questo periodo'}.`);
    else if (!choice[i]) warnings.push(`${t.label}: ci sono titoli, ma il limite per emittente impedisce di usarli.`);
  });
  if (!sel.exact) warnings.push('Ricerca interrotta per complessità: la proposta è molto buona ma potrebbe non essere la migliore in assoluto.');

  return {
    mode: 'capital', settle, useCoupons, accumulate: pooled, zainetto, budget, issuerCap,
    targets: targets.map((t, i) => ({
      ...t, amount: amounts[i], bond: choice[i] ? choice[i].bond : null, fixed: !!(choice[i] && choice[i].fixed),
      nominal: nominal[i], candidates: allCands[i], ...comp[i], periodFrom: per[i].lo,
      surplus: comp[i].available - amounts[i]
    })),
    // Cedole fuori dai periodi (prima della scala, fra date lontane): entrata in più o, se accantonate, avanzo finale
    preCoupons: before, gapCoupons: between, preUntil: per[0].lo, potLeft,
    positions, schedule, totalCost, irr,
    summary: summarize(positions, totalCost),
    warnings, exact: sel.exact
  };
}

/** Indicatori comuni: rendimento medio ponderato, duration, esposizioni. */
export function summarize(positions, totalCost) {
  const w = p => totalCost > 0 ? p.cost / totalCost : 0;
  const byIssuer = new Map(), byRating = new Map();
  let yNet = 0, ySuper = 0, dur = 0, below = 0, gainAtMat = 0, lossAtMat = 0;
  for (const p of positions) {
    const b = p.bond;
    yNet += w(p) * (Number.isFinite(b.ytmNet) ? b.ytmNet : 0);
    ySuper += w(p) * (Number.isFinite(b.ytmSuperNet) ? b.ytmSuperNet : b.ytmNet || 0);
    dur += w(p) * (Number.isFinite(b.durGross) ? b.durGross : 0);
    if (b.price <= 100) below += w(p);
    const g = (100 - b.price) * p.nominal / 100;
    if (g > 0) gainAtMat += g; else lossAtMat -= g;
    const e = byIssuer.get(b.issuer) || { issuer: b.issuer, name: b.issuerName, country: b.country, cost: 0, count: 0 };
    e.cost += p.cost; e.count++; byIssuer.set(b.issuer, e);
    byRating.set(b.rating || 'NR', (byRating.get(b.rating || 'NR') || 0) + p.cost);
  }
  return {
    yieldNet: yNet, yieldSuperNet: ySuper, duration: dur, belowParShare: below,
    gainAtMaturity: gainAtMat, lossAtMaturity: lossAtMat,
    byIssuer: [...byIssuer.values()].map(e => ({ ...e, share: totalCost ? e.cost / totalCost : 0 })).sort((a, b) => b.cost - a.cost),
    byRating: [...byRating.entries()].map(([rating, cost]) => ({ rating, cost, share: totalCost ? cost / totalCost : 0 }))
  };
}

export { fmtMonthYear, parts };
