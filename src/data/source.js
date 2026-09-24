/* Da dove arrivano i dati del giorno:
   1. il file automatico: data/stfi-latest.csv, pubblicato ogni sera dal workflow GitHub
      (letto dal sito stesso e, se più aggiornato, direttamente dal repository);
   2. la copia salvata nel browser (funziona anche offline);
   3. un file caricato a mano dall'utente (scaricato da simpletoolsforinvestors.eu).
   All'avvio vince il file automatico, a meno che la copia nel browser sia un file più recente. */

const CACHE_KEY = 'bondladder.v3.data';
const SOURCES = ['./data/', 'https://raw.githubusercontent.com/igorbonfanti/bond-screener/main/data/'];
export const STFI_PAGE = 'https://www.simpletoolsforinvestors.eu/documentivari.php';

async function fetchOk(url, as, ms) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : 0;   // rete appesa = sito non raggiungibile
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (!r.ok) throw new Error(`${r.status}`);
    return await (as === 'json' ? r.json() : r.text());
  } finally { clearTimeout(timer); }
}

/** Copia salvata nel browser: {text, meta} o null. */
export function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c && c.text && c.meta ? c : null;
  } catch { return null; }
}

export function writeCache(text, meta) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ text, meta })); } catch { /* spazio insufficiente: pazienza */ }
}

export function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* */ }
}

/** Il file automatico pubblicato, senza scaricarlo: [{base, meta:{refDate, rows, fetchedAt}}], il più recente per primo. */
async function remoteList() {
  const metas = await Promise.all(SOURCES.map(async base => {
    try { const meta = await fetchOk(base + 'stfi-latest.json', 'json', 8000); return meta && meta.refDate ? { base, meta } : null; }
    catch { return null; }
  }));
  return metas.filter(Boolean).sort((a, b) => b.meta.refDate.localeCompare(a.meta.refDate));
}

/** Informazioni sul file automatico più recente, o null se non è raggiungibile. */
export async function remoteInfo() {
  return (await remoteList())[0] || null;
}

/** Dati da usare: {text, meta:{refDate, source:'auto'|'manual', from:'network'|'cache', …}, remote} o null.
    Senza force: il file automatico se è recente almeno quanto la copia nel browser, altrimenti la copia.
    Con force: solo il file automatico, scaricato adesso (null se non raggiungibile). */
export async function loadLatest({ force = false } = {}) {
  const cached = readCache();
  const list = await remoteList();
  const remote = list[0] || null;
  for (const r of list) {
    if (!force && cached && r.meta.refDate < (cached.meta.refDate || '')) break;   // la copia nel browser è più recente
    try {
      const text = await fetchOk(r.base + 'stfi-latest.csv', 'text', 30000);
      const meta = { refDate: r.meta.refDate, publishedAt: r.meta.fetchedAt || null, loadedAt: new Date().toISOString(),
        url: new URL(r.base + 'stfi-latest.csv', location.href).href, source: 'auto', from: 'network' };
      return { text, meta, remote };
    } catch { /* si prova l'altra fonte, poi la copia nel browser */ }
  }
  if (force || !cached) return null;
  return { text: cached.text, meta: { ...cached.meta, from: 'cache' }, remote };
}

export async function loadDemo() {
  const text = await fetchOk('./tests/fixtures/stfi-synthetic.csv', 'text', 15000);
  return { text, meta: { refDate: null, source: 'demo' } };
}
