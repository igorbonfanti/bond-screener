/* Il portafoglio che l'utente possiede già e non vuole vendere.
   Resta solo in questo browser (localStorage): non va mai nel cloud (le scale salvate lì sono
   leggibili da chiunque abbia il link) né nel repository.
   Ogni posizione si collega ai dati STFI del giorno tramite l'ISIN. I BTP per i risparmiatori (Valore, Più,
   Italia, Futura) usano la loro tabella: cedole crescenti e premio fedeltà, che STFI non ha. I titoli che
   mancano del tutto si descrivono a mano. */
import { couponDates, accrued, xirr } from './core/bond.js';
import { parseDay, parts, day, daysInMonth, iso } from './core/dates.js';
import { EUROZONE } from './data/stfi.js';
import { RETAIL_BTP } from './data/retail-btp.js';

const KEY = 'bondladder.portfolio.v1';

export function emptyPortfolio() { return { v: 1, holdings: [], source: null, updatedAt: null }; }

export function loadPortfolio() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (p && Array.isArray(p.holdings)) return { ...emptyPortfolio(), ...p };
  } catch { /* dati illeggibili: si riparte vuoti */ }
  return emptyPortfolio();
}

export function savePortfolio(p) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...p, updatedAt: new Date().toISOString() })); return true; }
  catch { return false; }
}

export function clearPortfolio() { try { localStorage.removeItem(KEY); } catch { /* */ } }

/** Unisce posizioni lette (import) a quelle presenti: 'replace' sostituisce tutto, 'add' somma per ISIN. */
export function mergeHoldings(current, incoming, mode = 'replace') {
  if (mode === 'replace') return incoming.map(clean);
  const out = current.map(h => ({ ...h }));
  for (const h of incoming) {
    const prev = out.find(x => x.isin === h.isin);
    if (!prev) { out.push(clean(h)); continue; }
    const tot = prev.nominal + h.nominal;
    prev.carico = Number.isFinite(prev.carico) && Number.isFinite(h.carico) ? (prev.carico * prev.nominal + h.carico * h.nominal) / tot : (prev.carico ?? h.carico ?? null);
    prev.nominal = tot;
  }
  return out;
}
const clean = h => ({ isin: h.isin, desc: h.desc || '', nominal: +h.nominal, carico: Number.isFinite(h.carico) ? +h.carico : null,
  price: Number.isFinite(h.price) ? +h.price : null, manual: h.manual || null });

/* ---------------- Collegamento ai dati del giorno ---------------- */
const SOV_PREFIX = { EU: ['SOV_EU', 'Unione Europea'], XS: null };

/** Emittente dedotto dall'ISIN per i titoli che STFI non ha (serve per le quote per emittente). */
function issuerFromIsin(isin) {
  const cc = isin.slice(0, 2);
  if (cc === 'EU') return { issuer: 'SOV_EU', issuerName: 'Unione Europea', group: 'sov', country: 'SOV', area: 'sov' };
  if (EUROZONE.includes(cc)) return { issuer: `GOV_${cc}`, issuerName: cc === 'IT' ? 'Italia' : cc, group: 'gov', country: cc, area: 'euro' };
  return { issuer: `ISIN_${cc}`, issuerName: cc, group: 'gov', country: cc, area: 'extra' };
}

/** Mesi di stacco dalla scadenza e dalla frequenza (1, 2, 4, 12 volte l'anno). */
export function monthsFrom(maturity, freq) {
  if (!(freq > 0)) return [];
  const m0 = parts(maturity).m;
  return [...new Set(Array.from({ length: freq }, (_, k) => ((m0 - 1 + k * 12 / freq) % 12) + 1))].sort((a, b) => a - b);
}

/** Descrizione manuale (o della tabella dei BTP retail) → titolo con gli stessi campi dei dati STFI.
    ref = riga STFI dello stesso titolo (o dell'ISIN di mercato), se c'è: prezzo di oggi ed emittente. */
function synthBond(h, spec, ref, settle) {
  const maturity = parseDay(spec.maturity);
  if (maturity == null) return null;
  const steps = (spec.steps || []).map(s => ({ from: parseDay(s.from), rate: +s.rate })).filter(s => s.from != null && Number.isFinite(s.rate)).sort((a, b) => a.from - b.from);
  const freq = spec.coupon > 0 || steps.length ? (spec.freq || 2) : 0;
  const b = {
    isin: h.isin, desc: spec.name || h.desc || h.isin, maturity, currency: 'EUR',
    ...issuerFromIsin(h.isin),
    rating: null, ratingScore: null, lot: 1000,
    price: ref && Number.isFinite(ref.price) ? ref.price : Number.isFinite(h.price) ? h.price : Number.isFinite(h.carico) ? h.carico : 100,
    liquidity: 0, coupon: +spec.coupon || 0, months: freq ? monthsFrom(maturity, freq) : [], freq,
    issuePrice: Number.isFinite(+spec.issuePrice) && +spec.issuePrice > 0 ? +spec.issuePrice : 100, zc: !freq, tax: spec.tax === 0.26 ? 0.26 : 0.125,
    steps, premio: Number.isFinite(+spec.premio) ? +spec.premio : 0,
    extra: (spec.extra || []).map(x => ({ day: parseDay(x.date), perc: +x.perc })).filter(x => x.day != null && x.perc > 0),
    synthetic: true, stepUp: steps.length > 1, inflation: !!spec.inflation
  };
  if (ref) Object.assign(b, { issuer: ref.issuer, issuerName: ref.issuerName, group: ref.group, country: ref.country, area: ref.area,
    rating: ref.rating, ratingScore: ref.ratingScore, lot: ref.lot || 1000, liquidity: ref.liquidity, tax: ref.tax });
  if (steps.length) b.coupon = rateAt(b, settle);          // cedola in corso (serve al rateo)
  return b;
}

/**
 * Posizioni + dati del giorno → posizioni risolte:
 * { h, bond, status: 'data' | 'retail' | 'manual' | 'missing' | 'matured', value, flows }.
 * value = valore di mercato oggi (prezzo + rateo); flows = flussi netti futuri in euro.
 */
export function resolveHoldings(holdings, ds, { zainetto = false } = {}) {
  const by = new Map(ds.bonds.map(b => [b.isin, b]));
  return holdings.map(h => {
    const retail = RETAIL_BTP[h.isin] || null;
    const ref = by.get(h.isin) || (retail ? by.get(retail.market) : null) || null;
    let bond, status;
    if (h.manual) { bond = synthBond(h, h.manual, ref, ds.settle); status = 'manual'; }
    else if (retail) { bond = synthBond(h, retail, ref, ds.settle); status = 'retail'; }
    else { bond = ref; status = 'data'; }
    if (!bond) return { h, bond: null, status: 'missing', value: Number.isFinite(h.price) ? h.nominal * h.price / 100 : 0, flows: [] };
    if (bond.maturity <= ds.settle) return { h, bond, status: 'matured', value: 0, flows: [] };
    const flows = holdingFlows(bond, h, ds.settle, { zainetto });
    const cleanPx = Number.isFinite(bond.price) ? bond.price : 100;
    const value = h.nominal * (cleanPx + accrued(bond, ds.settle)) / 100;
    return { h, bond, status, value, flows };
  });
}

/** Tasso della cedola alla data (step-up dei BTP retail; altrimenti la cedola attuale). */
function rateAt(b, d) {
  if (!b.steps || !b.steps.length) return b.coupon;
  let r = b.steps[0].rate;
  for (const s of b.steps) if (s.from <= d) r = s.rate;
  return r;
}

/**
 * Flussi netti futuri di una posizione già posseduta, in euro. Regime amministrato, persona fisica:
 * - cedole intere, tassate per intero (il credito sul rateo pagato all'acquisto è già alle spalle);
 * - a scadenza lo scarto di emissione (100 − prezzo di emissione) si tassa sempre tutto: il credito per la
 *   parte maturata prima dell'acquisto è arrivato allora. La plusvalenza si misura sul prezzo di CARICO,
 *   non su quello di oggi, rispetto al prezzo di emissione (o a 100 se emesso alla pari o sopra). Senza la
 *   data d'acquisto è il minimo esatto: chi ha comprato dopo l'emissione paga al più il 12,5% (o 26%) della
 *   parte di scarto maturata prima del suo acquisto. Con lo "zainetto" la plusvalenza è compensata;
 * - premio fedeltà (solo ISIN con premio) e premi intermedi, tassati come il titolo.
 */
export function holdingFlows(b, h, settle, { zainetto = false } = {}) {
  const k = h.nominal / 100, out = [];
  if (!b.zc && b.freq) {
    for (const d of couponDates(b, settle, b.maturity)) {
      const gross = rateAt(b, d - 1) / b.freq;
      out.push({ day: d, kind: 'coupon', gross: gross * k, net: gross * (1 - b.tax) * k });
    }
  }
  for (const x of b.extra || []) if (x.day > settle && x.day < b.maturity) out.push({ day: x.day, kind: 'coupon', premio: true, gross: x.perc * k, net: x.perc * (1 - b.tax) * k });
  const basis = Number.isFinite(h.carico) ? h.carico : (Number.isFinite(b.price) ? b.price : 100);
  const issue = Number.isFinite(b.issuePrice) && b.issuePrice > 0 ? b.issuePrice : 100;
  const discount = Math.max(0, 100 - issue);
  const gain = Math.max(0, Math.min(100, issue) - basis);
  const premio = b.premio > 0 ? b.premio : 0;
  const tax = (discount + (zainetto ? 0 : gain) + premio) * b.tax;
  out.push({ day: b.maturity, kind: 'redemption', gross: (100 + premio) * k, net: (100 + premio) * k - tax * k, loss: Math.max(0, basis - 100) * k });
  return out.sort((a, c) => a.day - c.day);
}

/** Rendimento netto annuo dai prezzi di oggi (per confronto con i titoli da comprare). */
export function holdingYield(r, settle) {
  if (!r.bond || !r.flows.length || !(r.value > 0)) return NaN;
  const y = xirr([{ day: settle, amount: -r.value }].concat(r.flows.map(f => ({ day: f.day, amount: f.net }))));
  return Number.isFinite(y) ? y * 100 : NaN;
}

/** Riepilogo: nominale, carico, valore di oggi, risultato latente, flussi per anno e per mese. */
export function portfolioSummary(resolved, settle) {
  const live = resolved.filter(r => r.bond && r.status !== 'matured');
  const held = resolved.filter(r => r.status !== 'matured');                // anche quelli da completare
  const incomplete = held.length - live.length;
  const nominal = held.reduce((s, r) => s + r.h.nominal, 0);
  const cost = live.reduce((s, r) => s + (Number.isFinite(r.h.carico) ? r.h.nominal * r.h.carico / 100 : 0), 0);
  const costKnown = live.every(r => Number.isFinite(r.h.carico));
  const value = held.reduce((s, r) => s + r.value, 0);
  const cleanValue = live.reduce((s, r) => s + r.h.nominal * (Number.isFinite(r.bond.price) ? r.bond.price : 100) / 100, 0);
  const schedule = live.flatMap(r => r.flows.map(f => ({ ...f, isin: r.h.isin })));
  const liveValue = live.reduce((s, r) => s + r.value, 0);
  const all = [{ day: settle, amount: -liveValue }].concat(schedule.map(f => ({ day: f.day, amount: f.net })));
  const irr = live.length ? xirr(all.sort((a, b) => a.day - b.day)) : NaN;
  return { count: held.length, incomplete, nominal, cost, costKnown, value, cleanValue, pnl: costKnown ? cleanValue - cost : NaN, schedule, irr };
}

export { iso, day, daysInMonth };
