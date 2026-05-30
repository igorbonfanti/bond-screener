/* ============================================================
   filters.js — Filtraggio universo bond
   Ogni filtro è opzionale (null / '' = non applicato).
   Replica i filtri del notebook + ricerca testuale.
   ============================================================ */
const BSFilters = (() => {

  function num(v) { return (v === '' || v == null) ? null : (isNaN(+v) ? null : +v); }
  function dateVal(s) { return s ? BSData.toDate(s) : null; }

  // Valori distinti / range utili per popolare la UI dei filtri
  function facets(bonds) {
    const issuers = new Set(), currencies = new Set(), ratings = new Set(), countries = new Set();
    let dMin = Infinity, dMax = -Infinity, pMin = Infinity, pMax = -Infinity;
    let rMin = null, rMax = null;
    for (const b of bonds) {
      if (b.issuercode) issuers.add(b.issuercode);
      if (b.currencycode) currencies.add(b.currencycode);
      if (b.ratingsp) ratings.add(b.ratingsp);
      if (b._country) countries.add(b._country);
      if (isFinite(b.grossduration)) { dMin = Math.min(dMin, b.grossduration); dMax = Math.max(dMax, b.grossduration); }
      if (isFinite(b.price)) { pMin = Math.min(pMin, b.price); pMax = Math.max(pMax, b.price); }
      if (b.redemptiondate instanceof Date) {
        if (!rMin || b.redemptiondate < rMin) rMin = b.redemptiondate;
        if (!rMax || b.redemptiondate > rMax) rMax = b.redemptiondate;
      }
    }
    return {
      issuers: [...issuers].sort(),
      currencies: [...currencies].sort(),
      ratings: [...ratings].sort((a, b) => (BSData.RATING_MAP[b] || 0) - (BSData.RATING_MAP[a] || 0)),
      countries: [...countries].sort(),
      durationRange: isFinite(dMin) ? [dMin, dMax] : [0, 30],
      priceRange: isFinite(pMin) ? [pMin, pMax] : [0, 200],
      redemptionRange: [rMin, rMax]
    };
  }

  // Applica i filtri. Ritorna { result, log:[{label,count}] }
  function apply(bonds, f) {
    f = f || {};
    let cur = bonds.slice();
    const log = [{ label: 'Totale', count: cur.length }];
    const push = (label) => log.push({ label, count: cur.length });

    if (f.issuers && f.issuers.length) {
      const set = new Set(f.issuers);
      cur = cur.filter(b => set.has(b.issuercode)); push('Emittenti');
    }
    if (f.currencies && f.currencies.length) {
      const set = new Set(f.currencies);
      cur = cur.filter(b => set.has(b.currencycode)); push('Valute');
    }
    if (f.countries && f.countries.length) {
      const set = new Set(f.countries);
      cur = cur.filter(b => set.has(b._country)); push('Paesi');
    }
    const dMin = num(f.durationMin), dMax = num(f.durationMax);
    if (dMin != null) { cur = cur.filter(b => isFinite(b.grossduration) && b.grossduration >= dMin); push('Duration min'); }
    if (dMax != null) { cur = cur.filter(b => isFinite(b.grossduration) && b.grossduration <= dMax); push('Duration max'); }

    const pMin = num(f.priceMin), pMax = num(f.priceMax);
    if (pMin != null) { cur = cur.filter(b => isFinite(b.price) && b.price >= pMin); push('Prezzo min'); }
    if (pMax != null) { cur = cur.filter(b => isFinite(b.price) && b.price <= pMax); push('Prezzo max'); }

    const rMin = dateVal(f.redemptionMin), rMax = dateVal(f.redemptionMax);
    if (rMin) { cur = cur.filter(b => b.redemptiondate instanceof Date && b.redemptiondate >= rMin); push('Scadenza da'); }
    if (rMax) { cur = cur.filter(b => b.redemptiondate instanceof Date && b.redemptiondate <= rMax); push('Scadenza a'); }

    const yMin = num(f.yieldMin);
    if (yMin != null) { cur = cur.filter(b => isFinite(b.grossytm) && b.grossytm >= yMin); push('Yield min'); }
    const yMax = num(f.yieldMax);
    if (yMax != null) { cur = cur.filter(b => isFinite(b.grossytm) && b.grossytm <= yMax); push('Yield max'); }

    const cMin = num(f.couponMin), cMax = num(f.couponMax);
    if (cMin != null) { cur = cur.filter(b => isFinite(b.currentcouponrate) && b.currentcouponrate >= cMin); push('Cedola min'); }
    if (cMax != null) { cur = cur.filter(b => isFinite(b.currentcouponrate) && b.currentcouponrate <= cMax); push('Cedola max'); }

    const vMin = num(f.volumeMin), vMax = num(f.volumeMax);
    if (vMin != null) { cur = cur.filter(b => isFinite(b.volumevalue) && b.volumevalue >= vMin); push('Volume min'); }
    if (vMax != null) { cur = cur.filter(b => isFinite(b.volumevalue) && b.volumevalue <= vMax); push('Volume max'); }

    if (f.ratingMin) {
      const minScore = BSData.RATING_MAP[f.ratingMin] || 0;
      cur = cur.filter(b => b._ratingScore >= minScore); push('Rating min');
    }

    if (f.search && f.search.trim()) {
      const q = f.search.trim().toLowerCase();
      cur = cur.filter(b =>
        (b.description && String(b.description).toLowerCase().includes(q)) ||
        (b.isincode && b.isincode.toLowerCase().includes(q)));
      push('Ricerca');
    }

    // Ordina per yield decrescente (come nel notebook)
    cur.sort((a, b) => (b.grossytm || -Infinity) - (a.grossytm || -Infinity));
    return { result: cur, log };
  }

  return { facets, apply };
})();
