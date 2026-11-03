/* Indici d'inflazione e coefficienti di indicizzazione (CI), con il metodo ufficiale MEF (lo stesso dell'AFT):
     IR(d,m) = I(m−3) + (d − 1)/gg(m) × [I(m−2) − I(m−3)]        indice di riferimento del giorno d del mese m
     CI(d)   = IR(d) / IR(base)                                  coefficiente del titolo
   IR e CI si troncano alla 6ª decimale e si arrotondano alla 5ª.
   Le serie mensili sono in base 2025=100 (in vigore da febbraio 2026); i valori in base 2015 si convertono con la
   chiave di raccordo di dicembre 2025 (vedi data/inflazione/). Il CI non cambia con il ribasamento: si ricava
   l'IR di base del titolo dal CI ufficiale di un giorno noto (IR_base = IR(giorno) / CI_ufficiale(giorno)), già
   nella base nuova.
   I mesi futuri si proiettano per scenario: I(m) = I(m−1) × (1 + π_anno)^(1/12). */
import { parts, daysInMonth } from './dates.js';

export const mkey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const shift = (y, m, k) => { const i = y * 12 + (m - 1) + k; return [Math.floor(i / 12), i % 12 + 1]; };

/** Troncamento alla 6ª decimale e arrotondamento alla 5ª (con una tolleranza per gli errori di virgola mobile). */
export function t6r5(x) {
  const t = Math.trunc(x * 1e6 + (x >= 0 ? 1e-7 : -1e-7)) / 1e6;
  return Math.round(t * 1e5 + (t >= 0 ? 1e-9 : -1e-9)) / 1e5;
}

/**
 * Serie mensile con proiezione: known = { 'aaaa-mm': valore } (mesi pubblicati, prime pubblicazioni);
 * rate(y) = inflazione annua prevista nell'anno y (decimale) per i mesi successivi all'ultimo pubblicato.
 * Restituisce { get(y, m), last: 'aaaa-mm', projected(y, m) }.
 */
export function series(known, rate) {
  const keys = Object.keys(known).sort();
  if (!keys.length) throw new Error('Serie d\'inflazione vuota.');
  const last = keys[keys.length - 1];
  const [ly, lm] = last.split('-').map(Number);
  const memo = new Map();
  const get = (y, m) => {
    const k = mkey(y, m);
    if (memo.has(k)) return memo.get(k);
    if (k in known) return known[k];
    if (k < keys[0]) throw new Error(`Indice ${k} non disponibile (la serie parte da ${keys[0]}).`);
    if (memo.has(k)) return memo.get(k);
    const [py, pm] = shift(y, m, -1);
    const v = get(py, pm) * Math.pow(1 + rate(y), 1 / 12);
    memo.set(k, v);
    return v;
  };
  // riempie la memoria in ordine, così la ricorsione resta corta anche per date lontane
  // (riparte dall'ultimo mese già calcolato, non dall'ultimo pubblicato: una lettura costa O(1) dopo la prima)
  let wy = ly, wm = lm;
  const warm = (y, m) => { while (wy * 12 + wm < y * 12 + m) { [wy, wm] = shift(wy, wm, 1); get(wy, wm); } };
  return {
    last,
    get: (y, m) => { if (mkey(y, m) > last) warm(y, m); return get(y, m); },
    projected: (y, m) => mkey(y, m) > last
  };
}

/** Indice di riferimento del giorno dn (metodo MEF/AFT), troncato e arrotondato. */
export function refIndex(s, dn) {
  const { y, m, d } = parts(dn);
  const [y3, m3] = shift(y, m, -3), [y2, m2] = shift(y, m, -2);
  const a = s.get(y3, m3), b = s.get(y2, m2);
  return t6r5(a + (d - 1) / daysInMonth(y, m) * (b - a));
}

/** Indice di riferimento senza arrotondamenti (per le proiezioni lontane, dove l'arrotondamento non conta). */
export function refIndexRaw(s, dn) {
  const { y, m, d } = parts(dn);
  const [y3, m3] = shift(y, m, -3), [y2, m2] = shift(y, m, -2);
  const a = s.get(y3, m3), b = s.get(y2, m2);
  return a + (d - 1) / daysInMonth(y, m) * (b - a);
}

/** Coefficiente di indicizzazione del giorno dn per un titolo con indice di riferimento base irBase. */
export function indexRatio(s, dn, irBase) { return t6r5(refIndex(s, dn) / irBase); }

/** IR di base ricavato dal CI ufficiale di un giorno noto (stessa base della serie). */
export function baseFromOfficial(s, dn, ciOfficial) { return refIndex(s, dn) / ciOfficial; }

/** Inflazione annua di uno scenario: rates = { 2027: 0.026, …, default } (decimali); gli anni mancanti prendono
    l'ultimo anno indicato prima di loro, o default. */
export function rateFn(rates) {
  const ys = Object.keys(rates).filter(k => /^\d{4}$/.test(k)).map(Number).sort((a, b) => a - b);
  return y => {
    let v = rates.default;
    for (const k of ys) if (k <= y) v = rates[k];
    if (v == null) v = rates[ys[0]];
    return v;
  };
}
