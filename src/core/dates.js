/* Date come "giorni interi" (numero di giorni dal 1970-01-01, calendario UTC).
   Nessun oggetto Date locale nei calcoli: niente sfasamenti di fuso orario
   (la v2 perdeva un giorno a ogni salvataggio in Italia). */

const MS_DAY = 86400000;

export function day(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / MS_DAY); }

export function parts(dn) {
  const dt = new Date(dn * MS_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

/** Giorno della settimana: 0 = domenica … 6 = sabato. */
export function weekday(dn) { return new Date(dn * MS_DAY).getUTCDay(); }

/** "gg/mm/aaaa" (anche "g/m/aa", separatori / - .) oppure "aaaa-mm-gg" → giorno; null se non valida. */
export function parseDay(s) {
  if (s == null) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  let y, mo, d;
  if (m) { d = +m[1]; mo = +m[2]; y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; }
  else if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return day(y, mo, d);
}

export function iso(dn) {
  const { y, m, d } = parts(dn);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function fmt(dn) {
  if (dn == null) return '—';
  const { y, m, d } = parts(dn);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export const MONTHS_LONG = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
  'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

export function fmtMonthYear(dn) { const { y, m } = parts(dn); return `${MONTHS[m - 1]} ${y}`; }

/** Aggiunge n mesi; se il giorno non esiste nel mese d'arrivo si ferma all'ultimo giorno. */
export function addMonths(dn, n) {
  const { y, m, d } = parts(dn);
  const idx = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(idx / 12), nm = idx % 12 + 1;
  return day(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Aggiunge n giorni lavorativi (sabato e domenica esclusi; festività ignorate). */
export function addBusinessDays(dn, n) {
  let out = dn, left = n;
  while (left > 0) { out += 1; const w = weekday(out); if (w !== 0 && w !== 6) left -= 1; }
  return out;
}

/** Anni (frazione) tra due giorni, base ACT/365.25. */
export function years(from, to) { return (to - from) / 365.25; }

export function today() { const n = new Date(); return day(n.getFullYear(), n.getMonth() + 1, n.getDate()); }
