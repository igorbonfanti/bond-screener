/* Flusso a costo minimo (cammini minimi successivi, Bellman-Ford/SPFA).
   Usato per l'assegnazione esatta gradini → emittenti quando i gradini hanno lo stesso peso:
   sorgente → gradino (cap 1) → emittente (cap 1) → pozzo (cap = gradini ammessi per emittente). */

export class MinCostFlow {
  constructor(n) { this.n = n; this.g = Array.from({ length: n }, () => []); }
  addEdge(u, v, cap, cost) {
    const a = { to: v, cap, cost, rev: this.g[v].length };
    const b = { to: u, cap: 0, cost: -cost, rev: this.g[u].length };
    this.g[u].push(a); this.g[v].push(b);
    return a;
  }
  /** Aumenta finché esiste un cammino a costo negativo (flusso massimo a costo minimo se ogni unità vale −BIG). */
  run(s, t) {
    const { n, g } = this;
    let flow = 0, cost = 0;
    for (;;) {
      const dist = new Array(n).fill(Infinity), inQ = new Array(n).fill(false), prev = new Array(n).fill(null);
      dist[s] = 0;
      const q = [s]; inQ[s] = true;
      while (q.length) {
        const u = q.shift(); inQ[u] = false;
        for (let i = 0; i < g[u].length; i++) {
          const e = g[u][i];
          if (e.cap > 0 && dist[u] + e.cost < dist[e.to] - 1e-12) {
            dist[e.to] = dist[u] + e.cost; prev[e.to] = [u, i];
            if (!inQ[e.to]) { inQ[e.to] = true; q.push(e.to); }
          }
        }
      }
      if (dist[t] === Infinity || dist[t] >= 0) break;
      let f = Infinity;
      for (let v = t; v !== s; v = prev[v][0]) f = Math.min(f, g[prev[v][0]][prev[v][1]].cap);
      for (let v = t; v !== s; v = prev[v][0]) {
        const e = g[prev[v][0]][prev[v][1]];
        e.cap -= f; g[v][e.rev].cap += f;
      }
      flow += f; cost += f * dist[t];
    }
    return { flow, cost };
  }
}
