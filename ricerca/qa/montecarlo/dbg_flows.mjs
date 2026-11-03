// Flussi per tipo di un titolo con l'inflazione del percorso 0 (per spiegare le differenze di check_walk.py)
import fs from 'node:fs';
import { ds, infl, state, run } from './common.mjs';
import { series, rateFn } from '/home/user/bond-screener/src/core/indice.js';
import { buildInstruments, growthFor } from '/home/user/bond-screener/src/core/alm.js';
const d = JSON.parse(fs.readFileSync('out/base.json'));
const isin = process.argv[2] || 'IT0005482994';
const b = ds.bonds.find(x => x.isin === isin);
const P = d.detail['0']; const pi = Object.fromEntries(Object.entries(P.infl).map(([k, v]) => [k, v]));
const hicp = rateFn(pi), fns = { hicp, foi: hicp, estr: () => 0.02 };
const sc = { id: 'p', fns, series: { HICP: series(infl.hicp, hicp), FOI: series(infl.foi, hicp) }, G: growthFor(fns.estr, { bollo: 0.002, aliquotaEtf: 0.26 }) };
const f = (await run(state())).plan.cfg.fisco;
const { items } = buildInstruments([b], { settle: ds.settle, f, scen: [sc], bases: infl.bases, btpItalia: infl.btpItalia });
console.log(b.isin, b.desc, 'issue', b.issuePrice, 'price', b.price, 'base', infl.bases[isin]);
for (const x of items[0].flows.p.filter(x => x.day >= b.maturity - 400)) console.log(new Date(x.day * 864e5).toISOString().slice(0, 10), x.kind, x.net.toFixed(5));
