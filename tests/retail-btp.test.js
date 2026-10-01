// Coerenza della tabella dei BTP retail con il file STFI reale (STFI_CSV=/percorso/file.csv npm test):
// scadenza, mesi di stacco e cedola in corso dell'ISIN di mercato devono coincidere con quelli del file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RETAIL_BTP } from '../src/data/retail-btp.js';
import { loadText } from '../src/data/stfi.js';
import { parseDay, parts } from '../src/core/dates.js';

const markets = [...new Set(Object.values(RETAIL_BTP).map(x => x.market))];

test('tabella retail: ogni ISIN con premio ha il suo ISIN di mercato e viceversa', () => {
  for (const m of markets) {
    const r = RETAIL_BTP[m];
    assert.equal(r.premio, 0, `${m}: l'ISIN di mercato non ha premio`);
    assert.ok(r.isinPremio, `${r.name}: manca l'ISIN con premio (del collocamento)`);
    assert.equal(RETAIL_BTP[r.isinPremio].market, m);
  }
  // premi minimi dei prospetti: nessun titolo con premio a zero tranne il BTP Più (ha il rimborso anticipato)
  for (const x of Object.values(RETAIL_BTP)) if (x.isinPremio && x.market !== 'IT0005634800' && RETAIL_BTP[x.isinPremio] === x) {
    assert.ok(x.premio > 0, `${x.name}: premio a scadenza mancante`);
  }
});

test('tabella retail coerente con il file STFI reale', { skip: !process.env.STFI_CSV }, () => {
  const ds = loadText(readFileSync(process.env.STFI_CSV, 'utf8'));
  const by = new Map(ds.bonds.map(b => [b.isin, b]));
  for (const m of markets) {
    const r = RETAIL_BTP[m], b = by.get(m);
    if (!b) continue;                                            // scaduto o non più nel file
    assert.equal(b.maturity, parseDay(r.maturity), `${r.name}: scadenza`);
    assert.equal(b.freq, r.freq, `${r.name}: cedole l'anno`);
    assert.ok(b.months.includes(parts(b.maturity).m), `${r.name}: mesi di stacco`);
    let rate = r.steps[0].rate;
    for (const s of r.steps) if (parseDay(s.from) <= ds.settle) rate = s.rate;
    assert.ok(Math.abs(b.coupon - rate) < 1e-9, `${r.name}: cedola in corso ${b.coupon} nel file, ${rate} in tabella`);
  }
});
