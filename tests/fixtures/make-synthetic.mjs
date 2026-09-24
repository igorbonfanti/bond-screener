/* Genera tests/fixtures/stfi-synthetic.csv: titoli INVENTATI nel formato dell'export STFI,
   con rendimenti coerenti con prezzi e flussi (calcolati con lo stesso modello dell'app).
   Uso: node tests/fixtures/make-synthetic.mjs */
import fs from 'node:fs';
import { day, parts, fmt, addBusinessDays, years } from '../../src/core/dates.js';
import { netYield, cashflows, costPer100 } from '../../src/core/bond.js';

const REF = day(2026, 9, 24), SETTLE = addBusinessDays(REF, 2);
const HEADER = 'isincode;description;redemptiondate;currencycode;issuercode;issuerdescription;ratingsp;ratingmoodys;ratingfitch;minimumlot;status;referencedate;pricetype;price;volume;volumevalue;grossytm;grossduration;netytm;supernetytm;supernetduration;ispread;zspread;currentcouponrate;couponperiodicity;couponmonths;instantyield;issueprice;';
const ISS = {
  GOV_IT: ['Italia', 'BBB+', 'Baa2'], GOV_DE: ['Germania', 'AAA', 'Aaa'], GOV_FR: ['Francia', 'A+', 'Aa3'],
  GOV_ES: ['Spagna', 'A+', 'A3'], GOV_GR: ['Grecia', 'BBB', 'Baa3'], GOV_RO: ['Romania', 'BBB-', 'Baa3'],
  SOV_EU: ['European Union', 'AA+', ''], SOV_BEI: ['European Investment Bank', 'AAA', ''], INTESASP: ['Intesa Sanpaolo', 'BBB+', 'Baa1']
};
let n = 0;
const B = (issuer, y, m, d, cpn, price, o = {}) => ({ issuer, maturity: day(y, m, d), coupon: cpn, price, lot: 1000, liq: 2, pt: 'LP', cur: 'EUR', status: 'Senior', issuePrice: 99.5, ...o, isin: o.isin || `XS${String(++n).padStart(10, '0')}` });
const semi = (m) => [m, ((m + 5) % 12) + 1].sort((a, b) => a - b);

const list = [];
// BTP semestrali: una scadenza per coppia di mesi in più anni
[[2027, 2, 1, 2.5, 99.4], [2027, 11, 1, 3.1, 100.2], [2028, 3, 1, 1.6, 97.6], [2028, 6, 15, 2.65, 98.7], [2029, 1, 15, 3.0, 98.9],
 [2029, 4, 1, 2.8, 98.2], [2030, 5, 15, 3.4, 98.6], [2030, 9, 1, 3.3, 98.0], [2031, 8, 1, 3.5, 97.9], [2031, 12, 1, 3.6, 98.1],
 [2032, 2, 1, 3.0, 94.9], [2032, 10, 15, 3.4, 95.6], [2033, 3, 1, 3.7, 96.3], [2033, 6, 1, 3.2, 93.8], [2034, 4, 1, 3.9, 96.8],
 [2035, 7, 1, 3.8, 95.2], [2036, 2, 1, 4.0, 95.9]]
  .forEach(([y, m, d, c, p]) => list.push(B('GOV_IT', y, m, d, c, p, { months: semi(m), desc: `BTP ${fmt(day(y, m, d))} ${String(c).replace('.', ',')}%` })));
// Annuali area euro e sovranazionali
[['GOV_DE', 2027, 4, 15, 0.5, 97.9], ['GOV_DE', 2029, 8, 15, 0, 91.2], ['GOV_DE', 2031, 2, 15, 2.1, 96.3], ['GOV_DE', 2034, 2, 15, 2.2, 92.1],
 ['GOV_FR', 2027, 10, 25, 2.75, 99.4], ['GOV_FR', 2029, 11, 25, 0, 89.0], ['GOV_FR', 2031, 11, 25, 0, 81.5], ['GOV_FR', 2033, 5, 25, 3.0, 92.7], ['GOV_FR', 2035, 11, 25, 3.5, 91.9],
 ['GOV_ES', 2028, 7, 30, 1.4, 96.1], ['GOV_ES', 2030, 10, 31, 1.25, 91.0], ['GOV_ES', 2032, 4, 30, 2.35, 92.5], ['GOV_ES', 2036, 1, 31, 3.1, 94.8],
 ['GOV_GR', 2028, 6, 18, 3.75, 101.3], ['GOV_GR', 2030, 6, 18, 1.5, 92.4], ['GOV_GR', 2033, 1, 30, 3.9, 99.2], ['GOV_GR', 2035, 6, 15, 3.625, 94.9],
 ['SOV_EU', 2028, 12, 5, 3.125, 99.3], ['SOV_EU', 2031, 10, 13, 2.875, 96.4], ['SOV_EU', 2034, 3, 12, 3.2, 95.0],
 ['SOV_BEI', 2029, 7, 17, 2.75, 98.0], ['SOV_BEI', 2032, 9, 15, 2.5, 94.2]]
  .forEach(([iss, y, m, d, c, p]) => list.push(B(iss, y, m, d, c, p, { months: c ? [m] : [], desc: `${ISS[iss][0].toUpperCase()} ${fmt(day(y, m, d))} ${c ? String(c).replace('.', ',') + '%' : '0%'}` })));
// Casi speciali
list.push(B('GOV_IT', 2030, 5, 15, 1.6, 99.0, { months: [5, 11], desc: 'BTP Italia 15/05/2030 1,6%(senza indicizzazione)' }));
list.push(B('GOV_IT', 2031, 3, 10, 2.6, 96.0, { months: [3, 6, 9, 12], desc: 'BTP VALORE 10/03/2031 STEP UP 2,60% - 3,80%', stepUp: true }));
list.push(B('GOV_IT', 2027, 3, 12, 0, 97.4, { months: [], desc: 'BOT 12/03/2027 ZC' }));
list.push(B('GOV_IT', 2033, 9, 1, 6.0, 112.5, { months: semi(9), desc: 'BTP 01/09/2033 6%(No CACs)' }));
list.push(B('GOV_RO', 2031, 7, 16, 2.124, 86.1, { months: [7], desc: 'ROMANIA 16/07/2031 2,124%' }));
list.push(B('GOV_DE', 2030, 1, 15, 2.4, 98.5, { months: [1], liq: 0, pt: 'RP', desc: 'GERMANIA 15/01/2030 2,4%' }));
list.push(B('SOV_BEI', 2030, 3, 15, 2.0, 96.0, { months: [3], lot: 100000, desc: 'BEI 15/03/2030 2%' }));
list.push(B('INTESASP', 2029, 6, 1, 3.5, 99.1, { months: [6], desc: 'INTESA SANPAOLO 01/06/2029 3,5%' }));
list.push(B('GOV_IT', 2032, 5, 1, 2.0, 88.0, { months: [5, 11], cur: 'USD', desc: 'BTP 01/05/2032 2% USD' }));

const f = (v, dec = 3) => Number.isFinite(v) ? String(+v.toFixed(dec)).replace('.', ',') : '';
const rows = list.map(o => {
  const b = { ...o, freq: o.months.length, zc: o.coupon === 0, tax: o.issuer.startsWith('GOV') || o.issuer.startsWith('SOV') ? 0.125 : 0.26 };
  const g = netYield({ ...b, tax: 0 }, SETTLE), nt = netYield(b, SETTLE), sn = netYield(b, SETTLE, { zainetto: true });
  // duration modificata dai flussi lordi
  const fl = cashflows({ ...b, tax: 0 }, SETTLE), y = g / 100;
  let pv = 0, tpv = 0;
  for (const c of fl) { const t = years(SETTLE, c.day), v = c.gross / Math.pow(1 + y, t); pv += v; tpv += t * v; }
  const dur = pv ? tpv / pv / (1 + y) : 0;
  const [name, sp, md] = ISS[o.issuer];
  return [o.isin, o.desc, fmt(o.maturity), o.cur, o.issuer, name, sp, md, '', o.lot, o.status, fmt(REF), o.pt, f(o.price),
    o.liq ? 250000 : 0, o.liq, f(g, 2), f(dur, 2), f(nt, 2), f(sn, 2), f(dur, 2), '', '', f(o.coupon / 100, 5),
    o.months.length || '', o.months.join(','), f(o.coupon / o.price, 4), f(o.issuePrice)].join(';') + ';';
});
fs.writeFileSync(new URL('./stfi-synthetic.csv', import.meta.url), [HEADER, ...rows].join('\r\n') + '\r\n');
console.log(`Scritti ${rows.length} titoli sintetici (rif ${fmt(REF)}, regolamento ${fmt(SETTLE)}).`);
