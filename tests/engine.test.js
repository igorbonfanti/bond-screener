/* Test del motore (node --test, fuso Europe/Rome impostato da "npm test"). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { day, parseDay, addMonths, addBusinessDays, fmt, iso, parts } from '../src/core/dates.js';
import { num, parseCSV, loadText } from '../src/data/stfi.js';
import { couponDates, accrued, cashflows, xirr, netYield, gainTax } from '../src/core/bond.js';
import { enrich, applyBasket } from '../src/core/basket.js';
import { selectPerSlot, assignByFlow, branchAndBound } from '../src/core/select.js';
import { regularTargets, dateTargets, planCapital } from '../src/core/capital.js';
import { planIncome } from '../src/core/income.js';

const FIX = fs.readFileSync(new URL('./fixtures/stfi-synthetic.csv', import.meta.url), 'utf8');
const load = () => enrich(loadText(FIX));

test('date: giorni interi, nessuno sfasamento di fuso', () => {
  assert.equal(fmt(parseDay('30/05/2026')), '30/05/2026');
  assert.equal(iso(parseDay('01/06/2027')), '2027-06-01');
  assert.equal(parseDay('31/02/2027'), null, 'data inesistente rifiutata');
  assert.equal(parseDay('15/13/2027'), null, 'mese 13 rifiutato');
  assert.equal(fmt(addMonths(day(2027, 5, 31), 6)), '30/11/2027', 'fine mese senza scivolare a dicembre');
  assert.equal(fmt(addBusinessDays(day(2026, 9, 24), 2)), '28/09/2026', 'T+2 salta il fine settimana');
});

test('numeri all\'italiana e CSV', () => {
  assert.equal(num('102,642'), 102.642);
  assert.equal(num('1.234,5'), 1234.5);
  assert.equal(num('0,0625'), 0.0625);
  assert.ok(Number.isNaN(num('')));
  const rows = parseCSV('﻿a;b;c\r\n1;"x;y";3\r\n');
  assert.deepEqual(rows, [{ a: '1', b: 'x;y', c: '3' }]);
});

test('normalizzazione export STFI', () => {
  const ds = load();
  assert.equal(fmt(ds.refDate), '24/09/2026');
  assert.equal(fmt(ds.settle), '28/09/2026');
  const btp = ds.bonds.find(b => b.desc.startsWith('BTP 01/02/2027'));
  assert.equal(btp.coupon, 2.5, 'cedola da frazione a percentuale');
  assert.deepEqual(btp.months, [2, 8]);
  assert.equal(btp.area, 'euro');
  assert.ok(ds.bonds.find(b => /BTP Italia/.test(b.desc)).inflation);
  assert.ok(ds.bonds.find(b => /STEP UP/.test(b.desc)).stepUp);
  assert.ok(ds.bonds.find(b => /^BOT/.test(b.desc)).zc);
  assert.equal(ds.bonds.find(b => b.issuer === 'GOV_RO').area, 'extra');
  assert.equal(ds.bonds.find(b => b.issuer === 'SOV_EU').rating, 'AA+');
  assert.equal(ds.bonds.find(b => b.issuer === 'INTESASP').tax, 0.26);
  assert.throws(() => loadText('a;b\n1;2\n'), /simpletoolsforinvestors/);
});

test('flussi di un titolo: calendario, rateo, credito sul rateo, plusvalenza', () => {
  const ds = load();
  const b = ds.bonds.find(x => x.desc.startsWith('BTP 01/02/2027'));
  assert.deepEqual(couponDates(b, ds.settle, b.maturity).map(fmt), ['01/02/2027']);
  const acc = accrued(b, ds.settle);                       // 1,25 × 58/184 (dal 01/08 al 28/09)
  assert.ok(Math.abs(acc - 1.25 * 58 / 184) < 1e-9);
  const fl = cashflows(b, ds.settle);
  assert.ok(Math.abs(fl[0].tax - 0.125 * (1.25 - acc)) < 1e-9, 'tassata solo la parte maturata dopo l\'acquisto');
  assert.ok(Math.abs(fl.at(-1).net - (100 - 0.125 * (100 - 99.4))) < 1e-9, 'rimborso netto della tassa sulla plusvalenza');
  assert.ok(gainTax(b, true) <= gainTax(b, false), 'lo zainetto riduce la tassa');
  const r = xirr([{ day: day(2026, 1, 1), amount: -100 }, { day: day(2027, 1, 1), amount: 104 }]);
  assert.ok(Math.abs(r - 0.04) < 0.001);
});

test('rendimenti ricalcolati coerenti con quelli del file', () => {
  const ds = load();
  for (const b of ds.bonds.filter(x => x.currency === 'EUR' && !x.stepUp)) {
    assert.ok(Math.abs(netYield(b, ds.settle) - b.ytmNet) < 0.01, `${b.desc}: ${netYield(b, ds.settle)} vs ${b.ytmNet}`);
  }
});

test('paniere predefinito: area euro + sovranazionali, sotto la pari, liquidi, niente indicizzati', () => {
  const ds = load();
  const { bonds, excluded } = applyBasket(ds, {});
  assert.ok(bonds.every(b => ['euro', 'sov'].includes(b.area) && b.price <= 100 && b.liquidity >= 1 && !b.inflation && b.currency === 'EUR'));
  assert.ok(excluded.price >= 1 && excluded.liquidity >= 1 && excluded.inflation >= 1 && excluded.group >= 1 && excluded.currency >= 1);
});

test('selezione: mai un gradino vuoto se si può riempire (difetto della v2)', () => {
  const mk = (isin, issuer, score) => ({ bond: { isin, issuer }, score });
  const slots = [
    { weight: 1, cands: [mk('IT_A', 'GOV_IT', 0.04), mk('DE_A', 'GOV_DE', 0.005)] },
    { weight: 1, cands: [mk('IT_B', 'GOV_IT', 0.03)] }
  ];
  for (const cap of [0.5, 0.99]) {
    const r = selectPerSlot(slots, { issuerCap: cap });
    assert.deepEqual(r.choice.map(c => c && c.bond.isin), ['DE_A', 'IT_B']);
    const w = selectPerSlot(slots.map((s, i) => ({ ...s, weight: i + 1 })), { issuerCap: cap });
    assert.deepEqual(w.choice.map(c => c && c.bond.isin), ['DE_A', 'IT_B'], 'anche con pesi diversi (branch & bound)');
  }
});

test('selezione: flusso, branch & bound e forza bruta danno lo stesso ottimo', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const brute = (slots, cap) => {
    const N = slots.length, capCount = cap >= 1 ? N : Math.max(1, Math.floor(cap * N + 1e-9));
    let best = [-1, -1];
    (function rec(k, used, cnt, fill, val) {
      if (k === N) { if (fill > best[0] || (fill === best[0] && val > best[1] + 1e-12)) best = [fill, val]; return; }
      for (const c of slots[k].cands) {
        const n = cnt[c.bond.issuer] || 0;
        if (n >= capCount || used.has(c.bond.isin)) continue;
        cnt[c.bond.issuer] = n + 1; used.add(c.bond.isin);
        rec(k + 1, used, cnt, fill + 1, val + c.score);
        used.delete(c.bond.isin); cnt[c.bond.issuer] = n;
      }
      rec(k + 1, used, cnt, fill, val);
    })(0, new Set(), {}, 0, 0);
    return best;
  };
  for (let trial = 0; trial < 40; trial++) {
    const issuers = ['A', 'B', 'C', 'D'].slice(0, 2 + Math.floor(rnd() * 3));
    const slots = Array.from({ length: 3 + Math.floor(rnd() * 5) }, (_, t) => ({
      weight: 1, cands: issuers.flatMap(iss => rnd() < 0.7 ? [{ bond: { isin: `${iss}${t}`, issuer: iss }, score: rnd() * 0.05 }] : [])
    }));
    const cap = [1, 0.5, 0.34][trial % 3];
    const val = r => [r.choice.filter(Boolean).length, r.choice.reduce((s, c) => s + (c ? c.score : 0), 0)];
    const [bf, bv] = brute(slots, cap);
    for (const [name, r] of [['flusso', assignByFlow(slots, { issuerCap: cap })], ['branch & bound', branchAndBound(slots, { issuerCap: cap })]]) {
      const [f, v] = val(r);
      assert.equal(f, bf, `${name}: gradini coperti (caso ${trial})`);
      assert.ok(Math.abs(v - bv) < 1e-9, `${name}: valore ${v} invece di ${bv} (caso ${trial})`);
    }
  }
});

test('capitale a scadenza: scala annuale, importi garantiti, cedole usate', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const targets = regularTargets({ yearFrom: 2027, yearTo: 2033, everyMonths: 12, amount: 10000 }, ds.settle);
  assert.deepEqual(targets.map(t => t.label), ['2027', '2028', '2029', '2030', '2031', '2032', '2033']);
  const plan = planCapital(ds, bonds, { targets, issuerCap: 0.5 });
  assert.equal(plan.targets.filter(t => t.bond).length, 7, 'tutti i gradini coperti');
  for (const t of plan.targets) {
    assert.ok(t.available >= t.amount - 1e-6, `${t.label}: ${t.available} < ${t.amount}`);
    assert.ok(t.bond.maturity > t.start && t.bond.maturity <= t.end, 'scadenza nella finestra');
    assert.equal(t.nominal % t.bond.lot, 0, 'nominale multiplo del lotto');
  }
  const noCpn = planCapital(ds, bonds, { targets, issuerCap: 0.5, useCoupons: false });
  assert.ok(noCpn.totalCost > plan.totalCost, 'usare le cedole costa meno');
  const shares = plan.summary.byIssuer.map(e => e.share);
  assert.ok(Math.max(...shares) <= 0.62, 'limite per emittente rispettato (a meno degli arrotondamenti)');
});

test('capitale a scadenza: dal capitale disponibile, titolo fissato a mano, date precise', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const targets = regularTargets({ yearFrom: 2027, yearTo: 2031, everyMonths: 12, amount: 1 }, ds.settle);
  const plan = planCapital(ds, bonds, { targets, budget: 50000, issuerCap: 1 });
  assert.ok(plan.totalCost <= 50000 + 1e-6);
  assert.ok(50000 - plan.totalCost < 1100, 'capitale quasi tutto investito');
  const alt = plan.targets[2].candidates.find(c => c.bond.isin !== plan.targets[2].bond.isin);
  const fixed = planCapital(ds, bonds, { targets, budget: 50000, issuerCap: 1, fixed: { 2: alt.bond.isin } });
  assert.equal(fixed.targets[2].bond.isin, alt.bond.isin);
  assert.ok(fixed.targets[2].fixed);
  const dt = dateTargets([{ day: day(2029, 9, 1), amount: 20000 }, { day: day(2032, 6, 30), amount: 30000 }], 12, ds.settle);
  const p2 = planCapital(ds, bonds, { targets: dt, issuerCap: 1 });
  for (const t of p2.targets) {
    assert.ok(t.bond.maturity <= t.need && t.bond.maturity > addMonths(t.need, -12) - 1, 'entro 12 mesi prima della data');
    assert.ok(t.available >= t.amount - 1e-6);
  }
});

test('rendita mensile: 12 mesi coperti, regolare, capitale investito, priorità al rendimento', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const r = planIncome(ds, bonds, { capital: 100000, yearFrom: 2028, yearTo: 2036, issuerCap: 1 });
  assert.equal(r.coveredMonths, 12);
  assert.ok(r.regularity > 0.85, `regolarità ${r.regularity}`);
  assert.ok(r.cash >= 0 && r.cash < 3000, `liquidità residua ${r.cash}`);
  for (const p of r.positions) assert.equal(p.nominal % p.bond.lot, 0);
  const y = planIncome(ds, bonds, { capital: 100000, yearFrom: 2028, yearTo: 2036, issuerCap: 1, tradeoff: 0.8 });
  assert.ok(y.summary.yieldNet >= r.summary.yieldNet - 0.02, 'meno vincolo sulla rendita → rendimento non inferiore');
});

// Facoltativo: STFI_CSV=/percorso/file.csv npm test → confronto sui dati reali
test('dati reali STFI (se disponibili)', { skip: !process.env.STFI_CSV }, () => {
  const ds = enrich(loadText(fs.readFileSync(process.env.STFI_CSV, 'utf8')));
  const eur = ds.bonds.filter(b => b.currency === 'EUR' && b.group !== 'corp' && !b.inflation && !b.stepUp && !b.anomaly && b.maturity > ds.settle + 60);
  const ok = eur.filter(b => Math.abs(netYield(b, ds.settle) - b.ytmNet) < 0.05).length;
  assert.ok(ok / eur.length > 0.97, `${ok}/${eur.length} rendimenti netti entro 0,05 punti`);
  assert.ok(parts(ds.refDate).y >= 2024);
});
