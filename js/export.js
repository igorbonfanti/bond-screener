/* ============================================================
   export.js — Export Excel (SheetJS)
   Esporta il bond ladder (con metriche e parametri) e l'universo filtrato.
   ============================================================ */
const BSExport = (() => {

  const fmtDate = (d) => d instanceof Date ? d.toLocaleDateString('it-IT') :
    (d ? new Date(d).toLocaleDateString('it-IT') : '');

  function ladderRows(slots) {
    return slots.map(s => ({
      Step: s.step,
      'Scadenza target': fmtDate(s.target),
      ISIN: s.bond ? s.bond.isincode : '—',
      Descrizione: s.bond ? s.bond.description : '(vuoto)',
      Scadenza: s.bond ? fmtDate(s.bond.redemptiondate) : '',
      Emittente: s.bond ? s.bond.issuercode : '',
      Paese: s.bond ? s.bond._country : '',
      'Yield %': s.bond ? round(s.bond.grossytm) : '',
      Duration: s.bond ? round(s.bond.grossduration) : '',
      'Cedola': s.bond ? round(s.bond.currentcouponrate) : '',
      Rating: s.bond ? s.bond.ratingsp : '',
      Prezzo: s.bond ? round(s.bond.price) : ''
    }));
  }
  const round = (n) => isFinite(n) ? Math.round(n * 10000) / 10000 : '';

  function ladder(slots, metrics, params, name) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ladderRows(slots)), 'Bond Ladder');

    const metr = [
      { Metrica: 'Bond inseriti', Valore: `${metrics.count} / ${metrics.total}` },
      { Metrica: 'Yield medio %', Valore: round(metrics.avgYield) },
      { Metrica: 'Duration media', Valore: round(metrics.avgDuration) },
      { Metrica: 'Cedola media', Valore: round(metrics.avgCoupon) }
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metr), 'Metriche');

    const par = Object.entries(params || {}).map(([k, v]) => ({ Parametro: k, Valore: v }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(par), 'Parametri');

    const safe = (name || 'bond_ladder').replace(/[^\w\-]+/g, '_');
    XLSX.writeFile(wb, `${safe}.xlsx`);
  }

  function universe(bonds, cols) {
    const columns = cols && cols.length ? cols : Object.keys(bonds[0] || {}).filter(c => !c.startsWith('_'));
    const rows = bonds.map(b => {
      const r = {};
      columns.forEach(c => {
        r[c] = b[c] instanceof Date ? fmtDate(b[c]) : b[c];
      });
      r.Paese = b._country;
      return r;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Universo filtrato');
    XLSX.writeFile(wb, `universo_bond_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return { ladder, universe };
})();
