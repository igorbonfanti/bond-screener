/* ============================================================
   ladder.js — Costruzione bond ladder (v2)
   Metodi: Greedy, Ottimizzato (branch & bound), Manuale.
   Obiettivo selezionabile:
     - 'yield'  : massimizza il rendimento totale a scadenza (grossytm)
     - 'cedole' : massimizza la cedola NETTA, e a parità massimizza lo yield
                  (ottimizzazione lessicografica)
   Vincolo opzionale: duration MEDIA di portafoglio <= durationMax.
   Sempre equipesato (capitale uguale per gradino).
   ============================================================ */
const BSLadder = (() => {

  const DAY = 86400 * 1000;
  const W = 1e9; // peso lessicografico: cedola netta primaria, yield secondario

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

  function targetDates(params) {
    const first = parseFirstMaturity(params.primaScadenza);
    if (!first) return [];
    const out = [];
    for (let i = 0; i < params.numeroStep; i++) out.push(addMonths(first, i * params.intervalloMesi));
    return out;
  }

  function eligibleByRating(bonds, ratingMin) {
    const min = ratingMin ? (BSData.RATING_MAP[ratingMin] || 0) : 0;
    return bonds.filter(b => b._ratingScore >= min);
  }

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

  /* ---------------- fiscalità e cedole ---------------- */

  // Aliquota: 12,5% per titoli di Stato / sovranazionali whitelist, 26% altrimenti
  function taxRate(b) { return /^(GOV|SOV)[_\-]/i.test(b.issuercode || '') ? 0.125 : 0.26; }

  // Rendimento cedolare corrente LORDO (%) = cedola annua / prezzo
  function grossCurrentYield(b, couponScale) {
    const price = isFinite(b.price) && b.price > 0 ? b.price : 100;
    const cpn = (isFinite(b.currentcouponrate) ? b.currentcouponrate : 0) * (couponScale || 1); // % per 100 nom.
    return cpn / price * 100;
  }
  // Punteggio cedolare NETTO per bond (proporzionale al reddito netto a parità di capitale)
  function netCouponScore(b, couponScale) { return grossCurrentYield(b, couponScale) * (1 - taxRate(b)); }

  // Valore di un bond secondo l'obiettivo (con tie-break lessicografico per le cedole)
  function valueOf(b, objective, couponScale) {
    if (objective === 'cedole') return netCouponScore(b, couponScale) * W + (b.grossytm || 0);
    return (b.grossytm || 0);
  }

  /* ---------------- GREEDY ---------------- */
  // Sceglie per ogni gradino il bond "migliore" secondo l'obiettivo (miope).
  // NB: non garantisce il vincolo di duration di portafoglio (usa l'Ottimizzato per quello).
  function buildGreedy(bonds, params) {
    const obj = params.objective || 'yield';
    const cs = params.couponScale || 1;
    const eligible = eligibleByRating(bonds, params.ratingMin);
    const targets = targetDates(params);
    const perStep = bondsPerStep(eligible, targets, params.giorniTolleranza);
    const usedIsin = new Set();
    const issuerCount = {}, countryCount = {};
    const maxIss = params.maxBondPerEmittente || Infinity;
    const maxCnt = params.maxBondPerPaese || Infinity;

    const slots = perStep.map(s => {
      const ordered = s.bonds.slice().sort((a, b) => valueOf(b, obj, cs) - valueOf(a, obj, cs));
      let pick = null;
      for (const b of ordered) {
        if (usedIsin.has(b.isincode)) continue;
        if ((issuerCount[b.issuercode] || 0) >= maxIss) continue;
        if ((countryCount[b._country] || 0) >= maxCnt) continue;
        pick = b; break;
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
  // Massimizza Σ valueOf scegliendo 1 bond per gradino (o nessuno), ISIN unico,
  // rispettando cap per emittente/paese e (opz.) duration media <= durationMax.
  function buildOptimized(bonds, params) {
    const obj = params.objective || 'yield';
    const cs = params.couponScale || 1;
    const eligible = eligibleByRating(bonds, params.ratingMin);
    const targets = targetDates(params);
    const perStep = bondsPerStep(eligible, targets, params.giorniTolleranza);
    const maxIss = params.maxBondPerEmittente || Infinity;
    const maxCnt = params.maxBondPerPaese || Infinity;
    const durMax = (params.durationMax != null && isFinite(params.durationMax)) ? +params.durationMax : Infinity;
    const CAP = 25;
    const NODE_BUDGET = 300000;
    const N = perStep.length;

    // Ordina gli step dal più vincolato (meno candidati) per potare prima
    const order = perStep.map((s, i) => i).sort((a, b) => perStep[a].bonds.length - perStep[b].bonds.length);
    // Candidati per step ordinati per valore obiettivo desc, troncati a CAP
    const cand = order.map(i => perStep[i].bonds.slice().sort((a, b) => valueOf(b, obj, cs) - valueOf(a, obj, cs)).slice(0, CAP));
    // Bound ammissibile: miglior valore residuo
    const suffixBest = new Array(N + 1).fill(0);
    for (let k = N - 1; k >= 0; k--) {
      const top = cand[k].length ? Math.max(0, valueOf(cand[k][0], obj, cs)) : 0;
      suffixBest[k] = suffixBest[k + 1] + top;
    }

    let best = { value: -Infinity, choice: null };
    let nodes = 0;
    const issuerCount = {}, countryCount = {};
    const usedIsin = new Set();
    const choice = new Array(N).fill(null);

    function dfs(k, sum, curDur, curCount) {
      if (++nodes > NODE_BUDGET) return;
      if (sum + suffixBest[k] <= best.value) return;          // pruning obiettivo
      if (durMax !== Infinity && curDur > durMax * N) return; // pruning duration (infattibile)
      if (k === N) {
        // ammissibile se almeno un bond e duration media <= durMax
        if (curCount > 0 && (durMax === Infinity || curDur <= durMax * curCount) && sum > best.value) {
          best = { value: sum, choice: choice.slice() };
        }
        return;
      }
      for (const b of cand[k]) {
        if (usedIsin.has(b.isincode)) continue;
        if ((issuerCount[b.issuercode] || 0) >= maxIss) continue;
        if ((countryCount[b._country] || 0) >= maxCnt) continue;
        usedIsin.add(b.isincode);
        issuerCount[b.issuercode] = (issuerCount[b.issuercode] || 0) + 1;
        countryCount[b._country] = (countryCount[b._country] || 0) + 1;
        choice[k] = b;
        dfs(k + 1, sum + valueOf(b, obj, cs), curDur + (isFinite(b.grossduration) ? b.grossduration : 0), curCount + 1);
        choice[k] = null;
        usedIsin.delete(b.isincode);
        issuerCount[b.issuercode]--;
        countryCount[b._country]--;
        if (nodes > NODE_BUDGET) return;
      }
      // Opzione: gradino vuoto
      choice[k] = null;
      dfs(k + 1, sum, curDur, curCount);
    }
    dfs(0, 0, 0, 0);

    const byOrig = new Array(N).fill(null);
    if (best.choice) best.choice.forEach((b, k) => { byOrig[order[k]] = b; });
    const slots = perStep.map((s, i) => ({ step: s.step, target: s.target, bond: byOrig[i], candidates: s.bonds.length }));
    return { slots, targets, perStep, exhausted: nodes > NODE_BUDGET, feasible: !!best.choice };
  }

  /* ---------------- MANUALE ---------------- */
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
      avgNetYield: mean('netytm'),
      avgDuration: mean('grossduration'),
      avgCoupon: mean('currentcouponrate'),
      totalYield: bonds.reduce((a, b) => a + (b.grossytm || 0), 0),
      complete: n === slots.length && slots.length > 0
    };
  }

  // Report cedolare (lordo/imposta/netto) — in € se passi budget, sempre in % di portafoglio
  function couponReport(slots, opts) {
    opts = opts || {};
    const cs = opts.couponScale || 1;
    const budget = +opts.budget > 0 ? +opts.budget : 0;
    const bonds = slots.map(s => s.bond).filter(Boolean);
    const n = bonds.length;
    const perRung = budget && n ? budget / n : 0;
    let grossCY = 0, netCY = 0, grossEur = 0, taxEur = 0, netEur = 0;
    const perBond = [];
    bonds.forEach(b => {
      const gcy = grossCurrentYield(b, cs);          // % cedola lorda / prezzo
      const tr = taxRate(b);
      grossCY += gcy; netCY += gcy * (1 - tr);
      let gE = 0, tE = 0, nE = 0;
      if (perRung > 0) {
        const price = isFinite(b.price) && b.price > 0 ? b.price : 100;
        const nominal = perRung / price * 100;
        gE = nominal * ((isFinite(b.currentcouponrate) ? b.currentcouponrate : 0) * cs) / 100;
        tE = gE * tr; nE = gE - tE;
        grossEur += gE; taxEur += tE; netEur += nE;
      }
      perBond.push({ isin: b.isincode, taxRate: tr, grossCurrentYield: gcy, grossEur: gE, taxEur: tE, netEur: nE });
    });
    return {
      n, budget, perRung,
      grossCurrentYield: n ? grossCY / n : 0,        // % media (= reddito cedolare lordo / capitale)
      netCurrentYield: n ? netCY / n : 0,
      grossCoupon: grossEur, tax: taxEur, netCoupon: netEur,   // € annui
      perBond
    };
  }

  /* ---------------- LADDER ESISTENTE (portafoglio reale) ---------------- */
  // Aggancia una lista di ISIN posseduti ai dati correnti.
  // text: righe "ISIN" oppure "ISIN;nominale" (anche separato da , o tab).
  function matchHoldings(text, allBonds, defaultNominal) {
    const def = +defaultNominal > 0 ? +defaultNominal : 10000;
    const byIsin = new Map(allBonds.map(b => [String(b.isincode).toUpperCase(), b]));
    const holdings = [], unmatched = [];
    String(text || '').split(/\r?\n/).forEach(line => {
      const s = line.trim(); if (!s) return;
      const parts = s.split(/[;,\t]+/).map(x => x.trim());
      const isin = (parts[0] || '').toUpperCase();
      if (!isin) return;
      const nRaw = parts[1] != null && parts[1] !== '' ? BSData.toNum(parts[1]) : def;
      const nominal = isFinite(nRaw) && nRaw > 0 ? nRaw : def;
      const bond = byIsin.get(isin);
      if (bond) holdings.push({ bond, nominal });
      else unmatched.push(parts[0]);
    });
    return { holdings, unmatched };
  }

  // Costruisce gli "slot" del portafoglio (ordinati per scadenza), con nominale per bond
  function portfolioSlots(holdings) {
    return holdings.slice()
      .sort((a, b) => {
        const da = a.bond.redemptiondate instanceof Date ? a.bond.redemptiondate.getTime() : 0;
        const db = b.bond.redemptiondate instanceof Date ? b.bond.redemptiondate.getTime() : 0;
        return da - db;
      })
      .map((h, i) => ({ step: i + 1, target: h.bond.redemptiondate instanceof Date ? h.bond.redemptiondate : new Date(), bond: h.bond, nominal: h.nominal, candidates: 1 }));
  }

  // Analisi ponderata per valore di mercato del portafoglio esistente
  function portfolioReport(slots, couponScale) {
    const cs = couponScale || 1;
    let mv = 0, face = 0, wYtm = 0, wNet = 0, wDur = 0, grossC = 0, taxC = 0, netC = 0;
    const byIssuer = {}, byCountry = {};
    slots.forEach(s => {
      const b = s.bond; if (!b) return;
      const N = isFinite(s.nominal) && s.nominal > 0 ? s.nominal : 0;
      const price = isFinite(b.price) && b.price > 0 ? b.price : 100;
      const value = N * price / 100;
      mv += value; face += N;
      wYtm += value * (b.grossytm || 0);
      wNet += value * (isFinite(b.netytm) ? b.netytm : (b.grossytm || 0));
      wDur += value * (isFinite(b.grossduration) ? b.grossduration : 0);
      const cpnPct = (isFinite(b.currentcouponrate) ? b.currentcouponrate : 0) * cs; // % per 100 nom.
      const gC = N * cpnPct / 100, tr = taxRate(b);
      grossC += gC; taxC += gC * tr; netC += gC * (1 - tr);
      byIssuer[b.issuercode] = (byIssuer[b.issuercode] || 0) + value;
      byCountry[b._country] = (byCountry[b._country] || 0) + value;
    });
    const toArr = (o) => Object.entries(o).map(([k, v]) => ({ key: k, count: v, value: v, share: mv ? v / mv : 0 }))
      .sort((a, b) => b.value - a.value);
    return {
      n: slots.length, marketValue: mv, face,
      avgYield: mv ? wYtm / mv : 0, avgNetYield: mv ? wNet / mv : 0, avgDuration: mv ? wDur / mv : 0,
      grossCoupon: grossC, tax: taxC, netCoupon: netC,
      grossCouponYield: mv ? grossC / mv * 100 : 0, netCouponYield: mv ? netC / mv * 100 : 0,
      byIssuer: toArr(byIssuer), byCountry: toArr(byCountry)
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
    buildGreedy, buildOptimized, buildManual, metrics, couponReport, exposure, endOfMonth,
    taxRate, grossCurrentYield, netCouponScore, valueOf,
    matchHoldings, portfolioSlots, portfolioReport
  };
})();
