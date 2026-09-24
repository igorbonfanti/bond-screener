/* Paniere: quali titoli sono ammessi, con il motivo di ogni esclusione (per spiegarlo all'utente). */
import { ratingScore } from '../data/stfi.js';
import { costPer100, netYield } from './bond.js';

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

/** Calcoli per titolo che non dipendono dalle scelte dell'utente (una volta per file). */
export function enrich(ds) {
  for (const b of ds.bonds) {
    b.cost = costPer100(b, ds.settle);
    // Controllo di coerenza: se il rendimento lordo ricalcolato dai flussi si discosta molto
    // da quello di STFI (e il titolo non ha cedole variabili) il dato è anomalo.
    if (!b.stepUp && !b.inflation && b.maturity > ds.settle + 30 && Number.isFinite(b.ytmGross)) {
      const own = netYield({ ...b, tax: 0 }, ds.settle);
      b.anomaly = !Number.isFinite(own) || Math.abs(own - b.ytmGross) > 1;
    } else b.anomaly = false;
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
