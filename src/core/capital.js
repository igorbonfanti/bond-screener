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
      se parti dal capitale; il capitale avanzato viene poi usato lotto per lotto).
   5. Portafoglio già posseduto (facoltativo). Non si vende nulla: i flussi netti dei titoli posseduti
      sono fissi e ogni scadenza compra solo ciò che manca. Le eccedenze di un periodo e i rimborsi dei
      titoli posseduti che arrivano fuori dai periodi restano in cassa, senza interessi, e pagano le
      scadenze successive. Il limite per emittente vale sul portafoglio complessivo (posseduto + nuovo).
      Nella scelta i titoli posseduti hanno un piccolo vantaggio di rendimento (preferenza dell'utente):
      se la differenza è minima se ne comprano altri pezzi invece di aggiungere una linea nuova.
      Partendo dal capitale, l'importo per scadenza si trova per bisezione (il costo non è più
      proporzionale all'importo, perché una parte la pagano i titoli posseduti). */
import { day, parts, addMonths, years, fmt, fmtMonthYear } from './dates.js';
import { cashflows, scoreYield, xirr } from './bond.js';
import { selectPerSlot } from './select.js';

/** Preferenza «sempre i miei titoli»: +100 punti di rendimento, vince su ogni differenza ma rispetta i vincoli. */
export const ALWAYS = 'always';
const ALWAYS_BONUS = 1;
const MIN_NEED = 0.5;                  // euro: sotto questa cifra la scadenza è già coperta dal portafoglio

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

/** Candidati di un obiettivo, dal rendimento più alto. held = ISIN già posseduti (marcati: la preferenza
    per i propri titoli si applica solo nella scelta, il punteggio mostrato resta il rendimento). */
function candidatesFor(t, bonds, settle, zainetto, approxAmount, held = null) {
  const out = [];
  for (const b of bonds) {
    if (b.maturity <= t.start || b.maturity > t.end) continue;
    if (b.lot * b.cost / 100 > approxAmount * 1.05) continue;        // lotto minimo troppo grande
    const y = scoreYield(b, zainetto) / 100;
    if (!Number.isFinite(y)) continue;
    let score = y;
    if (t.need != null) score = Math.pow(1 + y, years(settle, b.maturity) / years(settle, t.need)) - 1;
    out.push(held && held.has(b.isin) ? { bond: b, score, held: true } : { bond: b, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

const roundLot = (x, lot, mode) => {
  if (!(x > 0)) return 0;
  const q = x / lot;
  return (mode === 'up' ? Math.ceil(q - 1e-9) : mode === 'down' ? Math.floor(q + 1e-9) : mode === 'nearest' ? Math.round(q) : q) * lot;
};

/** Nominali all'indietro. amounts[t] = importo voluto; draws[t] = parte pagata dalla cassa (cedole accantonate,
    eccedenze portate avanti); fixedIn[t] = parte pagata dai titoli posseduti nel periodo;
    flows[s][k].p = periodo in cui cade il flusso (−1 = nessuno). */
function sizeBackward(choice, flows, amounts, useCoupons, rounding, draws = null, fixedIn = null) {
  const T = amounts.length;
  const sumIn = (t, fl, kinds) => fl.reduce((s, f) => s + (f.p === t && kinds.includes(f.kind) ? f.net : 0), 0);
  const nominal = new Array(T).fill(0);
  for (let t = T - 1; t >= 0; t--) {
    if (!choice[t]) continue;
    let others = 0;
    if (useCoupons) for (let s = t + 1; s < T; s++) if (nominal[s]) others += nominal[s] / 100 * sumIn(t, flows[s], ['coupon']);
    const own = sumIn(t, flows[t], useCoupons ? ['coupon', 'redemption'] : ['redemption']);
    const residual = amounts[t] - others - (draws ? draws[t] : 0) - (fixedIn ? fixedIn[t] : 0);
    nominal[t] = residual > 0 && own > 0 ? roundLot(residual / own * 100, choice[t].bond.lot, rounding) : 0;
  }
  return nominal;
}

/** Flussi fissi del portafoglio posseduto, per obiettivo. in[t] conta per l'importo di t (rimborsi e, se si
    usano, cedole del suo periodo). pot[t] entra in cassa prima di t: con carry i rimborsi che arrivano fuori
    dai periodi (sono capitale: restano nella scala), con «accantona» le cedole. after = dopo l'ultima scadenza;
    outRed/outCpn = rimborsi e cedole fuori dai periodi che tornano all'investitore. */
function heldContrib(list, T, periodOf, nextOf, useCoupons, pooled, carry) {
  const z = () => new Array(T).fill(0);
  const F = { in: z(), inRed: z(), inCpn: z(), extraCpn: z(), pot: z(), outCpn: 0, outRed: 0, after: 0, flows: [] };
  for (const x of list) for (const f of x.flows) {
    const p = periodOf(f.day), q = p >= 0 ? p : nextOf(f.day);
    F.flows.push({ ...f, p, q, isin: x.isin });
    if (p >= 0) {
      if (f.kind === 'redemption') { F.inRed[p] += f.net; F.in[p] += f.net; }
      else if (useCoupons) { F.inCpn[p] += f.net; F.in[p] += f.net; }
      else F.extraCpn[p] += f.net;
    } else if (q < 0) F.after += f.net;
    else if (f.kind === 'redemption' ? carry : pooled) F.pot[q] += f.net;
    else if (f.kind === 'redemption') F.outRed += f.net;      // rimborso fuori dai periodi: torna all'investitore
    else F.outCpn += f.net;                                   // cedole fuori dai periodi: entrata in più
  }
  return F;
}

/** Fabbisogno di ogni obiettivo dopo i soli titoli posseduti (cassa compresa): pesi della scelta dei titoli. */
function residualNeeds(amounts, F, carry) {
  let pot = 0;
  return amounts.map((a, t) => {
    pot += F.pot[t];
    const d = Math.min(pot, Math.max(0, a - F.in[t])); pot -= d;
    if (carry) pot += Math.max(0, F.in[t] - a);               // eccedenza portata avanti
    return Math.max(0, a - F.in[t] - d);
  });
}

/** Cassa di ogni obiettivo, dati i nominali. Le cedole fuori dai periodi (prima della scala o
    fra due date lontane; flows[s][k].q = obiettivo successivo) sono un'entrata in più, oppure,
    se accantonate, pagano in ordine le prime scadenze che ne hanno bisogno.
    Con il portafoglio (F) contano anche i suoi flussi e, con carry, le eccedenze passano alle scadenze dopo. */
function cashPlan(choice, flows, nominal, amounts, useCoupons, pooled, F = null, carry = false) {
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
  const potOn = pooled || carry, potAfter = [];
  let pot = 0;
  return {
    rows: rows.map((r, t) => {
      const heldIn = F ? F.in[t] : 0;
      const own = r.redemption + (useCoupons ? r.coupons : 0) + heldIn;
      let fromPot = 0;
      if (pooled) pot += outside[t];
      if (F) pot += F.pot[t];
      if (potOn) { fromPot = Math.min(pot, Math.max(0, amounts[t] - own)); pot -= fromPot; }
      const available = own + fromPot;
      const carried = carry ? Math.max(0, available - amounts[t]) : 0;
      pot += carried;
      potAfter.push(pot);
      const row = { ...r, fromPot, available, extraCoupons: useCoupons ? 0 : r.coupons };
      if (F) Object.assign(row, { heldIn, heldRedemption: F.inRed[t], heldCoupons: F.inCpn[t], carried, extraCoupons: row.extraCoupons + F.extraCpn[t] });
      return row;
    }),
    before: outside[0], between: outside.slice(1).reduce((a, b) => a + b, 0) + after,
    potLeft: potOn ? pot + (pooled ? after : 0) : 0, potAfter
  };
}

/** Cassa (cedole accantonate, flussi del portafoglio fuori dai periodi, eccedenze portate avanti): quanto ne
    usa ogni obiettivo (prima le scadenze più vicine). La cassa dipende dai titoli (le loro cedole) e i titoli
    dalla cassa: iterazione a punto fisso, smorzata. */
function potDraws(choice, flows, amounts, { useCoupons = true, pooled = true, carry = false, F = null, init = null } = {}) {
  const T = amounts.length, tol = 1e-7 * Math.max(1, ...amounts);
  let draws = init ? init.slice() : amounts.map(() => 0);
  for (let it = 0; it < 300; it++) {
    const x = sizeBackward(choice, flows, amounts, useCoupons, 'none', draws, F && F.in);
    const inflow = amounts.map(() => 0), others = amounts.map(() => 0);
    choice.forEach((c, s) => {
      if (!c || !x[s]) return;
      for (const f of flows[s]) {
        if (f.kind !== 'coupon') continue;
        const v = x[s] / 100 * f.net;
        if (f.p < 0) { if (pooled && f.q >= 0) inflow[f.q] += v; }
        else if (f.p < s && useCoupons) others[f.p] += v;
      }
    });
    let pot = 0, delta = 0;
    const next = amounts.map((a, t) => {
      pot += inflow[t] + (F ? F.pot[t] : 0);
      const oth = others[t] + (F ? F.in[t] : 0);
      const d = Math.min(pot, Math.max(0, a - oth)); pot -= d;
      if (carry) pot += Math.max(0, oth - a);
      return d;
    });
    draws = draws.map((d, t) => { const nd = d + 0.5 * (next[t] - d); delta = Math.max(delta, Math.abs(nd - d)); return nd; });
    if (delta < tol) break;
  }
  return draws;
}

/** Cassa ferma (senza interessi), in euro × anni: saldo dopo ogni scadenza fino alla successiva, più i flussi
    del portafoglio che entrano in cassa dalla loro data alla scadenza che li riceve. */
function idleEuroYears(potAfter, per, F, pooled) {
  let s = 0;
  potAfter.forEach((b, t) => { if (t + 1 < per.length && b > 0.5) s += b * (per[t + 1].hi - per[t].hi) / 365.25; });
  if (F) for (const f of F.flows) if (f.p < 0 && f.q >= 0 && (f.kind === 'redemption' || pooled)) s += f.net * Math.max(0, per[f.q].hi - f.day) / 365.25;
  return s;
}

/**
 * @param ds       dataset (settle)
 * @param bonds    titoli del paniere
 * @param cfg      { targets, useCoupons=true, accumulate=false, zainetto=false, issuerCap=1, budget=null,
 *                   fixed={} (indice → isin), rounding='up'|'nearest',
 *                   holdings=[] titoli posseduti { isin, topUpIsin?, bond, nominal, flows (netti futuri, in euro), value },
 *                   heldBonus=0 (vantaggio di rendimento dei titoli posseduti nella scelta, decimale, o ALWAYS),
 *                   heldPool=[] titoli posseduti fuori dal paniere che si possono ricomprare,
 *                   carry=true (con il portafoglio: eccedenze e rimborsi fuori dai periodi pagano le scadenze dopo) }
 */
export function planCapital(ds, bonds, cfg) {
  const { targets, useCoupons = true, accumulate = false, zainetto = false, issuerCap = 1, budget = null, fixed = {}, rounding = 'up',
    holdings = [], heldBonus = 0, heldPool = [] } = cfg;
  const pooled = !!(accumulate && useCoupons);
  const settle = ds.settle, T = targets.length;
  if (!T) return { empty: true, targets: [], positions: [], warnings: ['Nessuna scadenza futura nel periodo scelto.'] };
  const hasHeld = holdings.length > 0, carry = hasHeld && cfg.carry !== false, potOn = pooled || carry;

  const per = periods(targets, settle);
  const periodOf = d => per.findIndex(q => d > q.lo && d <= q.hi);
  const nextOf = d => per.findIndex(q => d <= q.lo);                  // per i flussi fuori dai periodi
  const F = hasHeld ? heldContrib(holdings, T, periodOf, nextOf, useCoupons, pooled, carry) : null;
  const heldSet = new Set(holdings.flatMap(x => x.topUpIsin && x.topUpIsin !== x.isin ? [x.isin, x.topUpIsin] : [x.isin]));
  const bonus = heldBonus === ALWAYS ? ALWAYS_BONUS : (+heldBonus || 0);
  const pool = heldPool.length ? bonds.concat(heldPool.filter(b => !bonds.includes(b))) : bonds;
  const heldNominal = holdings.reduce((s, x) => s + x.nominal, 0);

  const w = targets.map(t => t.amount);
  const weightSum = targets.reduce((s, t) => s + t.amount, 0);
  const approx = t => budget != null ? (budget + heldNominal) * t.amount / weightSum : t.amount;
  const allCands = targets.map(t => candidatesFor(t, pool, settle, zainetto, approx(t), hasHeld ? heldSet : null));

  // Quote per emittente: con il portafoglio contano anche i titoli posseduti (al nominale)
  const preHeld = new Map();
  for (const x of holdings) preHeld.set(x.bond.issuer, (preHeld.get(x.bond.issuer) || 0) + x.nominal);

  /** Un titolo per obiettivo; pesi = importi (senza portafoglio) o fabbisogni dopo il portafoglio. */
  const select = (needs, markCovered) => {
    const choice = new Array(T).fill(null), covered = new Array(T).fill(false);
    const preIss = new Map(preHeld), preIsin = [], free = [];
    targets.forEach((t, i) => {
      // Titoli fissati dall'utente: fuori dall'ottimizzazione, ma pesano sul limite per emittente
      const isin = fixed[i];
      const c = isin ? allCands[i].find(x => x.bond.isin === isin) || (() => {
        const b = pool.find(x => x.isin === isin);
        return b ? { bond: b, score: scoreYield(b, zainetto) / 100, ...(heldSet.has(isin) ? { held: true } : {}) } : null;
      })() : null;
      if (c) { choice[i] = { ...c, fixed: true }; preIsin.push(c.bond.isin); preIss.set(c.bond.issuer, (preIss.get(c.bond.issuer) || 0) + needs[i]); }
      else if (markCovered && needs[i] <= MIN_NEED) covered[i] = true;               // bastano i titoli posseduti
      else free.push(i);
    });
    const totalWeight = needs.reduce((s, a) => s + a, 0) + heldNominal;
    // Con il portafoglio: fuori subito i titoli di emittenti già al limite (la ricerca pota meglio, stesso risultato)
    const maxW = free.reduce((m, i) => Math.max(m, needs[i]), 0);
    const capW = hasHeld && issuerCap < 1 ? Math.max(issuerCap * totalWeight, maxW) * (1 + 1e-9) : Infinity;
    const pref = c => c.held && bonus ? { bond: c.bond, score: c.score + bonus, base: c } : c;
    const sel = selectPerSlot(free.map(i => ({ weight: needs[i],
      cands: hasHeld ? allCands[i].filter(c => (preIss.get(c.bond.issuer) || 0) + needs[i] <= capW).map(pref) : allCands[i] })),
    { issuerCap, totalWeight, preUsedIsins: preIsin, preIssuerWeights: preIss });
    free.forEach((i, k) => { const c = sel.choice[k]; choice[i] = c && c.base ? c.base : c; });
    return { choice, covered, exact: sel.exact };
  };
  const annotate = choice => choice.map(c => c ? cashflows(c.bond, settle, { zainetto }).map(f => {
    const p = periodOf(f.day);
    return { ...f, p, q: p >= 0 ? p : nextOf(f.day) };
  }) : []);
  const drawsFor = (ch, fl, a, init = null) => potOn ? potDraws(ch, fl, a, { useCoupons, pooled, carry, F, init }) : null;
  const costOf = (ch, n) => n.reduce((s, x, i) => s + (ch[i] ? x * ch[i].bond.cost / 100 : 0), 0);

  let choice, covered, exact, flows, amounts = w.slice(), nominal;
  const plan = (n, a) => cashPlan(choice, flows, n, a, useCoupons, pooled, F, carry);
  const spendLeftover = () => {
    // Capitale avanzato dall'arrotondamento: un lotto alla volta dove manca di più
    for (let guard = 0; guard < 500; guard++) {
      const left = budget - costOf(choice, nominal);
      const comp = plan(nominal, amounts).rows;
      let bestI = -1, bestGap = 0;
      choice.forEach((c, i) => {
        if (!c || c.bond.lot * c.bond.cost / 100 > left) return;
        const gap = amounts[i] > 0 ? (amounts[i] - comp[i].available) / amounts[i] : 0;
        if (gap > bestGap) { bestGap = gap; bestI = i; }
      });
      if (bestI < 0) break;
      nominal[bestI] += choice[bestI].bond.lot;
    }
  };

  if (budget != null && !hasHeld) {
    ({ choice, covered, exact } = select(w, false));
    flows = annotate(choice);
    // Tutto è proporzionale agli importi (anche la cassa accantonata): basta scalare la soluzione unitaria
    const unitDraws = pooled ? potDraws(choice, flows, amounts) : null;
    const unit = sizeBackward(choice, flows, amounts, useCoupons, 'none', unitDraws);
    const unitCost = costOf(choice, unit);
    const f = unitCost > 0 ? budget / unitCost : 0;
    amounts = amounts.map(a => a * f);
    nominal = sizeBackward(choice, flows, amounts, useCoupons, 'down', unitDraws && unitDraws.map(d => d * f));
    spendLeftover();
  } else if (budget != null) {
    // Con il portafoglio il costo non è proporzionale all'importo: bisezione sull'importo per scadenza (f × peso).
    // Scelta dei titoli e importo dipendono l'uno dall'altro: pochi giri, vince la scelta con l'importo più alto.
    const fGuess = (budget + heldNominal) / weightSum;
    const costAt = (ch, fl) => { let warm = null; return f => {
      const a = w.map(x => x * f), dr = drawsFor(ch, fl, a, warm); warm = dr;
      return costOf(ch, sizeBackward(ch, fl, a, useCoupons, 'none', dr, F.in));
    }; };
    // Importo che il portafoglio garantisce da solo (serve se non c'è nessun titolo da comprare)
    const heldOnly = () => {
      let lo = 0, hi = Math.max(1e-6, fGuess * 2);
      const ok = f => residualNeeds(w.map(x => x * f), F, carry).every(n => n <= MIN_NEED);
      if (ok(hi)) return hi;
      for (let k = 0; k < 60 && hi - lo > 1e-9 * hi; k++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
      return lo;
    };
    const solveF = (ch, fl) => {
      if (!ch.some(Boolean)) return heldOnly();
      const cost = costAt(ch, fl);
      // tolleranza di un centesimo: la cassa del punto fisso lascia residui di qualche decimillesimo di euro
      const fits = f => cost(f) <= budget + 0.01;
      let lo = 0, hi = Math.max(1e-6, fGuess * 2);
      for (let k = 0; k < 40 && fits(hi); k++) { lo = hi; hi *= 2; }
      if (fits(hi)) return lo;
      for (let k = 0; k < 100 && hi - lo > 1e-10 * hi; k++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
      return lo;
    };
    // pesi = fabbisogno residuo con un minimo (1‰ dell'importo): ogni scadenza con candidati riceve un titolo,
    // che resta a zero se il portafoglio basta
    const needsAt = f => residualNeeds(w.map(x => x * f), F, carry).map((n, i) => Math.max(n, 1e-3 * f * w[i]));
    let needs = needsAt(fGuess);
    const seen = new Map();
    for (let round = 0; round < 4; round++) {
      const sel = select(needs, false);
      const key = sel.choice.map(c => c ? c.bond.isin : '-').join();
      if (seen.has(key)) break;
      const fl = annotate(sel.choice);
      seen.set(key, { ...sel, flows: fl, f: solveF(sel.choice, fl) });
      needs = needsAt(seen.get(key).f);
    }
    const best = [...seen.values()].reduce((a, b) => b.f > a.f + 1e-9 ? b : a);
    ({ choice, covered, exact, flows } = best);
    amounts = w.map(a => a * best.f);
    nominal = sizeBackward(choice, flows, amounts, useCoupons, 'down', drawsFor(choice, flows, amounts), F.in);
    spendLeftover();
  } else {
    const needs = hasHeld ? residualNeeds(amounts, F, carry) : amounts;
    ({ choice, covered, exact } = select(needs, hasHeld));
    flows = annotate(choice);
    const draws = drawsFor(choice, flows, amounts);
    nominal = sizeBackward(choice, flows, amounts, useCoupons, rounding === 'nearest' ? 'nearest' : 'up', draws, F && F.in);
    if (potOn && rounding !== 'nearest') {
      // Con la cassa l'arrotondamento può lasciare scoperto qualche euro: i lotti che mancano…
      for (let guard = 0; guard < 100; guard++) {
        const rows = plan(nominal, amounts).rows;
        const i = rows.findIndex((r, t) => choice[t] && r.available + 0.5 < amounts[t]);
        if (i < 0) break;
        const perLot = choice[i].bond.lot / 100 * flows[i].reduce((s, f) => s + (f.p === i ? f.net : 0), 0);
        nominal[i] += choice[i].bond.lot * Math.max(1, Math.ceil((amounts[i] - rows[i].available) / Math.max(perLot, 1e-9) - 1e-9));
      }
      // …oppure lotti di troppo (la cassa ha più del previsto): si restituiscono, dalle scadenze più vicine.
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

  const { rows: comp, before, between, potLeft, potAfter } = plan(nominal, amounts);
  const positions = [];
  choice.forEach((c, i) => {
    if (!c || !nominal[i]) return;
    positions.push({ target: i, bond: c.bond, nominal: nominal[i], cost: nominal[i] * c.bond.cost / 100, score: c.score, fixed: !!c.fixed,
      ...(hasHeld ? { topUp: heldSet.has(c.bond.isin) } : {}) });
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
    if (hasHeld && comp[i].available + 0.5 >= amounts[i]) return;
    if (!allCands[i].length) warnings.push(`${t.label}: nessun titolo del paniere scade ${t.need != null ? `tra ${fmt(t.start + 1)} e ${fmt(t.end)}` : 'in questo periodo'}.`);
    else if (!choice[i]) warnings.push(`${t.label}: ci sono titoli, ma il limite per emittente impedisce di usarli.`);
  });
  if (!exact) warnings.push('Ricerca interrotta per complessità: la proposta è molto buona ma potrebbe non essere la migliore in assoluto.');

  const out = {
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
    warnings, exact
  };
  if (hasHeld) Object.assign(out, { carry }, heldReport(out, holdings, F, per, periodOf, potAfter, pooled, carry, covered, settle));
  return out;
}

/** Il portafoglio nella proposta: cosa copre ogni scadenza, cosa resta fuori, cassa ferma, rendimenti complessivi. */
function heldReport(out, holdings, F, per, periodOf, potAfter, pooled, carry, covered, settle) {
  const byTarget = out.targets.map(() => []);
  for (const x of holdings) { const p = periodOf(x.bond.maturity); if (p >= 0) byTarget[p].push(x); }
  out.targets.forEach((t, i) => {
    t.held = byTarget[i].map(x => ({ isin: x.isin, desc: x.bond.desc, nominal: x.nominal, maturity: x.bond.maturity }));
    t.coveredByHeld = covered[i] || (!t.nominal && t.available + 0.5 >= t.amount && (t.heldIn > 0.5 || t.fromPot > 0.5));
    t.topUp = !!(t.bond && t.nominal > 0 && holdings.some(x => x.isin === t.bond.isin || x.topUpIsin === t.bond.isin));
  });
  const heldValue = holdings.reduce((s, x) => s + (x.value || 0), 0);
  const heldSchedule = holdings.flatMap(x => x.flows.map(f => ({ day: f.day, isin: x.isin, bond: x.bond, kind: f.kind, gross: f.gross, net: f.net, held: true })))
    .sort((a, b) => a.day - b.day);
  const cash = f => ({ day: f.day, amount: f.net });
  const irrHeld = heldValue > 0 ? xirr([{ day: settle, amount: -heldValue }].concat(heldSchedule.map(cash))) : NaN;
  const irrAll = heldValue + out.totalCost > 0 ? xirr([{ day: settle, amount: -(heldValue + out.totalCost) }]
    .concat(out.schedule.map(cash), heldSchedule.map(cash)).sort((a, b) => a.day - b.day)) : NaN;
  const before = F.flows.filter(f => f.p < 0 && f.q === 0 && (f.kind === 'redemption' ? carry : pooled)).reduce((s, f) => s + f.net, 0);
  // Quanto degli importi pagano da soli i titoli posseduti (cassa compresa)
  const amounts = out.targets.map(t => t.amount), totalAmount = amounts.reduce((a, b) => a + b, 0);
  const heldCover = totalAmount > 0 ? Math.max(0, Math.min(1, 1 - residualNeeds(amounts, F, carry).reduce((a, b) => a + b, 0) / totalAmount)) : 0;
  // Senza carry: quanto danno in più del necessario le scadenze coperte dai titoli posseduti (torna all'investitore)
  const heldSurplus = carry ? 0 : out.targets.reduce((s, t) => s + (!t.nominal && t.heldIn > 0.5 ? Math.max(0, t.available - t.amount) : 0), 0);
  // Emittenti che nel portafoglio posseduto superano già il limite: niente acquisti nuovi da loro
  const expo = new Map();
  const add = (b, n, held) => { const e = expo.get(b.issuer) || { issuer: b.issuer, name: b.issuerName, held: 0, all: 0 }; e.all += n; if (held) e.held += n; expo.set(b.issuer, e); };
  for (const x of holdings) add(x.bond, x.nominal, true);
  for (const p of out.positions) add(p.bond, p.nominal, false);
  const totalNominal = [...expo.values()].reduce((s, e) => s + e.all, 0);
  const issuerOver = out.issuerCap < 1 && totalNominal > 0 ? [...expo.values()].filter(e => e.held / totalNominal > out.issuerCap + 1e-9)
    .map(e => ({ issuer: e.issuer, name: e.name, share: e.all / totalNominal, heldShare: e.held / totalNominal })).sort((a, b) => b.share - a.share) : [];
  return {
    holdings: holdings.map(x => ({ isin: x.isin, desc: x.bond.desc, bond: x.bond, nominal: x.nominal, value: x.value, status: x.status })),
    heldValue, heldSchedule, irrHeld, irrAll,
    heldIn: F.in.reduce((a, b) => a + b, 0),
    heldBefore: before,                                    // rimborsi (e cedole accantonate) prima della scala: in cassa
    heldOutCoupons: F.outCpn,                              // cedole fuori dai periodi non accantonate: entrata in più
    heldOutRedemptions: F.outRed, heldSurplus,             // senza carry: rimborsi fuori dai periodi ed eccedenze, tornano a te
    heldAfter: F.after,                                    // flussi dopo l'ultima scadenza: restano a te
    idleEuroYears: idleEuroYears(potAfter, per, F, pooled), heldCover, issuerOver,
    newLines: out.positions.filter(p => !p.topUp).length, topUps: out.positions.filter(p => p.topUp).length,
    coveredByHeld: out.targets.filter(t => t.coveredByHeld).length
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
