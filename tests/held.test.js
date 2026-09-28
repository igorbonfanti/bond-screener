/* Scala costruita attorno a un portafoglio già posseduto (niente vendite). Solo dati inventati. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadText } from '../src/data/stfi.js';
import { enrich, applyBasket } from '../src/core/basket.js';
import { regularTargets, planCapital, ALWAYS } from '../src/core/capital.js';
import { resolveHoldings } from '../src/portfolio.js';
import { parts } from '../src/core/dates.js';
import { compute } from '../src/engine.js';
import { defaults } from '../src/state.js';

const FIX = fs.readFileSync(new URL('./fixtures/stfi-synthetic.csv', import.meta.url), 'utf8');
const load = () => enrich(loadText(FIX));
const held = (ds, list) => resolveHoldings(list, ds).filter(r => r.bond && r.status !== 'matured')
  .map(r => ({ isin: r.h.isin, bond: r.bond, nominal: r.h.nominal, flows: r.flows, value: r.value, status: r.status }));
const inYear = (bonds, y, not = []) => bonds.find(b => parts(b.maturity).y === y && !not.includes(b.isin));

test('portafoglio: gli anni già coperti non comprano nulla, gli altri solo la differenza', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const targets = regularTargets({ yearFrom: 2027, yearTo: 2031, everyMonths: 12, amount: 10000 }, ds.settle);
  const b28 = inYear(bonds, 2028), b30 = inYear(bonds, 2030);
  const holdings = held(ds, [{ isin: b28.isin, nominal: 10000, carico: 99 }, { isin: b30.isin, nominal: 4000, carico: 99 }]);
  const base = planCapital(ds, bonds, { targets, issuerCap: 1 });
  const p = planCapital(ds, bonds, { targets, issuerCap: 1, holdings });
  const t28 = p.targets.find(t => t.label === '2028'), t30 = p.targets.find(t => t.label === '2030');
  assert.ok(t28.coveredByHeld && !t28.nominal, '2028 pagato dal titolo posseduto');
  assert.ok(t30.nominal > 0 && t30.nominal < base.targets.find(t => t.label === '2030').nominal, '2030: si compra solo la differenza');
  assert.ok(t30.heldIn > 3900, 'il rimborso posseduto conta nel 2030');
  for (const t of p.targets) assert.ok(t.available + 0.5 >= t.amount, `${t.label} coperta`);
  assert.ok(p.totalCost < base.totalCost - 10000, 'con il portafoglio si spende molto meno');
  assert.ok(p.heldCover > 0.25 && p.heldCover < 0.35, `quota pagata dal portafoglio ${p.heldCover}`);
  assert.equal(planCapital(ds, bonds, { targets, issuerCap: 1, holdings: [] }).totalCost, base.totalCost, 'senza portafoglio: identico');
});

test('portafoglio: eccedenze portate avanti (carry) oppure restituite', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const targets = regularTargets({ yearFrom: 2027, yearTo: 2030, everyMonths: 12, amount: 10000 }, ds.settle);
  const b27 = inYear(bonds, 2027);
  const holdings = held(ds, [{ isin: b27.isin, nominal: 25000, carico: 100 }]);
  const on = planCapital(ds, bonds, { targets, issuerCap: 1, holdings });
  const off = planCapital(ds, bonds, { targets, issuerCap: 1, holdings, carry: false });
  assert.ok(on.carry && !off.carry);
  assert.ok(on.targets[0].carried > 14000, 'il 2027 avanza circa 15.000 €');
  assert.ok(on.targets[1].fromPot > 9000, 'che pagano il 2028');
  assert.ok(on.totalCost < off.totalCost - 9000, 'con le eccedenze si compra meno');
  assert.ok(on.idleEuroYears > 9000, 'ma restano ferme in cassa');
  assert.equal(off.idleEuroYears, 0);
  assert.ok(off.heldSurplus > 14000, 'senza carry l\'eccedenza torna all\'investitore');
  for (const p of [on, off]) for (const t of p.targets) assert.ok(t.available + 0.5 >= t.amount, `${t.label} coperta`);
});

test('portafoglio: dal capitale disponibile (anche zero) e limite per emittente sul totale', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const targets = regularTargets({ yearFrom: 2027, yearTo: 2031, everyMonths: 12, amount: 1 }, ds.settle);
  const b27 = inYear(bonds, 2027), b29 = inYear(bonds, 2029);
  const holdings = held(ds, [{ isin: b27.isin, nominal: 10000, carico: 99 }, { isin: b29.isin, nominal: 10000, carico: 99 }]);
  const zero = planCapital(ds, bonds, { targets, issuerCap: 1, holdings, budget: 0 });
  assert.equal(zero.totalCost, 0, 'budget zero: niente acquisti');
  assert.ok(zero.targets[0].amount > 3000 && zero.targets.every(t => t.available + 0.5 >= t.amount), 'importo garantito dal solo portafoglio');
  const p = planCapital(ds, bonds, { targets, issuerCap: 1, holdings, budget: 30000 });
  assert.ok(p.totalCost <= 30000 + 1e-6 && p.totalCost > 28000, 'capitale quasi tutto investito, mai di più');
  const noHeld = planCapital(ds, bonds, { targets, issuerCap: 1, budget: 30000 });
  assert.ok(p.targets[0].amount > noHeld.targets[0].amount + 3000, 'il portafoglio alza la somma per scadenza');
  // un emittente che nel portafoglio pesa già oltre il limite non riceve acquisti nuovi
  const iss = b27.issuer;
  const heavy = held(ds, bonds.filter(b => b.issuer === iss).slice(0, 3).map(b => ({ isin: b.isin, nominal: 30000, carico: 99 })));
  const t2 = regularTargets({ yearFrom: 2031, yearTo: 2035, everyMonths: 12, amount: 10000 }, ds.settle);
  const capped = planCapital(ds, bonds, { targets: t2, issuerCap: 1 / 3, holdings: heavy });
  assert.ok(!capped.positions.some(x => x.bond.issuer === iss), 'niente acquisti dall\'emittente già oltre il limite');
  assert.ok(capped.issuerOver.some(e => e.issuer === iss), 'e lo dice');
});

test('portafoglio: preferenza per i titoli già posseduti (rabbocco)', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const targets = regularTargets({ yearFrom: 2029, yearTo: 2029, everyMonths: 12, amount: 20000 }, ds.settle);
  const p0 = planCapital(ds, bonds, { targets, issuerCap: 1 });
  const other = p0.targets[0].candidates.find(c => c.bond.isin !== p0.targets[0].bond.isin);
  assert.ok(other, 'serve un\'alternativa nella finestra');
  const holdings = held(ds, [{ isin: other.bond.isin, nominal: 5000, carico: 99 }]);
  const yieldFirst = planCapital(ds, bonds, { targets, issuerCap: 1, holdings, heldBonus: 1e-6 });
  const mine = planCapital(ds, bonds, { targets, issuerCap: 1, holdings, heldBonus: ALWAYS });
  assert.equal(yieldFirst.targets[0].bond.isin, p0.targets[0].bond.isin, '«Rendimento»: il migliore della finestra');
  assert.equal(mine.targets[0].bond.isin, other.bond.isin, '«I miei titoli»: altri pezzi del tuo');
  assert.ok(mine.targets[0].topUp && mine.topUps === 1 && mine.newLines === 0);
  assert.equal(mine.targets[0].candidates[0].score, p0.targets[0].candidates[0].score, 'il rendimento mostrato non cambia');
});

test('portafoglio dalle impostazioni (engine.compute): titoli non trovati, confronto sulle eccedenze', () => {
  const ds = load();
  const st = defaults(ds.refDate);
  st.goal = 'capital'; st.capital.yearFrom = 2027; st.capital.yearTo = 2030;
  const { bonds } = applyBasket(ds, {});
  const b27 = inYear(bonds, 2027);
  st.holdings = [{ isin: b27.isin, nominal: 30000, carico: 100 }, { isin: 'DE0001102580', nominal: 5000, carico: 98 }];
  const r = compute(ds, st);
  assert.deepEqual(r.portfolio.missing, ['DE0001102580'], 'titolo che il file non ha: segnalato, fuori dal calcolo');
  assert.equal(r.plan.holdings.length, 1);
  assert.ok(r.plan.carry && r.plan.alt && !r.plan.alt.carry, 'calcolata anche l\'altra scelta');
  assert.ok(r.plan.alt.totalCost > r.plan.totalCost, 'restituendo le eccedenze si compra di più');
  st.portfolioCarry = false;
  assert.ok(!compute(ds, st).plan.carry, 'impostazione rispettata');
  st.usePortfolio = false; delete st.holdings;
  assert.equal(compute(ds, st).plan.holdings, undefined, 'senza portafoglio: proposta normale');
});

test('rendita attorno al portafoglio: cedole dei tuoi titoli come base, prima e dopo, rendita desiderata', async () => {
  const { planIncome, planIncomeTarget } = await import('../src/core/income.js');
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const cpn = bonds.filter(b => !b.zc && b.freq && parts(b.maturity).y >= 2029 && parts(b.maturity).y <= 2033);
  const holdings = held(ds, cpn.slice(0, 3).map(b => ({ isin: b.isin, nominal: 20000, carico: 99 })));
  const base = { yearFrom: 2028, yearTo: 2036, issuerCap: 1, tradeoff: 1, holdings };
  const zero = planIncome(ds, bonds, { ...base, capital: 0 });
  assert.equal(zero.totalCost, 0, 'capitale zero: nessun acquisto');
  assert.ok(zero.annual > 0 && Math.abs(zero.annual - zero.annualHeld) < 1e-9, 'solo le cedole dei tuoi titoli');
  const p = planIncome(ds, bonds, { ...base, capital: 30000 });
  const alone = planIncome(ds, bonds, { yearFrom: 2028, yearTo: 2036, issuerCap: 1, tradeoff: 1, capital: 30000 });
  assert.ok(p.totalCost <= 30000 + 1e-6);
  for (let m = 0; m < 12; m++) assert.ok(p.monthly[m] >= p.monthlyHeld[m] - 1e-9, 'i tuoi titoli restano: nessun mese scende');
  assert.ok(p.minMonth > alone.minMonth, 'con la base dei tuoi titoli il mese più povero sale');
  assert.ok(p.minAllAfter > p.minAllBefore, 'il mese più povero (anche a zero) sale');
  const t = planIncomeTarget(ds, bonds, base, p.minMonth + 50);
  assert.ok(Math.min(...t.coverable.map(m => t.monthly[m - 1])) >= p.minMonth + 50 - 1e-6, 'rendita desiderata raggiunta');
  assert.ok(t.totalCost > p.totalCost, 'serve più capitale');
  // senza portafoglio il motore della rendita non cambia
  const again = planIncome(ds, bonds, { yearFrom: 2028, yearTo: 2036, issuerCap: 1, tradeoff: 1, capital: 30000, holdings: [] });
  assert.deepEqual(again.positions.map(x => [x.bond.isin, x.nominal]), alone.positions.map(x => [x.bond.isin, x.nominal]));
});
