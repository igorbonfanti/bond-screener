/* Lettura del CSV giornaliero di simpletoolsforinvestors.eu (STFI).
   Separatore ';', virgola decimale, date gg/mm/aaaa, cedola in frazione (0,0625 = 6,25%),
   couponmonths = mesi di stacco ("5,11"). */
import { parseDay, addBusinessDays } from '../core/dates.js';

export const RATING_SCALE = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-',
  'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D'];
const SCORE = Object.fromEntries(RATING_SCALE.map((r, i) => [r, RATING_SCALE.length - 1 - i]));
const MOODYS = {
  Aaa: 'AAA', Aa1: 'AA+', Aa2: 'AA', Aa3: 'AA-', A1: 'A+', A2: 'A', A3: 'A-',
  Baa1: 'BBB+', Baa2: 'BBB', Baa3: 'BBB-', Ba1: 'BB+', Ba2: 'BB', Ba3: 'BB-',
  B1: 'B+', B2: 'B', B3: 'B-', Caa1: 'CCC+', Caa2: 'CCC', Caa3: 'CCC-', Ca: 'CC', C: 'C'
};
export function ratingScore(r) { return r in SCORE ? SCORE[r] : null; }

// Nomi brevi dei sovranazionali (l'emittente governativo usa issuerdescription: "Italia", "Germania"…)
const SOV_NAMES = {
  SOV_BEI: 'BEI', SOV_EU: 'Unione Europea', SOV_EFSF: 'EFSF', SOV_ESM: 'MES (ESM)',
  SOV_WORLDBANK: 'Banca Mondiale', SOV_IBRD: 'BIRS (IBRD)', SOV_EBRD: 'BERS (EBRD)', SOV_CEB: 'CEB'
};

const REQUIRED = ['isincode', 'redemptiondate', 'issuercode', 'price'];

// Paesi dell'area euro (la Bulgaria dal 1° gennaio 2026). Gli altri Stati che emettono in euro
// (Romania, Ungheria, Polonia, Israele…) hanno rischi diversi e stanno in un gruppo a parte.
export const EUROZONE = ['AT', 'BE', 'BG', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT',
  'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];
export const AREAS = {
  euro: 'Stati area euro', extra: 'Altri Stati (emissioni in euro)', sov: 'Sovranazionali', corp: 'Societari'
};

/** Numero da testo italiano ("102,642", "1.234,5", "0,0625"); NaN se vuoto. */
export function num(v) {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  let s = String(v).trim().replace(/\s/g, '');
  if (!s || s === '-' || /^n\.?d\.?$/i.test(s)) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** CSV con separatore ';' (o ',') e campi eventualmente tra virgolette. */
export function parseCSV(text) {
  const src = String(text).replace(/^﻿/, '');
  const nl = src.indexOf('\n');
  const firstLine = nl >= 0 ? src.slice(0, nl) : src;
  const sep = (firstLine.split(';').length >= firstLine.split(',').length) ? ';' : ',';
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(x => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] != null ? r[i].trim() : ''])));
}

function classify(desc) {
  const d = desc || '';
  return {
    inflation: /senza indicizzazione/i.test(d) || /^BTP\s*i\b/i.test(d) || /\bBTP\s+ITALIA\b/i.test(d) ||
      /€i\b/i.test(d) || /\b(OATEI|OATI|INFLATION|LINKER|HICP)\b/i.test(d),
    stepUp: /STEP[\s-]?UP/i.test(d),
    retail: /\bBTP\s+(VALORE|FUTURA|PI[UÙ])/i.test(d),
    bot: /^BOT\b/i.test(d),
    green: /GREEN/i.test(d)
  };
}

function unifiedRating(sp, moodys) {
  const s = (sp || '').trim();
  if (s && s !== 'NR' && s in SCORE) return { rating: s, ratingSource: 'S&P' };
  const m = MOODYS[(moodys || '').trim()];
  if (m) return { rating: m, ratingSource: "Moody's" };
  return { rating: null, ratingSource: null };
}

/** Righe grezze → titoli normalizzati + metadati. Lancia un errore se il file non è un export STFI. */
export function normalize(rawRows) {
  if (!rawRows.length) throw new Error('Il file è vuoto.');
  const cols = Object.keys(rawRows[0]);
  const missing = REQUIRED.filter(c => !cols.includes(c));
  if (missing.length) throw new Error(`Non sembra un export di simpletoolsforinvestors: mancano le colonne ${missing.join(', ')}.`);

  // La cedola arriva in frazione (0,0625); se un file la desse già in percentuale non la moltiplichiamo.
  let maxCpn = 0;
  for (const r of rawRows) { const c = num(r.currentcouponrate); if (c > maxCpn) maxCpn = c; }
  const cpnScale = maxCpn > 0 && maxCpn < 1 ? 100 : 1;

  const seen = new Set(), refCount = new Map(), bonds = [];
  for (const r of rawRows) {
    const isin = (r.isincode || '').trim().toUpperCase();
    const maturity = parseDay(r.redemptiondate);
    const price = num(r.price);
    if (!isin || seen.has(isin) || maturity == null || !(price > 0)) continue;
    seen.add(isin);
    const issuer = (r.issuercode || '').trim();
    const prefix = issuer.split('_')[0];
    const group = prefix === 'GOV' ? 'gov' : prefix === 'SOV' ? 'sov' : 'corp';
    const country = group === 'gov' ? issuer.slice(4) : group === 'sov' ? 'SOV' : '';
    const area = group === 'gov' ? (EUROZONE.includes(country) ? 'euro' : 'extra') : group;
    const coupon = Math.max(0, (num(r.currentcouponrate) || 0) * cpnScale);   // % annuo
    let months = String(r.couponmonths || '').split(/[,;\s]+/).map(Number).filter(m => m >= 1 && m <= 12);
    const matMonth = +String(r.redemptiondate).split(/[/.-]/)[1];
    if (coupon > 0 && !months.length) {                          // periodicità senza mesi: li ricaviamo dalla scadenza
      const f = [1, 2, 4, 12].includes(+r.couponperiodicity) ? +r.couponperiodicity : 1;
      months = Array.from({ length: f }, (_, k) => ((matMonth - 1 + k * 12 / f) % 12) + 1);
    }
    months = [...new Set(months)].sort((a, b) => a - b);
    const ref = parseDay(r.referencedate);
    if (ref != null) refCount.set(ref, (refCount.get(ref) || 0) + 1);
    const { rating, ratingSource } = unifiedRating(r.ratingsp, r.ratingmoodys);
    const kind = classify(r.description);
    bonds.push({
      isin,
      desc: (r.description || '').trim(),
      maturity,
      currency: (r.currencycode || '').trim().toUpperCase(),
      issuer,
      issuerName: group === 'sov' ? (SOV_NAMES[issuer] || r.issuerdescription || issuer) : (r.issuerdescription || issuer).trim(),
      group, country, area,
      rating, ratingSource, ratingScore: rating ? SCORE[rating] : null,
      ratingSP: (r.ratingsp || '').trim(), ratingMoodys: (r.ratingmoodys || '').trim(),
      lot: num(r.minimumlot) > 0 ? num(r.minimumlot) : 1000,
      status: (r.status || 'Senior').trim(),
      priceType: (r.pricetype || '').trim().toUpperCase(),
      price,
      volume: num(r.volume) || 0,
      liquidity: Number.isFinite(num(r.volumevalue)) ? num(r.volumevalue) : 0,
      ytmGross: num(r.grossytm), durGross: num(r.grossduration),
      ytmNet: num(r.netytm), ytmSuperNet: num(r.supernetytm), durSuperNet: num(r.supernetduration),
      iSpread: num(r.ispread), zSpread: num(r.zspread),
      coupon, months, freq: months.length,
      issuePrice: num(r.issueprice),
      zc: coupon === 0,
      tax: group === 'corp' ? 0.26 : 0.125,
      ...kind
    });
  }
  let refDate = null, best = 0;
  for (const [d, n] of refCount) if (n > best) { best = n; refDate = d; }
  if (refDate == null) throw new Error('Data di riferimento non trovata nel file.');
  return { bonds, refDate, settle: addBusinessDays(refDate, 2), rowCount: rawRows.length };
}

export function loadText(text) { return normalize(parseCSV(text)); }
