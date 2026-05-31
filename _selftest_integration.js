/* Integrazione: CSV reale -> normalizzazione -> filtri -> ladder */
const fs = require('fs');
const dir = __dirname + '/js/';
let code = '';
['data.js', 'filters.js', 'ladder.js'].forEach(f => code += fs.readFileSync(dir + f, 'utf8') + '\n');
code += 'module.exports={BSData,BSFilters,BSLadder};';
const mod = { exports: {} };
new Function('module', 'exports', code)(mod, mod.exports);
const { BSData, BSFilters, BSLadder } = mod.exports;

// mini-parser CSV ';'
const raw = fs.readFileSync(__dirname + '/sample_bond.csv', 'utf8').trim().split(/\r?\n/);
const headers = raw[0].split(';');
const rows = raw.slice(1).map(line => {
  const v = line.split(';'); const o = {};
  headers.forEach((h, i) => o[h] = v[i]); return o;
});

const norm = BSData.normalizeRows(rows);
console.log(`Normalizzati: ${norm.bonds.length} bond · rif ${norm.referenceDate} · colonne ${norm.columns.length}`);
const b0 = norm.bonds[0];
console.log(`Esempio: ${b0.isincode} yield=${b0.grossytm} (num:${typeof b0.grossytm}) dur=${b0.grossduration} scad=${b0.redemptiondate instanceof Date ? b0.redemptiondate.toISOString().slice(0,10) : 'NO'} paese=${b0._country} rating=${b0.ratingsp}(${b0._ratingScore})`);

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗', m); } };
ok(typeof b0.grossytm === 'number' && b0.grossytm === 2.85, 'virgola->numero (2,85=2.85)');
ok(b0.redemptiondate instanceof Date, 'data parsata');
ok(b0._country === 'AT', 'paese da GOV_AT');

// preset: emittenti GOV_, EUR
const facets = BSFilters.facets(norm.bonds);
const govIssuers = facets.issuers.filter(i => /^GOV_/.test(i));
const { result } = BSFilters.apply(norm.bonds, { issuers: govIssuers, currencies: ['EUR'] });
console.log(`\nFiltro preset GOV/EUR: ${result.length} bond`);
ok(result.length === norm.bonds.length, 'tutti i bond sono GOV EUR');

const params = { numeroStep: 6, intervalloMesi: 12, primaScadenza: '5/2027', maxBondPerEmittente: 1, maxBondPerPaese: 99, giorniTolleranza: 120, ratingMin: 'BBB' };

const g = BSLadder.buildGreedy(result, params);
const gm = BSLadder.metrics(g.slots);
console.log(`\n--- LADDER GREEDY (yield medio ${gm.avgYield.toFixed(3)}%, dur media ${gm.avgDuration.toFixed(2)}) ---`);
g.slots.forEach(s => console.log(`  Step ${s.step} ${s.target.toISOString().slice(0,7)} -> ${s.bond ? `${s.bond.isincode} ${s.bond.description} (${s.bond.grossytm}% ${s.bond._country})` : 'VUOTO'}`));

const o = BSLadder.buildOptimized(result, params);
const om = BSLadder.metrics(o.slots);
console.log(`\n--- LADDER OTTIMIZZATO (yield medio ${om.avgYield.toFixed(3)}%, dur media ${om.avgDuration.toFixed(2)}) ---`);
o.slots.forEach(s => console.log(`  Step ${s.step} ${s.target.toISOString().slice(0,7)} -> ${s.bond ? `${s.bond.isincode} ${s.bond.description} (${s.bond.grossytm}% ${s.bond._country})` : 'VUOTO'}`));

ok(gm.count >= 5, 'greedy riempie >= 5 step');
ok(om.count >= gm.count, 'optimized riempie >= greedy');
ok(om.totalYield >= gm.totalYield - 1e-9, 'optimized totalYield >= greedy');
// invarianti vincoli
const allBonds = [...g.slots, ...o.slots].map(s => s.bond).filter(Boolean);
const isinDupO = new Set(o.slots.map(s => s.bond && s.bond.isincode).filter(Boolean));
ok(isinDupO.size === om.count, 'optimized nessun ISIN duplicato');
const issC = {}; o.slots.forEach(s => { if (s.bond) issC[s.bond.issuercode] = (issC[s.bond.issuercode] || 0) + 1; });
ok(Object.values(issC).every(v => v <= 1), 'optimized rispetta max 1/emittente');

/* --- v2: obiettivo cedole vs yield + vincolo duration su dati reali --- */
const oYield = BSLadder.buildOptimized(result, { ...params, objective: 'yield', couponScale: 1 });
const oCed = BSLadder.buildOptimized(result, { ...params, objective: 'cedole', couponScale: 1 });
const repC = BSLadder.couponReport(oCed.slots, { budget: 120000, couponScale: 1 });
const repY = BSLadder.couponReport(oYield.slots, { budget: 120000, couponScale: 1 });
console.log(`\nCedole nette annue (120k) — obiettivo CEDOLE: €${repC.netCoupon.toFixed(0)} · obiettivo YIELD: €${repY.netCoupon.toFixed(0)}`);
ok(repC.netCoupon >= repY.netCoupon - 1e-6, 'obiettivo cedole >= cedole nette dell\'obiettivo yield');

const oCap = BSLadder.buildOptimized(result, { ...params, objective: 'cedole', durationMax: 3, couponScale: 1 });
const mCap = BSLadder.metrics(oCap.slots);
console.log(`Con durationMax 3: duration media ${mCap.avgDuration.toFixed(2)}, step riempiti ${mCap.count}`);
ok(mCap.count === 0 || mCap.avgDuration <= 3 + 1e-6, 'vincolo duration media <= 3 rispettato');

console.log(`\n${fail ? 'FAIL ' + fail : 'TUTTO OK'}`);
process.exit(fail ? 1 : 0);
