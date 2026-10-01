/* Rendita mensile: regressioni trovate nell'audit (dati inventati; il confronto con STFI solo se STFI_CSV è impostato). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadText } from '../src/data/stfi.js';
import { enrich, applyBasket } from '../src/core/basket.js';
import { netYield } from '../src/core/bond.js';
import { checkSolution } from '../src/core/lp.js';
import { planIncome, planIncomeTarget } from '../src/core/income.js';
import { resolveHoldings } from '../src/portfolio.js';
import { parts } from '../src/core/dates.js';

const FIX = fs.readFileSync(new URL('./fixtures/stfi-synthetic.csv', import.meta.url), 'utf8');
const load = () => enrich(loadText(FIX));
const minCov = p => Math.min(...p.coverable.map(m => p.monthly[m - 1]));

test('LP: una soluzione fuori dai vincoli si riconosce (variabile negativa, vincolo violato)', () => {
  const model = { objective: 'o', constraints: { cap: { max: 10 }, floor: { min: 2 } }, variables: { a: { o: 1, cap: 1, floor: 1 }, b: { o: 1, cap: 1 } } };
  assert.ok(checkSolution(model, { a: 4, b: 6 }) < 1e-9, 'soluzione giusta');
  assert.ok(checkSolution(model, { a: 20, b: -10 }) > 1e-5, 'investimento negativo');
  assert.ok(checkSolution(model, { a: 1, b: 9 }) > 1e-5, 'minimo violato');
});

test('rendita: il mese più basso conta anche i mesi rimasti a zero; quote per emittente rispettate dopo i lotti', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  for (const capital of [20000, 50000, 100000, 300000]) {
    const p = planIncome(ds, bonds, { capital, yearFrom: 2028, yearTo: 2036, issuerCap: 1 / 3 });
    assert.equal(p.minMonth, minCov(p), `${capital}: minMonth sui mesi pagabili`);
    const by = new Map();
    for (const x of p.positions) by.set(x.bond.issuer, (by.get(x.bond.issuer) || 0) + x.cost);
    const n = new Set(bonds.filter(b => parts(b.maturity).y >= 2028 && parts(b.maturity).y <= 2036).map(b => b.issuer)).size;
    for (const [k, v] of by) assert.ok(v <= Math.max(1 / 3, 1 / n + 1e-3) * capital + 1, `${capital}: ${k} ${v.toFixed(0)} oltre la quota`);
  }
});

test('rendita: un titolo con lotto da 100.000 € non lascia un mese a zero', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  // tutti i titoli che pagano a marzo diventano «da 100.000»: o si compra un lotto intero o marzo resta scoperto, con avviso
  for (const b of bonds) if (b.months.includes(3)) b.lot = 100000;
  for (const capital of [200000, 400000]) {
    const p = planIncome(ds, bonds, { capital, yearFrom: 2028, yearTo: 2036, issuerCap: 1 });
    const zero = p.coverable.filter(m => p.monthly[m - 1] < 0.005);
    assert.ok(!zero.length || p.warnings.length > 0, `${capital}: mesi a zero senza avviso ${zero}`);
    assert.ok(p.monthly[2] > 0 || p.warnings.some(w => /marzo/.test(w)), `${capital}: marzo a zero senza avviso`);
  }
});

test('rendita anno per anno: i titoli che scadono smettono di pagare (niente reinvestimento)', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const cpn = bonds.filter(b => !b.zc && b.freq && parts(b.maturity).y >= 2028 && parts(b.maturity).y <= 2029);
  const holdings = resolveHoldings(cpn.slice(0, 2).map(b => ({ isin: b.isin, nominal: 20000, carico: 99 })), ds)
    .map(r => ({ isin: r.h.isin, bond: r.bond, nominal: r.h.nominal, flows: r.flows, value: r.value, status: r.status }));
  const p = planIncome(ds, bonds, { capital: 50000, yearFrom: 2028, yearTo: 2036, issuerCap: 1, holdings });
  const last = Math.max(...holdings.map(x => parts(x.bond.maturity).y));
  assert.deepEqual(p.byYear.map(r => r.year), [2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036]);
  for (const r of p.byYear) if (r.year > last) assert.equal(r.held, 0, `${r.year}: i tuoi titoli sono già scaduti`);
  assert.ok(p.byYear.at(-1).annual < p.annual, 'nell\'ultimo anno la rendita è sotto l\'anno tipo');
});

test('rendita desiderata anche senza portafoglio: raggiunta e con i mesi pagabili', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const t = planIncomeTarget(ds, bonds, { yearFrom: 2028, yearTo: 2036, issuerCap: 1 / 3 }, 150);
  assert.ok(t.coverable.length > 0 && minCov(t) >= 150 - 1e-6, `rendita ${minCov(t)}`);
});

// Facoltativo: STFI_CSV=/percorso/file.csv npm test → i BTP Valore comprati sul mercato seguono gli step-up della tabella
test('step-up dei BTP retail nuovi: rendimento dai flussi = rendimento STFI (dati reali)', { skip: !process.env.STFI_CSV }, () => {
  const ds = enrich(loadText(fs.readFileSync(process.env.STFI_CSV, 'utf8')));
  for (const isin of ['IT0005672024', 'IT0005696338', 'IT0005634800', 'IT0005583486']) {
    const b = ds.bonds.find(x => x.isin === isin);
    if (!b || !Number.isFinite(b.ytmNet)) continue;
    assert.ok(b.steps && b.steps.length > 1, `${isin}: calendario degli step-up`);
    assert.ok(Math.abs(netYield(b, ds.settle) - b.ytmNet) < 0.05, `${isin}: ${netYield(b, ds.settle).toFixed(2)} contro STFI ${b.ytmNet}`);
  }
});
