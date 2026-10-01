/* Calendario cedole, rateo, flussi netti e rendimenti di un singolo titolo.
   Importi per 100 di nominale. Fiscalità italiana, persona fisica in regime amministrato (D.Lgs. 239/1996):
   - cedole tassate per intero all'aliquota del titolo (12,5% Stati/sovranazionali, 26% altri);
   - all'acquisto l'intermediario accredita l'imposta sul rateo pagato al venditore e sul disaggio di emissione
     già maturato (li ha addebitati al venditore): il costo vero è prezzo + rateo − crediti d'imposta;
   - a scadenza si paga l'imposta su tutto il disaggio di emissione (100 − prezzo di emissione) e, se il prezzo
     d'acquisto è sotto il «prezzo teorico» (emissione + disaggio maturato), sulla plusvalenza (teorico − prezzo),
     compensabile con minusvalenze pregresse ("zainetto");
   - BOT: l'imposta sul disaggio che resta da maturare si paga subito, all'acquisto.
   Cedole crescenti (BTP Valore, Più, Futura): b.steps = [{from, rate}], tasso del periodo che finisce alla cedola. */
import { parts, day, daysInMonth, years } from './dates.js';

/** Giorno di stacco nel mese m dell'anno y: lo stesso giorno della scadenza, o l'ultimo del mese se non esiste
    (30/04 → 30/10, non 31/10: è il calendario del Tesoro e quello che usa STFI). */
function couponDay(b, y, m) {
  const mp = parts(b.maturity);
  return day(y, m, Math.min(mp.d, daysInMonth(y, m)));
}

/** Date di stacco cedola in (from, to], mai oltre la scadenza. */
export function couponDates(b, from, to) {
  if (b.zc || !b.freq) return [];
  const end = Math.min(to, b.maturity), out = [];
  const y0 = parts(from).y, y1 = parts(end).y;
  for (let y = y0; y <= y1; y++) for (const m of b.months) {
    const c = couponDay(b, y, m);
    if (c > from && c <= end) out.push(c);
  }
  return out.sort((a, b2) => a - b2);
}

/** Tasso annuo lordo in vigore il giorno d (cedole crescenti; altrimenti la cedola attuale). */
export function rateAt(b, d) {
  if (!b.steps || !b.steps.length) return b.coupon;
  let r = b.steps[0].rate;
  for (const s of b.steps) if (s.from <= d) r = s.rate;
  return r;
}

/** Cedola lorda per 100 pagata il giorno c (tasso del periodo che finisce in c). */
export function couponAt(b, c) { return b.freq ? rateAt(b, c - 1) / b.freq : 0; }

/** Cedola ultima (≤ d) e prossima (> d) attorno a una data. */
function couponBounds(b, d) {
  const next = couponDates(b, d, d + 400)[0];
  if (next == null) return null;
  const prevList = couponDates(b, d - 800, d);
  const prev = prevList.length ? prevList[prevList.length - 1] : next - Math.round(365.25 / b.freq);
  return { prev, next };
}

/** Rateo lordo per 100 nominale alla data di regolamento (ACT/ACT, tasso del periodo in corso). */
export function accrued(b, settle) {
  if (b.zc || !b.freq) return 0;
  const cb = couponBounds(b, settle);
  if (!cb) return 0;
  const per = couponAt(b, cb.next);
  return per * Math.max(0, settle - cb.prev) / Math.max(1, cb.next - cb.prev);
}

/* ---------------- Disaggio di emissione ----------------
   D = 100 − prezzo di emissione (se emesso sotto la pari). Parte maturata all'acquisto: A = teorico − emissione,
   lineare nel tempo per i titoli con cedola, composta per gli zero coupon (convenzioni STFI). Senza la data di
   emissione (il file STFI non la riporta) A si ricava dal rendimento «super netto» di STFI, che la usa
   (b.discAcc, calcolato in enrich). */
export function issueDiscount(b) {
  return Number.isFinite(b.issuePrice) && b.issuePrice < 100 ? 100 - b.issuePrice : 0;
}
function discAccrued(b) {
  const D = issueDiscount(b);
  return D > 0 && Number.isFinite(b.discAcc) ? Math.min(D, Math.max(0, b.discAcc)) : 0;
}
/** Prezzo teorico ai fini della plusvalenza: emissione + disaggio maturato (100 se emesso alla pari o sopra). */
export function theoreticalPrice(b) {
  const D = issueDiscount(b);
  return D > 0 ? b.issuePrice + discAccrued(b) : 100;
}

/** Crediti d'imposta accreditati al regolamento, per 100: rateo + disaggio maturato (BOT: meno l'imposta anticipata). */
export function purchaseCredit(b, settle) {
  const disc = b.bot ? discAccrued(b) - issueDiscount(b) : discAccrued(b);
  return (accrued(b, settle) + disc) * b.tax;
}

/** Tassa pagata a scadenza, per 100 nominale: disaggio di emissione intero (non per i BOT, pagato all'acquisto)
    + plusvalenza sul prezzo teorico (azzerata dallo zainetto). */
export function gainTax(b, zainetto) {
  const gain = zainetto ? 0 : Math.max(0, theoreticalPrice(b) - b.price);
  return ((b.bot ? 0 : issueDiscount(b)) + gain) * b.tax;
}

/** Costo d'acquisto per 100 nominale: prezzo secco + rateo lordo − crediti d'imposta (quello che esce dal conto). */
export function costPer100(b, settle) { return b.price + accrued(b, settle) - purchaseCredit(b, settle); }

/** Flussi dopo l'acquisto, per 100 nominale: [{day, kind:'coupon'|'redemption', gross, tax, net}]. */
export function cashflows(b, settle, { zainetto = false } = {}) {
  const out = [];
  for (const c of couponDates(b, settle, b.maturity)) {
    const per = couponAt(b, c), tax = per * b.tax;
    out.push({ day: c, kind: 'coupon', gross: per, tax, net: per - tax });
  }
  const gt = gainTax(b, zainetto);
  out.push({ day: b.maturity, kind: 'redemption', gross: 100, tax: gt, net: 100 - gt });
  return out;
}

/** Cedola netta per 100 nominale, per stacco, al tasso di oggi (le cedole crescenti salgono dopo: stima prudente). */
export function netCouponPerPeriod(b) { return b.freq ? (b.coupon / b.freq) * (1 - b.tax) : 0; }

/** Cedola netta per stacco garantita fra from e to: per le cedole crescenti la più bassa staccata nell'intervallo
    (crescono soltanto), per le altre netCouponPerPeriod. È la cedola dell'«anno tipo» della rendita mensile. */
export function netCouponPerPeriodIn(b, from, to) {
  if (!b.freq) return 0;
  if (!b.steps || b.steps.length < 2) return netCouponPerPeriod(b);
  const ds = couponDates(b, from, to);
  if (!ds.length) return netCouponPerPeriod(b);
  return Math.min(...ds.map(d => couponAt(b, d))) * (1 - b.tax);
}

/** Tasso interno di rendimento annuo di flussi [{day, amount}] (amount < 0 = uscita). */
export function xirr(flows, guess = 0.03) {
  if (!flows.length) return NaN;
  const t0 = flows[0].day;
  const f = (r) => flows.reduce((s, x) => s + x.amount / Math.pow(1 + r, years(t0, x.day)), 0);
  const df = (r) => flows.reduce((s, x) => { const t = years(t0, x.day); return s - t * x.amount / Math.pow(1 + r, t + 1); }, 0);
  let r = guess;
  for (let i = 0; i < 50; i++) {
    const v = f(r), d = df(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const nr = r - v / d;
    if (!Number.isFinite(nr) || nr <= -0.99) break;
    if (Math.abs(nr - r) < 1e-10) return nr;
    r = nr;
  }
  let lo = -0.9, hi = 1.5;                       // fallback robusto: bisezione
  if (f(lo) * f(hi) > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Rendimento netto annuo (%) calcolato dai flussi, per confronto con STFI. */
export function netYield(b, settle, opts) {
  const flows = [{ day: settle, amount: -costPer100(b, settle) }]
    .concat(cashflows(b, settle, opts).map(c => ({ day: c.day, amount: c.net })));
  return xirr(flows) * 100;
}

/** Disaggio maturato implicito nel rendimento «super netto» di STFI (che conosce la data di emissione).
    Super netto = flussi senza la tassa sulla plusvalenza: il credito sul disaggio maturato è l'unica incognita,
    quindi si ricava in forma chiusa: credito = valore attuale dei flussi futuri al rendimento STFI − costo senza
    credito. Precisione: il rendimento ha due decimali (±0,005 punti). null se non applicabile. */
export function impliedDiscAccrued(b, settle) {
  const D = issueDiscount(b);
  if (!(D > 0) || !Number.isFinite(b.ytmSuperNet) || !(b.tax > 0) || b.maturity <= settle) return null;
  const y = b.ytmSuperNet / 100, v = d => Math.pow(1 + y, -years(settle, d));
  const probe = { ...b, discAcc: 0 };
  let pv = 0;
  for (const c of cashflows(probe, settle, { zainetto: true })) pv += c.net * v(c.day);
  const costNoDisc = b.price + accrued(b, settle) * (1 - b.tax) + (b.bot ? D * b.tax : 0);
  const credit = costNoDisc - pv;                          // costo vero = costo senza credito − A·t = valore attuale
  return Math.min(D, Math.max(0, credit / b.tax));
}

/** Rendimento usato per confrontare i titoli: quello di STFI (netto o "super netto" con zainetto), oppure quello
    dei flussi dell'app se il titolo ha cedole variabili che l'app non conosce (scelta e dimensionamento coerenti). */
export function scoreYield(b, zainetto) {
  if (b.flowYield) return zainetto ? b.flowYield.superNet : b.flowYield.net;
  const y = zainetto && Number.isFinite(b.ytmSuperNet) ? b.ytmSuperNet : b.ytmNet;
  return Number.isFinite(y) ? y : (Number.isFinite(b.ytmGross) ? b.ytmGross * (1 - b.tax) : NaN);
}
