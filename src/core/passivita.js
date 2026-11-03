/* Scenari d'inflazione e passività indicizzata (l'affitto).
   Uno scenario dà l'inflazione HICP area euro anno per anno; il FOI italiano è HICP + uno spread (basis, default 0
   nello scenario base); l'€STR segue l'inflazione: €STR_s = €STR_base + 0,5 × (π_s − π_base).
   L'affitto del primo anno L₀ cresce ogni anno con l'inflazione dell'anno appena chiuso più uno spread reale:
   L(Y) = L₀ × Π_{k = primo anno … Y−1} (1 + π_k + spread). La rata del periodo (12 o 6 mesi) è dovuta
   all'inizio del periodo: scelta prudenziale (il brief §3.1). */
import { day } from './dates.js';
import { rateFn } from './indice.js';

/** Scenari predefiniti (tassi decimali). 'base' è editabile anno per anno. */
export function defaultScenarios(base = { 2027: 0.026, 2028: 0.021, 2029: 0.023 }) {
  const ys = Object.keys(base).map(Number).sort((a, b) => a - b);
  const y0 = ys[0], tail = base[ys[ys.length - 1]];
  const shock = { [y0]: 0.08, [y0 + 1]: 0.08, [y0 + 2]: 0.07, [y0 + 3]: 0.06, [y0 + 4]: 0.05, [y0 + 5]: tail };
  return [
    { id: 'base', label: 'Base', rates: { ...base }, basis: 0 },
    { id: 'alto', label: 'Alto 3,5%', rates: { [y0]: 0.035 }, basis: 0 },
    { id: 'basso', label: 'Basso 1%', rates: { [y0]: 0.01 }, basis: 0 },
    { id: 'shock', label: 'Shock 8→5%', rates: shock, basis: 0 },
    { id: 'basis', label: 'FOI +0,5% su HICP', rates: { ...base }, basis: 0.005 }
  ];
}

/** Funzioni annue di uno scenario: hicp(y), foi(y), estr(y). */
export function scenarioFns(sc, estrBase, baseScenario) {
  const hicp = rateFn(sc.rates), b = rateFn(baseScenario.rates);
  return {
    hicp, foi: y => hicp(y) + (sc.basis || 0),
    estr: y => Math.max(0, estrBase + 0.5 * (hicp(y) - b(y)))
  };
}

/**
 * Date e importi dovuti: [{ day, year, half, amount }] per uno scenario.
 * cfg: { L0, yearFrom, yearTo, schedule: 'yearly'|'semester', realSpread, index: 'FOI'|'HICP', flat: importo fisso }
 */
export function liabilities(cfg, fns) {
  const { L0, yearFrom, yearTo, schedule = 'yearly', realSpread = 0.005 } = cfg;
  const index = cfg.index || cfg.liabIndex || 'FOI';     // nelle impostazioni si chiama liabIndex
  const pi = index === 'HICP' ? fns.hicp : fns.foi;
  const out = [];
  let L = L0;
  for (let y = yearFrom; y <= yearTo; y++) {
    if (y > yearFrom && !cfg.flat) L *= 1 + pi(y - 1) + realSpread;   // flat: importo fisso (per il confronto)
    if (schedule === 'semester') {
      out.push({ day: day(y, 1, 1), year: y, half: 1, amount: L / 2 });
      out.push({ day: day(y, 7, 1), year: y, half: 2, amount: L / 2 });
    } else out.push({ day: day(y, 1, 1), year: y, half: 0, amount: L });
  }
  return out;
}

/** Deflatore per gli «euro di oggi»: prezzi al giorno dn rispetto a today, con l'inflazione dell'indice scelto. */
export function deflator(fns, today, index = 'FOI') {
  const pi = index === 'HICP' ? fns.hicp : fns.foi;
  return dn => {
    let f = 1;
    for (let t = today; t < dn; ) {
      const y = new Date(t * 864e5).getUTCFullYear();
      const end = Math.min(dn, day(y + 1, 1, 1));
      f *= Math.pow(1 + pi(y), (end - t) / 365.25);
      t = end;
    }
    return f;
  };
}
