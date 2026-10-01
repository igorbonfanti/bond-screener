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
  const sorted = [];
  for (const x of list.filter(y => y.day > settle && y.amount > 0).sort((a, b) => a.day - b.day)) {
    // stessa data: un solo obiettivo con la somma (il secondo avrebbe una finestra vuota e resterebbe scoperto)
    const m = sorted[sorted.length - 1];
    if (m && m.day === x.day) { m.amount += x.amount; m.label = `${m.label || fmt(m.day)} + ${x.label || fmt(x.day)}`; }
    else sorted.push({ ...x });
  }
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

/** Flussi di un titolo per 100 di nominale, sommati per obiettivo (una volta per titolo, poi dalla cache): rimborso e
    cedole del periodo di ogni obiettivo, cedole fuori dai periodi per l'obiettivo successivo (vanno in cassa se accantonate). */
function coefs(fl, T) {
  if (fl.cf && fl.cf.red.length === T) return fl.cf;
  const red = new Float64Array(T), cpn = new Float64Array(T), pot = new Float64Array(T);
  for (const f of fl) {
    if (f.p >= 0) { if (f.kind === 'redemption') red[f.p] += f.net; else cpn[f.p] += f.net; }
    else if (f.kind === 'coupon' && f.q >= 0) pot[f.q] += f.net;
  }
  Object.defineProperty(fl, 'cf', { value: { red, cpn, pot }, configurable: true, writable: true });
  return fl.cf;
}

/** Nominali all'indietro. amounts[t] = importo voluto; draws[t] = parte pagata dalla cassa (cedole accantonate,
    eccedenze portate avanti); fixedIn[t] = parte pagata dai titoli posseduti nel periodo;
    flows[s][k].p = periodo in cui cade il flusso (−1 = nessuno). */
function sizeBackward(choice, flows, amounts, useCoupons, rounding, draws = null, fixedIn = null) {
  const T = amounts.length;
  const K = choice.map((c, s) => c ? coefs(flows[s], T) : null);
  const nominal = new Array(T).fill(0);
  for (let t = T - 1; t >= 0; t--) {
    if (!choice[t]) continue;
    let others = 0;
    if (useCoupons) for (let s = t + 1; s < T; s++) if (nominal[s]) others += nominal[s] / 100 * K[s].cpn[t];
    const own = K[t].red[t] + (useCoupons ? K[t].cpn[t] : 0);
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
  const F = { in: z(), inRed: z(), inCpn: z(), extraCpn: z(), pot: z(), potRed: z(), outCpn: 0, outRed: 0, after: 0, flows: [] };
  for (const x of list) for (const f of x.flows) {
    const p = periodOf(f.day), q = p >= 0 ? p : nextOf(f.day);
    F.flows.push({ ...f, p, q, isin: x.isin });
    if (p >= 0) {
      if (f.kind === 'redemption') { F.inRed[p] += f.net; F.in[p] += f.net; }
      else if (useCoupons) { F.inCpn[p] += f.net; F.in[p] += f.net; }
      else F.extraCpn[p] += f.net;
    } else if (q < 0) F.after += f.net;
    else if (f.kind === 'redemption' ? carry : pooled) { F.pot[q] += f.net; if (f.kind === 'redemption') F.potRed[q] += f.net; }
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
  const outside = amounts.map(() => 0), outsideFlows = [];
  let after = 0;
  choice.forEach((c, s) => {
    if (!c || !nominal[s]) return;
    for (const f of flows[s]) {
      const v = nominal[s] / 100 * f.net;
      if (f.p >= 0) { if (f.kind === 'redemption') rows[f.p].redemption += v; else rows[f.p].coupons += v; }
      else if (f.kind === 'coupon') { if (f.q >= 0) { outside[f.q] += v; outsideFlows.push({ day: f.day, q: f.q, net: v }); } else after += v; }
    }
  });
  const potOn = pooled || carry, potAfter = [];
  let pot = 0;
  return {
    rows: rows.map((r, t) => {
      const heldIn = F ? F.in[t] : 0;
      const own = r.redemption + (useCoupons ? r.coupons : 0) + heldIn;
      let fromPot = 0;
      // entrate in cassa prima di questa scadenza (fuori dai periodi): cedole dei nuovi, cedole e rimborsi dei tuoi
      const potInNew = pooled ? outside[t] : 0, potInHeldRed = F ? F.potRed[t] : 0, potInHeldCpn = F ? F.pot[t] - F.potRed[t] : 0;
      pot += potInNew + potInHeldRed + potInHeldCpn;
      if (potOn) { fromPot = Math.min(pot, Math.max(0, amounts[t] - own)); pot -= fromPot; }
      const available = own + fromPot;
      const carried = carry ? Math.max(0, available - amounts[t]) : 0;
      pot += carried;
      potAfter.push(pot);
      // movimenti di cassa della scadenza, per l'interfaccia: entrate prima, prelievo (fromPot), eccedenza (carried), saldo dopo
      const row = { ...r, fromPot, available, extraCoupons: useCoupons ? 0 : r.coupons, potInNew, potAfter: pot };
      if (F) Object.assign(row, { heldIn, heldRedemption: F.inRed[t], heldCoupons: F.inCpn[t], carried, extraCoupons: row.extraCoupons + F.extraCpn[t], potInHeldRed, potInHeldCpn });
      return row;
    }),
    before: outside[0], between: outside.slice(1).reduce((a, b) => a + b, 0) + after,
    potLeft: potOn ? pot + (pooled ? after : 0) : 0, potAfter, outsideFlows
  };
}

/** Disponibile di ogni scadenza: lo stesso conto di cashPlan, solo le cifre (per i cicli del dimensionamento). */
function availFast(choice, flows, nominal, amounts, useCoupons, pooled, F, carry) {
  const T = amounts.length, potOn = pooled || carry, out = new Array(T);
  const K = choice.map((c, s) => c && nominal[s] ? coefs(flows[s], T) : null);
  let pot = 0;
  for (let t = 0; t < T; t++) {
    let own = F ? F.in[t] : 0;
    if (F) pot += F.pot[t];
    for (let s = 0; s < T; s++) {
      const k = K[s];
      if (!k) continue;
      const m = nominal[s] / 100;
      own += m * (k.red[t] + (useCoupons ? k.cpn[t] : 0));
      if (pooled) pot += m * k.pot[t];
    }
    let av = own;
    if (potOn) { const d = Math.min(pot, Math.max(0, amounts[t] - own)); pot -= d; av += d; }
    if (carry) pot += Math.max(0, av - amounts[t]);
    out[t] = av;
  }
  return out;
}

/** Cassa (cedole accantonate, flussi del portafoglio fuori dai periodi, eccedenze portate avanti): quanto ne
    usa ogni obiettivo (prima le scadenze più vicine). La cassa dipende dai titoli (le loro cedole) e i titoli
    dalla cassa: iterazione a punto fisso, smorzata. */
function potDraws(choice, flows, amounts, { useCoupons = true, pooled = true, carry = false, F = null, init = null, rel = 1e-7 } = {}) {
  const T = amounts.length, tol = rel * Math.max(1, ...amounts);
  let draws = init ? init.slice() : amounts.map(() => 0);
  for (let it = 0; it < 300; it++) {
    const x = sizeBackward(choice, flows, amounts, useCoupons, 'none', draws, F && F.in);
    const inflow = amounts.map(() => 0), others = amounts.map(() => 0);
    choice.forEach((c, s) => {
      if (!c || !x[s]) return;
      const k = coefs(flows[s], T), m = x[s] / 100;
      for (let t = 0; t < T; t++) {
        if (pooled) inflow[t] += m * k.pot[t];
        if (useCoupons && t < s) others[t] += m * k.cpn[t];
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
function idleEuroYears(potAfter, per, F, pooled, carry, newOutside = []) {
  let s = 0;
  potAfter.forEach((b, t) => { if (t + 1 < per.length && b > 0.5) s += b * (per[t + 1].hi - per[t].hi) / 365.25; });
  // solo i flussi che entrano davvero in cassa: rimborsi dei tuoi titoli con carry, cedole (tue e dei nuovi) se accantonate
  const wait = f => f.net * Math.max(0, per[f.q].hi - f.day) / 365.25;
  if (F) for (const f of F.flows) if (f.p < 0 && f.q >= 0 && (f.kind === 'redemption' ? carry : pooled)) s += wait(f);
  if (pooled) for (const f of newOutside) s += wait(f);
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
  const banned = new Set();              // titoli che il capitale non riesce a comprare (lotto minimo): fuori dalla scelta
  for (const x of holdings) preHeld.set(x.bond.issuer, (preHeld.get(x.bond.issuer) || 0) + x.nominal);
  // con il portafoglio il lotto minimo si confronta col fabbisogno residuo, non con l'importo (un lotto da 100.000
  // per 18.000 che mancano lascerebbe 82.000 fermi in cassa); i lotti piccoli restano sempre ammessi
  const lotOk = (c, need) => c.bond.lot * c.bond.cost / 100 <= Math.max(need * 1.05, 1100);

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
    // nel totale solo le scadenze che possono ricevere un titolo: quelle senza candidati non comprano nulla
    const totalWeight = needs.reduce((s, a, i) => s + (choice[i] || (free.includes(i) && allCands[i].length) ? a : 0), 0) + heldNominal;
    // Con il portafoglio: fuori subito i titoli di emittenti già al limite (la ricerca pota meglio, stesso risultato)
    const maxW = free.reduce((m, i) => allCands[i].length ? Math.max(m, needs[i]) : m, 0);
    // peso massimo per emittente (lo stesso del branch & bound); con il portafoglio filtra subito i candidati
    const capAll = issuerCap < 1 ? Math.max(issuerCap * totalWeight, maxW) * (1 + 1e-9) : Infinity;
    const capW = hasHeld ? capAll : Infinity;
    const pref = c => c.held && bonus ? { bond: c.bond, score: c.score + bonus, base: c } : c;
    const ok = c => !banned.has(c.bond.isin);
    const sel = selectPerSlot(free.map(i => ({ weight: needs[i],
      cands: hasHeld ? allCands[i].filter(c => ok(c) && lotOk(c, needs[i]) && (preIss.get(c.bond.issuer) || 0) + needs[i] <= capW).map(pref) : allCands[i].filter(ok) })),
    { issuerCap, totalWeight, preUsedIsins: preIsin, preIssuerWeights: preIss });
    free.forEach((i, k) => { const c = sel.choice[k]; choice[i] = c && c.base ? c.base : c; });
    return { choice, covered, exact: sel.exact, capW, capAll };
  };
  const annotateOne = c => cashflows(c.bond, settle, { zainetto }).map(f => {
    const p = periodOf(f.day);
    return { ...f, p, q: p >= 0 ? p : nextOf(f.day) };
  });
  const annotate = choice => choice.map(c => c ? annotateOne(c) : []);
  const drawsFor = (ch, fl, a, init = null, rel = 1e-7) => potOn ? potDraws(ch, fl, a, { useCoupons, pooled, carry, F, init, rel }) : null;
  const costOf = (ch, n) => n.reduce((s, x, i) => s + (ch[i] ? x * ch[i].bond.cost / 100 : 0), 0);
  const cp = (ch, fl, n, a) => cashPlan(ch, fl, n, a, useCoupons, pooled, F, carry);
  const av = (ch, fl, n, a) => availFast(ch, fl, n, a, useCoupons, pooled, F, carry);
  const covers = (v, need) => v.every((x, t) => x + 0.5 >= need[t]);
  // preferenza per i titoli posseduti: il vantaggio di rendimento della scelta diventa uno sconto di costo equivalente
  const eff = (ch, n) => costOf(ch, n) - (bonus ? ch.reduce((a, c, i) => a + (c && c.held && n[i] ? n[i] * c.bond.cost / 100 * bonus * years(settle, c.bond.maturity) : 0), 0) : 0);
  const ownPerLot = (ch, fl, i) => { const k = coefs(fl[i], T); return ch[i].bond.lot / 100 * (k.red[i] + (useCoupons ? k.cpn[i] : 0)); };

  /** Nominali a lotti interi per gli importi a: all'indietro, per eccesso. Con la cassa poi i lotti che mancano, quelli
      di troppo e (swaps) gli scambi di lotti fra scadenze (la cassa porta le eccedenze alle scadenze dopo). */
  const sizeInt = (ch, fl, a, mode = rounding, swaps = true, init = null) => {
    // la cassa del punto fisso serve solo da prima stima: dopo i controlli sono esatti (availFast)
    let n = sizeBackward(ch, fl, a, useCoupons, mode === 'nearest' ? 'nearest' : 'up', drawsFor(ch, fl, a, init, 1e-5), F && F.in);
    if (!potOn || mode === 'nearest') return n;
    // Con la cassa l'arrotondamento può lasciare scoperto qualche euro: i lotti che mancano…
    for (let guard = 0; guard < 100; guard++) {
      const v = av(ch, fl, n, a);
      const i = v.findIndex((x, t) => ch[t] && x + 0.5 < a[t]);
      if (i < 0) break;
      n[i] += ch[i].bond.lot * Math.max(1, Math.ceil((a[i] - v[i]) / Math.max(ownPerLot(ch, fl, i), 1e-9) - 1e-9));
    }
    // …oppure lotti di troppo (la cassa ha più del previsto): si restituiscono, dalle scadenze più vicine.
    // Togliere lotti non aumenta mai la cassa di nessuna scadenza: ricerca binaria sul numero di lotti.
    const base = av(ch, fl, n, a);
    const need = a.map((x, t) => Math.min(x, base[t]));
    for (let t = 0; t < n.length; t++) {
      const lot = ch[t] ? ch[t].bond.lot : 0, orig = n[t];
      if (!lot || orig < lot) continue;
      let lo = 0, hi = Math.floor(orig / lot + 1e-9);
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        n[t] = orig - m * lot;
        if (covers(av(ch, fl, n, a), need)) lo = m; else hi = m - 1;
      }
      n[t] = orig - lo * lot;
    }
    if (!swaps) return n;
    // Scambi di lotti: togliere k lotti a una scadenza e coprire quello che manca con lotti di un'altra scadenza (prima:
    // l'eccedenza va in cassa e la paga; dopo: con le sue cedole) può costare meno. Si accetta solo se tutte le scadenze
    // restano coperte.
    const base2 = av(ch, fl, n, a);
    const perLotTo = (s, t) => {                   // quanto porta alla scadenza t un lotto in più del titolo di s
      const k = coefs(fl[s], T), lot = ch[s].bond.lot / 100;
      if (s < t) return carry ? lot * (k.red[s] + (useCoupons ? k.cpn[s] : 0)) : 0;
      return s > t && useCoupons ? lot * k.cpn[t] : 0;
    };
    const repair = m => {
      for (let g = 0; g < 60; g++) {
        const v = av(ch, fl, m, a);
        if (v.some((x, t) => !ch[t] && x + 0.5 < Math.min(a[t], base2[t]))) return false;
        const i = v.findIndex((x, t) => ch[t] && x + 0.5 < a[t]);
        if (i < 0) return true;
        m[i] += ch[i].bond.lot * Math.max(1, Math.ceil((a[i] - v[i]) / Math.max(ownPerLot(ch, fl, i), 1e-9) - 1e-9));
      }
      return false;
    };
    for (let pass = 0, better = true; better && pass < 20; pass++) {
      better = false;
      for (let t = T - 1; t >= 0; t--) {
        const lot = ch[t] ? ch[t].bond.lot : 0;
        for (let k = 1; k <= 4 && lot && n[t] >= k * lot; k++) {
          const m = n.slice(); m[t] -= k * lot;
          const short = a[t] - av(ch, fl, m, a)[t];
          let bestM = null, bestC = costOf(ch, n) - 0.01;
          for (let s = 0; s < T; s++) {
            if (!ch[s] || (s !== t && !(short > 0.5))) continue;
            const m2 = m.slice();
            if (s !== t) {
              const per = perLotTo(s, t);
              if (!(per > 1e-9)) continue;
              m2[s] += ch[s].bond.lot * Math.ceil((short - 0.5) / per - 1e-9);
            }
            if (!repair(m2)) continue;
            const c = costOf(ch, m2);
            if (c < bestC) { bestC = c; bestM = m2; }
          }
          if (bestM) { n = bestM; better = true; break; }
        }
      }
    }
    return n;
  };

  /** Scelta migliorata per COSTO. Il rendimento a scadenza presume le cedole reinvestite allo stesso tasso; nella scala
      quelle che arrivano dove i soldi non servono restano in cassa allo 0% e i lotti arrotondano: un titolo con rendimento
      un po' più basso può costare meno. Discesa per coordinate: per ogni scadenza si prova a sostituire il titolo con uno
      dei migliori candidati (stessi vincoli della scelta: ISIN unici, limite per emittente, lotto) e si tiene il cambio se
      costa meno e lascia ogni scadenza coperta come prima, finché nessun cambio migliora. Due partenze: la scelta per
      rendimento, e la migliore scelta per costo senza lotti (porta ad altre combinazioni). Alla fine i lotti interi
      completi: vince la più economica, se costa meno della scelta di partenza. */
  const improveByCost = (ch0, fl0, n0, needs, covered, a, capAll) => {
    const free = targets.map((_, i) => i).filter(i => !(ch0[i] && ch0[i].fixed) && !covered[i] && allCands[i].length);
    if (!free.length) return null;
    const K = Math.max(6, Math.min(16, Math.floor(160 / free.length)));
    const base = av(ch0, fl0, n0, a);
    const need = a.map((x, t) => Math.min(x, base[t]));
    // costo senza lotti: limite inferiore del costo con i lotti (con «I miei titoli» lo sconto è grande: niente scorciatoia)
    const d0 = drawsFor(ch0, fl0, a);             // punto di partenza della cassa per tutte le valutazioni (converge prima)
    const cont = (ch, fl) => eff(ch, sizeBackward(ch, fl, a, useCoupons, 'none', drawsFor(ch, fl, a, d0, 1e-5), F && F.in));
    const screen = bonus < 0.01 ? cont : null;
    // lotti interi veloci (senza scambi di lotti fra scadenze): gli scambi si fanno alla fine, sulle scelte migliori
    const light = (ch, fl) => { const n = sizeInt(ch, fl, a, 'up', false, d0); return covers(av(ch, fl, n, a), need) ? { cost: eff(ch, n) } : null; };
    const visited = [];                    // scelte accettate lungo le discese: le migliori si dimensionano per intero
    const descend = (start, obj, lb) => {
      let cur = start;
      for (let pass = 0; pass < 5; pass++) {
        let improved = false;
        for (const i of free) {
          const used = new Set(), iw = new Map(preHeld);
          cur.choice.forEach((c, j) => { if (c && j !== i) { used.add(c.bond.isin); iw.set(c.bond.issuer, (iw.get(c.bond.issuer) || 0) + needs[j]); } });
          const cands = allCands[i].filter(c => !banned.has(c.bond.isin) && (!hasHeld || lotOk(c, needs[i]))).slice(0, K);
          for (const c of cands) {
            if ((cur.choice[i] && c.bond.isin === cur.choice[i].bond.isin) || used.has(c.bond.isin)) continue;
            if ((iw.get(c.bond.issuer) || 0) + needs[i] > capAll) continue;
            const ch = cur.choice.slice(); ch[i] = c;
            const fl = cur.flows.slice(); fl[i] = annotateOne(c);
            if (lb && lb(ch, fl) >= cur.cost - 0.5) continue;
            const r = obj(ch, fl);
            if (r && r.cost < cur.cost - 0.5) { cur = { choice: ch, flows: fl, cost: r.cost }; visited.push(cur); improved = true; }
          }
        }
        if (!improved) break;
      }
      return cur;
    };
    const l0 = light(ch0, fl0);
    descend({ choice: ch0, flows: fl0, cost: l0 ? l0.cost : eff(ch0, n0) }, light, screen);
    const nLight = visited.length;
    const C = descend({ choice: ch0, flows: fl0, cost: cont(ch0, fl0) }, (ch, fl) => ({ cost: cont(ch, fl) }), null);
    // le scelte della discesa senza lotti si confrontano con i lotti (dimensionamento veloce)
    for (const v of visited.splice(nLight)) { const r = light(v.choice, v.flows); if (r) visited.push({ ...v, cost: r.cost }); }
    const lc = C.choice !== ch0 ? light(C.choice, C.flows) : null;
    if (lc) descend({ choice: C.choice, flows: C.flows, cost: lc.cost }, light, screen);
    // Scale corte: scambi a coppie e ripartenze «spinte», con i candidati ordinati per costo senza lotti (non per
    // rendimento: conta quando arrivano le cedole). Sempre gli stessi tentativi: il risultato non dipende dal dispositivo.
    const rankAt = (cur, i, n, skip = []) => {
      const used = new Set(skip), iw = new Map(preHeld);
      cur.choice.forEach((c, j) => { if (c && j !== i && !skip.includes(j)) { used.add(c.bond.isin); iw.set(c.bond.issuer, (iw.get(c.bond.issuer) || 0) + needs[j]); } });
      return allCands[i].filter(c => !banned.has(c.bond.isin) && !used.has(c.bond.isin) && (!hasHeld || lotOk(c, needs[i]))
        && (iw.get(c.bond.issuer) || 0) + needs[i] <= capAll && !(cur.choice[i] && c.bond.isin === cur.choice[i].bond.isin))
        .slice(0, K).map(c => {
          const ch = cur.choice.slice(); ch[i] = c;
          const fl = cur.flows.slice(); fl[i] = annotateOne(c);
          return { c, fl: fl[i], cost: cont(ch, fl) };
        }).sort((x, y) => x.cost - y.cost).slice(0, n);
    };
    if (free.length <= 8 && visited.length) {
      const bestOf = () => visited.reduce((x, y) => y.cost < x.cost ? y : x);
      const pairs = start => {
        let cur = start;
        for (let round = 0, improved = true; improved && round < 3; round++) {
          improved = false;
          const ranked = new Map(free.map(i => [i, rankAt(cur, i, 4)]));
          for (let x = 0; x < free.length && !improved; x++) for (let y = x + 1; y < free.length && !improved; y++) {
            const i = free[x], j = free[y];
            for (const ci of ranked.get(i)) for (const cj of ranked.get(j)) {
              if (ci.c.bond.isin === cj.c.bond.isin) continue;
              const ch = cur.choice.slice(); ch[i] = ci.c; ch[j] = cj.c;
              const iw = new Map(preHeld);
              ch.forEach((c, k) => { if (c) iw.set(c.bond.issuer, (iw.get(c.bond.issuer) || 0) + needs[k]); });
              if ([ci.c.bond.issuer, cj.c.bond.issuer].some(iss => iw.get(iss) > capAll)) continue;
              const fl = cur.flows.slice(); fl[i] = ci.fl; fl[j] = cj.fl;
              if (screen && screen(ch, fl) >= cur.cost - 0.5) continue;
              const r = light(ch, fl);
              if (r && r.cost < cur.cost - 0.5) { cur = { choice: ch, flows: fl, cost: r.cost }; visited.push(cur); improved = true; break; }
            }
          }
          if (improved) cur = descend(cur, light, screen);
        }
      };
      // a turno: scambi a coppie dalla migliore trovata, poi ripartenze (una scadenza con uno dei suoi 3 migliori
      // candidati, poi di nuovo la discesa), finché la migliore non cambia
      for (let iter = 0; iter < 3; iter++) {
        const before = bestOf().cost;
        pairs(bestOf());
        const best0 = bestOf();
        for (const i of free) for (const r of rankAt(best0, i, 3)) {
          const ch = best0.choice.slice(); ch[i] = r.c;
          const fl = best0.flows.slice(); fl[i] = r.fl;
          const l = light(ch, fl);
          if (l) { const v = { choice: ch, flows: fl, cost: l.cost }; visited.push(v); descend(v, light, screen); }
        }
        if (bestOf().cost >= before - 0.5) break;
      }
    }
    const key = v => v.choice.map(c => c ? c.bond.isin : '-').join();
    const top = [...new Map(visited.sort((x, y) => x.cost - y.cost).map(v => [key(v), v])).values()].slice(0, free.length <= 8 ? 12 : 6);
    let best = null, bestCost = eff(ch0, n0) - 0.5;
    for (const r of top) {
      const n = sizeInt(r.choice, r.flows, a, 'up', true, d0);
      if (!covers(av(r.choice, r.flows, n, a), need)) continue;
      const cost = eff(r.choice, n);
      if (cost < bestCost) { best = { choice: r.choice, flows: r.flows, nominal: n }; bestCost = cost; }
    }
    return best;
  };

  /** Partendo dal capitale: la somma per scadenza più alta che i titoli scelti GARANTISCONO a ogni scadenza, con lotti
      interi e dentro il capitale (bisezione sull'importo; fHi = somma del metodo continuo, che i lotti non superano). */
  const fitBudget = (ch, fl, fHi) => {
    const at = (f, swaps) => {
      const a = w.map(x => x * f), n = sizeInt(ch, fl, a, 'up', swaps);
      return { f, nominal: n, ok: costOf(ch, n) <= budget + 0.01 && covers(av(ch, fl, n, a), a) };
    };
    // prima con il dimensionamento veloce, poi con gli scambi di lotti (costa meno: la somma sale ancora un po')
    let lo = null, hi = Math.max(fHi, 1e-6), r = at(hi, false);
    for (let k = 0; k < 30 && r.ok; k++) { lo = r; hi *= 1.1; r = at(hi, false); }
    let fLo = lo ? lo.f : 0;
    for (let k = 0; k < 45 && hi - fLo > 1e-7 * hi; k++) {
      const m = (fLo + hi) / 2, x = at(m, false);
      if (x.ok) { lo = x; fLo = m; } else hi = m;
    }
    if (!lo || !(lo.f > 0)) return null;
    lo = at(lo.f, true);
    hi = Math.min(hi * 1.02, Math.max(fHi, lo.f) * 1.000001);
    for (let k = 0; k < 10 && hi - lo.f > 1e-7 * hi; k++) {
      const m = (lo.f + hi) / 2, x = at(m, true);
      if (x.ok) lo = x; else hi = m;
    }
    return lo.ok ? lo : null;
  };
  /** La somma esatta (fitBudget) fra le scelte provate, poi la scelta migliorata per costo a quella somma: se costa meno,
      la somma sale. Bisezione continua e arrotondamento per difetto possono mostrare una somma che qualche scadenza non
      raggiunge: se la somma esatta non è più alta di quella che la soluzione continua garantisce davvero, si tiene la
      soluzione continua ma si mostra la somma garantita. Una scadenza senza titoli e scoperta limiterebbe la somma di tutte:
      lì resta il metodo continuo (con l'avviso della scadenza scoperta). */
  const exactBudget = (cands, n0, ch0, fl0, needsAt) => {
    const rows0 = cp(ch0, fl0, n0, amounts).rows;
    if (ch0.some((c, t) => !c && rows0[t].available + 0.5 < amounts[t])) return null;
    const guaranteed = rows0.reduce((m, r, t) => Math.min(m, w[t] > 0 ? r.available / w[t] : Infinity), Infinity);
    let best = null;
    for (const c of cands) {
      const r = fitBudget(c.choice, c.flows, c.f);
      if (r && (!best || r.f > best.f)) best = { ...c, f: r.f, nominal: r.nominal };
    }
    for (let round = 0; best && round < 3; round++) {
      const a = w.map(x => x * best.f);
      const better = improveByCost(best.choice, best.flows, best.nominal, needsAt(best.f), best.covered, a, best.capAll);
      if (!better) break;
      const r = fitBudget(better.choice, better.flows, best.f);
      if (!r || r.f <= best.f * (1 + 1e-9)) break;
      best = { ...best, choice: better.choice, flows: better.flows, f: r.f, nominal: r.nominal };
    }
    if (best && best.f >= guaranteed * (1 - 1e-6)) return best;
    return Number.isFinite(guaranteed) && guaranteed > 0 ? { f: guaranteed, keep: true } : null;
  };

  let choice, covered, exact, flows, amounts = w.slice(), nominal, capInfo = null, capAll = Infinity;
  const plan = (n, a) => cp(choice, flows, n, a);
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
    let sel;
    ({ choice, covered, exact, capAll } = sel = select(w, false));
    flows = annotate(choice);
    // Tutto è proporzionale agli importi (anche la cassa accantonata): basta scalare la soluzione unitaria
    const unitDraws = pooled ? potDraws(choice, flows, amounts) : null;
    const unit = sizeBackward(choice, flows, amounts, useCoupons, 'none', unitDraws);
    const unitCost = costOf(choice, unit);
    const f = unitCost > 0 ? budget / unitCost : 0;
    amounts = amounts.map(a => a * f);
    nominal = sizeBackward(choice, flows, amounts, useCoupons, 'down', unitDraws && unitDraws.map(d => d * f));
    spendLeftover();
    const ex = f > 0 ? exactBudget([{ ...sel, flows, f }], nominal, choice, flows, x => w.map(y => y * x)) : null;
    if (ex && !ex.keep) ({ choice, flows, nominal } = ex);
    if (ex) amounts = w.map(a => a * ex.f);
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
    let tried = [];
    for (let pass = 0; pass < 4; pass++) {
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
      tried = [...seen.values()];
      const best = tried.reduce((a, b) => b.f > a.f + 1e-9 ? b : a);
      ({ choice, covered, exact, flows, capW: capInfo } = best);
      amounts = w.map(a => a * best.f);
      nominal = sizeBackward(choice, flows, amounts, useCoupons, 'down', drawsFor(choice, flows, amounts), F.in);
      spendLeftover();
      // un titolo scelto di cui il capitale non compra nemmeno un lotto lascia la scadenza scoperta con capitale avanzato
      const rows = plan(nominal, amounts).rows, left = budget - costOf(choice, nominal);
      const stuck = choice.filter((c, i) => c && !c.fixed && !nominal[i] && amounts[i] - rows[i].available > MIN_NEED && c.bond.lot * c.bond.cost / 100 > left);
      if (!stuck.length) break;
      for (const c of stuck) banned.add(c.bond.isin);
    }
    const ex = exactBudget(tried.filter(c => c.choice.some(Boolean)), nominal, choice, flows, needsAt);
    if (ex && !ex.keep) ({ choice, covered, exact, flows, nominal, capW: capInfo } = ex);
    if (ex) amounts = w.map(a => a * ex.f);
  } else {
    const needs = hasHeld ? residualNeeds(amounts, F, carry) : amounts;
    ({ choice, covered, exact, capW: capInfo, capAll } = select(needs, hasHeld));
    flows = annotate(choice);
    nominal = sizeInt(choice, flows, amounts);
    if (rounding !== 'nearest') {
      const better = improveByCost(choice, flows, nominal, needs, covered, amounts, capAll);
      if (better) ({ choice, flows, nominal } = better);
    }
  }

  const { rows: comp, before, between, potLeft, potAfter, outsideFlows } = plan(nominal, amounts);
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

  // Soldi che tornano liberi all'investitore (non servono alle scadenze), con la data: eccedenze restituite (senza carry),
  // cedole non usate per gli importi, flussi dei tuoi titoli fuori dalla scala che non vanno in cassa, avanzo finale
  const hiOf = t => t.need ?? t.end, at = d => Math.max(d, settle);
  const returned = [];
  if (!carry) targets.forEach((t, i) => { const x = comp[i].available - amounts[i]; if (x > 0.005) returned.push({ day: hiOf(t), amount: x }); });
  comp.forEach((r, i) => { if (r.extraCoupons > 0.005) returned.push({ day: hiOf(targets[i]), amount: r.extraCoupons }); });
  if (!pooled) for (const f of outsideFlows) returned.push({ day: at(f.day), amount: f.net });
  if (F) for (const f of F.flows) if (f.p < 0 && (f.q < 0 || !(f.kind === 'redemption' ? carry : pooled))) returned.push({ day: at(f.day), amount: f.net });
  if (potLeft > 0.005) returned.push({ day: hiOf(targets[T - 1]), amount: potLeft });
  returned.sort((x, y) => x.day - y.day);
  // Rendimento alle scadenze: dal capitale di oggi (nuovi acquisti e, con il portafoglio, i tuoi titoli ai prezzi di oggi)
  // alle somme che ricevi alle date che ti servono più i soldi che tornano liberi; la cassa ferma rende zero.
  // Ordina le proposte come il costo: a parità di somme, chi spende meno rende di più.
  const outlay = totalCost + holdings.reduce((x, h) => x + (h.value || 0), 0);
  const goalIrr = outlay > 0 ? xirr([{ day: settle, amount: -outlay }].concat(targets.map((t, i) => ({ day: hiOf(t), amount: Math.min(comp[i].available, amounts[i]) })), returned)
    .sort((x, y) => x.day - y.day)) : NaN;

  const warnings = [];
  targets.forEach((t, i) => {
    if (hasHeld && comp[i].available + 0.5 >= amounts[i]) return;
    if (!allCands[i].length) warnings.push(`${t.label}: nessun titolo del paniere scade ${t.need != null ? `tra ${fmt(t.start + 1)} e ${fmt(t.end)}` : 'in questo periodo'}.`);
    else if (!choice[i]) warnings.push(`${t.label}: ci sono titoli, ma il limite per emittente impedisce di usarli.`);
    else if (!nominal[i] && comp[i].available + 0.5 < amounts[i]) warnings.push(`${t.label}: il capitale non basta per il lotto minimo di ${choice[i].bond.desc} (${Math.round(choice[i].bond.lot * choice[i].bond.cost / 100).toLocaleString('it-IT')} €).`);
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
    positions, schedule, totalCost, irr, goalIrr, returned,
    summary: summarize(positions, totalCost),
    warnings, exact
  };
  if (hasHeld) Object.assign(out, { carry }, heldReport(out, holdings, F, per, periodOf, potAfter, pooled, carry, covered, settle, outsideFlows, capInfo));
  return out;
}

/** Il portafoglio nella proposta: cosa copre ogni scadenza, cosa resta fuori, cassa ferma, rendimenti complessivi. */
function heldReport(out, holdings, F, per, periodOf, potAfter, pooled, carry, covered, settle, newOutside = [], capInfo = null) {
  const byTarget = out.targets.map(() => []);
  for (const x of holdings) { const p = periodOf(x.bond.maturity); if (p >= 0) byTarget[p].push(x); }
  // fabbisogno dopo i SOLI titoli posseduti (con la loro cassa): «coperta dai tuoi titoli» solo se è zero
  const heldOnlyNeed = residualNeeds(out.targets.map(t => t.amount), F, carry);
  out.targets.forEach((t, i) => {
    t.held = byTarget[i].map(x => ({ isin: x.isin, desc: x.bond.desc, nominal: x.nominal, maturity: x.bond.maturity }));
    t.coveredByHeld = covered[i] || (!t.nominal && t.available + 0.5 >= t.amount && heldOnlyNeed[i] <= MIN_NEED);
    t.topUp = !!(t.bond && t.nominal > 0 && holdings.some(x => x.isin === t.bond.isin || x.topUpIsin === t.bond.isin));
  });
  const heldValue = holdings.reduce((s, x) => s + (x.value || 0), 0);
  const heldSchedule = holdings.flatMap(x => x.flows.map(f => ({ day: f.day, isin: x.isin, bond: x.bond, kind: f.kind, gross: f.gross, net: f.net, held: true, ...(f.pre ? { pre: true } : {}) })))
    .sort((a, b) => a.day - b.day);
  const cash = f => ({ day: f.day, amount: f.net });
  const fwd = heldSchedule.filter(f => !f.pre);              // cedole già incassate prima del regolamento: fuori dal rendimento
  const irrHeld = heldValue > 0 ? xirr([{ day: settle, amount: -heldValue }].concat(fwd.map(cash))) : NaN;
  const irrAll = heldValue + out.totalCost > 0 ? xirr([{ day: settle, amount: -(heldValue + out.totalCost) }]
    .concat(out.schedule.map(cash), fwd.map(cash)).sort((a, b) => a.day - b.day)) : NaN;
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
  // oltre il limite al nominale E davvero esclusi dalla scelta (il posseduto da solo supera il limite nei pesi del motore, capInfo):
  // così «non compro altri suoi titoli» è sempre vero
  const blocked = e => e.held / totalNominal > out.issuerCap + 1e-9 && (capInfo == null || !Number.isFinite(capInfo) || e.held > capInfo);
  const issuerOver = out.issuerCap < 1 && totalNominal > 0 ? [...expo.values()].filter(blocked)
    .map(e => ({ issuer: e.issuer, name: e.name, share: e.all / totalNominal, heldShare: e.held / totalNominal })).sort((a, b) => b.share - a.share) : [];
  // quota nominale finale oltre il limite (il limite vale sugli importi, e ogni emittente può avere almeno una scadenza)
  const issuerAbove = out.issuerCap < 1 && totalNominal > 0 ? [...expo.values()].filter(e => e.all > e.held && e.all / totalNominal > out.issuerCap + 0.005 && !issuerOver.some(o => o.issuer === e.issuer))
    .map(e => ({ issuer: e.issuer, name: e.name, share: e.all / totalNominal })).sort((a, b) => b.share - a.share) : [];
  return {
    holdings: holdings.map(x => ({ isin: x.isin, desc: x.bond.desc, bond: x.bond, nominal: x.nominal, value: x.value, status: x.status })),
    heldValue, heldSchedule, irrHeld, irrAll,
    heldIn: F.in.reduce((a, b) => a + b, 0),
    heldBefore: before,                                    // rimborsi (e cedole accantonate) prima della scala: in cassa
    heldOutCoupons: F.outCpn,                              // cedole fuori dai periodi non accantonate: entrata in più
    heldOutRedemptions: F.outRed, heldSurplus,             // senza carry: rimborsi fuori dai periodi ed eccedenze, tornano a te
    heldAfter: F.after,                                    // flussi dopo l'ultima scadenza: restano a te
    idleEuroYears: idleEuroYears(potAfter, per, F, pooled, carry, newOutside), heldCover, issuerOver, issuerAbove,
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
