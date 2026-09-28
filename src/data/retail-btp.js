/* BTP per i risparmiatori (Valore, Più, Italia, Italia Sì, Futura): calendario delle cedole crescenti e premio
   fedeltà, che il file STFI non ha (dà solo la cedola di oggi e l'ISIN di mercato).
   Ogni emissione ha due ISIN: quello di mercato e quello «con premio», che resta a chi ha sottoscritto al
   collocamento e tiene il titolo fino alla scadenza. Il premio spetta solo con l'ISIN con premio.
   Fonti: Dipartimento del Tesoro (schede informative, information memorandum, risultati dei collocamenti).
   Aggiornata a settembre 2026. Stime prudenti: inflazione futura zero (BTP Italia e Italia Sì, cedola reale
   su 100), premio legato al PIL al minimo garantito (BTP Futura), BTP Più tenuto fino alla scadenza. */

// [ISIN di mercato, ISIN con premio, nome, emissione, scadenza, cedole l'anno, [[dal, tasso % annuo lordo], …],
//  premio % a scadenza, premi intermedi [[data, %], …], tipo]
const LIST = [
  ['IT0005547408', 'IT0005547390', 'BTP Valore 1ª', '2023-06-13', '2027-06-13', 2, [['2023-06-13', 3.25], ['2025-06-13', 4.00]], 0.5],
  ['IT0005565400', 'IT0005565392', 'BTP Valore 2ª', '2023-10-10', '2028-10-10', 4, [['2023-10-10', 4.10], ['2026-10-10', 4.50]], 0.5],
  ['IT0005583486', 'IT0005583478', 'BTP Valore 3ª', '2024-03-05', '2030-03-05', 4, [['2024-03-05', 3.25], ['2027-03-05', 4.00]], 0.7],
  ['IT0005594483', 'IT0005594491', 'BTP Valore 4ª', '2024-05-14', '2030-05-14', 4, [['2024-05-14', 3.35], ['2027-05-14', 3.90]], 0.8],
  ['IT0005634800', 'IT0005634792', 'BTP Più', '2025-02-25', '2033-02-25', 4, [['2025-02-25', 2.85], ['2029-02-25', 3.70]], 0],
  ['IT0005672024', 'IT0005672016', 'BTP Valore 6ª', '2025-10-28', '2032-10-28', 4, [['2025-10-28', 2.60], ['2028-10-28', 3.10], ['2030-10-28', 4.00]], 0.8],
  ['IT0005696338', 'IT0005696320', 'BTP Valore 7ª', '2026-03-10', '2032-03-10', 4, [['2026-03-10', 2.60], ['2028-03-10', 3.20], ['2030-03-10', 3.80]], 0.8],
  ['IT0005388175', null, 'BTP Italia 15ª', '2019-10-28', '2027-10-28', 2, [['2019-10-28', 0.65]], 0, null, 'italia'],
  ['IT0005497000', 'IT0005496994', 'BTP Italia 17ª', '2022-06-28', '2030-06-28', 2, [['2022-06-28', 1.60]], 0.6, null, 'italia'],
  ['IT0005517195', 'IT0005517187', 'BTP Italia 18ª', '2022-11-22', '2028-11-22', 2, [['2022-11-22', 1.60]], 0.8, null, 'italia'],
  ['IT0005532723', 'IT0005532715', 'BTP Italia 19ª', '2023-03-14', '2028-03-14', 2, [['2023-03-14', 2.00]], 0.8, null, 'italia'],
  ['IT0005648255', 'IT0005648248', 'BTP Italia 20ª', '2025-06-04', '2032-06-04', 2, [['2025-06-04', 1.85]], 1.0, null, 'italia'],
  ['IT0005713547', 'IT0005713539', 'BTP Italia Sì', '2026-06-23', '2031-06-23', 2, [['2026-06-23', 1.60]], 0.6, null, 'italia'],
  ['IT0005415291', 'IT0005415283', 'BTP Futura 1ª', '2020-07-14', '2030-07-14', 2, [['2020-07-14', 1.15], ['2024-07-14', 1.30], ['2027-07-14', 1.45]], 1.0],
  ['IT0005425761', 'IT0005425753', 'BTP Futura 2ª', '2020-11-17', '2028-11-17', 2, [['2020-11-17', 0.35], ['2023-11-17', 0.60], ['2026-11-17', 1.00]], 1.0],
  ['IT0005442097', 'IT0005442089', 'BTP Futura 3ª', '2021-04-27', '2037-04-27', 2, [['2021-04-27', 0.75], ['2025-04-27', 1.20], ['2029-04-27', 1.65], ['2033-04-27', 2.00]], 0, [['2029-04-27', 0.4]]],
  ['IT0005466351', 'IT0005466344', 'BTP Futura 4ª', '2021-11-16', '2033-11-16', 2, [['2021-11-16', 0.75], ['2025-11-16', 1.35], ['2029-11-16', 1.70]], 1.6, [['2029-11-16', 0.4]]]
];

/** ISIN (di mercato o con premio) → descrizione nello stesso formato dei titoli descritti a mano. */
export const RETAIL_BTP = {};
for (const [market, withPremio, name, issued, maturity, freq, rates, premio, extra, kind] of LIST) {
  const base = { name, issued, maturity, freq, coupon: rates[0][1], steps: rates.map(([from, rate]) => ({ from, rate })),
    issuePrice: 100, tax: 0.125, market, isinPremio: withPremio, inflation: kind === 'italia' };
  RETAIL_BTP[market] = { ...base, premio: 0, extra: [] };
  if (withPremio) RETAIL_BTP[withPremio] = { ...base, premio, extra: (extra || []).map(([date, perc]) => ({ date, perc })) };
}
