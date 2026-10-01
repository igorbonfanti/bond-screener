/* Scelta per costo: a parità di somme garantite, la proposta non costa mai più della scelta per rendimento; partendo dal
   capitale la somma mostrata è garantita a ogni scadenza; ogni euro dei flussi è in una scadenza o torna libero. Dati inventati. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadText } from '../src/data/stfi.js';
import { enrich, applyBasket } from '../src/core/basket.js';
import { regularTargets, planCapital } from '../src/core/capital.js';
import { resolveHoldings } from '../src/portfolio.js';
import { parts } from '../src/core/dates.js';
import { compute } from '../src/engine.js';
import { defaults } from '../src/state.js';

const FIX = fs.readFileSync(new URL('./fixtures/stfi-synthetic.csv', import.meta.url), 'utf8');
const load = () => enrich(loadText(FIX));
const held = (ds, list) => resolveHoldings(list, ds).filter(r => r.bond && r.status !== 'matured')
  .map(r => ({ isin: r.h.isin, bond: r.bond, nominal: r.h.nominal, flows: r.flows, value: r.value, status: r.status }));
const inflows = (p, holdings = []) => p.schedule.reduce((s, f) => s + f.net, 0) + holdings.reduce((s, x) => s + x.flows.reduce((a, f) => a + f.net, 0), 0);
const used = p => p.targets.reduce((s, t) => s + Math.min(t.available, t.amount), 0);
const back = p => p.returned.reduce((s, f) => s + f.amount, 0);

test('scelta per costo: mai più cara della scelta per rendimento, stesse scadenze coperte', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  for (const [from, to, every, accumulate] of [[2027, 2033, 12, false], [2027, 2033, 12, true], [2028, 2032, 6, false], [2033, 2036, 12, true]]) {
    const targets = regularTargets({ yearFrom: from, yearTo: to, everyMonths: every, amount: 10000 }, ds.settle);
    const p = planCapital(ds, bonds, { targets, issuerCap: 1, accumulate });
    // la scelta per rendimento (senza limite per emittente: il migliore di ogni periodo), fissata a mano: niente scambi
    const fixed = {};
    const isins = new Set();
    p.targets.forEach((t, i) => { const c = t.candidates.find(x => !isins.has(x.bond.isin)); if (c) { fixed[i] = c.bond.isin; isins.add(c.bond.isin); } });
    const y = planCapital(ds, bonds, { targets, issuerCap: 1, accumulate, fixed });
    assert.ok(p.totalCost <= y.totalCost + 0.5, `${from}-${to}/${every}: ${p.totalCost.toFixed(2)} ≤ ${y.totalCost.toFixed(2)}`);
    for (const t of p.targets) assert.ok(t.available + 0.5 >= t.amount, `${t.label} coperta`);
    for (const t of p.targets) assert.equal(t.nominal % t.bond.lot, 0, 'lotti interi');
    assert.ok(Math.abs(inflows(p) - used(p) - back(p)) < 0.01, 'ogni euro è in una scadenza o torna libero');
    assert.ok(Number.isFinite(p.goalIrr) && p.goalIrr > 0 && p.goalIrr < 0.1, `rendimento alle scadenze ${p.goalIrr}`);
  }
});

test('dal capitale: la somma mostrata arriva a ogni scadenza, nel capitale', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  for (const accumulate of [false, true]) for (const cap of [1, 1 / 3]) {
    const targets = regularTargets({ yearFrom: 2027, yearTo: 2034, everyMonths: 12, amount: 1 }, ds.settle);
    const p = planCapital(ds, bonds, { targets, issuerCap: cap, accumulate, budget: 80000 });
    assert.ok(p.totalCost <= 80000 + 1e-6, 'mai oltre il capitale');
    assert.ok(80000 - p.totalCost < 0.05 * 80000, `capitale quasi tutto investito (${p.totalCost.toFixed(0)})`);
    for (const t of p.targets) assert.ok(t.available + 0.5 >= t.amount, `${t.label}: ${t.available.toFixed(2)} ≥ ${t.amount.toFixed(2)}`);
    assert.ok(Math.abs(inflows(p) - used(p) - back(p)) < 0.01, 'ogni euro è in una scadenza o torna libero');
  }
});

test('eccedenze in cassa o restituite: il confronto è un investimento (capitale in più oggi, soldi che tornano)', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const b27 = bonds.find(b => parts(b.maturity).y === 2027);
  const st = defaults(ds.refDate);
  st.goal = 'capital'; Object.assign(st.capital, { yearFrom: 2027, yearTo: 2031, amount: 10000 });
  st.holdings = [{ isin: b27.isin, nominal: 30000, carico: 100 }];
  const r = compute(ds, st), p = r.plan, alt = p.alt;
  assert.ok(p.carry && alt && !alt.carry);
  assert.ok(alt.extraToday > 0 && Math.abs(alt.extraToday - (alt.totalCost - p.totalCost)) < 1e-6, 'senza cassa si spende di più oggi');
  assert.ok(alt.extraBack > 15000, `e tornano le eccedenze (${alt.extraBack})`);
  assert.ok(Number.isFinite(alt.diffIrr) && Number.isFinite(alt.benchYield), 'con il loro rendimento e quello di pari durata');
  const hs = held(ds, st.holdings);
  assert.ok(Math.abs(inflows(p, hs) - used(p) - back(p)) < 0.01, 'identità anche con il portafoglio');
});
