/* Il portafoglio che l'utente possiede già: lettura da tabelle esportate dalla banca
   (Fineco e simili, .xls/.xlsx/.csv o testo incollato) e dall'inserimento a mano.
   Qui solo funzioni pure su righe di celle: la lettura dei file sta in xls.js.
   I dati del portafoglio restano nel browser (localStorage): mai nel cloud né nel repository. */

/** ISIN valido: formato e cifra di controllo (Luhn sulle cifre, lettere A=10 … Z=35). */
export function isinOk(s) {
  const t = String(s || '').trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(t)) return false;
  const digits = t.replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let sum = 0, dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Numero da una cella: già numero, oppure testo all'italiana ("20.000,50") o all'inglese ("20,000.50").
    kind 'price' (prezzi in % del nominale, fra 0 e 1.000): "98,499" è un decimale, non 98.499. */
export function cellNumber(v, kind = 'amount') {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (v == null) return NaN;
  let t = String(v).trim().replace(/[\s  €%'’]|EUR|USD/gi, '').replace(/^\((.*)\)$/, '-$1').replace(/−/g, '-');
  if (!t || /^[-–—]$/.test(t) || /^n\.?[da]\.?$/i.test(t)) return NaN;
  const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {                     // entrambi: l'ultimo è il decimale
    t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const thousands = /^-?\d{1,3}(,\d{3})+$/.test(t);
    t = thousands && kind !== 'price' ? t.replace(/,/g, '') : t.replace(/\./g, '').replace(',', '.');
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(t) && kind !== 'price') {
    t = t.replace(/\./g, '');                                // "20.000" = ventimila
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9%€ ]+/g, ' ').replace(/\s+/g, ' ').trim();

/* Intestazioni riconosciute (confronto su testo normalizzato: minuscole, senza accenti e punteggiatura).
   L'ordine conta: la prima colonna che corrisponde vince. */
const COLUMNS = {
  isin: [/^isin$/, /^codice isin$/, /^cod isin$/, /^isin code$/, /^symbol isin$/, /^codice titolo$/, /\bisin\b/],
  desc: [/^titolo$/, /^descrizione( titolo)?$/, /^denominazione$/, /^nome( titolo)?$/, /^strumento finanziario$/, /^description$/, /^name$/, /^prodotto$/, /^product$/, /^titolo descrizione$/],
  nominal: [/^quantita$/, /^q ?ta$/, /^qta$/, /^valore nominale$/, /^nominale$/, /^quantita( valore)? nominale$/, /^quantity$/, /^qty$/, /^nominal( value)?$/, /^face value$/, /^saldo( nominale)?$/, /^consistenza$/, /^pezzi$/, /^amount$/],
  carico: [/^p ?zo medio di carico$/, /^prezzo medio di carico$/, /^prezzo( di)? carico$/, /^pmc$/, /^p ?m ?c$/, /^prezzo medio( acquisto| ponderato)?$/, /^costo medio( unitario)?$/, /^prz medio carico$/, /^average (cost|price)$/, /^avg (cost|price)$/, /^cost price$/, /^open price$/, /^prezzo medio di acquisto$/],
  price: [/^p ?zo di mercato$/, /^prezzo di mercato$/, /^prezzo( attuale| corrente| ultimo)?$/, /^ultimo prezzo$/, /^quotazione$/, /^corso$/, /^chiusura$/, /^closing$/, /^market price$/, /^current price$/, /^last price$/, /^price$/],
  value: [/^valore di mercato( €)?$/, /^controvalore( di mercato| €)?$/, /^market value$/, /^value in eur$/, /^valore( attuale)?$/],
  costValue: [/^valore di carico$/, /^controvalore di carico$/, /^costo( totale)?$/, /^book value$/],
  type: [/^strumento$/, /^tipo( strumento)?$/, /^tipologia$/, /^asset class$/, /^asset type$/, /^categoria$/, /^instrument( type)?$/],
  currency: [/^valuta$/, /^divisa$/, /^currency$/],
  accrued: [/^rateo( maturato)?$/, /^interessi maturati$/, /^accrued( interest)?$/]
};
const NOT_BONDS = /azion|equity|share|etf|etc\b|etn|fond|sicav|fund|certificat|warrant|covered|opzion|future|cfd|liquidit|cash/;

function findHeader(rows) {
  const lim = Math.min(rows.length, 40);
  let best = null;
  for (let r = 0; r < lim; r++) {
    const cells = (rows[r] || []).map(norm);
    const map = {};
    for (const [key, pats] of Object.entries(COLUMNS)) {
      for (const p of pats) {
        const c = cells.findIndex((x, i) => x && p.test(x) && !Object.values(map).includes(i));
        if (c >= 0) { map[key] = c; break; }
      }
    }
    const score = Object.keys(map).length;
    if (map.isin != null && map.nominal != null && (!best || score > best.score)) best = { row: r, map, score };
  }
  if (best && best.map.type != null && best.map.desc == null) {
    // «Strumento»: in Fineco è il tipo (pochi valori ripetuti), in Directa il nome del titolo
    const vals = rows.slice(best.row + 1).map(x => String((x || [])[best.map.type] ?? '').trim()).filter(Boolean);
    if (vals.length >= 3 && new Set(vals).size / vals.length > 0.6) { best.map.desc = best.map.type; delete best.map.type; }
  }
  return best;
}

/** Colonna ISIN trovata senza intestazione: la colonna con più ISIN validi. */
function guessIsinColumn(rows) {
  const counts = new Map();
  rows.slice(0, 200).forEach(row => (row || []).forEach((v, c) => { if (isinOk(v)) counts.set(c, (counts.get(c) || 0) + 1); }));
  let best = null;
  for (const [c, n] of counts) if (!best || n > best[1]) best = [c, n];
  return best ? best[0] : null;
}

/**
 * Righe di celle (array di array) → posizioni.
 * Ritorna { holdings:[{isin, desc, nominal, carico, price, accrued, rows}], skipped:[{row, reason, text}], header, notes:[…] }.
 * Righe dello stesso ISIN si sommano (carico medio ponderato sul nominale).
 */
export function tableToHoldings(rows, { fileName = '' } = {}) {
  const notes = [];
  const skipped = [];
  let head = findHeader(rows);
  if (!head) {
    const c = guessIsinColumn(rows);
    if (c == null) return { holdings: [], skipped, header: null, notes: ['Nessuna colonna ISIN riconosciuta: controlla che il file sia l\'elenco dei titoli.'] };
    head = { row: -1, map: { isin: c } };
    notes.push('Intestazioni non riconosciute: letti solo gli ISIN. Inserisci nominali e prezzi di carico a mano.');
  }
  const { map } = head;
  const get = (row, key) => (map[key] == null ? undefined : row[map[key]]);
  const byIsin = new Map();
  for (let r = head.row + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const isin = String(get(row, 'isin') ?? '').trim().toUpperCase();
    const text = row.filter(v => v !== '' && v != null).slice(0, 3).join(' · ');
    if (!isin || /^(TOTALE|TOTAL|EUR)\b/.test(isin)) { if (isin === '' && text && !/^(totale|total|eur)\b/i.test(text)) skipped.push({ row: r + 1, reason: 'senza ISIN', text }); continue; }
    if (!isinOk(isin)) { skipped.push({ row: r + 1, reason: 'ISIN non valido', text: isin }); continue; }
    const type = norm(get(row, 'type'));
    if (type && NOT_BONDS.test(type) && !/obblig|bond|titol|stato|btp|bot|cct|ctz/.test(type)) { skipped.push({ row: r + 1, reason: 'non è un\'obbligazione', text }); continue; }
    const cur = String(get(row, 'currency') ?? '').trim().toUpperCase();
    if (cur && cur !== 'EUR' && cur !== '€') { skipped.push({ row: r + 1, reason: `in ${cur}: l'app lavora solo in euro`, text }); continue; }
    let nominal = cellNumber(get(row, 'nominal'), 'amount');
    const carico = cellNumber(get(row, 'carico'), 'price');
    const price = cellNumber(get(row, 'price'), 'price');
    // Nominale o numero di pezzi? Se c'è un controvalore, il nominale implicito lo dice.
    const value = cellNumber(get(row, 'value'), 'amount'), costValue = cellNumber(get(row, 'costValue'), 'amount');
    const implied = Number.isFinite(value) && price > 0 ? value * 100 / price : Number.isFinite(costValue) && carico > 0 ? costValue * 100 / carico : NaN;
    if (Number.isFinite(nominal) && Number.isFinite(implied) && nominal > 0) {
      let bestK = 1, bestErr = Infinity;
      for (const k of [1, 100, 1000, 50000, 100000]) { const err = Math.abs(nominal * k / implied - 1); if (err < bestErr) { bestErr = err; bestK = k; } }
      if (bestK !== 1 && bestErr < 0.15) { nominal *= bestK; notes.push(`${isin}: quantità letta come pezzi da ${String(bestK).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} € di nominale.`); }
    }
    if (!(nominal > 0)) { skipped.push({ row: r + 1, reason: 'nominale mancante', text: isin }); continue; }
    const accrued = cellNumber(get(row, 'accrued'), 'amount');
    const desc = String(get(row, 'desc') ?? '').trim();
    const prev = byIsin.get(isin);
    if (prev) {
      const tot = prev.nominal + nominal;
      if (Number.isFinite(prev.carico) && Number.isFinite(carico)) prev.carico = (prev.carico * prev.nominal + carico * nominal) / tot;
      else if (prev.carico != null || Number.isFinite(carico)) { prev.carico = null; notes.push(`${isin}: su una delle righe manca il prezzo di carico, indicalo a mano.`); }
      prev.nominal = tot;
      prev.rows.push(r + 1);
    } else {
      byIsin.set(isin, { isin, desc, nominal, carico: Number.isFinite(carico) ? carico : null, price: Number.isFinite(price) ? price : null,
        accrued: Number.isFinite(accrued) ? accrued : null, rows: [r + 1] });
    }
  }
  if (map.carico == null && head.row >= 0) notes.push('Colonna del prezzo medio di carico non trovata: senza carico la tassa a scadenza è stimata sul prezzo di oggi.');
  const holdings = [...byIsin.values()];
  const merged = holdings.filter(h => h.rows.length > 1).length;
  if (merged) notes.push(`${merged} titoli comparivano su più righe: nominali sommati, carico medio ponderato.`);
  return { holdings, skipped, header: head.row >= 0 ? head.row + 1 : null, notes, fileName };
}

/** Testo incollato o CSV → righe di celle (le righe vuote restano, così i numeri di riga tornano).
    Separatore: tabulazione se c'è, altrimenti ';' o ',' contati fuori dalle virgolette.
    Righe libere «ISIN nominale [prezzo]» (anche copiate da un PDF) diventano tre colonne con intestazione. */
export function textToRows(text) {
  const lines = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const filled = lines.filter(l => l.trim());
  if (!filled.length) return [];
  const outside = (l, ch) => { let n = 0, q = false; for (const c of l) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  const sample = filled.slice(0, 30);
  let sep = null;
  if (sample.some(l => outside(l, '\t') > 0)) sep = '\t';
  else {
    const semi = sample.reduce((n, l) => n + outside(l, ';'), 0), comma = sample.reduce((n, l) => n + outside(l, ','), 0);
    if (semi || comma) sep = semi >= comma ? ';' : ',';
  }
  const rows = lines.map(l => (l.trim() ? (sep ? splitLine(l, sep) : [l.trim()]) : []));
  if (!rows.some(r => r.some(isinOk))) {
    const free = lines.map(l => {
      const m = l.match(/\b([A-Z]{2}[A-Z0-9]{9}\d)\b[\s:;,]+([\d.,' ]+)(?:[\s;,]+([\d.,]+))?\s*$/);
      return m && isinOk(m[1]) ? [m[1], m[2].trim(), m[3] || ''] : [];
    });
    if (free.some(r => r.length)) return [['ISIN', 'Nominale', 'Prezzo di carico'], ...free];
  }
  return rows;
}

function splitLine(line, sep) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === sep) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
