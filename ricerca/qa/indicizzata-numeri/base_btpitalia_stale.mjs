// BTP Italia 22/11/2028: se il regolamento (24/11/2026) cade dopo una cedola (22/11/2026) che il file d'inflazione
// non ha ancora fatto avanzare (aggiornato prima del 22/11), l'app usa la base vecchia. Confronto con la base giusta.
import fs from 'node:fs';
const R = '../../../';
const { loadText } = await import(R + 'src/data/stfi.js');
const { enrich } = await import(R + 'src/core/basket.js');
const { buildInstruments, growthFor } = await import(R + 'src/core/alm.js');
const { series } = await import(R + 'src/core/indice.js');
const { prepareInflation } = await import(R + 'src/engine-indexed.js');
const { day, iso } = await import(R + 'src/core/dates.js');
const { FISCO_DEFAULT } = await import(R + 'src/core/fisco-parametri.js');
const ds = enrich(loadText(fs.readFileSync(new URL(R + 'data/stfi-latest.csv', import.meta.url), 'utf8')));
const J = JSON.parse(fs.readFileSync(new URL(R + 'data/inflazione/inflazione.json', import.meta.url), 'utf8'));
const settle = day(2026, 11, 24);
const b = ds.bonds.find(x => x.isin === 'IT0005517195');
for (const [lab, base] of [['base app (non avanzata)', 101.30645], ['base giusta dopo la cedola del 22/11', 104.12]]) {
  const j = structuredClone(J); j.titoli.IT0005517195.irBase = base;
  const infl = prepareInflation(j);
  const sc = { id: 's', series: { HICP: series(infl.hicp, () => 0.02), FOI: series(infl.foi, () => 0.02) }, G: growthFor(() => 0.02, FISCO_DEFAULT) };
  const { items } = buildInstruments([b], { settle, f: FISCO_DEFAULT, scen: [sc], bases: infl.bases, btpItalia: infl.btpItalia });
  const it = items[0];
  console.log(lab, 'CI regolamento', it.ciSettle, 'costo/100', it.cost.toFixed(4), 'primi flussi', it.flows.s.slice(0, 2).map(f => `${iso(f.day)} ${f.kind} ${f.net.toFixed(4)}`).join(' | '));
}
