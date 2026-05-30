/* ============================================================
   data.js — Caricamento e normalizzazione dati obbligazioni
   Replica la pulizia del notebook Colab "bond screener":
   - virgola decimale -> punto
   - date gg/mm/aaaa -> Date
   - rating S&P -> score numerico
   - colonne derivate: paese, tipo emittente
   ============================================================ */
const BSData = (() => {

  // Colonne che nel file sono numeriche ma arrivano come testo (virgola decimale)
  const NUMERIC_COLS = [
    'price', 'grossytm', 'grossduration', 'netytm', 'supernetytm',
    'supernetduration', 'ispread', 'zspread', 'currentcouponrate',
    'instantyield', 'issueprice', 'volumevalue'
  ];

  const DATE_COLS = ['redemptiondate', 'referencedate'];

  // Colonne da scartare (come nel notebook)
  const DROP_COLS = ['Unnamed: 28', 'ratingfitch'];

  // Mappa rating S&P -> punteggio numerico (come nel notebook)
  const RATING_MAP = {
    'AAA': 21, 'AA+': 20, 'AA': 19, 'AA-': 18,
    'A+': 17, 'A': 16, 'A-': 15,
    'BBB+': 14, 'BBB': 13, 'BBB-': 12,
    'BB+': 11, 'BB': 10, 'BB-': 9,
    'B+': 8, 'B': 7, 'B-': 6,
    'CCC+': 5, 'CCC': 4, 'CCC-': 3,
    'CC': 2, 'C': 1, 'D': 0
  };
  // Ordine rating dal migliore al peggiore (per dropdown)
  const RATING_ORDER = Object.keys(RATING_MAP);

  /* ---------- helpers di conversione ---------- */

  function toNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v == null) return NaN;
    let s = String(v).trim();
    if (!s || s === '-' || s.toLowerCase() === 'nan') return NaN;
    // Se presenti sia '.' che ',' assumiamo '.' = separatore migliaia, ',' = decimale
    if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    s = s.replace(/[^0-9.\-eE]/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? NaN : n;
  }

  function toDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    // Numero seriale Excel
    if (typeof v === 'number') {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return isNaN(d) ? null : d;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); // gg/mm/aaaa
    if (m) {
      let [, dd, mm, yy] = m;
      yy = yy.length === 2 ? '20' + yy : yy;
      const d = new Date(+yy, +mm - 1, +dd);
      return isNaN(d) ? null : d;
    }
    m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/); // aaaa-mm-gg
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      return isNaN(d) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  // Estrae il codice paese dal codice emittente (es. GOV_AT -> AT, SOV_EU -> EU)
  function countryFromIssuer(issuer) {
    if (!issuer) return '—';
    const parts = String(issuer).split(/[_\-\s]/);
    return parts.length > 1 ? parts[parts.length - 1] : String(issuer);
  }

  /* ---------- parsing file (CSV / Excel) tramite SheetJS ---------- */

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const isCsv = /\.csv$/i.test(file.name);
      reader.onerror = () => reject(new Error('Errore lettura file'));
      reader.onload = (e) => {
        try {
          let wb;
          if (isCsv) {
            const text = new TextDecoder('utf-8').decode(new Uint8Array(e.target.result));
            // Rileva separatore: ';' (default file Colab) o ','
            const head = text.split(/\r?\n/)[0] || '';
            const FS = (head.split(';').length - 1) >= (head.split(',').length - 1) ? ';' : ',';
            wb = XLSX.read(text, { type: 'string', FS, raw: false });
          } else {
            wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
          }
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
          resolve(rows);
        } catch (err) { reject(err); }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ---------- normalizzazione ---------- */

  function normalizeRows(rawRows) {
    if (!rawRows || !rawRows.length) return { bonds: [], columns: [], referenceDate: null };

    // Header normalizzati (trim, lowercase) + mappa verso chiave originale
    const firstKeys = Object.keys(rawRows[0]);
    const keyMap = {};
    firstKeys.forEach(k => { keyMap[k] = String(k).trim(); });

    const bonds = rawRows.map(raw => {
      const b = {};
      for (const k of firstKeys) {
        const key = keyMap[k];
        if (DROP_COLS.includes(key) || DROP_COLS.includes(k)) continue;
        b[key] = raw[k];
      }
      // conversioni numeriche
      for (const c of NUMERIC_COLS) if (c in b) b[c] = toNum(b[c]);
      // conversioni date
      for (const c of DATE_COLS) if (c in b) b[c] = toDate(b[c]);
      // rating score
      b.ratingsp = b.ratingsp != null ? String(b.ratingsp).trim() : '';
      b._ratingScore = RATING_MAP[b.ratingsp] != null ? RATING_MAP[b.ratingsp] : 0;
      // colonne derivate
      b._country = countryFromIssuer(b.issuercode);
      b.isincode = b.isincode != null ? String(b.isincode).trim() : '';
      return b;
    }).filter(b => b.isincode); // scarta righe senza ISIN

    // colonne effettive
    const columns = bonds.length ? Object.keys(bonds[0]).filter(c => !c.startsWith('_')) : [];

    // data di riferimento = referencedate più frequente
    let referenceDate = null;
    const counts = {};
    for (const b of bonds) {
      const d = b.referencedate;
      if (d instanceof Date) {
        const key = d.toISOString().slice(0, 10);
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    let best = -1;
    for (const k in counts) if (counts[k] > best) { best = counts[k]; referenceDate = k; }

    return { bonds, columns, referenceDate };
  }

  // Rileva la convenzione delle cedole sull'intero dataset:
  // 100 se sono frazioni (es. 0,02 = 2%), 1 se sono già in percentuale (es. 2,2 = 2,2%).
  function couponScale(bonds) {
    let mx = 0, seen = false;
    for (const b of bonds || []) {
      const c = Math.abs(b.currentcouponrate);
      if (isFinite(c) && c > 0) { seen = true; if (c > mx) mx = c; }
    }
    return seen && mx < 0.5 ? 100 : 1;
  }

  // Pipeline completa: file -> {bonds, columns, referenceDate, rowCount}
  async function load(file) {
    const rawRows = await readFile(file);
    const norm = normalizeRows(rawRows);
    norm.rowCount = norm.bonds.length;
    norm.rawCount = rawRows.length;
    return norm;
  }

  // Ricostruzione da snapshot salvato (bond già normalizzati in JSON: date come stringhe ISO)
  function reviveBonds(plainBonds) {
    return plainBonds.map(b => {
      const r = { ...b };
      for (const c of DATE_COLS) if (r[c]) r[c] = toDate(r[c]);
      return r;
    });
  }

  // Serializza i bond (Date -> ISO) per il salvataggio
  function serializeBonds(bonds) {
    return bonds.map(b => {
      const r = { ...b };
      for (const c of DATE_COLS) if (r[c] instanceof Date) r[c] = r[c].toISOString();
      return r;
    });
  }

  return {
    NUMERIC_COLS, DATE_COLS, RATING_MAP, RATING_ORDER,
    toNum, toDate, countryFromIssuer, couponScale,
    load, normalizeRows, reviveBonds, serializeBonds
  };
})();
