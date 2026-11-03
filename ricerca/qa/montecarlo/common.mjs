// Caricamento comune per le prove del Monte Carlo (dati reali, HiGHS come nei test).
import fs from 'node:fs';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const ROOT = '/home/user/bond-screener';
const { loadText } = await import(`${ROOT}/src/data/stfi.js`);
const { enrich } = await import(`${ROOT}/src/core/basket.js`);
const { defaults } = await import(`${ROOT}/src/state.js`);
const { computeIndexed, prepareInflation } = await import(`${ROOT}/src/engine-indexed.js`);
export const ds = enrich(loadText(fs.readFileSync(`${ROOT}/data/stfi-latest.csv`, 'utf8')));
export const infl = prepareInflation(JSON.parse(fs.readFileSync(`${ROOT}/data/inflazione/inflazione.json`, 'utf8')));
const m = await import(`${ROOT}/vendor/highs/highs.mjs`);
export const highs = await m.default({ wasmBinary: fs.readFileSync(`${ROOT}/vendor/highs/highs.wasm`) });
export { defaults, computeIndexed };
export function state(mod = {}) {
  const st = defaults(ds.refDate); st.goal = 'indexed';
  if (mod.alm) Object.assign(st.indexed.alm, mod.alm);
  if (mod.mc) Object.assign(st.indexed.mc, mod.mc);
  return st;
}
export const run = (st) => computeIndexed(ds, st, { highs, infl });
