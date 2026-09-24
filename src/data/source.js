/* Da dove arrivano i dati del giorno:
   1. automaticamente: data/stfi-latest.csv, pubblicato ogni sera dal workflow GitHub
      (letto dal sito stesso e, se più aggiornato, direttamente dal repository);
   2. copia locale nel browser (funziona anche offline);
   3. file caricato a mano dall'utente (scaricato da simpletoolsforinvestors.eu). */

const CACHE_KEY = 'bondladder.v3.data';
const SOURCES = ['./data/', 'https://raw.githubusercontent.com/igorbonfanti/bond-screener/main/data/'];
export const STFI_PAGE = 'https://www.simpletoolsforinvestors.eu/documentivari.php';

async function fetchOk(url, as) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status}`);
  return as === 'json' ? r.json() : r.text();
}

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

/** Dati più recenti disponibili: {text, meta:{refDate:'aaaa-mm-gg', source:'auto'|'manual'|'demo', fetchedAt}} o null. */
export async function loadLatest() {
  const cached = readCache();
  const metas = await Promise.all(SOURCES.map(async base => {
    try { const meta = await fetchOk(base + 'stfi-latest.json', 'json'); return meta && meta.refDate ? { base, meta } : null; }
    catch { return null; }
  }));
  const best = metas.filter(Boolean).sort((a, b) => b.meta.refDate.localeCompare(a.meta.refDate))[0];
  if (best && (!cached || best.meta.refDate >= (cached.meta.refDate || ''))) {
    try {
      const text = await fetchOk(best.base + 'stfi-latest.csv', 'text');
      const meta = { refDate: best.meta.refDate, fetchedAt: best.meta.fetchedAt || null, source: 'auto' };
      writeCache(text, meta);
      return { text, meta };
    } catch { /* si ripiega sulla copia locale */ }
  }
  return cached;
}

export async function loadDemo() {
  const text = await fetchOk('./tests/fixtures/stfi-synthetic.csv', 'text');
  return { text, meta: { refDate: null, source: 'demo' } };
}
