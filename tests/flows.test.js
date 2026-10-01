/* Flussi dei titoli nuovi: cedole crescenti dei BTP retail, disaggio di emissione, calendario. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { day, fmt } from '../src/core/dates.js';
import { loadText } from '../src/data/stfi.js';
import { couponDates, cashflows, netYield, costPer100, gainTax, impliedDiscAccrued, accrued, scoreYield } from '../src/core/bond.js';
import { enrich } from '../src/core/basket.js';

const SETTLE = day(2026, 10, 2);
// BTP Valore 3ª comprato sul mercato (ISIN di mercato, nella tabella dei BTP retail): 3,25% fino al 05/03/2027, poi 4%
const valore3 = () => ({ isin: 'IT0005583486', desc: 'BTP VALORE 3 05/03/2030 STEP UP 3,25% - 4%', maturity: day(2030, 3, 5),
  currency: 'EUR', issuer: 'GOV_IT', group: 'gov', area: 'euro', price: 99.8, coupon: 3.25, months: [3, 6, 9, 12], freq: 4,
  issuePrice: 100, zc: false, tax: 0.125, stepUp: true, retail: true, inflation: false, ytmGross: 4.03, ytmNet: 3.52, ytmSuperNet: 3.53, lot: 1000 });

test('BTP retail comprati sul mercato: cedole crescenti dalla tabella, non la cedola di oggi', () => {
  const ds = enrich({ bonds: [valore3()], settle: SETTLE, refDate: day(2026, 9, 30) });
  const b = ds.bonds[0];
  assert.ok(b.steps && b.steps.length === 2, 'calendario dei tassi collegato all\'ISIN di mercato');
  const cps = cashflows(b, SETTLE).filter(f => f.kind === 'coupon');
  const at = d => cps.find(f => f.day === d).gross;
  assert.equal(at(day(2026, 12, 5)), 3.25 / 4);
  assert.equal(at(day(2027, 3, 5)), 3.25 / 4, 'la cedola che chiude il periodo iniziato prima dello scalino resta al tasso vecchio');
  assert.equal(at(day(2027, 6, 5)), 4 / 4, 'dal periodo che inizia il 05/03/2027: 4%');
  assert.ok(Math.abs(accrued(b, SETTLE) - 3.25 / 4 * 27 / 91) < 1e-9, 'rateo al tasso del periodo in corso');
  // rendimento dai flussi ≈ STFI (che conosce gli scalini); prima: 2,93% contro 3,52%
  assert.ok(Math.abs(netYield(b, SETTLE) - 3.52) < 0.02, `netto ${netYield(b, SETTLE)}`);
  assert.ok(!b.anomaly);
  assert.ok(!b.flowYield, 'per i titoli in tabella la scelta usa il rendimento STFI');
});

test('step-up fuori tabella: la scelta usa il rendimento dei flussi stimati (coerente con il dimensionamento)', () => {
  const b = { ...valore3(), isin: 'IT0000000000' };          // stesso titolo, ISIN che la tabella non conosce
  const ds = enrich({ bonds: [b], settle: SETTLE, refDate: day(2026, 9, 30) });
  assert.ok(ds.bonds[0].flowYield, 'cedole future ignote: niente rendimento STFI nella scelta');
  assert.ok(Math.abs(scoreYield(ds.bonds[0], false) - netYield(ds.bonds[0], SETTLE)) < 1e-9);
});

test('calendario: scadenza il 30 di un mese da 30 giorni → cedola il 30, non il 31', () => {
  const b = { maturity: day(2045, 4, 30), months: [4, 10], freq: 2, coupon: 1.5, zc: false };
  assert.deepEqual(couponDates(b, SETTLE, day(2027, 6, 1)).map(fmt), ['30/10/2026', '30/04/2027']);
});

test('disaggio di emissione: credito all\'acquisto, tassa intera a scadenza, plusvalenza sul prezzo teorico', () => {
  // Titolo emesso a 77,764 (scarto 22,236) con 8,1 punti già maturati: prezzo 95,1 sopra il teorico 85,86
  const b = { isin: 'XX', maturity: day(2042, 1, 30), months: [1], freq: 1, coupon: 4.2, zc: false, price: 95.1, issuePrice: 77.764,
    tax: 0.125, discAcc: 8.1 };
  const D = 100 - 77.764;
  assert.ok(Math.abs(gainTax(b, false) - D * 0.125) < 1e-9, 'sopra il teorico: niente plusvalenza, ma tutto il disaggio tassato');
  assert.ok(Math.abs(costPer100(b, SETTLE) - (95.1 + accrued(b, SETTLE) * 0.875 - 8.1 * 0.125)) < 1e-9, 'credito sul disaggio maturato');
  // prima: tassa (100 − 95,1) × 12,5% = 0,61 a scadenza, nessun credito; ora 2,78 a scadenza e 1,01 subito
  const below = { ...b, price: 80 };
  assert.ok(Math.abs(gainTax(below, false) - (D + 85.864 - 80) * 0.125) < 1e-9, 'sotto il teorico: disaggio + plusvalenza');
  assert.ok(Math.abs(gainTax(below, true) - D * 0.125) < 1e-9, 'zainetto: resta il disaggio');
});

test('disaggio maturato ricavato dal rendimento super netto (STFI conosce la data di emissione)', () => {
  for (const discAcc of [0, 0.3, 1.2, 2.0]) {
    const b = { isin: 'XX', maturity: day(2031, 6, 15), months: [6], freq: 1, coupon: 2, zc: false, price: 95, issuePrice: 98, tax: 0.125, discAcc };
    const sn = netYield(b, SETTLE, { zainetto: true });
    const probe = { ...b, ytmSuperNet: sn };
    delete probe.discAcc;
    assert.ok(Math.abs(impliedDiscAccrued(probe, SETTLE) - discAcc) < 1e-6, `disaggio maturato ${discAcc}`);
  }
});

// Facoltativo: STFI_CSV=/percorso/file.csv npm test → BTP retail e titoli di Stato coerenti con STFI
test('dati reali: rendimenti dai flussi entro 0,01 punti da STFI per Stati e sovranazionali (step-up compresi)', { skip: !process.env.STFI_CSV }, () => {
  const ds = enrich(loadText(fs.readFileSync(process.env.STFI_CSV, 'utf8')));
  const eur = ds.bonds.filter(b => b.currency === 'EUR' && b.group !== 'corp' && !b.anomaly && b.maturity > ds.settle + 60);
  const ok = eur.filter(b => Math.abs(netYield(b, ds.settle) - b.ytmNet) <= 0.01).length;
  assert.ok(ok / eur.length > 0.99, `${ok}/${eur.length} netti entro 0,01`);
  for (const b of eur.filter(x => x.retail)) assert.ok(Math.abs(netYield(b, ds.settle) - b.ytmNet) < 0.02, `${b.desc}: ${netYield(b, ds.settle)} vs ${b.ytmNet}`);
});

test('titoli posseduti: la cedola pagata fra la data dei dati e il regolamento è del possessore', async () => {
  const { resolveHoldings, holdingYield, portfolioSummary } = await import('../src/portfolio.js');
  // titolo inventato al 2,40% con cedola il 01/10/2026: dati del 30/09 (prezzo già ex cedola), regolamento 02/10
  const b = { isin: 'IT0000000001', desc: 'BTP 01/10/2029 2,40%', maturity: day(2029, 10, 1), currency: 'EUR', issuer: 'GOV_IT', group: 'gov',
    area: 'euro', price: 101.2, coupon: 2.4, months: [4, 10], freq: 2, issuePrice: 99.9, zc: false, tax: 0.125, lot: 1000 };
  const ds = { bonds: [b], refDate: day(2026, 9, 30), settle: SETTLE };
  const [r] = resolveHoldings([{ isin: b.isin, nominal: 7000, carico: 100.3 }], ds);
  const pre = r.flows.filter(f => f.pre);
  assert.equal(pre.length, 1);
  assert.equal(fmt(pre[0].day), '01/10/2026');
  assert.ok(Math.abs(pre[0].net - 7000 * 1.2 / 100 * 0.875) < 1e-9, '73,50 € netti');
  // il rendimento dai prezzi di oggi non la conta (il valore di mercato al regolamento è già senza)
  const y = holdingYield(r, SETTLE), y2 = holdingYield({ ...r, flows: r.flows.filter(f => !f.pre) }, SETTLE);
  assert.ok(Math.abs(y - y2) < 1e-12);
  assert.ok(Number.isFinite(portfolioSummary([r], SETTLE).irr));
});

test('BTP Futura 3ª (ISIN con premio): premio intermedio 0,4% nel 2029 e finale minimo 1,6% (0,6% + 1%)', async () => {
  const { RETAIL_BTP } = await import('../src/data/retail-btp.js');
  const f3 = RETAIL_BTP['IT0005442089'];
  assert.equal(f3.premio, 1.6);
  assert.deepEqual(f3.extra, [{ date: '2029-04-27', perc: 0.4 }]);
  assert.equal(RETAIL_BTP['IT0005442097'].premio, 0, 'ISIN di mercato: niente premio');
});
