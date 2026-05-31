/* ============================================================
   ladder.js — Costruzione bond ladder
   Metodi: Greedy (come notebook), Ottimizzato (branch & bound),
   Manuale. + metriche e analisi di diversificazione.
   ============================================================ */
const BSLadder = (() => {

  const DAY = 86400 * 1000;

  function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, d.getDate()); }

  // Interpreta 'M/YYYY', 'MM/YYYY', 'YYYY-MM' come fine mese
  function parseFirstMaturity(str) {
    if (!str) return null;
    const s = String(str).trim();
    let m = s.match(/^(\d{1,2})[\/\-.](\d{4})$/);            // M/YYYY
    if (m) return endOfMonth(new Date(+m[2], +m[1] - 1, 1));
    m = s.match(/^(\d{4})[\/\-.](\d{1,2})$/);                // YYYY-MM
    if (m) return endOfMonth(new Date(+m[1], +m[2] - 1, 1));
    const d = BSData.toDate(s);
    return d ? endOfMonth(d) : null;
  }

  // Date di scadenza target del ladder
  function targetDates(params) {
    const first = parseFirstMaturity(params.primaScadenza);
    if (!first) return [];
    const out = [];
    for (let i = 0; i < params.numeroStep; i++) out.push(addMonths(first, i * params.intervalloMesi));
    return out;
  }

  // Bond eleggibili (filtro rating S&P minimo)
  function eligibleByRating(bonds, ratingMin) {
    const min = ratingMin ? (BSData.RATING_MAP[ratingMin] || 0) : 0;
    return bonds.filter(b => b._ratingScore >= min);
  }

  // Per ogni target, i bond entro la finestra ±tolleranza (ordinati per yield desc)
  function bondsPerStep(eligible, targets, giorniTolleranza) {
    const tol = giorniTolleranza * DAY;
    return targets.map((t, i) => {
      const min = t.getTime() - tol, max = t.getTime() + tol;
      const list = eligible.filter(b => b.redemptiondate instanceof Date &&
        b.redemptiondate.getTime() >= min && b.redemptiondate.getTime() <= max)
        .sort((a, b) => (b.grossytm || -Infinity) - (a.grossytm || -Infinity));
      return { step: i + 1, target: t, bonds: list };
    });
  }

  /* ---------------- GREEDY ---------------- */
  // Ritorna array di slot {step, target, bond|null}. A differenza del notebook
  // non azzera tutto se uno step fallisce: mostra gli slot vuoti.
  function buildGreedy(bonds, params) {
    const eligible = eligibleByRating(bonds, params.ratingMin);
    const targets = targetDates(params);
    const perStep = bondsPerStep(eligible, targets, params.giorniTolleranza);
    const usedIsin = new Set();
    const issuerCount = {}, countryCount = {};
    const maxIss = params.maxBondPerEmittente || Infinity;
    const maxCnt = params.maxBondPerPaese || Infinity;

    const slots = perStep.map(s => {
      let pick = null;
      for (const b of s.bonds) {
        if (usedIsin.has(b.isincode)) continue;
        if ((issuerCount[b.issuercode] || 0) >= maxIss) continue;
        if ((countryCount[b._country] || 0) >= maxCnt) continue;
        pick = b; break; // già ordinati per yield desc -> il primo valido è il migliore
      }
      if (pick) {
        usedIsin.add(pick.isincode);
        issuerCount[pick.issuercode] = (issuerCount[pick.issuercode] || 0) + 1;
        countryCount[pick._country] = (countryCount[pick._country] || 0) + 1;
      }
      return { step: s.step, target: s.target, bond: pick, candidates: s.bonds.length };
    });
    return { slots, targets, perStep };
  }

  /* ---------------- OTTIMIZZATO (branch & bound) ---------------- */
  // Massimizza la somma dei rendimenti scegliendo 1 bond per step (o nessuno),
  // ogni ISIN una sola volta, rispettando i limiti per emittente e per paese.
  function buildOptimized(bonds, params) {
    const eligible = eligibleByRating(bonds, params.ratingMin);
    const targets = targetDates(params);
    const perStep = bondsPerStep(eligible, targets, params.giorniTolleranza);
    const maxIss = params.maxBondPerEmittente || Infinity;
    const maxCnt = params.maxBondPerPaese || Infinity;
    const CAP = 25;            // candidati massimi per step
    const NODE_BUDGET = 300000;

    // Ordina gli step dal più vincolato (meno candidati) per potare prima
    const order = perStep.map((s, i) => i).sort((a, b) => perStep[a].bonds.length - perStep[b].bonds.length);
    const cand = order.map(i => perStep[i].bonds.slice(0, CAP));
    // Miglior yield residuo per pruning (bound ammissibile)
    const suffixBest = new Array(order.length + 1).fill(0);
    for (let k = order.length - 1; k >= 0; k--) {
      const top = cand[k].length ? Math.max(0, cand[k][0].grossytm || 0) : 0;
      suffixBest[k] = suffixBest[k + 1] + top;
    }

    let best = { sum: -1, choice: null };
    let nodes = 0;
    const issuerCount = {}, countryCount = {};
    const usedIsin = new Set();
    const choice = new Array(order.length).fill(null);

    function dfs(k, sum) {
      if (++nodes > NODE_BUDGET) return;            // budget di sicurezza
      if (sum + suffixBest[k] <= best.sum) return;  // pruning
      if (k === order.length) {
        if (sum > best.sum) best = { sum, choice: choice.slice() };
        return;
      }
      // Opzione: scegli un candidato valido
      for (const b of cand[k]) {
        if (usedIsin.has(b.isincode)) continue;
        if ((issuerCount[b.issuercode] || 0) >= maxIss) continue;
        if ((countryCount[b._country] || 0) >= maxCnt) continue;
        usedIsin.add(b.isincode);
        issuerCount[b.issuercode] = (issuerCount[b.issuercode] || 0) + 1;
        countryCount[b._country] = (countryCount[b._country] || 0) + 1;
        choice[k] = b;
        dfs(k + 1, sum + (b.grossytm || 0));
        choice[k] = null;
        usedIsin.delete(b.isincode);
        issuerCount[b.issuercode]--;
        countryCount[b._country]--;
        if (nodes > NODE_BUDGET) return;
      }
      // Opzione: lascia lo step vuoto (necessaria se nessun candidato è collocabile)
      choice[k] = null;
      dfs(k + 1, sum);
    }
    dfs(0, 0);

    // Rimappa le scelte all'ordine originale degli step
    const byOrig = new Array(perStep.length).fill(null);
    if (best.choice) best.choice.forEach((b, k) => { byOrig[order[k]] = b; });
    const slots = perStep.map((s, i) => ({ step: s.step, target: s.target, bond: byOrig[i], candidates: s.bonds.length }));
    return { slots, targets, perStep, exhausted: nodes > NODE_BUDGET };
  }

  /* ---------------- MANUALE ---------------- */
  // selections: array di ISIN (o '') per step. perStep dal calcolo corrente.
  function buildManual(selections, perStep) {
    return perStep.map((s, i) => {
      const isin = selections[i];
      const bond = isin ? s.bonds.find(b => b.isincode === isin) || null : null;
      return { step: s.step, target: s.target, bond, candidates: s.bonds.length };
    });
  }

  /* ---------------- METRICHE & DIVERSIFICAZIONE ---------------- */
  function metrics(slots) {
    const bonds = slots.map(s => s.bond).filter(Boolean);
    const n = bonds.length;
    const mean = (sel) => n ? bonds.reduce((a, b) => a + (isFinite(b[sel]) ? b[sel] : 0), 0) / n : 0;
    return {
      count: n,
      total: slots.length,
      avgYield: mean('grossytm'),
      avgDuration: mean('grossduration'),
      avgCoupon: mean('currentcouponrate'),
      totalYield: bonds.reduce((a, b) => a + (b.grossytm || 0), 0),
      complete: n === slots.length && slots.length > 0
    };
  }

  function exposure(slots) {
    const bonds = slots.map(s => s.bond).filter(Boolean);
    const byIssuer = {}, byCountry = {};
    bonds.forEach(b => {
      byIssuer[b.issuercode] = (byIssuer[b.issuercode] || 0) + 1;
      byCountry[b._country] = (byCountry[b._country] || 0) + 1;
    });
    const toArr = (o) => Object.entries(o).map(([k, v]) => ({ key: k, count: v, share: v / bonds.length }))
      .sort((a, b) => b.count - a.count);
    return { byIssuer: toArr(byIssuer), byCountry: toArr(byCountry), n: bonds.length };
  }

  return {
    targetDates, eligibleByRating, bondsPerStep, parseFirstMaturity,
    buildGreedy, buildOptimized, buildManual, metrics, exposure, endOfMonth
  };
})();
