// Tempi in Node: piano senza Monte Carlo e con Monte Carlo, per alcuni casi
import { state, run } from './common.mjs';
const cases = {
  base: {}, semest: { alm: { schedule: 'semester' } },
  heavy: { alm: { schedule: 'semester', yearTo: 2066, L0: 12000 }, mc: { total: 700000 } },
  maxhor: { alm: { mode: 'maxhorizon', budget: 400000, yearTo: 2070 }, mc: { total: 600000 } }
};
for (const [k, c] of Object.entries(cases)) {
  const t = []; for (const on of [false, true]) { const st = state({ alm: c.alm, mc: { ...(c.mc || {}), on } }); const t0 = performance.now(); const r = await run(st); t.push(performance.now() - t0); if (on) console.log(k, 'senza MC', t[0].toFixed(0), 'ms, con MC', t[1].toFixed(0), 'ms, MC', (t[1] - t[0]).toFixed(0), 'ms; orizzonte', r.plan.horizon, 'rate', r.mc && r.mc.dues ? r.mc.dues.length : r.mc && r.mc.error); }
}
