/* Lettura del file del portafoglio esportato dalla banca → righe di celle.
   .csv/.txt/.tsv: testo. .xls (Excel binario), .xlsx: SheetJS, caricato solo quando serve
   (vendor/xlsx.mjs, SheetJS Community Edition, Apache 2.0). Alcune banche salvano come .xls
   una pagina HTML o un testo a tabulazioni: li riconosciamo dai primi byte. */
import { textToRows, isinOk } from './portfolio.js';

let sheetjs = null;
const loadSheetJS = () => sheetjs || (sheetjs = import('../../vendor/xlsx.mjs'));

export async function readSpreadsheet(file) {
  const name = (file.name || '').toLowerCase();
  if (/\.(csv|txt|tsv)$/.test(name)) return textToRows(await file.text());
  const buf = new Uint8Array(await file.arrayBuffer());
  const ole = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
  const zip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (!ole && !zip) {                                   // testo o HTML travestito da .xls
    const text = new TextDecoder(buf[0] === 0xff && buf[1] === 0xfe ? 'utf-16le' : 'utf-8').decode(buf);
    if (/<table[\s>]/i.test(text)) return htmlRows(text);
    return textToRows(text);
  }
  const XLSX = await loadSheetJS();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  // il foglio con più ISIN validi (di solito il primo)
  let best = null;
  for (const n of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '', blankrows: false });
    const score = rows.reduce((s, r) => s + r.filter(isinOk).length, 0);
    if (!best || score > best.score) best = { rows, score };
  }
  return best ? best.rows : [];
}

function htmlRows(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const table = [...doc.querySelectorAll('table')].sort((a, b) => b.rows.length - a.rows.length)[0];
  return table ? [...table.rows].map(tr => [...tr.cells].map(td => td.textContent.trim())) : [];
}
