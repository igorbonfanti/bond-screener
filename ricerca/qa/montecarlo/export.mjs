// Esporta piano, risultato del Monte Carlo (modulo originale) e, dalla copia strumentata, i percorsi generati e gli
// ingressi di walk() per alcuni percorsi. Uso: node export.mjs <nome> '<json opzioni>'
//   opzioni: { alm:{...}, mc:{...}, keep:[indici percorsi da esportare in dettaglio], n }
import fs from 'node:fs';
import { ds, infl, state, run } from './common.mjs';
import { monteCarlo as mcOrig } from '/home/user/bond-screener/src/core/montecarlo.js';
import { monteCarlo as mcInstr, walk } from './mc_instr.mjs';
import { day } from '/home/user/bond-screener/src/core/dates.js';
import { xeonNet } from '/home/user/bond-screener/src/core/fisco-parametri.js';

const name = process.argv[2] || 'base';
const o = JSON.parse(process.argv[3] || '{}');
const st = state({ alm: o.alm, mc: { ...(o.mc || {}), on: true } });
const t0 = Date.now();
const res = await run(st);
const tAll = Date.now() - t0;
const plan = res.plan;
if (plan.empty) { console.log('piano vuoto', plan.notes); process.exit(1); }
const mc = st.indexed.mc;
const opts = { eqMu: mc.eqMu, eqSd: mc.eqSd, inflMean: mc.inflMean, inflSd: mc.inflSd, stress: mc.stress,
  extras: mc.extra && mc.extra.amount > 0 ? [mc.extra] : [], ...(o.n ? { n: o.n } : {}), ...(o.extraOpts || {}) };
const keep = new Set(o.keep || [0, 1, 2]);
const paths = [], detail = {}, allRes = [];
globalThis.__mcHook = {
  path: (i, p) => paths.push({ infl: p.infl, eq: p.eq }),
  inputs: (i, x) => {
    const a = walk(x.G, x.eq, x.flows, x.L, x.extras, x.defl, x.cash0, x.etf0, x.settle, x.years, x.p, x.f, x.disc),
      b = walk(x.G, x.eq, [], x.L, x.extras, x.defl, 0, mc.total, x.settle, x.years, x.p, x.f, x.disc);
    // valore dei titoli al regolamento con i flussi del percorso, scontati come fa il modello
    const bond0 = x.flows.reduce((s, q) => s + (q.day > x.settle ? q.net / Math.pow(1 + x.disc, (q.day - x.settle) / 365.25) : 0), 0);
    allRes.push({ mix: a, etf: b, bond0, inflMean: Object.values(x.infl).reduce((s, v) => s + v, 0) / Object.keys(x.infl).length });
    if (!keep.has(i)) return;
    const ys = Object.keys(x.infl).map(Number);
    detail[i] = { flows: x.flows, L: x.L, extras: x.extras.map(e => ({ ...e, defl: x.defl(e.day) })), eq: x.eq, infl: x.infl,
      res: walk(x.G, x.eq, x.flows, x.L, x.extras, x.defl, x.cash0, x.etf0, x.settle, x.years, x.p, x.f, x.disc),
      resEtf: walk(x.G, x.eq, [], x.L, x.extras, x.defl, 0, mc.total, x.settle, x.years, x.p, x.f, x.disc),
      total: mc.total, taxEq: x.p.taxEq,
      cash0: x.cash0, etf0: x.etf0, settle: x.settle, years: x.years, disc: x.disc, bollo: x.f.bollo, aliquotaEtf: x.f.aliquotaEtf,
      // €STR e rendimento netto XEON per anno ricavati dalla funzione G del modello (per confronto con la formula)
      gYear: Object.fromEntries(ys.map(y => [y, Math.log(x.G(day(y, 1, 1), day(y + 1, 1, 1))) / (day(y + 1, 1, 1) - day(y, 1, 1)) * 365.25])),
      deflYear: Object.fromEntries(x.years.map(y => [y, x.defl(day(y, 1, 1))])) };
  }
};
const t1 = Date.now();
const r2 = o.n || o.extraOpts ? mcOrig(ds, plan, infl, mc.total, opts) : res.mc;
const tOrig = Date.now() - t1;
const ri = mcInstr(ds, plan, infl, mc.total, opts);
const same = JSON.stringify(ri.mix) === JSON.stringify(r2.mix) && JSON.stringify(ri.allEtf) === JSON.stringify(r2.allEtf);
// flussi della scala nello scenario base del piano (per il confronto con i flussi del percorso)
const out = {
  name, tAllMs: tAll, tMcMs: tOrig, sameAsOriginal: same, settle: ds.settle, refDate: ds.refDate,
  estrBase: plan.cfg.estr, xeonBase: xeonNet(plan.cfg.estr, plan.cfg.fisco), inflBase: plan.cfg.inflBase, liabIndex: plan.cfg.liabIndex,
  cfg: { L0: plan.cfg.L0, yearFrom: plan.cfg.yearFrom, yearTo: plan.cfg.yearTo, schedule: plan.cfg.schedule, realSpread: plan.cfg.realSpread, mode: plan.cfg.mode, budget: plan.cfg.budget },
  plan: { totalCost: plan.totalCost, bondCost: plan.bondCost, cash0: plan.cash0, irr: plan.irr, lam: plan.lam, horizon: plan.horizon,
    positions: plan.positions.map(x => ({ isin: x.b.isin, desc: x.b.desc, issuePrice: x.b.issuePrice, coupon: x.b.coupon, maturity: x.b.maturity, nominal: x.nominal, infl: !!x.b.inflation, cost: x.cost })) },
  hicpLast: infl.meta.hicp.ultimo, foiLast: infl.meta.foi.ultimo,
  mc: r2, mcInstr: ri, allRes, paths: o.noPaths ? null : paths, detail
};
fs.writeFileSync(new URL(`./out/${name}.json`, import.meta.url), JSON.stringify(out));
console.log(name, 'tutto', tAll, 'ms; mc', tOrig, 'ms; uguale', same, 'costo', plan.totalCost.toFixed(0), 'cash0', plan.cash0.toFixed(0), 'irr', plan.irr,
  'pAll', r2.error || r2.mix.pAll, r2.error ? '' : r2.allEtf.pAll);
