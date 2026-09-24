/* Test cedole mensili (€ + semestrale) — carica charts.js con mock di Chart/DOM */
const fs = require('fs');
let lastCfg = null;
global.Chart = function (ctx, cfg) { lastCfg = cfg; this.destroy = () => {}; }; // cattura la config
global.document = { getElementById: () => ({ getContext: () => ({}) }) };

let code = fs.readFileSync(__dirname + '/js/charts.js', 'utf8') + '\nmodule.exports={BSCharts};';
const mod = { exports: {} };
new Function('module', 'exports', 'Chart', 'document', code)(mod, mod.exports, global.Chart, global.document);
const { BSCharts } = mod.exports;

let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('  ✗', m); } };

const slots = [
  { bond: { isincode: 'IT1', description: 'BTP', _country: 'IT', price: 100, currentcouponrate: 2, redemptiondate: new Date(2027, 5, 15) } }, // giugno
  { bond: { isincode: 'DE1', description: 'BUND', _country: 'DE', price: 100, currentcouponrate: 1, redemptiondate: new Date(2027, 2, 15) } }  // marzo
];

// importo 20000, 2 gradini -> 10000/gradino
const r = BSCharts.monthlyCoupons('x', slots, { amount: 20000, freqMode: 'auto' });
const data = lastCfg.data.datasets[0].data;
console.log('Mesi (€):', data.map((v, i) => v ? ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'][i] + '=' + v : null).filter(Boolean).join('  '));
console.log('Totale annuo €:', r.annual, '· perRung €:', r.perRung, '· unit:', r.unit);

ok(r.unit === '€', 'unità euro');
ok(r.perRung === 10000, 'split equo 10000/gradino');
// IT semestrale: 10000*2/100=200 annui -> 100 a giugno (5) e 100 a dicembre (11)
ok(data[5] === 100, 'IT giugno 100€ (semestrale)');
ok(data[11] === 100, 'IT dicembre 100€ (+6 mesi)');
// DE annuale: 10000*1/100=100 a marzo (2)
ok(data[2] === 100, 'DE marzo 100€ (annuale)');
ok(Math.abs(r.annual - 300) < 1e-9, 'totale annuo 300€');

// modalità tutte annuali: IT diventa annuale -> 200 a giugno, niente a dicembre
BSCharts.monthlyCoupons('x', slots, { amount: 20000, freqMode: '1' });
const d2 = lastCfg.data.datasets[0].data;
ok(d2[5] === 200 && d2[11] === 0, 'freq forzata annuale: IT 200€ a giugno, 0 a dicembre');

// senza importo -> per 100 nominale
const r3 = BSCharts.monthlyCoupons('x', slots, { amount: 0, freqMode: 'auto' });
ok(r3.unit === 'per 100 nom.', 'senza importo: per 100 nominale');

console.log(fail ? `\nFAIL ${fail}` : '\nTUTTO OK');
process.exit(fail ? 1 : 0);
