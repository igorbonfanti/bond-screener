/* Piccolo involucro attorno a javascript-lp-solver (Unlicense, vendor/lp-solver.mjs). */
import solver from '../../vendor/lp-solver.mjs';

/**
 * Risolve un modello LP. variables: { nome: { vincolo: coeff, ... } }, constraints: { vincolo: {min,max,equal} }.
 * @returns {{feasible:boolean, value:number, x:Record<string,number>}}
 */
export function solveLP({ objective, sense = 'max', constraints, variables }) {
  const res = solver.Solve({ optimize: objective, opType: sense, constraints, variables });
  const x = {};
  for (const k of Object.keys(variables)) x[k] = Number.isFinite(res[k]) ? res[k] : 0;
  return { feasible: !!res.feasible, value: Number.isFinite(res.result) ? res.result : NaN, x };
}
