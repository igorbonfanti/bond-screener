// Controlli di proprietà del motore del capitale su portafogli e impostazioni casuali (dati STFI reali in STFI_CSV).
// Usato da tests/capital-audit.test.js; solo portafogli inventati.
import fs from 'node:fs';
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const { loadText } = await import('../../src/data/stfi.js');
const { enrich } = await import('../../src/core/basket.js');
const engine = await import('../../src/engine.js');
const dates = await import('../../src/core/dates.js');
const stateMod = await import('../../src/state.js');
const retail = await import('../../src/data/retail-btp.js');
const ds = enrich(loadText(fs.readFileSync(process.env.STFI_CSV, 'utf8')));
const e0 = n => Math.round(n).toLocaleString('it-IT');
const e2 = n => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const { fmt, day, parts } = dates;
const SEED = 1;
let s = SEED >>> 0;
export function setSeed(x) { s = x >>> 0; }
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const univ = ds.bonds.filter(b => b.currency === 'EUR' && (b.group === 'gov' || b.group === 'sov') && b.maturity > ds.settle + 5 && b.maturity < day(2038, 1, 1) && !b.anomaly);
const premio = Object.entries(retail.RETAIL_BTP).filter(([k, v]) => v.isinPremio === k && day(...v.maturity.split('-').map(Number)) > ds.settle + 5).map(([k]) => k);
export function randomHoldings(k = ri(1, 12)) {
  const out = [], seen = new Set();
  for (let i = 0; i < k; i++) {
    const usePremio = rnd() < 0.2;
    const isin = usePremio ? pick(premio) : pick(univ).isin;
    if (seen.has(isin)) continue; seen.add(isin);
    const b = ds.bonds.find(x => x.isin === isin);
    out.push({ isin, nominal: ri(1, 30) * 1000, carico: +((b ? b.price : 100) + (rnd() * 6 - 3)).toFixed(2) });
  }
  return out;
}
export function randomSettings() {
  const st = stateMod.defaults(ds.refDate);
  st.goal = 'capital';
  const r = rnd();
  const c = st.capital;
  c.schedule = r < 0.6 ? 'yearly' : r < 0.8 ? 'semester' : 'dates';
  c.yearFrom = ri(2026, 2030); c.yearTo = c.yearFrom + ri(0, 7);
  c.amount = ri(4, 120) * 500;
  c.start = c.schedule !== 'dates' && rnd() < 0.3 ? 'budget' : 'amounts';
  c.budget = ri(0, 60) * 5000;
  c.useCoupons = rnd() < 0.8; c.accumulate = rnd() < 0.5; c.rounding = rnd() < 0.85 ? 'up' : 'nearest';
  if (c.schedule === 'dates') {
    const n = ri(1, 5); c.dates = [];
    for (let i = 0; i < n; i++) { const y = ri(2026, 2035), m = ri(1, 12), d = ri(1, 28); c.dates.push({ label: `D${i + 1}`, date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, amount: ri(2, 100) * 500 }); }
    c.flexMonths = pick([0, 3, 6, 12, 24]);
  }
  st.basket.issuerCap = pick([1, 1, 0.5, 1 / 3, 0.25]);
  st.portfolioPref = pick(['balanced', 'balanced', 'mine', 'yield']);
  st.portfolioCarry = rnd() < 0.7;
  st.holdings = rnd() < 0.85 ? randomHoldings() : [];
  st.usePortfolio = true;
  return st;
}
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)) * 0 + tol;
export function check(st, plan, ctx = {}) {
  const V = [];
  const bad = (code, msg) => V.push({ code, msg });
  if (!plan || plan.empty || !plan.targets.length) return V;
  const ptf = !!plan.holdings, T = plan.targets.length, c = st.capital;
  const carry = !!plan.carry, useCoupons = plan.useCoupons, pooled = !!plan.accumulate;
  const budgetMode = plan.budget != null;
  // periodi dai target (lo = periodFrom, hi = need ?? end)
  const per = plan.targets.map(t => ({ lo: t.periodFrom, hi: t.need ?? t.end }));
  const periodOf = d => per.findIndex(q => d > q.lo && d <= q.hi);
  const nextOf = d => per.findIndex(q => d <= q.lo);
  const held = ptf ? plan.heldSchedule : [], neu = plan.schedule;
  const all = held.map(f => ({ ...f, src: 'h' })).concat(neu.map(f => ({ ...f, src: 'n' })));
  for (const f of all) { f.p = periodOf(f.day); f.q = f.p >= 0 ? f.p : nextOf(f.day); }
  // --- I5: campi per scadenza ricostruiti dai calendari
  let pot = 0, potLog = [];
  const potIn = all.filter(f => f.p < 0 && f.q >= 0 && (f.src === 'h' ? (f.kind === 'redemption' ? carry : pooled) : (f.kind === 'coupon' && pooled)));
  let extra = 0, ret = 0;
  for (let t = 0; t < T; t++) {
    const tt = plan.targets[t];
    const hIn = all.filter(f => f.src === 'h' && f.p === t && (f.kind === 'redemption' || useCoupons)).reduce((a, f) => a + f.net, 0);
    const nRed = all.filter(f => f.src === 'n' && f.p === t && f.kind === 'redemption').reduce((a, f) => a + f.net, 0);
    const nCpn = all.filter(f => f.src === 'n' && f.p === t && f.kind === 'coupon').reduce((a, f) => a + f.net, 0);
    if (ptf && Math.abs(hIn - tt.heldIn) > 0.01) bad('heldIn', `${tt.label}: heldIn ${e2(tt.heldIn)} ≠ ricostruito ${e2(hIn)}`);
    if (Math.abs(nRed - tt.redemption) > 0.01) bad('redemption', `${tt.label}: rimborso ${tt.redemption} ≠ ${nRed}`);
    if (Math.abs(nCpn - tt.coupons) > 0.01) bad('coupons', `${tt.label}: cedole ${tt.coupons} ≠ ${nCpn}`);
    const own = nRed + (useCoupons ? nCpn : 0) + (ptf ? hIn : 0);
    pot += potIn.filter(f => f.q === t).reduce((a, f) => a + f.net, 0);
    if (tt.fromPot < -1e-9) bad('potNeg', `${tt.label}: fromPot negativo ${tt.fromPot}`);
    if (tt.fromPot > pot + 0.01) bad('timeTravel', `${tt.label}: usa ${e2(tt.fromPot)} di cassa ma ne sono arrivati solo ${e2(pot)} entro il ${fmt(per[t].lo)}`);
    const exp = (pooled || carry) ? Math.min(pot, Math.max(0, tt.amount - own)) : 0;
    if (Math.abs(exp - tt.fromPot) > 0.01) bad('fromPot', `${tt.label}: fromPot ${e2(tt.fromPot)} ≠ atteso ${e2(exp)}`);
    pot -= tt.fromPot;
    const avail = own + tt.fromPot;
    if (Math.abs(avail - tt.available) > 0.01) bad('available', `${tt.label}: disponibile ${e2(tt.available)} ≠ ${e2(avail)}`);
    const car = carry ? Math.max(0, avail - tt.amount) : 0;
    if (ptf && Math.abs(car - (tt.carried || 0)) > 0.01) bad('carried', `${tt.label}: carried ${tt.carried} ≠ ${car}`);
    pot += car;
    if (!carry) ret += Math.max(0, avail - tt.amount);
    extra += (useCoupons ? 0 : nCpn) + (useCoupons ? 0 : all.filter(f => f.src === 'h' && f.p === t && f.kind === 'coupon').reduce((a, f) => a + f.net, 0));
    // I2: copertura dove c'è un titolo (importi, arrotondamento per eccesso)
    if (!budgetMode && c.rounding !== 'nearest' && tt.bond && tt.nominal > 0 && tt.available + 0.5 < tt.amount) bad('coverage', `${tt.label}: titolo comprato ma disponibile ${e2(tt.available)} < obiettivo ${e2(tt.amount)}`);
    if (ptf && tt.coveredByHeld && (tt.nominal > 0 || tt.available + 0.5 < tt.amount)) bad('coveredByHeld', `${tt.label}: coperta dai tuoi ma nominale ${tt.nominal} disp ${tt.available} < ${tt.amount}`);
    if (!budgetMode && tt.available + 0.5 < tt.amount && !(plan.warnings || []).some(w => w.startsWith(tt.label + ':')) && c.rounding !== 'nearest') bad('silentShort', `${tt.label}: sotto l'obiettivo (${e2(tt.available)} < ${e2(tt.amount)}) senza avviso`);
  }
  const afterNew = all.filter(f => f.src === 'n' && f.p < 0 && f.q < 0 && f.kind === 'coupon').reduce((a, f) => a + f.net, 0);
  const potLeftExp = (pooled || carry) ? pot + (pooled ? afterNew : 0) : 0;
  if (Math.abs(potLeftExp - plan.potLeft) > 0.01) bad('potLeft', `avanzo ${e2(plan.potLeft)} ≠ ${e2(potLeftExp)}`);
  // --- I1: ogni euro spiegato
  const inflow = all.reduce((a, f) => a + f.net, 0);
  const paid = plan.targets.reduce((a, t) => a + Math.min(t.available, t.amount), 0);
  const outside = all.filter(f => f.p < 0 && !potIn.includes(f)).reduce((a, f) => a + f.net, 0);   // fuori dai periodi e non in cassa: tornano all'investitore
  const explained = paid + ret + plan.potLeft + extra + outside - (pooled ? afterNew : 0);
  if (Math.abs(inflow - explained) > 0.05) bad('accounting', `flussi ${e2(inflow)} ≠ spiegati ${e2(explained)} (pagati ${e2(paid)}, restituiti ${e2(ret)}, avanzo ${e2(plan.potLeft)}, cedole extra ${e2(extra)}, fuori ${e2(outside)})`);
  // engine's own fields for "outside" (UI) vs independent
  if (ptf) {
    const hOutC = all.filter(f => f.src === 'h' && f.p < 0 && f.q >= 0 && f.kind === 'coupon' && !pooled).reduce((a, f) => a + f.net, 0);
    const hOutR = all.filter(f => f.src === 'h' && f.p < 0 && f.q >= 0 && f.kind === 'redemption' && !carry).reduce((a, f) => a + f.net, 0);
    const hAfter = all.filter(f => f.src === 'h' && f.p < 0 && f.q < 0).reduce((a, f) => a + f.net, 0);
    if (Math.abs(hOutC - plan.heldOutCoupons) > 0.01) bad('heldOutCoupons', `${e2(plan.heldOutCoupons)} ≠ ${e2(hOutC)}`);
    if (Math.abs(hOutR - plan.heldOutRedemptions) > 0.01) bad('heldOutRedemptions', `${e2(plan.heldOutRedemptions)} ≠ ${e2(hOutR)}`);
    if (Math.abs(hAfter - plan.heldAfter) > 0.01) bad('heldAfter', `${e2(plan.heldAfter)} ≠ ${e2(hAfter)}`);
    if (Math.abs(plan.heldIn - plan.targets.reduce((a, t) => a + t.heldIn, 0)) > 0.01) bad('heldInTot', 'totale heldIn');
    if (!(plan.heldCover >= 0 && plan.heldCover <= 1)) bad('heldCover', `heldCover ${plan.heldCover}`);
    if (plan.coveredByHeld !== plan.targets.filter(t => t.coveredByHeld).length) bad('coveredCount', 'conteggio');
    if (plan.newLines + plan.topUps !== plan.positions.length) bad('lines', 'linee');
    // cassa ferma: formula del motore ricostruita + versione "da quando arriva"
    let idle = 0, pot2 = 0;
    const potAfter = [];
    for (let t = 0; t < T; t++) { const tt = plan.targets[t]; pot2 += potIn.filter(f => f.q === t).reduce((a, f) => a + f.net, 0) - tt.fromPot + (carry ? Math.max(0, tt.available - tt.amount) : 0); potAfter.push(pot2); }
    potAfter.forEach((b, t) => { if (t + 1 < T && b > 0.5) idle += b * (per[t + 1].hi - per[t].hi) / 365.25; });
    const idleHeldEngine = all.filter(f => f.src === 'h' && f.p < 0 && f.q >= 0 && (f.kind === 'redemption' || pooled)).reduce((a, f) => a + f.net * Math.max(0, per[f.q].hi - f.day) / 365.25, 0);
    const idleHeldTrue = potIn.filter(f => f.src === 'h').reduce((a, f) => a + f.net * Math.max(0, per[f.q].hi - f.day) / 365.25, 0);
    const idleNewTrue = potIn.filter(f => f.src === 'n').reduce((a, f) => a + f.net * Math.max(0, per[f.q].hi - f.day) / 365.25, 0);
    const engineIdle = idle + idleHeldEngine, trueIdle = idle + idleHeldTrue + idleNewTrue;
    if (Math.abs(engineIdle - plan.idleEuroYears) > 0.05) bad('idleFormula', `cassa ferma ${e2(plan.idleEuroYears)} ≠ formula ricostruita ${e2(engineIdle)}`);
    if (Math.abs(trueIdle - plan.idleEuroYears) > 1) bad('idleMeaning', `cassa ferma ${e2(plan.idleEuroYears)} vs flussi davvero in cassa ${e2(trueIdle)} (carry=${carry}, accantona=${pooled})`);
    // limite emittente in nominale
    if (plan.issuerCap < 1) {
      const m = new Map();
      for (const x of plan.holdings) { const e = m.get(x.bond.issuer) || { held: 0, neu: 0 }; e.held += x.nominal; m.set(x.bond.issuer, e); }
      for (const p of plan.positions) { const e = m.get(p.bond.issuer) || { held: 0, neu: 0 }; e.neu += p.nominal; m.set(p.bond.issuer, e); }
      const tot = [...m.values()].reduce((a, e) => a + e.held + e.neu, 0);
      for (const [iss, e] of m) {
        if (e.neu > 0 && (e.held + e.neu) / tot > plan.issuerCap + 0.005) {
          const slots = plan.positions.filter(p => p.bond.issuer === iss).length;
          bad(slots > 1 || e.held > 0 ? 'issuerCapNominal' : 'issuerCapOneSlot', `${iss}: ${(100 * (e.held + e.neu) / tot).toFixed(1)}% del nominale complessivo > ${(100 * plan.issuerCap).toFixed(1)}% (tuoi ${e0(e.held)}, nuovi ${e0(e.neu)} in ${slots} scadenze)`);
        }
      }
      for (const e of plan.issuerOver || []) if (plan.positions.some(p => p.bond.issuer === e.issuer)) bad('issuerOverButBought', `${e.issuer} segnalato «oltre il limite, non compro» ma ci sono acquisti`);
      for (const [iss, e] of m) if (e.neu > 0 && (e.held + e.neu) / tot > plan.issuerCap + 0.005 && !(plan.issuerAbove || []).some(x => x.issuer === iss) && !(plan.issuerOver || []).some(x => x.issuer === iss)) bad('issuerAboveSilent', `${iss} ${(100 * (e.held + e.neu) / tot).toFixed(1)}% oltre il limite senza avviso`);
    }
  }
  if (budgetMode && plan.totalCost > plan.budget + 0.01) bad('budget', `costo ${e2(plan.totalCost)} > capitale ${e2(plan.budget)}`);
  if (budgetMode) plan.targets.forEach(t => { if (t.bond && !t.nominal && t.amount - t.available > 0.5 && t.bond.lot * t.bond.cost / 100 > plan.budget - plan.totalCost && t.amount - t.available > Math.max(1000, 0.05 * t.amount)) bad('budgetStuck', `${t.label}: scelto ${t.bond.isin} (lotto ${e0(t.bond.lot)}) ma nominale 0, mancano ${e2(t.amount - t.available)} con ${e2(plan.budget - plan.totalCost)} di capitale avanzato`); });
  if (ptf) {
    const need = heldOnly(plan);
    plan.targets.forEach((t, k) => { if (t.coveredByHeld && need[k] > 0.5) bad('coveredByHeldLabel', `${t.label}: «coperta dai tuoi titoli» ma ai soli tuoi mancano ${e2(need[k])}`); });
  }
  return V;
}
const ENG = engine;
function heldOnly(p) {
  const T = p.targets.length, per = p.targets.map(t => ({ lo: t.periodFrom, hi: t.need ?? t.end }));
  const periodOf = d => per.findIndex(q => d > q.lo && d <= q.hi), nextOf = d => per.findIndex(q => d <= q.lo);
  const inn = new Array(T).fill(0), pot = new Array(T).fill(0);
  for (const f of p.heldSchedule) { const q0 = periodOf(f.day), q = q0 >= 0 ? q0 : nextOf(f.day);
    if (q0 >= 0) { if (f.kind === 'redemption' || p.useCoupons) inn[q0] += f.net; }
    else if (q >= 0 && (f.kind === 'redemption' ? p.carry : p.accumulate)) pot[q] += f.net; }
  let c = 0;
  return p.targets.map((t, i) => { c += pot[i]; const d = Math.min(c, Math.max(0, t.amount - inn[i])); c -= d; if (p.carry) c += Math.max(0, inn[i] - t.amount); return Math.max(0, t.amount - inn[i] - d); });
}
export function runOne(st) {
  const r = ENG.compute(ds, st);
  return { r, V: check(st, r.plan) };
}
