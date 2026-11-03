// Percorsi del generatore (copia strumentata), molti, per le statistiche: node gen.mjs N
import fs from 'node:fs';
import { rng, drawPath, MC_DEFAULT } from './mc_instr.mjs';
const N = +process.argv[2] || 50000, p = { ...MC_DEFAULT, infl0: 0.026 };
const R = rng(p.seed), y0 = 2026, y1 = 2047, T = y1 - y0 + 1;
const I = new Float64Array(N * T), E = new Float64Array(N * T);
for (let i = 0; i < N; i++) { const q = drawPath(R, p, y0, y1); for (let t = 0; t < T; t++) { I[i * T + t] = q.infl[y0 + t]; E[i * T + t] = q.eq[y0 + t]; } }
fs.writeFileSync('out/gen_infl.bin', Buffer.from(I.buffer)); fs.writeFileSync('out/gen_eq.bin', Buffer.from(E.buffer));
fs.writeFileSync('out/gen_meta.json', JSON.stringify({ N, T, y0, p }));
