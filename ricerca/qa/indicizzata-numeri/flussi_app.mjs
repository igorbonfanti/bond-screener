// Dump dei flussi prodotti da buildInstruments (app) in uno scenario d'inflazione costante del 2% (HICP e FOI).
import fs from 'node:fs';
const R = '../../../';
const { loadText } = await import(R + 'src/data/stfi.js');
const { enrich } = await import(R + 'src/core/basket.js');
const { buildInstruments, growthFor } = await import(R + 'src/core/alm.js');
const { series } = await import(R + 'src/core/indice.js');
const { prepareInflation } = await import(R + 'src/engine-indexed.js');
const { iso } = await import(R + 'src/core/dates.js');
const { FISCO_DEFAULT } = await import(R + 'src/core/fisco-parametri.js');
const ds = enrich(loadText(fs.readFileSync(new URL(R + 'data/stfi-latest.csv', import.meta.url), 'utf8')));
const infl = prepareInflation(JSON.parse(fs.readFileSync(new URL(R + 'data/inflazione/inflazione.json', import.meta.url), 'utf8')));
const isins = process.argv.slice(2).length ? process.argv.slice(2) : ['IT0005547812', 'IT0005532723', 'IT0005713547'];
const fisco = { ...FISCO_DEFAULT, ...(process.env.FISCO ? JSON.parse(process.env.FISCO) : {}) };
const pi = 0.02;
const sc = { id: 'c2', series: { HICP: series(infl.hicp, () => pi), FOI: series(infl.foi, () => pi) }, G: growthFor(() => 0.02, fisco) };
const ctx = { settle: ds.settle, f: fisco, scen: [sc], bases: infl.bases, btpItalia: infl.btpItalia };
const bonds = ds.bonds.filter(b => isins.includes(b.isin));
const { items, skipped } = buildInstruments(bonds, ctx);
const out = { settle: iso(ds.settle), items: items.map(it => ({ isin: it.b.isin, type: it.type, price: it.b.price, coupon: it.b.coupon, months: it.b.months, issuePrice: it.b.issuePrice, cost: it.cost, ciSettle: it.ciSettle,
  flows: it.flows.c2.map(f => ({ day: iso(f.day), kind: f.kind, net: f.net })) })), skipped: skipped.map(s => [s.b.isin, s.why]) };
console.log(JSON.stringify(out, null, 1));
