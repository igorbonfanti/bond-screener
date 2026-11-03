/* Ripiego quando HiGHS (WebAssembly) non si carica: legge il testo LP prodotto da lpText (formato CPLEX, solo le
   parti che usiamo) e lo risolve con javascript-lp-solver (src/core/lp.js, soluzione verificata sul modello).
   Espone la stessa interfaccia di HiGHS: solve(text) → { Status, Columns: { nome: { Primal } }, ObjectiveValue }.
   I programmi interi non si risolvono qui: si risponde «non risolto» e il piano arrotonda i lotti per eccesso. */
import { solveLP } from './lp.js';

/** «- 3.5 n1 + c0 + 2e-7 n4» → { n1: -3.5, c0: 1, n4: 2e-7 } (coefficiente 1 sottinteso). */
function parseRow(expr) {
  const out = {};
  let sign = 1, coef = null;
  for (const tok of expr.trim().split(/\s+/)) {
    if (!tok) continue;
    if (tok === '+' || tok === '-') { sign = tok === '-' ? -1 : 1; continue; }
    if (/^[0-9.]/.test(tok) || /^[+-][0-9.]/.test(tok)) { coef = Number(tok); continue; }
    out[tok] = (out[tok] || 0) + sign * (coef == null ? 1 : coef);
    sign = 1; coef = null;
  }
  return out;
}

export function parseLp(text) {
  const lines = text.split('\n');
  let sense = 'min', section = '', objective = {};
  const constraints = {}, variables = {}, ints = [];
  const add = (name, coefs) => { for (const [v, a] of Object.entries(coefs)) (variables[v] ||= {})[name] = a; };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(Minimize|Maximize)$/.test(line)) { sense = line === 'Maximize' ? 'max' : 'min'; section = 'obj'; continue; }
    if (/^(Subject To|Bounds|Generals|End)$/.test(line)) { section = line; continue; }
    if (section === 'obj') objective = parseRow(line.replace(/^obj:/, ''));
    else if (section === 'Subject To') {
      const m = line.match(/^(\w+):(.*?)(>=|<=|=)\s*(-?[0-9.eE+-]+)$/);
      if (!m) throw new Error(`riga LP non riconosciuta: ${line}`);
      const b = Number(m[4]);
      constraints[m[1]] = m[3] === '>=' ? { min: b } : m[3] === '<=' ? { max: b } : { equal: b };
      add(m[1], parseRow(m[2]));
    } else if (section === 'Bounds') {
      const m = line.match(/^(\w+)\s*(=|>=)\s*(-?[0-9.eE+-]+)$/);
      if (m && m[2] === '=') { constraints[`fix_${m[1]}`] = { equal: Number(m[3]) }; add(`fix_${m[1]}`, { [m[1]]: 1 }); }
    } else if (section === 'Generals') ints.push(...line.split(/\s+/));
  }
  for (const v of Object.keys(objective)) (variables[v] ||= {}).__obj = objective[v];
  return { sense, constraints, variables, ints };
}

export const fallbackSolver = {
  fallback: true,
  solve(text) {
    const m = parseLp(text);
    if (m.ints.length) return { Status: 'Not solved (no integer solver)' };
    const r = solveLP({ objective: '__obj', sense: m.sense, constraints: m.constraints, variables: m.variables });
    if (!r.feasible) return { Status: r.bad ? 'Not solved' : 'Infeasible' };
    const Columns = {};
    for (const [k, v] of Object.entries(r.x)) Columns[k] = { Primal: v };
    return { Status: 'Optimal', Columns, ObjectiveValue: r.value };
  }
};
