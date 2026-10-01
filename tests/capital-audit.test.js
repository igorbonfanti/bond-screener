/* Prove del motore «Capitale a scadenza» sui dati STFI reali (portafogli inventati): difetti trovati nell'audit di
   ottobre 2026 e proprietà su casi casuali. Il file cambia ogni giorno, quindi girano solo su richiesta:
   STFI_CSV=data/stfi-latest.csv npm test */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

if (!process.env.STFI_CSV) test('audit del motore sui dati reali', { skip: 'imposta STFI_CSV con un file STFI' }, () => {});
else await run();

async function run() {
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { loadText } = await import('../src/data/stfi.js');
const { enrich } = await import('../src/core/basket.js');
const { compute } = await import('../src/engine.js');
const { defaults } = await import('../src/state.js');
const { netYield } = await import('../src/core/bond.js');
const { RETAIL_BTP } = await import('../src/data/retail-btp.js');
const ds = enrich(loadText(fs.readFileSync(process.env.STFI_CSV, 'utf8')));
const base = (capital, extra = {}) => { const st = defaults(ds.refDate); st.goal = 'capital'; Object.assign(st.capital, capital); Object.assign(st, extra); return st; };
const dates = (list, flex = 6) => ({ schedule: 'dates', start: 'amounts', flexMonths: flex, rounding: 'up', dates: list });

test('step-up: i flussi dei BTP retail NUOVI danno il rendimento netto di STFI', () => {
  for (const b of ds.bonds.filter(x => RETAIL_BTP[x.isin] && !RETAIL_BTP[x.isin].inflation && RETAIL_BTP[x.isin].steps.length > 1 && x.maturity > ds.settle + 60))
    assert.ok(Math.abs(netYield(b, ds.settle) - b.ytmNet) < 0.03, `${b.isin} ${b.desc}: flussi ${netYield(b, ds.settle).toFixed(2)}% vs STFI ${b.ytmNet}%`);
});

test('date precise: due obiettivi nello stesso giorno sono coperti entrambi', () => {
  const p = compute(ds, base(dates([{ label: 'Retta', date: '2029-09-01', amount: 10000 }, { label: 'Affitto', date: '2029-09-01', amount: 5000 }]))).plan;
  const need = p.targets.reduce((s, t) => s + t.amount, 0), got = p.targets.reduce((s, t) => s + Math.min(t.available, t.amount), 0);
  assert.equal(need, 15000);
  assert.ok(got >= need - 0.5, `ricevuti ${got.toFixed(2)} su ${need}`);
});

test('limite emittente: una scadenza senza candidati non allarga il limite; mai «non compro» e poi compra', () => {
  const st = base(dates([{ label: 'Casa', date: '2027-05-14', amount: 60000 }, { label: 'Tesoretto', date: '2033-08-16', amount: 200000 }], 0),
    { holdings: [{ isin: 'IT0005633794', nominal: 40000, carico: 99 }] });
  st.basket.issuerCap = 1 / 3;
  const p = compute(ds, st).plan;
  for (const e of p.issuerOver || []) assert.ok(!p.positions.some(x => x.bond.issuer === e.issuer), `${e.name} segnalato oltre il limite ma comprato`);
  assert.ok(!p.positions.some(x => x.bond.issuer === 'GOV_IT'), 'Italia (oltre il limite nel posseduto) non deve ricevere acquisti con limite 1/3');
});

test('capitale con portafoglio: un titolo con lotto da 100.000 non blocca la scadenza (capitale avanzato)', () => {
  const holdings = [{ isin: 'IT0005466344', nominal: 21000, carico: 98.28 }, { isin: 'XS2765498717', nominal: 10000, carico: 97.79 }, { isin: 'EU000A1G6TV9', nominal: 7000, carico: 101.87 },
    { isin: 'IE00BMQ5JL65', nominal: 24000, carico: 82.88 }, { isin: 'PTOTEVOE0018', nominal: 25000, carico: 95.2 }, { isin: 'EU000A1Z99R5', nominal: 14000, carico: 103.06 },
    { isin: 'XS1843434876', nominal: 6000, carico: 94.81 }, { isin: 'IT0005672016', nominal: 1000, carico: 98.96 }, { isin: 'IT0005383309', nominal: 9000, carico: 92.9 },
    { isin: 'IT0005633794', nominal: 19000, carico: 99.2 }, { isin: 'DE000BU22080', nominal: 14000, carico: 99.91 }];
  const st = base({ schedule: 'yearly', start: 'budget', yearFrom: 2028, yearTo: 2029, budget: 35000, useCoupons: true, accumulate: false, rounding: 'nearest' }, { holdings, portfolioPref: 'mine' });
  st.basket.issuerCap = 1;
  const p = compute(ds, st).plan;
  assert.ok(p.totalCost > 30000, `investiti ${p.totalCost.toFixed(2)} su 35.000`);
  for (const t of p.targets) assert.ok(!(t.bond && !t.nominal && t.amount - t.available > 1000), `${t.label}: titolo ${t.bond && t.bond.isin} non comprato, mancano ${(t.amount - t.available).toFixed(0)}`);
});

test('«coperta dai tuoi titoli» solo se bastano i titoli posseduti (con la loro cassa)', () => {
  const holdings = [{ isin: 'PTOTEVOE0018', nominal: 23000, carico: 95.93 }, { isin: 'IE00BH3SQ895', nominal: 17000, carico: 94.84 }, { isin: 'XS2689948078', nominal: 15000, carico: 102.56 },
    { isin: 'IT0005433195', nominal: 26000, carico: 68.45 }, { isin: 'AT0000A1ZGE4', nominal: 2000, carico: 99.84 }, { isin: 'EU000A4EQY56', nominal: 8000, carico: 95.12 },
    { isin: 'XS2434393968', nominal: 28000, carico: 90.36 }, { isin: 'ES0000012M77', nominal: 26000, carico: 101.87 }];
  const st = base({ schedule: 'yearly', start: 'amounts', yearFrom: 2027, yearTo: 2031, amount: 25000, useCoupons: true, accumulate: true, rounding: 'up' }, { holdings, portfolioPref: 'mine' });
  st.basket.issuerCap = 1 / 3;
  const p = compute(ds, st).plan;
  const t29 = p.targets.find(t => t.label === '2029');
  // ai soli titoli posseduti mancano 459 €: li paga la cassa formata anche dalle cedole dei titoli nuovi
  assert.ok(!t29.coveredByHeld, '2029 non è pagata dai soli titoli posseduti');
});

test('cassa ferma: conta solo ciò che entra davvero in cassa (carry spento, niente accantonamento → zero)', () => {
  const holdings = [{ isin: 'IT0005415283', nominal: 10000, carico: 99 }, { isin: 'IT0005433690', nominal: 11000, carico: 96.5 }, { isin: 'ES0000012K53', nominal: 1000, carico: 92.4 },
    { isin: 'XS2010026214', nominal: 30000, carico: 102.61 }, { isin: 'ES0000012E69', nominal: 22000, carico: 87.19 }, { isin: 'XS2765498717', nominal: 9000, carico: 94.41 }, { isin: 'DE000BU2Z031', nominal: 12000, carico: 92.41 }];
  const st = base({ schedule: 'yearly', start: 'amounts', yearFrom: 2030, yearTo: 2035, amount: 32000, useCoupons: true, accumulate: false, rounding: 'up' }, { holdings, portfolioCarry: false, portfolioPref: 'yield' });
  st.basket.issuerCap = 0.25;
  const p = compute(ds, st).plan;
  assert.ok(p.idleEuroYears < 0.5, `cassa ferma ${p.idleEuroYears.toFixed(2)} €·anni senza nessun flusso in cassa`);
});

test('cassa ferma: le cedole accantonate dei titoli NUOVI contano dalla loro data (scala che parte nel 2031)', async () => {
  const P = await import('./helpers/capital-props.mjs');
  const st = base({ schedule: 'yearly', start: 'amounts', yearFrom: 2031, yearTo: 2033, amount: 30000, useCoupons: true, accumulate: true, rounding: 'up' },
    { holdings: [{ isin: 'IT0005633794', nominal: 5000, carico: 99 }], portfolioCarry: true });
  st.basket.issuerCap = 1;
  const p = compute(ds, st).plan;
  // ricostruzione indipendente: saldo dopo ogni scadenza + ogni flusso che entra in cassa dalla sua data alla fine del periodo che lo usa
  const V = P.check(st, p).filter(v => v.code === 'idleMeaning');
  assert.deepEqual(V, [], V.length ? V[0].msg : '');
});

test('arrotondamento ai lotti: un titolo posseduto in più non fa spendere di più (limite libero)', { todo: 'limite noto: l\'arrotondamento ai lotti con la cassa è euristico (anche con gli scambi di lotti)' }, () => {
  const h8 = [{ isin: 'EU000A4E0858', nominal: 17000, carico: 101.78 }, { isin: 'IT0005594491', nominal: 27000, carico: 97.73 }, { isin: 'DE0001141851', nominal: 8000, carico: 99.38 },
    { isin: 'XS2109812508', nominal: 11000, carico: 85.23 }, { isin: 'XS2308323661', nominal: 4000, carico: 72.64 }, { isin: 'XS1361554584', nominal: 7000, carico: 77.84 },
    { isin: 'PTOTEOOE0033', nominal: 14000, carico: 86.41 }, { isin: 'FI4000369467', nominal: 22000, carico: 93.75 }];
  const mk = h => { const st = base({ schedule: 'semester', start: 'amounts', yearFrom: 2027, yearTo: 2033, amount: 30000, useCoupons: true, accumulate: false, rounding: 'up' }, { holdings: h, portfolioPref: 'yield', portfolioCarry: true }); st.basket.issuerCap = 1; return compute(ds, st).plan; };
  const a = mk(h8), b = mk(h8.concat([{ isin: 'FI4000415153', nominal: 30000, carico: 72.33 }]));
  assert.ok(b.totalCost <= a.totalCost + 0.5, `con un titolo in più: ${a.totalCost.toFixed(2)} → ${b.totalCost.toFixed(2)}`);
});

test('importi con portafoglio: il lotto minimo si confronta col fabbisogno residuo (niente 100.000 per 18.600)', () => {
  const st = base({ schedule: 'yearly', start: 'amounts', yearFrom: 2029, yearTo: 2029, amount: 100000, useCoupons: true, accumulate: false, rounding: 'up' },
    { holdings: [{ isin: 'XS1843434876', nominal: 6000, carico: 95 }, { isin: 'IT0005543803', nominal: 75000, carico: 98 }], portfolioPref: 'mine', portfolioCarry: true });
  st.basket.issuerCap = 1;
  const p = compute(ds, st).plan;
  const t = p.targets[0];
  assert.ok(t.available - t.amount < 5000, `2029: disponibili ${t.available.toFixed(0)} per ${t.amount} (costo ${p.totalCost.toFixed(0)})`);
});

test('proprietà su 300 casi casuali: ogni euro spiegato, cassa mai negativa né usata prima di arrivare, copertura, capitale', async () => {
  const P = await import('./helpers/capital-props.mjs');
  P.setSeed(2024);
  for (let i = 0; i < 300; i++) {
    const st = P.randomSettings();
    const p = compute(ds, st).plan;
    const V = P.check(st, p).filter(v => ['accounting', 'timeTravel', 'potNeg', 'fromPot', 'available', 'carried', 'potLeft', 'coverage', 'budget', 'heldIn', 'redemption', 'coupons', 'silentShort'].includes(v.code));
    assert.deepEqual(V, [], `caso ${i}: ${JSON.stringify(V).slice(0, 300)}`);
  }
});
}
