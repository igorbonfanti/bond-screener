/* Scheda «Un titolo»: filtri, ordinamento e acquisto con un importo. Dati inventati. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadText } from '../src/data/stfi.js';
import { enrich } from '../src/core/basket.js';
import { parts } from '../src/core/dates.js';
import { scoreYield } from '../src/core/bond.js';

const { findBonds, purchase, finderDefaults } = await import('../src/ui/finder.js');
const ds = enrich(loadText(fs.readFileSync(new URL('./fixtures/stfi-synthetic.csv', import.meta.url), 'utf8')));

test('un titolo: filtri per emittente e anni, il primo è il migliore per il criterio scelto', () => {
  const de = ds.bonds.find(b => b.issuer.startsWith('GOV_') && b.area === 'euro').issuer;
  const f = { ...finderDefaults(2026), issuer: de, from: 2027, to: 2040, minRating: '', minLiq: 0 };
  const list = findBonds(ds, f);
  assert.ok(list.length > 0);
  for (const b of list) { assert.equal(b.issuer, de); assert.ok(parts(b.maturity).y >= 2027 && parts(b.maturity).y <= 2040); }
  for (let i = 1; i < list.length; i++) assert.ok(scoreYield(list[i - 1], false) >= scoreYield(list[i], false));
  const byCpn = findBonds(ds, { ...f, sort: 'coupon' });
  for (let i = 1; i < byCpn.length; i++) assert.ok(byCpn[i - 1].coupon >= byCpn[i].coupon);
  const zc = findBonds(ds, { ...f, issuer: '', type: 'zc' });
  assert.ok(zc.every(b => b.zc));
});

test('un titolo: con un importo si compra a lotti interi, mai oltre l\'importo', () => {
  const b = findBonds(ds, { ...finderDefaults(2026), from: 2028, to: 2035, minRating: '', minLiq: 0 })[0];
  const p = purchase(b, ds.settle, 10000);
  assert.equal(p.nominal % b.lot, 0);
  assert.ok(p.cost <= 10000 + 1e-9 && p.cost > 10000 - p.lotCost);
  assert.ok(Math.abs(p.received - p.flows.reduce((s, x) => s + x.net, 0)) < 1e-9);
  assert.ok(p.flows.at(-1).kind === 'redemption' && p.gain > 0);
  assert.equal(purchase(b, ds.settle, 1).nominal, b.lot >= 1000 ? 0 : purchase(b, ds.settle, 1).nominal);
});
