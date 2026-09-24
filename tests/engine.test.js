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
import { compute } from '../src/engine.js';
import { defaults } from '../src/state.js';

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

test('capitale a scadenza: scala che parte fra anni, le cedole di prima non tolgono il primo titolo', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const sumNet = (plan, pred) => plan.schedule.filter(f => f.kind === 'coupon' && pred(f.day)).reduce((s, f) => s + f.net, 0);
  // Importi fissi: 2033-2036, dopo sette anni di cedole
  const targets = regularTargets({ yearFrom: 2033, yearTo: 2036, everyMonths: 12, amount: 10000 }, ds.settle);
  const plan = planCapital(ds, bonds, { targets, issuerCap: 1 });
  plan.targets.forEach((t, i) => {
    assert.ok(t.bond && t.nominal > 0, `${t.label}: il titolo si compra`);
    assert.ok(t.available >= t.amount - 1e-6, `${t.label}: importo garantito`);
    const lo = day(2033 + i, 1, 1) - 1, hi = day(2033 + i, 12, 31);
    assert.equal(t.periodFrom, lo);
    assert.ok(Math.abs(t.coupons - sumNet(plan, d => d > lo && d <= hi)) < 1e-6, `${t.label}: solo le cedole del suo anno`);
  });
  assert.ok(plan.targets[0].nominal >= 0.8 * plan.targets[1].nominal, 'il primo titolo non è ridotto dalle cedole di prima');
  const pre = sumNet(plan, d => d <= day(2032, 12, 31));
  assert.ok(pre > 1000, 'sette anni di cedole prima della scala');
  assert.ok(Math.abs(plan.preCoupons - pre) < 1e-6 && plan.gapCoupons < 1e-6);
  assert.equal(plan.preUntil, day(2032, 12, 31));
  const all = plan.schedule.reduce((s, f) => s + f.net, 0);
  assert.ok(Math.abs(all - plan.targets.reduce((s, t) => s + t.available, 0) - plan.preCoupons) < 1e-6, 'ogni flusso è negli importi o fra le cedole di prima');
  // Dal capitale disponibile: stessa cosa, e il capitale è investito
  const unit = regularTargets({ yearFrom: 2033, yearTo: 2036, everyMonths: 12, amount: 1 }, ds.settle);
  const b = planCapital(ds, bonds, { targets: unit, budget: 50000, issuerCap: 1 });
  assert.ok(b.targets.every(t => t.nominal > 0), 'dal capitale: nessun gradino senza titolo');
  assert.ok(b.totalCost <= 50000 + 1e-6 && 50000 - b.totalCost < 1100);
  const amounts = b.targets.map(t => t.available);
  assert.ok(Math.max(...amounts) / Math.min(...amounts) < 1.15, `somme simili: ${amounts.map(Math.round)}`);
});

test('capitale a scadenza: date precise, contano le cedole dei 12 mesi prima', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const dt = dateTargets([{ day: day(2028, 9, 1), amount: 10000 }, { day: day(2034, 6, 30), amount: 30000 }], 6, ds.settle);
  const plan = planCapital(ds, bonds, { targets: dt, issuerCap: 1 });
  const sumNet = pred => plan.schedule.filter(f => f.kind === 'coupon' && pred(f.day)).reduce((s, f) => s + f.net, 0);
  plan.targets.forEach(t => {
    const lo = addMonths(t.need, -12);
    assert.equal(t.periodFrom, lo);
    assert.ok(t.nominal > 0 && t.available >= t.amount - 1e-6, `${t.label}: coperta dal suo titolo`);
    assert.ok(Math.abs(t.coupons - sumNet(d => d > lo && d <= t.need)) < 1e-6, `${t.label}: solo le cedole dei 12 mesi prima`);
  });
  assert.ok(Math.abs(plan.preCoupons - sumNet(d => d <= addMonths(day(2028, 9, 1), -12))) < 1e-6);
  assert.ok(Math.abs(plan.gapCoupons - sumNet(d => d > day(2028, 9, 1) && d <= addMonths(day(2034, 6, 30), -12))) < 1e-6);
  assert.ok(plan.gapCoupons > 1000, 'cinque anni di cedole fra le due date');
});

test('capitale a scadenza: opzione "accantona le cedole di prima"', () => {
  const ds = load();
  const { bonds } = applyBasket(ds, {});
  const targets = regularTargets({ yearFrom: 2033, yearTo: 2036, everyMonths: 12, amount: 10000 }, ds.settle);
  const base = planCapital(ds, bonds, { targets, issuerCap: 1 });
  const acc = planCapital(ds, bonds, { targets, issuerCap: 1, accumulate: true });
  assert.ok(acc.accumulate && !base.accumulate);
  for (const t of acc.targets) {
    assert.ok(t.available + 0.5 >= t.amount, `${t.label}: coperta (${t.available})`);
    assert.equal(t.nominal % t.bond.lot, 0);
  }
  assert.ok(acc.targets[0].fromPot > 1000, 'le cedole accantonate pagano la prima scadenza');
  const firstGap = acc.targets.findIndex(t => t.fromPot < 0.5);
  if (firstGap >= 0) assert.ok(acc.targets.slice(firstGap).every(t => t.fromPot < 0.5), 'la cassa va prima alle scadenze più vicine');
  assert.ok(acc.targets[0].nominal < base.targets[0].nominal, 'il primo titolo si riduce');
  assert.ok(acc.totalCost < base.totalCost - 1000, `serve meno capitale: ${acc.totalCost} < ${base.totalCost}`);
  const flows = acc.schedule.reduce((s, f) => s + f.net, 0);
  assert.ok(Math.abs(flows - acc.targets.reduce((s, t) => s + t.available, 0) - acc.potLeft) < 1e-6, 'ogni euro è in una scadenza o nell\'avanzo');
  assert.ok(acc.potLeft < 1100, `avanzo piccolo (${acc.potLeft})`);
  // Dal capitale: somme più alte che senza accantonare, capitale investito
  const unit = regularTargets({ yearFrom: 2033, yearTo: 2036, everyMonths: 12, amount: 1 }, ds.settle);
  const b0 = planCapital(ds, bonds, { targets: unit, budget: 50000, issuerCap: 1 });
  const b1 = planCapital(ds, bonds, { targets: unit, budget: 50000, issuerCap: 1, accumulate: true });
  assert.ok(b1.totalCost <= 50000 + 1e-6 && 50000 - b1.totalCost < 1100);
  assert.ok(b1.targets[0].amount > b0.targets[0].amount * 1.05, 'somma per scadenza più alta');
  // Scala che parte subito: nessuna cedola "di prima", l'opzione non cambia nulla
  const now = regularTargets({ yearFrom: 2026, yearTo: 2030, everyMonths: 12, amount: 10000 }, ds.settle);
  const n0 = planCapital(ds, bonds, { targets: now, issuerCap: 1 }), n1 = planCapital(ds, bonds, { targets: now, issuerCap: 1, accumulate: true });
  assert.equal(n0.preCoupons, 0);
  assert.equal(n1.totalCost, n0.totalCost);
  // Senza cedole negli importi l'opzione è spenta
  assert.equal(planCapital(ds, bonds, { targets, issuerCap: 1, useCoupons: false, accumulate: true }).accumulate, false);
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

test('dalle impostazioni alla proposta (engine.compute)', () => {
  const ds = load();
  const st = defaults(ds.refDate);
  st.goal = 'capital';
  const r = compute(ds, st);
  assert.equal(r.plan.mode, 'capital');
  assert.equal(r.plan.targets.length, 10, 'dieci anni di scadenze predefinite');
  assert.ok(r.map.length > 0, 'punti per la mappa dei rendimenti');
  const t = r.plan.targets.find(x => x.candidates.length > 1);
  const alt = t.candidates.find(c => c.bond.isin !== t.bond.isin);
  st.fixed = { [t.label]: alt.bond.isin };
  assert.equal(compute(ds, st).plan.targets.find(x => x.label === t.label).bond.isin, alt.bond.isin, 'scelta manuale per etichetta');
  st.fixed = {};
  st.capital.start = 'budget'; st.capital.budget = 50000;
  assert.ok(compute(ds, st).plan.totalCost <= 50000 + 1e-6);
  st.capital.accumulate = true; st.capital.yearFrom = 2032;
  const ra = compute(ds, st).plan;
  assert.ok(ra.accumulate && ra.totalCost <= 50000 + 1e-6 && ra.targets[0].fromPot > 0, 'opzione "accantona" dalle impostazioni');
  st.capital.accumulate = false;
  st.basket.excluded = ['GOV_IT'];
  assert.ok(!compute(ds, st).plan.positions.some(p => p.bond.issuer === 'GOV_IT'), 'emittente escluso');
  st.basket.excluded = [];
  st.goal = 'income'; st.income.start = 'target'; st.income.monthlyTarget = 150;
  const ri = compute(ds, st);
  assert.ok(ri.plan.minMonth >= 150, `rendita minima ${ri.plan.minMonth}`);
  const banned = ri.plan.positions[0].bond.isin;
  st.basket.excludedIsins = [banned];
  assert.ok(!compute(ds, st).plan.positions.some(p => p.bond.isin === banned), 'titolo escluso a mano');
});

// Facoltativo: STFI_CSV=/percorso/file.csv npm test → confronto sui dati reali
test('dati reali STFI (se disponibili)', { skip: !process.env.STFI_CSV }, () => {
  const ds = enrich(loadText(fs.readFileSync(process.env.STFI_CSV, 'utf8')));
  const eur = ds.bonds.filter(b => b.currency === 'EUR' && b.group !== 'corp' && !b.inflation && !b.stepUp && !b.anomaly && b.maturity > ds.settle + 60);
  const ok = eur.filter(b => Math.abs(netYield(b, ds.settle) - b.ytmNet) < 0.05).length;
  assert.ok(ok / eur.length > 0.97, `${ok}/${eur.length} rendimenti netti entro 0,05 punti`);
  assert.ok(parts(ds.refDate).y >= 2024);
});
