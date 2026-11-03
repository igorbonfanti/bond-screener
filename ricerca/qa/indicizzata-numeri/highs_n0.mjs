// La colonna n0 esiste se compare solo nella sezione Bounds? (serve al controllo «timed» di solveWith)
import fs from 'node:fs';
const highs = await (await import('../../../vendor/highs/highs.mjs')).default({ wasmBinary: fs.readFileSync('../../../vendor/highs/highs.wasm') });
const r = highs.solve('Minimize\n obj: n1 + c0\nSubject To\n a: n1 + c0 >= 2.5\nBounds\n n0 = 0\nGenerals\n n1\nEnd', { output_flag: false });
console.log(r.Status, Object.keys(r.Columns), r.Columns.n0);
