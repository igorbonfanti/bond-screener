/* Self-test logica pura: data.js, filters.js, ladder.js (Node, nessun browser) */
const fs = require('fs');
const dir = __dirname + '/js/';
let code = '';
['data.js', 'filters.js', 'ladder.js'].forEach(f => code += fs.readFileSync(dir + f, 'utf8') + '\n');
code += 'module.exports={BSData,BSFilters,BSLadder};';
const mod = { exports: {} };
new Function('module', 'exports', code)(mod, mod.exports);
const { BSData, BSFilters, BSLadder } = mod.exports;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ FAIL:', m); } };

/* --- conversioni --- */
ok(BSData.toNum('3,45') === 3.45, 'toNum virgola');
ok(BSData.toNum('1.234,56') === 1234.56, 'toNum migliaia EU');
ok(BSData.toNum('98.7') === 98.7, 'toNum punto');
ok(isNaN(BSData.toNum('')), 'toNum vuoto');
const d = BSData.toDate('15/03/2027');
ok(d && d.getFullYear() === 2027 && d.getMonth() === 2 && d.getDate() === 15, 'toDate gg/mm/aaaa');
ok(BSData.countryFromIssuer('GOV_AT') === 'AT', 'countryFromIssuer');

/* --- bond sintetici --- */
const countries = ['AT', 'DE', 'FR', 'IT', 'ES', 'NL'];
let bonds = [], k = 0;
for (let step = 0; step < 6; step++) {
  const year = 2027 + step;
  for (let j = 0; j < countries.length; j++) {
    const c = countries[j];
    bonds.push({
      isincode: `XS${1000 + k}`, description: `BOND ${c} ${year}`,
      redemptiondate: new Date(year, 4, 15), referencedate: new Date(2026, 4, 30),
      issuercode: `GOV_${c}`, _country: c, currencycode: 'EUR',
      grossytm: 2 + j * 0.5 + step * 0.1, grossduration: 1 + step,
      currentcouponrate: 0.03, price: 95 + j, ratingsp: 'AAA', _ratingScore: 21, volumevalue: 3
    });
    k++;
  }
}

/* --- filtri --- */
const { result } = BSFilters.apply(bonds, { issuers: [], currencies: ['EUR'], yieldMin: '2.5' });
ok(result.every(b => b.grossytm >= 2.5), 'filtro yieldMin');
ok(result[0].grossytm >= result[result.length - 1].grossytm, 'ordinamento yield desc');

const params = { numeroStep: 6, intervalloMesi: 12, primaScadenza: '5/2027', maxBondPerEmittente: 1, maxBondPerPaese: 99, giorniTolleranza: 120, ratingMin: 'BBB+' };

/* --- target dates --- */
const tds = BSLadder.targetDates(params);
ok(tds.length === 6, 'targetDates count');
ok(tds[0].getFullYear() === 2027 && tds[0].getMonth() === 4, 'prima scadenza 5/2027');
ok(tds[5].getFullYear() === 2032, 'ultima scadenza 2032');

/* --- greedy --- */
const g = BSLadder.buildGreedy(bonds, params);
const gBonds = g.slots.map(s => s.bond).filter(Boolean);
ok(g.slots.length === 6, 'greedy 6 slot');
ok(gBonds.length === 6, 'greedy riempie tutti gli step');
const gIsins = new Set(gBonds.map(b => b.isincode));
ok(gIsins.size === gBonds.length, 'greedy nessun ISIN duplicato');
const gIssuer = {}; gBonds.forEach(b => gIssuer[b.issuercode] = (gIssuer[b.issuercode] || 0) + 1);
ok(Object.values(gIssuer).every(v => v <= 1), 'greedy rispetta max 1/emittente');
const gMetrics = BSLadder.metrics(g.slots);

/* --- ottimizzato --- */
const o = BSLadder.buildOptimized(bonds, params);
const oBonds = o.slots.map(s => s.bond).filter(Boolean);
ok(oBonds.length === 6, 'optimized riempie tutti gli step');
const oIssuer = {}; oBonds.forEach(b => oIssuer[b.issuercode] = (oIssuer[b.issuercode] || 0) + 1);
ok(Object.values(oIssuer).every(v => v <= 1), 'optimized rispetta max 1/emittente');
const oMetrics = BSLadder.metrics(o.slots);
ok(oMetrics.totalYield >= gMetrics.totalYield - 1e-9, `optimized (${oMetrics.totalYield.toFixed(3)}) >= greedy (${gMetrics.totalYield.toFixed(3)})`);

/* --- vincolo paese --- */
const p2 = { ...params, maxBondPerEmittente: 99, maxBondPerPaese: 1 };
const o2 = BSLadder.buildOptimized(bonds, p2);
const o2Bonds = o2.slots.map(s => s.bond).filter(Boolean);
const o2C = {}; o2Bonds.forEach(b => o2C[b._country] = (o2C[b._country] || 0) + 1);
ok(Object.values(o2C).every(v => v <= 1), 'optimized rispetta max 1/paese');

/* --- manuale --- */
const sels = g.perStep.map(s => s.bonds.length ? s.bonds[0].isincode : '');
const man = BSLadder.buildManual(sels, g.perStep);
ok(man.filter(s => s.bond).length === 6, 'manuale costruisce 6 slot');

/* --- esposizione --- */
const expo = BSLadder.exposure(g.slots);
ok(expo.byCountry.length > 0 && expo.byIssuer.length === 6, 'esposizione calcolata');

console.log(`\nRisultato: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
