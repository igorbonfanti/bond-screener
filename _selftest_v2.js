/* Self-test v2: obiettivo cedole/yield (lessicografico), vincolo duration, cedola netta */
const fs = require('fs');
const dir = __dirname + '/js/';
let code = '';
['data.js', 'filters.js', 'ladder.js'].forEach(f => code += fs.readFileSync(dir + f, 'utf8') + '\n');
code += 'module.exports={BSData,BSFilters,BSLadder};';
const mod = { exports: {} };
new Function('module', 'exports', code)(mod, mod.exports);
const { BSLadder } = mod.exports;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗', m); } };

const mk = (o) => Object.assign({ _ratingScore: 21, _country: o.issuercode.split('_')[1] || 'XX', netytm: (o.grossytm || 0) * 0.9 }, o);

// 2 gradini, 2 candidati ciascuno: alta-cedola/basso-yield vs bassa-cedola/alto-yield
const bonds = [
  mk({ isincode: 'A', description: 'IT alta cedola', redemptiondate: new Date(2027, 4, 15), issuercode: 'GOV_IT', price: 102, grossytm: 2.0, grossduration: 1.0, currentcouponrate: 4 }),
  mk({ isincode: 'B', description: 'DE zero cedola', redemptiondate: new Date(2027, 4, 15), issuercode: 'GOV_DE', price: 95, grossytm: 3.0, grossduration: 1.05, currentcouponrate: 0 }),
  mk({ isincode: 'C', description: 'ES alta cedola', redemptiondate: new Date(2028, 4, 15), issuercode: 'GOV_ES', price: 103, grossytm: 2.2, grossduration: 1.9, currentcouponrate: 5 }),
  mk({ isincode: 'D', description: 'FR basso cedola', redemptiondate: new Date(2028, 4, 15), issuercode: 'GOV_FR', price: 90, grossytm: 3.5, grossduration: 2.0, currentcouponrate: 0.5 })
];
const base = { numeroStep: 2, intervalloMesi: 12, primaScadenza: '5/2027', maxBondPerEmittente: 1, maxBondPerPaese: 9, giorniTolleranza: 120, ratingMin: '', couponScale: 1 };
const isins = (r) => r.slots.map(s => s.bond ? s.bond.isincode : '-').join(',');

// Obiettivo YIELD -> sceglie B,D (alti yield)
const oy = BSLadder.buildOptimized(bonds, { ...base, objective: 'yield' });
ok(isins(oy) === 'B,D', `yield -> B,D (ottenuto ${isins(oy)})`);

// Obiettivo CEDOLE -> sceglie A,C (alte cedole)
const oc = BSLadder.buildOptimized(bonds, { ...base, objective: 'cedole' });
ok(isins(oc) === 'A,C', `cedole -> A,C (ottenuto ${isins(oc)})`);

// Vincolo duration media <= 1.5 in obiettivo yield: B+D (avg 1.525) infattibile -> A+D (avg 1.5)
const od = BSLadder.buildOptimized(bonds, { ...base, objective: 'yield', durationMax: 1.5 });
const mD = BSLadder.metrics(od.slots);
ok(mD.avgDuration <= 1.5 + 1e-9, `duration media <= 1.5 (ottenuto ${mD.avgDuration})`);
ok(isins(od) === 'A,D', `yield+durMax1.5 -> A,D (ottenuto ${isins(od)})`);

// Tie-break: stessa cedola/prezzo, yield diverso -> in modalità cedole vince yield più alto
const tie = [
  mk({ isincode: 'E', description: 'tie low yield', redemptiondate: new Date(2027, 4, 15), issuercode: 'GOV_AT', price: 100, grossytm: 2.5, grossduration: 1.0, currentcouponrate: 3 }),
  mk({ isincode: 'F', description: 'tie high yield', redemptiondate: new Date(2027, 4, 15), issuercode: 'GOV_NL', price: 100, grossytm: 2.8, grossduration: 1.0, currentcouponrate: 3 })
];
const ot = BSLadder.buildOptimized(tie, { ...base, numeroStep: 1, objective: 'cedole' });
ok(isins(ot) === 'F', `tie-break cedole -> F (yield più alto) (ottenuto ${isins(ot)})`);

// Aliquota: GOV 12,5%, corporate 26%
ok(BSLadder.taxRate({ issuercode: 'GOV_IT' }) === 0.125, 'aliquota GOV 12,5%');
ok(BSLadder.taxRate({ issuercode: 'SOV_EU' }) === 0.125, 'aliquota SOV 12,5%');
ok(BSLadder.taxRate({ issuercode: 'CORP_ACME' }) === 0.26, 'aliquota corporate 26%');

// Cedola netta in € su A,C con budget 20000 (10000/gradino)
const rep = BSLadder.couponReport(oc.slots, { budget: 20000, couponScale: 1 });
// A: 10000/102*100*4/100 = 392.16 lordo; C: 10000/103*100*5/100 = 485.44
const expGross = 10000 / 102 * 4 + 10000 / 103 * 5;
ok(Math.abs(rep.grossCoupon - expGross) < 0.01, `cedola lorda € (atteso ${expGross.toFixed(2)}, ottenuto ${rep.grossCoupon.toFixed(2)})`);
ok(Math.abs(rep.netCoupon - expGross * 0.875) < 0.01, `cedola netta = lorda*0.875 (ottenuto ${rep.netCoupon.toFixed(2)})`);
ok(Math.abs(rep.tax - expGross * 0.125) < 0.01, 'imposta = lorda*0.125');

console.log(`\nRisultato v2: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
