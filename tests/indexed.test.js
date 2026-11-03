/* Test della modalità «Affitto indicizzato» (passività indicizzata). Solo titoli sintetici (ISIN XS…) e, per la
   formula del CI, valori pubblici MEF/Eurostat. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { day } from '../src/core/dates.js';
import { loadText } from '../src/data/stfi.js';
import { enrich, applyBasket } from '../src/core/basket.js';
import { series, indexRatio, t6r5 } from '../src/core/indice.js';
import { FISCO_DEFAULT, xeonNet } from '../src/core/fisco-parametri.js';
import { btpEiFlows, linkerType } from '../src/core/alm.js';
import { btpItaliaFlows } from '../src/core/btp-italia.js';
import { liabilities, defaultScenarios, scenarioFns } from '../src/core/passivita.js';
import { planIndexed } from '../src/core/alm-plan.js';
import { prepareInflation } from '../src/engine-indexed.js';

const FIX = fs.readFileSync(new URL('./fixtures/stfi-synthetic.csv', import.meta.url), 'utf8');
// due BTP€i sintetici in più (prezzi reali, «senza indicizzazione» come nel file STFI)
const EXTRA = [
  'XS0000000091;BTPi 15/05/2029 1,5%(senza indicizzazione);15/05/2029;EUR;GOV_IT;Italia;BBB+;Baa2;;1000;Senior;24/09/2026;LP;99,8;250000;2;1,6;2,5;1,4;1,4;2,5;;;0,015;2;5,11;0,015;99,7;',
  'XS0000000092;BTPi 15/05/2033 0,1%(senza indicizzazione);15/05/2033;EUR;GOV_IT;Italia;BBB+;Baa2;;1000;Senior;24/09/2026;LP;88,5;250000;2;1,9;6,5;1,7;1,7;6,5;;;0,001;2;5,11;0,001;99,5;'
];
const load = () => enrich(loadText(FIX.trimEnd() + '\n' + EXTRA.join('\n') + '\n'));

// HICP sintetico in base 2025 = 100, +0,2% al mese da gen 2025 a ago 2026; FOI uguale
const months = {};
for (let y = 2025, v = 99; y <= 2026; y++) for (let m = 1; m <= 12; m++) { if (y === 2026 && m > 8) break; months[`${y}-${String(m).padStart(2, '0')}`] = +v.toFixed(2); v *= 1.002; }
const INFL = prepareInflation({
  aggiornato: '2026-09-24', hicp: { valori: months }, foi: { valori: months }, estr: { valore: 0.02, data: '2026-09-23' },
  titoli: {
    XS0000000091: { tipo: 'BTPEI', indice: 'HICP', irBase: 95, freq: 2, mesiCedola: [5, 11], cedolaReale: 1.5 },
    XS0000000092: { tipo: 'BTPEI', indice: 'HICP', irBase: 85, freq: 2, mesiCedola: [5, 11], cedolaReale: 0.1 },
    XS0000000040: { tipo: 'BTPITALIA', indice: 'FOI', irBase: 99.5, freq: 2, mesiCedola: [5, 11], cedolaReale: 1.6 }
  }
});

let highsP = null;
const solver = () => highsP || (highsP = import('../vendor/highs/highs.mjs').then(m => m.default({ wasmBinary: fs.readFileSync(new URL('../vendor/highs/highs.wasm', import.meta.url)) })));

test('CI: formula MEF (lag 3 mesi, interpolazione, troncamento 6ª e arrotondamento 5ª) sui valori pubblici', () => {
  // HICP ex tabacco area euro, prime pubblicazioni, base 2025=100 (Eurostat): ago e set 2026
  const s = series({ '2026-08': 103.66, '2026-09': 104.29 }, () => 0.02);
  // BTP€i 15/02/2037 (IT0005725160): IR al godimento 103,09484, CI MEF all'1/11/2026 = 1,00548
  assert.equal(indexRatio(s, day(2026, 11, 1), 103.09484), 1.00548);
  // BTP€i 15/09/2035 (IT0003745541): IR base 65,42310, CI MEF 1,58446
  assert.equal(indexRatio(s, day(2026, 11, 1), 65.4231), 1.58446);
  assert.equal(t6r5(1.0000049999), 1, 'troncamento prima dell\'arrotondamento');
});

test('BTP€i: test fiscale (prezzo reale 95, CI 1,10, rimborso con CI 1,30)', () => {
  const b = { isin: 'XS9', maturity: day(2030, 5, 15), coupon: 1, freq: 2, months: [5, 11], price: 95, issuePrice: 100, lot: 1000 };
  const settle = day(2026, 9, 28);
  const ci = d => (d <= settle ? 1.10 : d >= b.maturity ? 1.30 : 1.10 + 0.2 * (d - settle) / (b.maturity - settle));
  const at = (f, k) => btpEiFlows(b, settle, ci, 1.10, f).filter(x => x.kind === k);
  // a scadenza, base «acquisto»: 130 − 0,125 × (130 − 95 × 1,10) = 130 − 0,125 × 25,5
  const acq = { ...FISCO_DEFAULT, rivalutazioneBtpEi: 'scadenza', baseImponibileBtpEi: 'acquisto' };
  assert.ok(Math.abs(at(acq, 'redemption')[0].net - (130 - 0.125 * 25.5)) < 1e-9);
  // base «emissione» (default prudente): imposta su 130 − 100
  const em = { ...FISCO_DEFAULT, rivalutazioneBtpEi: 'scadenza' };
  assert.ok(Math.abs(at(em, 'redemption')[0].net - (130 - 0.125 * 30)) < 1e-9);
  // «ogni anno»: stesse imposte in totale, ma una parte pagata ogni 31/12
  const yr = { ...acq, rivalutazioneBtpEi: 'annuale' };
  const taxes = at(yr, 'tassa').reduce((s, x) => s - x.net, 0);
  assert.ok(taxes > 0);
  assert.ok(Math.abs(at(yr, 'redemption')[0].net - taxes - at(acq, 'redemption')[0].net) < 1e-9);
  // cedola: reale/2 × CI, tassata al 12,5%; nessun floor sulle cedole
  const cp = at(em, 'coupon')[0];
  assert.ok(Math.abs(cp.net - 0.5 * ci(cp.day) * 0.875) < 1e-9);
  // floor del capitale: con CI < 1 a scadenza si rimborsa 100
  const low = btpEiFlows(b, settle, () => 0.95, 0.95, acq).find(x => x.kind === 'redemption');
  assert.ok(Math.abs(low.net - (100 - 0.125 * (100 - 95 * 0.95))) < 1e-9, 'rimborso 100, imposta sul guadagno rispetto al prezzo pagato');
});

test('BTP Italia: rivalutazione semestrale con la regola del massimo; Italia Sì senza massimo', () => {
  const b = { isin: 'XS8', maturity: day(2028, 5, 15), coupon: 2, freq: 2, months: [5, 11], price: 100, lot: 1000 };
  const settle = day(2026, 9, 28);
  // NI alle cedole: 102 (nov 26), 101 (mag 27, deflazione), 103 (nov 27), 104 (mag 28); base iniziale 100
  const ni = { [day(2026, 11, 15)]: 102, [day(2027, 5, 15)]: 101, [day(2027, 11, 15)]: 103, [day(2028, 5, 15)]: 104 };
  const ci = d => (ni[d] ?? 100) / 100;
  const f = FISCO_DEFAULT;
  const riv = btpItaliaFlows(b, settle, ci, 1, f, { irBase: 100 }).filter(x => x.kind === 'rivalutazione').map(x => +(x.net / 0.875).toFixed(6));
  // 2% · niente (deflazione) · 103/102 − 1 · 104/103 − 1: si riparte sopra il massimo (102), senza recupero
  const r5 = x => t6r5(x);   // CI del semestre troncato alla 6ª e arrotondato alla 5ª
  assert.deepEqual(riv, [2, +(100 * (r5(103 / 102) - 1)).toFixed(6), +(100 * (r5(104 / 103) - 1)).toFixed(6)]);
  const si = btpItaliaFlows(b, settle, ci, 1, f, { irBase: 100, sottotipo: 'BTP_ITALIA_SI' }).filter(x => x.kind === 'coupon').map(x => +(x.net / 0.875).toFixed(6));
  // cedola fissa 1 + inflazione del semestre dalla cedola precedente (dopo la deflazione la risalita si paga tutta)
  assert.deepEqual(si, [3, 1, +(1 + 100 * (r5(103 / 101) - 1)).toFixed(6), +(1 + 100 * (r5(104 / 103) - 1)).toFixed(6)]);
});

test('affitto: cresce con l\'inflazione dell\'anno prima più lo spread, rata a inizio periodo', () => {
  const sc = defaultScenarios({ 2027: 0.02, 2028: 0.03 });
  const fns = scenarioFns(sc[0], 0.02, sc[0]);
  const L = liabilities({ L0: 12000, yearFrom: 2027, yearTo: 2029, realSpread: 0.005, index: 'HICP' }, fns);
  assert.deepEqual(L.map(l => +l.amount.toFixed(2)), [12000, +(12000 * 1.025).toFixed(2), +(12000 * 1.025 * 1.035).toFixed(2)]);
  assert.equal(L[1].day, day(2028, 1, 1));
  const S = liabilities({ L0: 12000, yearFrom: 2027, yearTo: 2027, schedule: 'semester', index: 'HICP' }, fns);
  assert.deepEqual(S.map(l => [l.day, l.amount]), [[day(2027, 1, 1), 6000], [day(2027, 7, 1), 6000]]);
});

test('XEON: rendimento netto (€STR + 0,085% − 0,10%) × 74% − bollo', () => {
  assert.ok(Math.abs(xeonNet(0.024) - ((0.024 + 0.00085 - 0.001) * 0.74 - 0.002)) < 1e-12);
});

const CFG = { L0: 10000, yearFrom: 2027, yearTo: 2031, schedule: 'yearly', realSpread: 0.005, liabIndex: 'HICP',
  inflBase: { 2027: 0.02 }, estr: 0.02, scenarios: ['base', 'alto', 'basso', 'shock', 'basis'], robust: ['base'] };

test('ottimizzatore: copre ogni rata negli scenari «da coprire», lotti interi, vincoli rispettati', async () => {
  const ds = load(), highs = await solver();
  const { bonds } = applyBasket(ds, { maxPrice: null, includeInflation: true });
  assert.equal(linkerType(bonds.find(b => b.isin === 'XS0000000091')), 'BTPEI');
  const p = planIndexed(ds, bonds, CFG, INFL, highs);
  assert.ok(!p.empty, (p.warnings || []).join());
  for (const s of p.scen.filter(s => s.robust)) assert.equal(p.sims[s.id].first, null, `scenario ${s.id} coperto`);
  for (const x of p.positions) assert.ok(Math.abs(x.nominal / x.b.lot - Math.round(x.nominal / x.b.lot)) < 1e-6, `${x.b.isin}: multiplo del lotto`);
  // il saldo dopo ogni rata non scende sotto zero nello scenario base
  assert.ok(p.byScen.base.every(r => r.bal > -0.5));

  // quota minima di indicizzati e tetto per titolo
  const q = planIndexed(ds, bonds, { ...CFG, minLinker: 0.5, titleCap: 0.4 }, INFL, highs);
  assert.ok(!q.empty, (q.warnings || []).join());
  assert.ok(q.linkerShare >= 0.5 - 0.02, `quota indicizzata ${q.linkerShare}`);
  for (const x of q.positions) assert.ok(x.cost <= 0.4 * q.bondCost + x.b.lot * 1.5, `${x.b.isin} sotto il tetto (a meno di un lotto)`);

  // più scenari da coprire non possono costare meno
  const r = planIndexed(ds, bonds, { ...CFG, robust: ['base', 'alto', 'shock'] }, INFL, highs);
  assert.ok(!r.empty);
  assert.ok(r.relaxedCost >= p.relaxedCost - 0.01, `robusto ${r.relaxedCost} ≥ base ${p.relaxedCost}`);
  for (const s of ['alto', 'shock']) assert.equal(r.sims[s].first, null);
});

test('ottimizzatore: con un capitale dato, l\'affitto più alto e l\'anno più lontano', async () => {
  const ds = load(), highs = await solver();
  const { bonds } = applyBasket(ds, { maxPrice: null, includeInflation: true });
  const base = planIndexed(ds, bonds, CFG, INFL, highs);
  const budget = Math.round(base.totalCost * 0.8);
  const s = planIndexed(ds, bonds, { ...CFG, mode: 'maxscale', budget }, INFL, highs);
  assert.ok(!s.empty && s.lam < 1 && s.lam > 0.6, `λ = ${s.lam}`);
  assert.ok(s.totalCost <= budget + 1, `costo ${s.totalCost} entro ${budget}`);
  const hz = planIndexed(ds, bonds, { ...CFG, mode: 'maxhorizon', budget }, INFL, highs);
  assert.ok(!hz.empty && hz.horizon < CFG.yearTo && hz.horizon >= CFG.yearFrom, `orizzonte ${hz.horizon}`);
});

test('solver di riserva (javascript-lp-solver): stesso ottimo «a pezzi» di HiGHS', async () => {
  const { fallbackSolver } = await import('../src/core/lp-fallback.js');
  const ds = load(), highs = await solver();
  const { bonds } = applyBasket(ds, { maxPrice: null, includeInflation: true });
  const a = planIndexed(ds, bonds, CFG, INFL, highs), b = planIndexed(ds, bonds, CFG, INFL, fallbackSolver);
  assert.ok(!b.empty);
  assert.ok(Math.abs(a.relaxedCost - b.relaxedCost) < 0.01 * a.relaxedCost, `${a.relaxedCost} vs ${b.relaxedCost}`);
  assert.equal(b.sims.base.first, null, 'anche con i lotti per eccesso lo scenario base è coperto');
});

test('Monte Carlo: stesso seme stessi risultati; più capitale non peggiora; il crollo di borsa pesa sul patrimonio', async () => {
  const { monteCarlo } = await import('../src/core/montecarlo.js');
  const ds = load(), highs = await solver();
  const { bonds } = applyBasket(ds, { maxPrice: null, includeInflation: true });
  const plan = planIndexed(ds, bonds, CFG, INFL, highs);
  const total = plan.totalCost * 1.3;
  const a = monteCarlo(ds, plan, INFL, total, { n: 200 }), b = monteCarlo(ds, plan, INFL, total, { n: 200 });
  assert.deepEqual(a.mix.paidTo, b.mix.paidTo);
  assert.deepEqual(a.mix.wealth, b.mix.wealth);
  assert.ok(Math.abs(a.etf0 - plan.totalCost * 0.3) < 1e-6);
  const more = monteCarlo(ds, plan, INFL, total * 1.5, { n: 200 });
  assert.ok(more.mix.pAll >= a.mix.pAll && more.allEtf.pAll >= a.allEtf.pAll);
  const crash = monteCarlo(ds, plan, INFL, total, { n: 200, stress: 'crollo' });
  assert.ok(crash.mix.wealth[3].p50 < a.mix.wealth[3].p50);
  // la scala copre lo scenario base: senza ETF e senza oscillazioni d'inflazione attorno alla base l'affitto è pagato
  const det = monteCarlo(ds, plan, INFL, plan.totalCost, { n: 5, inflSd: 0, inflMean: 0.02, infl0: 0.02, eqSd: 0 });
  assert.equal(det.mix.pAll, 1);
  assert.equal(monteCarlo(ds, plan, INFL, plan.totalCost - 1000).error != null, true, 'capitale minore della scala: errore');
});
