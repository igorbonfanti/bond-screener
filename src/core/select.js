/* Scelta di un titolo per gradino (branch & bound).
   Ordine lessicografico degli obiettivi: 1) numero di gradini coperti, 2) Σ peso × punteggio.
   Così non si lascia mai vuoto un gradino che si potrebbe coprire (difetto della v2).
   Vincoli: ISIN unici, peso per emittente ≤ issuerCap × peso totale. */

import { MinCostFlow } from './flow.js';

const EPS = 1e-12;

/**
 * @param {Array<{weight:number, cands:Array<{bond:object, score:number}>}>} slots
 * @returns {{choice:Array<{bond,score}|null>, exact:boolean, nodes:number}}
 */
export function selectPerSlot(slots, opts = {}) {
  const w0 = slots.length ? slots[0].weight : 0;
  const equal = slots.every(s => Math.abs(s.weight - w0) <= 1e-9 * Math.max(1, w0)) &&
    [...(opts.preIssuerWeights || new Map()).values()].every(v => Math.abs(v / w0 - Math.round(v / w0)) < 1e-9);
  if (equal && slots.length) {
    const r = assignByFlow(slots, opts);
    if (r) return r;
  }
  return branchAndBound(slots, opts);
}

/** Pesi uguali: assegnazione esatta con flusso a costo minimo (limite per emittente = numero di gradini). */
export function assignByFlow(slots, { issuerCap = 1, totalWeight = null, preUsedIsins = [], preIssuerWeights = new Map() } = {}) {
  const N = slots.length, w = slots[0].weight;
  const totalSlots = Math.round((totalWeight ?? N * w) / w);
  const used = new Set(preUsedIsins);
  const best = slots.map(s => {                       // miglior titolo di ogni emittente nel gradino
    const m = new Map();
    for (const c of s.cands) {
      if (used.has(c.bond.isin)) continue;
      const cur = m.get(c.bond.issuer);
      if (!cur || c.score > cur.score) m.set(c.bond.issuer, c);
    }
    return m;
  });
  const issuers = [...new Set(best.flatMap(m => [...m.keys()]))];
  const K = issuers.length, S = 0, T = N + K + 1;
  const mcf = new MinCostFlow(N + K + 2);
  const BIG = 1e6;
  const edges = [];
  for (let t = 0; t < N; t++) {
    mcf.addEdge(S, 1 + t, 1, 0);
    for (const [iss, c] of best[t]) edges.push({ t, c, e: mcf.addEdge(1 + t, 1 + N + issuers.indexOf(iss), 1, -(BIG + c.score)) });
  }
  issuers.forEach((iss, k) => {
    const pre = Math.round((preIssuerWeights.get(iss) || 0) / w);
    // almeno un gradino per emittente, anche se il limite in % è più stretto di un gradino
    const cap = issuerCap >= 1 ? N : Math.max(0, Math.max(1, Math.floor(issuerCap * totalSlots + 1e-9)) - pre);
    if (cap > 0) mcf.addEdge(1 + N + k, T, cap, 0);
  });
  mcf.run(S, T);
  const choice = new Array(N).fill(null);
  for (const { t, c, e } of edges) if (e.cap === 0) choice[t] = c;
  const isins = choice.filter(Boolean).map(c => c.bond.isin);
  if (new Set(isins).size !== isins.length) return null;     // finestre sovrapposte: serve il branch & bound
  return { choice, exact: true, nodes: 0 };
}

export function branchAndBound(slots, { issuerCap = 1, nodeBudget = 300000, perIssuer = 3, maxCand = 36,
  totalWeight = null, preUsedIsins = [], preIssuerWeights = new Map() } = {}) {
  const N = slots.length;
  const W = totalWeight ?? slots.reduce((s, x) => s + x.weight, 0);
  const maxW = slots.reduce((m, x) => Math.max(m, x.weight), 0);
  const capW = issuerCap >= 1 ? Infinity : Math.max(issuerCap * W, maxW) * (1 + 1e-9);

  // Candidati: i migliori per emittente (dominanza), in ordine di punteggio
  const C = slots.map(s => {
    const byIss = new Map(), kept = [];
    for (const c of [...s.cands].sort((a, b) => b.score - a.score)) {
      const n = byIss.get(c.bond.issuer) || 0;
      if (n < perIssuer) { byIss.set(c.bond.issuer, n + 1); kept.push(c); }
    }
    return kept.slice(0, maxCand);
  });

  // Prima i gradini con meno alternative (potano di più), a parità quelli più pesanti
  const order = C.map((_, i) => i).sort((a, b) => C[a].length - C[b].length || slots[b].weight - slots[a].weight);
  const sufFill = new Array(N + 1).fill(0), sufVal = new Array(N + 1).fill(0);
  for (let k = N - 1; k >= 0; k--) {
    const i = order[k];
    sufFill[k] = sufFill[k + 1] + (C[i].length ? 1 : 0);
    sufVal[k] = sufVal[k + 1] + (C[i].length ? Math.max(0, slots[i].weight * C[i][0].score) : 0);
  }

  const used = new Set(preUsedIsins), issW = new Map(preIssuerWeights), cur = new Array(N).fill(null);
  const fits = (b, w) => !used.has(b.isin) && (issW.get(b.issuer) || 0) + w <= capW;
  const take = (k, c, w) => { used.add(c.bond.isin); issW.set(c.bond.issuer, (issW.get(c.bond.issuer) || 0) + w); cur[k] = c; };
  const drop = (k, c, w) => { used.delete(c.bond.isin); issW.set(c.bond.issuer, issW.get(c.bond.issuer) - w); cur[k] = null; };

  // Soluzione iniziale golosa (buon limite inferiore per potare subito)
  let best = { fill: 0, val: 0, sel: new Array(N).fill(null) };
  {
    let fill = 0, val = 0;
    for (let k = 0; k < N; k++) {
      const i = order[k], w = slots[i].weight;
      const c = C[i].find(x => fits(x.bond, w));
      if (c) { take(k, c, w); fill++; val += w * c.score; }
    }
    best = { fill, val, sel: cur.slice() };
    for (let k = 0; k < N; k++) if (cur[k]) drop(k, cur[k], slots[order[k]].weight);
  }

  let nodes = 0;
  (function dfs(k, fill, val) {
    if (++nodes > nodeBudget) return;
    const bf = fill + sufFill[k], bv = val + sufVal[k];
    if (bf < best.fill || (bf === best.fill && bv <= best.val + EPS)) return;
    if (k === N) { best = { fill, val, sel: cur.slice() }; return; }
    const i = order[k], w = slots[i].weight;
    for (const c of C[i]) {
      if (!fits(c.bond, w)) continue;
      take(k, c, w);
      dfs(k + 1, fill + 1, val + w * c.score);
      drop(k, c, w);
      if (nodes > nodeBudget) return;
    }
    dfs(k + 1, fill, val);
  })(0, 0, 0);

  const choice = new Array(N).fill(null);
  best.sel.forEach((c, k) => { choice[order[k]] = c; });
  return { choice, exact: nodes <= nodeBudget, nodes };
}
