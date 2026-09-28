/* Test del portafoglio già posseduto: lettura delle tabelle esportate dalle banche e flussi futuri.
   Solo dati inventati (nessun portafoglio reale nel repository). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isinOk, cellNumber, tableToHoldings, textToRows } from '../src/data/portfolio.js';
import { loadText } from '../src/data/stfi.js';
import { enrich } from '../src/core/basket.js';
import { parseDay } from '../src/core/dates.js';
import { resolveHoldings, holdingFlows, mergeHoldings, portfolioSummary } from '../src/portfolio.js';

const FIX = fs.readFileSync(new URL('./fixtures/stfi-synthetic.csv', import.meta.url), 'utf8');
const load = () => enrich(loadText(FIX));

test('ISIN: formato e cifra di controllo', () => {
  for (const ok of ['US0378331005', 'IT0005094088', 'AU0000XVGZA3', 'DE0001102580']) assert.ok(isinOk(ok), ok);
  for (const ko of ['US0378331006', 'IT000509408', 'it0005094088x', '', null]) assert.ok(!isinOk(ko), String(ko));
});

test('numeri delle celle: italiano, inglese, prezzi', () => {
  assert.equal(cellNumber('20.000'), 20000);
  assert.equal(cellNumber('20.000,50'), 20000.5);
  assert.equal(cellNumber('20,000.50'), 20000.5);
  assert.equal(cellNumber('1 234,5'), 1234.5);
  assert.equal(cellNumber('(1.234,5)'), -1234.5);
  assert.equal(cellNumber('−12,3'), -12.3);
  assert.equal(cellNumber('98,499', 'price'), 98.499, 'nei prezzi la virgola è sempre decimale');
  assert.equal(cellNumber('1.234', 'price'), 1.234);
  assert.equal(cellNumber(98.5), 98.5);
  assert.ok(Number.isNaN(cellNumber('n.d.')));
  assert.ok(Number.isNaN(cellNumber('-')));
});

test('export tipo Fineco: intestazioni alla terza riga, totali ignorati', () => {
  const rows = [
    ['Portafoglio di sintesi'], [],
    ['Titolo', 'ISIN', 'Simbolo', 'Mercato', 'Strumento', 'Valuta', 'Quantità', 'P.zo medio di carico', 'Cambio di carico', 'Valore di carico', 'P.zo di mercato', 'Cambio di mercato', 'Valore di mercato €', 'Var%', 'Var €', 'Var in valuta', 'Rateo'],
    ['BTP-1FB27 2', 'IT0005094088', 'X', 'MOT', 'Obbligazione', 'EUR', 10000, 98.5, 1, 9850, 99.1, 1, 9910, 0.6, 60, 60, 12.3],
    ['ACME SPA', 'US0378331005', 'Y', 'MTA', 'Azione', 'EUR', 10, 150, 1, 1500, 160, 1, 1600, 6.6, 100, 100, 0],
    ['BUND 2029', 'DE0001102580', 'Z', 'MOT', 'Obbligazione', 'USD', 5000, 97, 1, 4850, 98, 1, 4900, 1, 50, 50, 0],
    [],
    ['Totale', '', '', '', '', '', '', '', '', '', '', 'Valore di carico', 'Valore di mercato', 'Var%', 'Var', '', ''],
    ['EUR', '', '', '', '', '', '', '', '', '', '', 16200, 16410, 1.3, 210, '', '']
  ];
  const r = tableToHoldings(rows);
  assert.equal(r.header, 3);
  assert.deepEqual(r.holdings.map(h => [h.isin, h.nominal, h.carico]), [['IT0005094088', 10000, 98.5]]);
  assert.deepEqual(r.skipped.map(s => s.reason), ['non è un\'obbligazione', 'in USD: l\'app lavora solo in euro']);
});

test('«Strumento» come nome del titolo (tipo Directa) e quantità in pezzi', () => {
  const rows = [
    ['Strumento', 'Isin', 'Prezzo', 'Quantita', 'Valore attuale', 'Prezzo medio'],
    ['BTP 1FB27', 'IT0005094088', '99,10', '10', '9.910,00', '98,50'],
    ['BUND 29', 'DE0001102580', '98,00', '5', '4.900,00', '97,00'],
    ['OAT 30', 'AU0000XVGZA3', '95,00', '2', '1.900,00', '96,00']
  ];
  const r = tableToHoldings(rows);
  assert.deepEqual(r.holdings.map(h => [h.isin, h.desc, h.nominal]), [['IT0005094088', 'BTP 1FB27', 10000], ['DE0001102580', 'BUND 29', 5000], ['AU0000XVGZA3', 'OAT 30', 2000]]);
  assert.ok(r.notes.some(n => /pezzi da 1\.000/.test(n)));
});

test('stesso ISIN su più righe: nominali sommati, carico medio ponderato', () => {
  const r = tableToHoldings(textToRows('ISIN;Quantità;PMC\nIT0005094088;10.000;98,00\n\nIT0005094088;5.000;101,00\n'));
  assert.equal(r.holdings.length, 1);
  assert.equal(r.holdings[0].nominal, 15000);
  assert.equal(Math.round(r.holdings[0].carico * 1000) / 1000, 99);
  assert.deepEqual(r.holdings[0].rows, [2, 4], 'numeri di riga veri, righe vuote comprese');
});

test('testo incollato: tabulazioni, virgole tra virgolette, righe libere', () => {
  assert.equal(tableToHoldings(textToRows('ISIN\tNominale\tPrezzo di carico\nIT0005094088\t10.000\t98,5')).holdings[0].nominal, 10000);
  assert.equal(tableToHoldings(textToRows('isin,quantity,average price\n"IT0005094088","10,000","98.50"')).holdings[0].carico, 98.5);
  const free = tableToHoldings(textToRows('Il mio BTP IT0005094088 10000 98,5\nBund DE0001102580 5.000\n'));
  assert.deepEqual(free.holdings.map(h => [h.isin, h.nominal, h.carico]), [['IT0005094088', 10000, 98.5], ['DE0001102580', 5000, null]]);
});

test('unione degli import: aggiungere somma, sostituire rimpiazza', () => {
  const cur = [{ isin: 'IT0005094088', nominal: 10000, carico: 98 }];
  assert.equal(mergeHoldings(cur, [{ isin: 'IT0005094088', nominal: 10000, carico: 100 }], 'add')[0].carico, 99);
  assert.equal(mergeHoldings(cur, [{ isin: 'DE0001102580', nominal: 1000, carico: 97 }], 'replace').length, 1);
});

test('flussi di un titolo posseduto: tassa sul prezzo di carico, non su quello di oggi', () => {
  const ds = load();
  const b0 = ds.bonds.find(x => !x.zc && x.freq && x.maturity > ds.settle + 400 && x.tax === 0.125);
  const b = { ...b0, issuePrice: 100 };
  const h = { isin: b.isin, nominal: 10000, carico: 95 };
  const flows = holdingFlows(b, h, ds.settle);
  const red = flows[flows.length - 1];
  assert.equal(red.kind, 'redemption');
  assert.ok(Math.abs(red.net - (100 - 5 * 0.125) * 100) < 1e-6, 'plusvalenza 5 punti tassata al 12,5%');
  const cp = flows.find(f => f.kind === 'coupon');
  assert.ok(Math.abs(cp.net - (b.coupon / b.freq) * 0.875 * 100) < 1e-6, 'cedola intera netta');
  const loss = holdingFlows(b, { ...h, carico: 103 }, ds.settle);
  assert.equal(loss[loss.length - 1].net, 10000, 'sopra la pari: nessuna tassa, minusvalenza allo zainetto');
  // emesso sotto la pari (99,5): lo scarto di emissione si tassa sempre per intero, anche con lo zainetto
  const d = { ...b0, issuePrice: 99.5 };
  const net = (c, z) => holdingFlows(d, { ...h, carico: c }, ds.settle, { zainetto: z }).at(-1).net / 100;
  assert.ok(Math.abs(net(98.5, false) - (100 - 1.5 * 0.125)) < 1e-9, 'carico sotto l\'emissione: 0,5 di scarto + 1 di plusvalenza');
  assert.ok(Math.abs(net(99.8, false) - (100 - 0.5 * 0.125)) < 1e-9, 'carico sopra l\'emissione: resta lo scarto');
  assert.ok(Math.abs(net(98.5, true) - (100 - 0.5 * 0.125)) < 1e-9, 'zainetto: compensa la plusvalenza, non lo scarto');
  assert.ok(Math.abs(net(101, true) - (100 - 0.5 * 0.125)) < 1e-9, 'sopra la pari: lo scarto si paga lo stesso');
  // riepilogo e titoli non trovati
  const res = resolveHoldings([h, { isin: 'US0378331005', nominal: 1000, carico: 99, price: 99 }], ds);
  assert.deepEqual(res.map(r => r.status), ['data', 'missing']);
  const sum = portfolioSummary(res, ds.settle);
  assert.equal(sum.count, 2);
  assert.equal(sum.incomplete, 1);
  assert.ok(sum.irr > 0);
});

test('titolo descritto a mano: cedole trimestrali crescenti e premio fedeltà', () => {
  const ds = load();
  const spec = { name: 'BTP Valore prova', maturity: '2028-10-10', coupon: 4.1, freq: 4, tax: 0.125,
    steps: [{ from: '2023-10-10', rate: 4.1 }, { from: '2026-10-10', rate: 4.5 }], premio: 0.8 };
  const [r] = resolveHoldings([{ isin: 'IT0005094088X'.slice(0, 12), nominal: 10000, carico: 100, manual: spec }], { ...ds, bonds: [] });
  assert.equal(r.status, 'manual');
  assert.deepEqual(r.bond.months, [1, 4, 7, 10]);
  const cps = r.flows.filter(f => f.kind === 'coupon');
  assert.ok(Math.abs(cps[0].gross - 4.1 / 4 * 100) < 1e-6, 'prima cedola al 4,10%');
  assert.ok(Math.abs(cps[cps.length - 1].gross - 4.5 / 4 * 100) < 1e-6, 'ultime cedole al 4,50%');
  const red = r.flows[r.flows.length - 1];
  assert.ok(Math.abs(red.net - (100 + 0.8 * 0.875) * 100) < 1e-6, 'rimborso alla pari più il premio netto');
});

test('BTP retail: premio solo con l\'ISIN con premio, cedole crescenti dalla tabella', () => {
  const ds = load();
  const settle = parseDay('2026-09-30'), bonds = [];
  // BTP Valore 4ª: ISIN con premio e di mercato, cedole trimestrali 3,35% fino al 14/5/2027, poi 3,90%, premio 0,8%
  const [prem, mkt] = resolveHoldings([{ isin: 'IT0005594491', nominal: 10000, carico: 100 }, { isin: 'IT0005594483', nominal: 10000, carico: 100 }], { ...ds, settle, bonds });
  assert.deepEqual([prem.status, mkt.status], ['retail', 'retail']);
  assert.deepEqual(prem.bond.months, [2, 5, 8, 11]);
  const cps = prem.flows.filter(f => f.kind === 'coupon');
  assert.ok(Math.abs(cps[2].gross - 3.35 / 4 * 100) < 1e-9, 'cedola del 14/5/2027 ancora al 3,35%');
  assert.ok(Math.abs(cps[3].gross - 3.90 / 4 * 100) < 1e-9, 'dal 14/8/2027 al 3,90%');
  assert.ok(Math.abs(prem.flows.at(-1).net - (100 + 0.8 * 0.875) * 100) < 1e-6, 'premio 0,8% netto');
  assert.equal(mkt.flows.at(-1).net, 10000, 'ISIN di mercato: niente premio');
});
