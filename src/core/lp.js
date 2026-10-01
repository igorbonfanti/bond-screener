/* Piccolo involucro attorno a javascript-lp-solver (Unlicense, vendor/lp-solver.mjs).
   Ogni soluzione si verifica sul modello (vincoli e variabili non negative, scarto relativo alla grandezza della
   riga, tolleranza 1e-5): javascript-lp-solver a volte dichiara «risolto» un punto fuori dai vincoli (un investimento
   negativo di 110.000 €, un mese 443 € sotto il minimo). In quel caso la soluzione non si usa: bad = true, feasible = false. */
import solver from '../../vendor/lp-solver.mjs';

/** Scarto massimo (relativo alla grandezza della riga) della soluzione x sul modello. */
export function checkSolution({ constraints, variables }, x) {
  const lhs = {}, mag = {};
  for (const k of Object.keys(constraints)) { lhs[k] = 0; mag[k] = 0; }
  let worst = 0;
  for (const [v, coefs] of Object.entries(variables)) {
    const xv = x[v] || 0;
    if (xv < 0) worst = Math.max(worst, -xv / (1 + Math.abs(xv)));
    for (const [k, a] of Object.entries(coefs)) if (k in lhs) { lhs[k] += a * xv; mag[k] += Math.abs(a * xv); }
  }
  for (const [k, b] of Object.entries(constraints)) {
    const s = 1 + mag[k] + Math.abs(b.min ?? b.max ?? b.equal ?? 0), v = lhs[k];
    if (b.equal != null) worst = Math.max(worst, Math.abs(v - b.equal) / s);
    if (b.min != null) worst = Math.max(worst, (b.min - v) / s);
    if (b.max != null) worst = Math.max(worst, (v - b.max) / s);
  }
  return worst;
}

/**
 * Risolve un modello LP. variables: { nome: { vincolo: coeff, ... } }, constraints: { vincolo: {min,max,equal} }.
 * @returns {{feasible:boolean, value:number, x:Record<string,number>, bad?:boolean}}
 */
export function solveLP({ objective, sense = 'max', constraints, variables }, tol = 1e-5) {
  const res = solver.Solve({ optimize: objective, opType: sense, constraints, variables });
  const x = {};
  for (const k of Object.keys(variables)) x[k] = Number.isFinite(res[k]) ? res[k] : 0;
  let out = { feasible: !!res.feasible, value: Number.isFinite(res.result) ? res.result : NaN, x };
  const err = out.feasible ? checkSolution({ constraints, variables }, x) : 0;
  if (err > tol) out = { feasible: false, value: NaN, x, bad: true };
  return out;
}
