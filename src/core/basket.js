/* Paniere: quali titoli sono ammessi, con il motivo di ogni esclusione (per spiegarlo all'utente). */
import { ratingScore } from '../data/stfi.js';
import { costPer100, netYield, impliedDiscAccrued } from './bond.js';
import { parseDay } from './dates.js';
import { RETAIL_BTP } from '../data/retail-btp.js';

export const DEFAULT_BASKET = {
  groups: { euro: true, extra: false, sov: true, corp: false },   // aree: vedi AREAS in stfi.js
  issuers: null,            // null = tutti gli emittenti dei gruppi scelti; altrimenti elenco di issuercode
  minRating: 'BBB-',
  includeUnrated: false,
  maxPrice: 100,            // null = qualsiasi prezzo
  minLiquidity: 1,          // classe STFI 0-4 (0 = nessuno scambio)
  includeInflation: false,  // BTP Italia / BTP€i: rendimento "senza indicizzazione", non confrontabile
  includeStepUp: true
};

/** Scarto massimo (punti) fra rendimento lordo dai flussi e quello di STFI prima di scartare il titolo. */
export const ANOMALY_GAP = 0.15;

/** Calcoli per titolo che non dipendono dalle scelte dell'utente (una volta per file). */
export function enrich(ds) {
  for (const b of ds.bonds) {
    // Cedole crescenti dei BTP per i risparmiatori comprati sul mercato (ISIN di mercato, senza premio)
    const retail = RETAIL_BTP[b.isin];
    if (retail && retail.steps && retail.steps.length > 1 && !b.steps)
      b.steps = retail.steps.map(s => ({ from: parseDay(s.from), rate: +s.rate })).filter(s => s.from != null).sort((x, y) => x.from - y.from);
    // Disaggio di emissione già maturato (serve al credito d'imposta all'acquisto e alla plusvalenza)
    const acc = impliedDiscAccrued(b, ds.settle);
    if (acc != null) b.discAcc = acc;
    b.cost = costPer100(b, ds.settle);
    // Controllo di coerenza: se il rendimento lordo ricalcolato dai flussi si discosta da quello di STFI
    // (e l'app conosce tutte le cedole) il dato è anomalo. Con flussi e fiscalità allineati a STFI i titoli di
    // Stato coincidono entro 0,01 punti: 0,15 basta a scartare gli errori del file (es. una cedola sbagliata
    // nel piano STFI, EU 12/03/2030: 3,75% invece di 3,375%, rendimento +0,33 punti).
    const known = !b.inflation && (!b.stepUp || b.steps);
    if (known && b.maturity > ds.settle + 30 && Number.isFinite(b.ytmGross)) {
      const own = netYield({ ...b, tax: 0 }, ds.settle);
      b.anomaly = !Number.isFinite(own) || Math.abs(own - b.ytmGross) > ANOMALY_GAP;
    } else b.anomaly = false;
    // Cedole variabili che l'app non conosce (step-up fuori tabella): la scelta usa il rendimento dei flussi
    // stimati con la cedola di oggi, gli stessi del dimensionamento, se si discosta da quello di STFI.
    delete b.flowYield;
    if (b.stepUp && !b.steps && b.maturity > ds.settle + 30 && Number.isFinite(b.ytmNet)) {
      const net = netYield(b, ds.settle), superNet = netYield(b, ds.settle, { zainetto: true });
      if (Number.isFinite(net) && Math.abs(net - b.ytmNet) > 0.05) b.flowYield = { net, superNet };
    }
  }
  return ds;
}

export const EXCLUSION_LABELS = {
  currency: 'valuta diversa da EUR',
  group: 'tipo di emittente non selezionato',
  issuer: 'emittente non selezionato',
  rating: 'rating sotto la soglia',
  unrated: 'senza rating',
  price: 'prezzo sopra il limite',
  liquidity: 'poco o per nulla scambiati',
  inflation: 'indicizzati all\'inflazione',
  stepUp: 'cedola step-up',
  subordinated: 'subordinati',
  expiring: 'in scadenza entro un mese',
  anomaly: 'dati incoerenti nel file'
};

export function applyBasket(ds, basket) {
  const k = { ...DEFAULT_BASKET, ...basket, groups: { ...DEFAULT_BASKET.groups, ...(basket && basket.groups) } };
  const minScore = ratingScore(k.minRating) ?? 0;
  const issuerSet = k.issuers ? new Set(k.issuers) : null;
  const excluded = {}, out = [];
  const drop = (why) => { excluded[why] = (excluded[why] || 0) + 1; };
  for (const b of ds.bonds) {
    if (b.currency !== 'EUR') { drop('currency'); continue; }
    if (!k.groups[b.area]) { drop('group'); continue; }
    if (issuerSet && !issuerSet.has(b.issuer)) { drop('issuer'); continue; }
    if (b.anomaly) { drop('anomaly'); continue; }
    if (b.status && !/^senior$/i.test(b.status)) { drop('subordinated'); continue; }
    if (b.maturity <= ds.settle + 30) { drop('expiring'); continue; }
    if (b.ratingScore == null) { if (!k.includeUnrated) { drop('unrated'); continue; } }
    else if (b.ratingScore < minScore) { drop('rating'); continue; }
    if (k.maxPrice != null && b.price > k.maxPrice) { drop('price'); continue; }
    if (b.liquidity < k.minLiquidity) { drop('liquidity'); continue; }
    if (b.inflation && !k.includeInflation) { drop('inflation'); continue; }
    if (b.stepUp && !k.includeStepUp) { drop('stepUp'); continue; }
    out.push(b);
  }
  return { bonds: out, excluded };
}

/** Emittenti presenti nel file (per costruire le scelte del paniere), con conteggi e rating. */
export function issuerCatalog(ds) {
  const map = new Map();
  for (const b of ds.bonds) {
    if (b.currency !== 'EUR' || b.group === 'corp') continue;
    const e = map.get(b.issuer) || { issuer: b.issuer, name: b.issuerName, group: b.group, area: b.area, country: b.country, rating: b.rating, ratingScore: b.ratingScore, count: 0 };
    e.count++;
    if (b.ratingScore != null && (e.ratingScore == null || b.ratingScore > e.ratingScore)) { e.rating = b.rating; e.ratingScore = b.ratingScore; }
    map.set(b.issuer, e);
  }
  return [...map.values()].sort((a, b) => (b.ratingScore ?? -1) - (a.ratingScore ?? -1) || b.count - a.count);
}
