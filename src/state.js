/* Stato delle impostazioni: valori predefiniti + salvataggio nel browser (la bozza non si perde). */
import { parts } from './core/dates.js';

const KEY = 'bondladder.v3.settings';

export function defaults(refDay) {
  const y = refDay != null ? parts(refDay).y : new Date().getFullYear();
  return {
    goal: null,                                   // 'capital' | 'income'
    capital: {
      start: 'amounts',                           // 'amounts' (importi che mi servono) | 'budget' (capitale che ho)
      schedule: 'yearly',                         // 'yearly' | 'semester' | 'dates'
      yearFrom: y + 1, yearTo: y + 10,
      amount: 10000, budget: 100000,
      dates: [
        { label: 'Obiettivo 1', date: `${y + 2}-09-01`, amount: 20000 },
        { label: 'Obiettivo 2', date: `${y + 5}-06-30`, amount: 30000 }
      ],
      flexMonths: 6,
      useCoupons: true,
      accumulate: false,                          // cedole incassate prima della scala: accantonate per le prime scadenze
      rounding: 'up'                              // 'up' (almeno l'importo) | 'nearest'
    },
    income: {
      start: 'capital',                           // 'capital' | 'target'
      capital: 100000, monthlyTarget: 300,
      yearFrom: y + 2, yearTo: y + 10,
      ladder: true,
      tradeoff: 1                                 // 1 = rendita più regolare possibile … 0.8 = più rendimento
    },
    basket: {
      groups: { euro: true, extra: false, sov: true },
      excluded: [],                               // emittenti tolti a mano
      minRating: 'BBB-',
      belowPar: true, maxPrice: 100,
      minLiquidity: 1,
      issuerCap: 1 / 3,
      zainetto: false,
      includeInflation: false,
      includeStepUp: true
    },
    fixed: {}                                     // etichetta gradino → ISIN scelto a mano (solo capitale)
  };
}

function merge(base, saved) {
  if (saved == null || typeof saved !== 'object' || Array.isArray(saved)) return saved ?? base;
  const out = { ...base };
  for (const k of Object.keys(saved)) {
    out[k] = base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]) ? merge(base[k], saved[k]) : saved[k];
  }
  return out;
}

export function loadSettings(refDay) {
  const d = defaults(refDay);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const st = merge(d, JSON.parse(raw));
    // anni nel passato rispetto ai dati → riallinea
    const y = d.capital.yearFrom - 1;
    for (const k of ['capital', 'income']) {
      if (st[k].yearFrom <= y) st[k].yearFrom = d[k].yearFrom;
      if (st[k].yearTo < st[k].yearFrom) st[k].yearTo = st[k].yearFrom + 5;
    }
    return st;
  } catch { return d; }
}

export function saveSettings(st) {
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* spazio pieno o navigazione privata */ }
}
