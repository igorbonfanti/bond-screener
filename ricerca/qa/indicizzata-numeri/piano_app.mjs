// Esegue computeIndexed (come l'app) con le impostazioni predefinite + override JSON (argv[2]) e salva il piano,
// i flussi delle posizioni per scenario e le liabilities in piano_<tag>.json. Uso: node piano_app.mjs '{"mode":"mincost"}' tag
import fs from 'node:fs';
const R = '../../../';
const { loadText } = await import(R + 'src/data/stfi.js');
const { enrich } = await import(R + 'src/core/basket.js');
const { prepareInflation, computeIndexed } = await import(R + 'src/engine-indexed.js');
const { defaults } = await import(R + 'src/state.js');
const { iso } = await import(R + 'src/core/dates.js');
const { context, withDefaults } = await import(R + 'src/core/alm-plan.js');
const { buildInstruments, prepare } = await import(R + 'src/core/alm.js');
const ds = enrich(loadText(fs.readFileSync(new URL(R + 'data/stfi-latest.csv', import.meta.url), 'utf8')));
const infl = prepareInflation(JSON.parse(fs.readFileSync(new URL(R + 'data/inflazione/inflazione.json', import.meta.url), 'utf8')));
const highs = await (await import(R + 'vendor/highs/highs.mjs')).default({ wasmBinary: fs.readFileSync(new URL(R + 'vendor/highs/highs.wasm', import.meta.url)) });
const over = JSON.parse(process.argv[2] || '{}'), tag = process.argv[3] || 'base';
const st = defaults(ds.refDate);
st.indexed.alm = { ...st.indexed.alm, ...(over.alm || {}) };
st.indexed.basket = { ...st.indexed.basket, ...(over.basket || {}) };
const t0 = Date.now();
let out;
try { out = await computeIndexed(ds, st, { highs, infl }); } catch (e) { console.log(JSON.stringify({ tag, crash: String(e && e.stack || e) })); process.exit(0); }
const secs = (Date.now() - t0) / 1000;
const p = out.plan;
const res = { tag, secs, empty: !!p.empty, warnings: p.warnings || null, basketCount: out.basketCount, settle: iso(ds.settle) };
if (!p.empty) {
  const cfg = withDefaults({ ...st.indexed.alm, estr: st.indexed.alm.estr ?? infl.estr });
  Object.assign(res, { mode: p.cfg.mode, horizon: p.horizon, lam: p.lam, bondCost: p.bondCost, cash0: p.cash0, totalCost: p.totalCost, relaxedCost: p.relaxedCost,
    linkerShare: p.linkerShare, notes: p.notes, budget: p.cfg.budget, estr: p.cfg.estr, cfg: { ...p.cfg, fisco: undefined },
    positions: p.positions.map(x => ({ isin: x.b.isin, desc: x.b.desc, type: x.type, lot: x.b.lot, lots: x.lots, nominal: x.nominal, cost: x.cost, costPer100: x.cost / x.nominal * 100, issuer: x.b.issuer, maturity: iso(x.b.maturity) })),
    sims: Object.fromEntries(Object.entries(p.sims).map(([k, v]) => [k, { bal: v.bal, first: v.first ? iso(v.first.day) : null, deficit: v.deficit }])),
    byScen: Object.fromEntries(Object.entries(p.byScen).map(([k, rows]) => [k, rows.map(r => ({ ...r, due: iso(r.due) }))])),
    scen: p.scen, flat: out.flat ? { perYear: out.flat.perYear, cost: out.flat.cost } : null, cash: out.cash });
  // flussi delle posizioni (ricostruiti con buildInstruments dell'app) per la simulazione indipendente
  const c = { ...cfg, yearTo: p.horizon };
  const { ctx } = context(ds, c, infl);
  const { items } = buildInstruments(p.positions.map(x => x.b), ctx);
  res.flows = Object.fromEntries(items.map(it => [it.b.isin, Object.fromEntries(Object.entries(it.flows).map(([s, f]) => [s, f.map(x => [iso(x.day), x.kind, x.net])]))]));
}
fs.writeFileSync(`piano_${tag}.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ tag, secs, empty: res.empty, warnings: res.warnings, mode: res.mode, horizon: res.horizon, lam: res.lam, totalCost: res.totalCost, budget: res.budget, cash0: res.cash0, relaxedCost: res.relaxedCost, linkerShare: res.linkerShare, npos: res.positions && res.positions.length, notes: res.notes, firsts: res.sims && Object.fromEntries(Object.entries(res.sims).map(([k, v]) => [k, v.first])) }));
