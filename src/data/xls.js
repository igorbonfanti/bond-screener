/* Lettura del file del portafoglio esportato dalla banca → righe di celle (righe vuote comprese,
   così i numeri di riga mostrati all'utente tornano).
   - Excel veri (.xls binario OLE, .xlsx ZIP, Excel XML 2003): SheetJS Community Edition 0.20.3
     (vendor/xlsx.mjs, Apache 2.0, licenza in vendor/LICENSE-SheetJS.txt), caricato solo quando serve.
   - Tutto il resto è testo: CSV/TSV, tabelle HTML salvate come .xls. SheetJS leggerebbe male i numeri
     all'italiana ("10.000" → 10), quindi il testo lo leggiamo noi, con la codifica giusta. */
import { textToRows, isinOk } from './portfolio.js';

const MAX_BYTES = 10 * 1024 * 1024;
let sheetjs = null;
export const loadSheetJS = () => sheetjs || (sheetjs = import('../../vendor/xlsx.mjs').catch(e => { sheetjs = null; throw e; }));

export async function readSpreadsheet(file) {
  if (file.size > MAX_BYTES) throw new Error('file troppo grande (oltre 10 MB): non sembra l\'elenco dei titoli');
  const buf = new Uint8Array(await file.arrayBuffer());
  const ole = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
  const zip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (ole || zip) return excelRows(buf, { type: 'array' });
  const text = decodeText(buf);
  if (/^\s*<\?xml[\s\S]{0,2000}urn:schemas-microsoft-com:office:spreadsheet/i.test(text)) return excelRows(text, { type: 'string' });
  if (/<table[\s>]/i.test(text)) return htmlRows(text);
  return textToRows(text);
}

async function excelRows(data, opts) {
  let XLSX;
  try { XLSX = await loadSheetJS(); }
  catch { throw new Error('non riesco a caricare il lettore di Excel (sei offline?). Riprova, oppure salva il file come CSV'); }
  let wb;
  try { wb = XLSX.read(data, { ...opts, dense: true, sheetRows: 5000, cellDates: false }); }
  catch (e) {
    if (/password|encrypt/i.test(String(e && e.message))) throw new Error('il file è protetto da password: aprilo in Excel e salvalo senza password');
    throw new Error('il file Excel non si legge: prova a salvarlo come CSV');
  }
  // il foglio con più ISIN validi (di solito il primo)
  let best = null;
  for (const n of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '', blankrows: true });
    const score = rows.reduce((s, r) => s + r.filter(isinOk).length, 0);
    if (!best || score > best.score) best = { rows, score };
  }
  return best ? best.rows : [];
}

/** Testo con la codifica giusta: BOM UTF-8/UTF-16, altrimenti UTF-8 e, se non è valido, Windows-1252. */
function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

/** Tabella HTML → righe (DOMParser non esegue script; l'HTML non entra mai nella pagina). */
export function htmlRows(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = [...doc.querySelectorAll('table')].sort((a, b) => b.rows.length - a.rows.length)[0];
  return table ? [...table.rows].map(tr => [...tr.cells].map(td => td.textContent.replace(/\s+/g, ' ').trim())) : [];
}
