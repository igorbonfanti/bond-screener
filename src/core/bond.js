/* Calendario cedole, rateo, flussi netti e rendimenti di un singolo titolo.
   Importi per 100 di nominale. Fiscalità italiana, persona fisica in regime amministrato:
   - cedole tassate all'aliquota del titolo (12,5% Stati/sovranazionali, 26% altri);
     sulla prima cedola si paga solo la parte maturata dopo l'acquisto (il rateo pagato
     al venditore dà diritto al credito d'imposta);
   - plusvalenza a scadenza (100 − prezzo) tassata alla stessa aliquota, salvo compensazione
     con minusvalenze pregresse ("zainetto"); lo scarto di emissione resta sempre tassato. */
import { parts, day, daysInMonth, years } from './dates.js';

function couponDay(b, y, m) {
  const mp = parts(b.maturity);
  const eom = mp.d === daysInMonth(mp.y, mp.m) && mp.d < 31;
  return day(y, m, eom ? daysInMonth(y, m) : Math.min(mp.d, daysInMonth(y, m)));
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

/** Cedola ultima (≤ d) e prossima (> d) attorno a una data. */
function couponBounds(b, d) {
  const next = couponDates(b, d, d + 400)[0];
  if (next == null) return null;
  const prevList = couponDates(b, d - 800, d);
  const prev = prevList.length ? prevList[prevList.length - 1] : next - Math.round(365.25 / b.freq);
  return { prev, next };
}

/** Rateo lordo per 100 nominale alla data di regolamento (ACT/ACT). */
export function accrued(b, settle) {
  if (b.zc || !b.freq) return 0;
  const cb = couponBounds(b, settle);
  if (!cb) return 0;
  const per = b.coupon / b.freq;
  return per * Math.max(0, settle - cb.prev) / Math.max(1, cb.next - cb.prev);
}

/** Costo d'acquisto per 100 nominale: prezzo secco + rateo lordo. */
export function costPer100(b, settle) { return b.price + accrued(b, settle); }

/** Tassa sulla plusvalenza a scadenza, per 100 nominale. */
export function gainTax(b, zainetto) {
  const gain = 100 - b.price;
  if (gain <= 0) return 0;
  const issueDiscount = Number.isFinite(b.issuePrice) ? Math.max(0, 100 - b.issuePrice) : 0;
  const taxable = zainetto ? Math.min(gain, issueDiscount) : gain;
  return taxable * b.tax;
}

/** Flussi dopo l'acquisto, per 100 nominale: [{day, kind:'coupon'|'redemption', gross, tax, net}]. */
export function cashflows(b, settle, { zainetto = false } = {}) {
  const out = [], per = b.freq ? b.coupon / b.freq : 0;
  const acc = accrued(b, settle);
  couponDates(b, settle, b.maturity).forEach((c, i) => {
    const taxable = i === 0 ? Math.max(0, per - acc) : per;
    const tax = taxable * b.tax;
    out.push({ day: c, kind: 'coupon', gross: per, tax, net: per - tax });
  });
  const gt = gainTax(b, zainetto);
  out.push({ day: b.maturity, kind: 'redemption', gross: 100, tax: gt, net: 100 - gt });
  return out;
}

/** Cedola netta "a regime" per 100 nominale, per stacco (senza credito sul rateo). */
export function netCouponPerPeriod(b) { return b.freq ? (b.coupon / b.freq) * (1 - b.tax) : 0; }

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

/** Rendimento usato per confrontare i titoli: quello di STFI (netto o "super netto" con zainetto). */
export function scoreYield(b, zainetto) {
  const y = zainetto && Number.isFinite(b.ytmSuperNet) ? b.ytmSuperNet : b.ytmNet;
  return Number.isFinite(y) ? y : (Number.isFinite(b.ytmGross) ? b.ytmGross * (1 - b.tax) : NaN);
}
