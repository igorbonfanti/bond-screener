/* ============================================================
   app.js — Orchestrazione UI Bond Screener
   ============================================================ */
(() => {
  'use strict';

  /* ---------------- stato ---------------- */
  const S = {
    allBonds: [], columns: [], referenceDate: null,
    filtered: [], currentFile: null, snapshotId: null, snapshotName: null,
    facets: null, perStep: [], slots: [], ladderType: null,
    sort: { key: 'grossytm', dir: -1 }
  };

  /* ---------------- helpers ---------------- */
  const $ = (id) => document.getElementById(id);
  const fmtNum = (n, d = 2) => isFinite(n) ? Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const fmtDate = (d) => {
    if (!d) return '—';
    const dt = d instanceof Date ? d : new Date(d);
    return isNaN(dt) ? '—' : dt.toLocaleDateString('it-IT');
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function toast(msg, type = '') {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast ' + type;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 3200);
  }
  function ratingClass(score) { return score >= 15 ? 'r-high' : score >= 12 ? 'r-mid' : 'r-low'; }

  /* ---------------- init ---------------- */
  function init() {
    // Firebase status
    const fb = $('fbStatus');
    if (FIREBASE_OK) { fb.textContent = 'Cloud ✓'; fb.className = 'pill pill-ok'; }
    else { fb.textContent = 'Offline'; fb.className = 'pill pill-off'; }

    // Tabs
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

    // Rating selects
    fillRatingSelect($('fRating'), true);
    fillRatingSelect($('pRating'), false, 'BBB+');

    // Upload
    const dz = $('dropzone'), fi = $('fileInput');
    dz.addEventListener('click', () => fi.click());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
    fi.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

    // Filters
    $('applyFiltersBtn').addEventListener('click', applyFilters);
    $('resetFiltersBtn').addEventListener('click', resetFilters);
    $('presetBtn').addEventListener('click', applyPreset);
    $('fSearch').addEventListener('keydown', e => { if (e.key === 'Enter') applyFilters(); });
    $('exportUniverseBtn').addEventListener('click', () => {
      if (!S.filtered.length) return toast('Nessun bond da esportare', 'err');
      BSExport.universe(S.filtered, S.columns);
    });
    $('goLadderBtn').addEventListener('click', () => switchTab('ladder'));

    // Ladder
    $('buildGreedyBtn').addEventListener('click', () => buildLadder('greedy'));
    $('buildOptBtn').addEventListener('click', () => buildLadder('ottimizzato'));
    $('saveLadderBtn').addEventListener('click', saveLadder);
    $('exportLadderBtn').addEventListener('click', () => {
      if (!S.slots.length) return toast('Nessun ladder', 'err');
      BSExport.ladder(S.slots, BSLadder.metrics(S.slots), readParams(), $('ladderName').value || 'bond_ladder');
    });

    // History
    $('refreshHistBtn').addEventListener('click', loadHistory);
    $('closeCompareBtn').addEventListener('click', () => $('compareCard').classList.add('hidden'));

    // Snapshot save button (creato dinamicamente nel summary)
  }

  function fillRatingSelect(sel, allowEmpty, def) {
    sel.innerHTML = '';
    if (allowEmpty) sel.appendChild(new Option('(nessun minimo)', ''));
    BSData.RATING_ORDER.forEach(r => sel.appendChild(new Option(r, r)));
    if (def) sel.value = def;
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    if (name === 'storico') loadHistory();
  }

  /* ---------------- caricamento file ---------------- */
  async function handleFile(file) {
    toast('Lettura file…');
    try {
      const { bonds, columns, referenceDate, rowCount, rawCount } = await BSData.load(file);
      if (!bonds.length) return toast('Nessun bond valido trovato nel file', 'err');
      S.allBonds = bonds; S.columns = columns; S.referenceDate = referenceDate;
      S.currentFile = file; S.snapshotId = null; S.snapshotName = file.name;
      S.facets = BSFilters.facets(bonds);
      populateFilterFacets();
      renderUploadSummary(rowCount, rawCount, referenceDate, file.name, true);
      updateTopbar();
      // applica preset di default al primo caricamento + filtra
      applyPreset(true);
      toast(`Caricati ${rowCount} bond`, 'ok');
    } catch (e) {
      console.error(e); toast('Errore lettura: ' + e.message, 'err');
    }
  }

  function updateTopbar() {
    $('refDate').textContent = S.referenceDate ? 'Rif: ' + fmtDate(S.referenceDate) : 'Nessun dato';
    $('refDate').className = 'pill ' + (S.referenceDate ? 'pill-accent' : 'pill-muted');
    $('bondCount').textContent = S.allBonds.length + ' bond';
    $('bondCount').className = 'pill ' + (S.allBonds.length ? 'pill-accent' : 'pill-muted');
  }

  function renderUploadSummary(rows, raw, refDate, fileName, canSave) {
    const el = $('uploadSummary');
    el.classList.remove('hidden');
    el.innerHTML =
      `<div class="us-item">File: <b>${esc(fileName)}</b></div>` +
      `<div class="us-item">Bond validi: <b>${rows}</b>${raw && raw !== rows ? ` / ${raw} righe` : ''}</div>` +
      `<div class="us-item">Data riferimento: <b>${fmtDate(refDate)}</b></div>`;
    if (canSave) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary btn-sm';
      btn.textContent = '☁ Salva snapshot su cloud';
      btn.onclick = saveSnapshot;
      el.appendChild(btn);
    }
  }

  /* ---------------- filtri ---------------- */
  function populateFilterFacets() {
    const f = S.facets;
    const fillMulti = (sel, vals) => { sel.innerHTML = ''; vals.forEach(v => sel.appendChild(new Option(v, v))); };
    fillMulti($('fIssuers'), f.issuers);
    fillMulti($('fCurrencies'), f.currencies);
    fillMulti($('fCountries'), f.countries);
  }

  function readFilters() {
    const multi = (sel) => Array.from(sel.selectedOptions).map(o => o.value);
    return {
      issuers: multi($('fIssuers')), currencies: multi($('fCurrencies')), countries: multi($('fCountries')),
      durationMin: $('fDurMin').value, durationMax: $('fDurMax').value,
      priceMin: $('fPriceMin').value, priceMax: $('fPriceMax').value,
      redemptionMin: $('fRedMin').value, redemptionMax: $('fRedMax').value,
      yieldMin: $('fYieldMin').value, yieldMax: $('fYieldMax').value,
      couponMin: $('fCpnMin').value, couponMax: $('fCpnMax').value,
      volumeMin: $('fVolMin').value, volumeMax: $('fVolMax').value,
      ratingMin: $('fRating').value, search: $('fSearch').value
    };
  }

  function applyFilters() {
    if (!S.allBonds.length) return toast('Carica prima un file', 'err');
    const { result, log } = BSFilters.apply(S.allBonds, readFilters());
    S.filtered = result;
    renderFilterLog(log);
    renderUniverse();
    $('universeCount').textContent = result.length;
    BSCharts.yieldDistribution('chartYield', result);
  }

  function renderFilterLog(log) {
    $('filterLog').innerHTML = log.map(l => `<span class="flog">${esc(l.label)}: <b>${l.count}</b></span>`).join('');
  }

  function resetFilters() {
    ['fDurMin', 'fDurMax', 'fPriceMin', 'fPriceMax', 'fRedMin', 'fRedMax', 'fYieldMin', 'fYieldMax', 'fCpnMin', 'fCpnMax', 'fVolMin', 'fVolMax', 'fSearch'].forEach(id => $(id).value = '');
    ['fIssuers', 'fCurrencies', 'fCountries'].forEach(id => Array.from($(id).options).forEach(o => o.selected = false));
    $('fRating').value = '';
    applyFilters();
  }

  // Preset: emittenti GOV_/SOV_, valuta EUR, parametri del notebook
  function applyPreset(silent) {
    if (!S.facets) return;
    Array.from($('fIssuers').options).forEach(o => o.selected = /^(GOV|SOV)[_\-]/i.test(o.value));
    Array.from($('fCurrencies').options).forEach(o => o.selected = (o.value === 'EUR'));
    Array.from($('fCountries').options).forEach(o => o.selected = false);
    applyFilters();
    if (silent !== true) toast('Preset applicato', 'ok');
  }

  /* ---------------- tabella universo ---------------- */
  const UNI_COLS = [
    { k: 'isincode', l: 'ISIN', t: 'mono' },
    { k: 'description', l: 'Descrizione', t: 'text' },
    { k: 'redemptiondate', l: 'Scadenza', t: 'date' },
    { k: 'issuercode', l: 'Emittente', t: 'mono' },
    { k: '_country', l: 'Paese', t: 'mono' },
    { k: 'currencycode', l: 'Val', t: 'mono' },
    { k: 'grossytm', l: 'Yield %', t: 'num' },
    { k: 'grossduration', l: 'Duration', t: 'num' },
    { k: 'currentcouponrate', l: 'Cedola', t: 'num' },
    { k: 'price', l: 'Prezzo', t: 'num' },
    { k: 'ratingsp', l: 'Rating', t: 'rating' },
    { k: 'volumevalue', l: 'Vol', t: 'num' }
  ];

  function renderUniverse() {
    const tbl = $('universeTable');
    const rows = S.filtered.slice().sort((a, b) => {
      const { key, dir } = S.sort, va = a[key], vb = b[key];
      if (va instanceof Date || vb instanceof Date) return ((va ? va.getTime() : 0) - (vb ? vb.getTime() : 0)) * dir;
      if (typeof va === 'number' || typeof vb === 'number') return ((va || -Infinity) - (vb || -Infinity)) * dir;
      return String(va || '').localeCompare(String(vb || '')) * dir;
    });
    const head = '<thead><tr>' + UNI_COLS.map(c =>
      `<th class="${c.t === 'num' ? 'num' : ''}" data-k="${c.k}">${c.l}${S.sort.key === c.k ? ` <span class="arrow">${S.sort.dir < 0 ? '▼' : '▲'}</span>` : ''}</th>`).join('') + '</tr></thead>';
    const body = '<tbody>' + rows.slice(0, 500).map(b => '<tr>' + UNI_COLS.map(c => cell(b, c)).join('') + '</tr>').join('') + '</tbody>';
    tbl.innerHTML = head + body;
    tbl.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (S.sort.key === k) S.sort.dir *= -1; else { S.sort.key = k; S.sort.dir = (k === 'description' || k === 'isincode') ? 1 : -1; }
      renderUniverse();
    }));
  }

  function cell(b, c) {
    const v = b[c.k];
    if (c.t === 'num') return `<td class="num">${fmtNum(v)}</td>`;
    if (c.t === 'date') return `<td class="mono">${fmtDate(v)}</td>`;
    if (c.t === 'rating') return `<td><span class="rating-badge ${ratingClass(b._ratingScore)}">${esc(v || '—')}</span></td>`;
    if (c.t === 'mono') return `<td class="mono">${esc(v)}</td>`;
    return `<td>${esc(v)}</td>`;
  }

  /* ---------------- ladder ---------------- */
  function readParams() {
    return {
      numeroStep: Math.max(1, parseInt($('pSteps').value) || 6),
      intervalloMesi: Math.max(1, parseInt($('pInterval').value) || 12),
      primaScadenza: $('pFirst').value.trim(),
      maxBondPerEmittente: parseInt($('pMaxIssuer').value) || Infinity,
      maxBondPerPaese: parseInt($('pMaxCountry').value) || Infinity,
      giorniTolleranza: parseInt($('pTolerance').value) || 0,
      ratingMin: $('pRating').value
    };
  }

  function buildLadder(type) {
    if (!S.filtered.length) return toast('Nessun universo filtrato. Vai al passo 1.', 'err');
    const params = readParams();
    if (!BSLadder.parseFirstMaturity(params.primaScadenza)) return toast('Prima scadenza non valida (usa M/AAAA)', 'err');

    const res = type === 'greedy' ? BSLadder.buildGreedy(S.filtered, params) : BSLadder.buildOptimized(S.filtered, params);
    S.perStep = res.perStep; S.slots = res.slots; S.ladderType = type;
    renderStepAvail(res.perStep);
    $('ladderResultCard').classList.remove('hidden');
    $('ladderTitle').textContent = 'Bond Ladder — ' + (type === 'greedy' ? 'Greedy' : 'Ottimizzato');
    if (!$('ladderName').value) $('ladderName').value = `Ladder ${type} ${fmtDate(S.referenceDate || new Date())}`;
    renderLadderTable();
    renderLadderAnalytics();
    const m = BSLadder.metrics(S.slots);
    $('ladderHint').textContent = res.exhausted ? 'Ottimizzazione troncata (spazio molto grande): risultato near-ottimo.' : '';
    toast(`Ladder ${type}: ${m.count}/${m.total} step riempiti`, m.complete ? 'ok' : '');
    $('ladderResultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderStepAvail(perStep) {
    $('stepAvail').innerHTML = perStep.map(s =>
      `<span class="savail ${s.bonds.length ? '' : 'zero'}">Step ${s.step} · ${s.target.toLocaleDateString('it-IT', { month: 'short', year: 'numeric' })}: <b>${s.bonds.length}</b> bond</span>`).join('');
  }

  const LAD_DETAIL = [
    { k: 'redemptiondate', l: 'Scadenza', t: 'date' },
    { k: 'issuercode', l: 'Emittente', t: 'mono' },
    { k: '_country', l: 'Paese', t: 'mono' },
    { k: 'grossytm', l: 'Yield %', t: 'num' },
    { k: 'grossduration', l: 'Duration', t: 'num' },
    { k: 'currentcouponrate', l: 'Cedola', t: 'num' },
    { k: 'ratingsp', l: 'Rating', t: 'rating' },
    { k: 'price', l: 'Prezzo', t: 'num' }
  ];

  function renderLadderTable() {
    const tbl = $('ladderTable');
    const head = '<thead><tr><th>Step</th><th>Target</th><th>Bond (modificabile)</th>' +
      LAD_DETAIL.map(c => `<th class="${c.t === 'num' ? 'num' : ''}">${c.l}</th>`).join('') + '</tr></thead>';
    const body = S.slots.map((s, i) => ladderRow(s, i)).join('');
    tbl.innerHTML = head + '<tbody>' + body + '</tbody>';
    tbl.querySelectorAll('select.sel-step').forEach(sel => sel.addEventListener('change', onManualChange));
  }

  function ladderRow(slot, i) {
    const cands = S.perStep[i] ? S.perStep[i].bonds : [];
    const opts = ['<option value="">— vuoto —</option>'].concat(cands.map(b =>
      `<option value="${esc(b.isincode)}" ${slot.bond && slot.bond.isincode === b.isincode ? 'selected' : ''}>${esc(b.description)} (${esc(b.isincode)}) · ${fmtNum(b.grossytm)}% · ${esc(b.ratingsp)}</option>`)).join('');
    const sel = `<select class="sel-step" data-step="${i}">${opts}</select>`;
    const detail = LAD_DETAIL.map(c => slot.bond ? cell(slot.bond, c) : '<td>—</td>').join('');
    return `<tr data-row="${i}" class="${slot.bond ? '' : 'empty-slot'}"><td><b>${slot.step}</b></td><td class="mono">${slot.target.toLocaleDateString('it-IT', { month: 'short', year: 'numeric' })}</td><td>${sel}</td>${detail}</tr>`;
  }

  function onManualChange() {
    const selections = Array.from($('ladderTable').querySelectorAll('select.sel-step'))
      .sort((a, b) => +a.dataset.step - +b.dataset.step).map(s => s.value);
    S.slots = BSLadder.buildManual(selections, S.perStep);
    S.ladderType = 'manuale';
    $('ladderTitle').textContent = 'Bond Ladder — Manuale';
    // aggiorna solo le celle di dettaglio delle righe + analytics (i select restano)
    $('ladderTable').querySelectorAll('tr[data-row]').forEach(tr => {
      const i = +tr.dataset.row, slot = S.slots[i];
      tr.classList.toggle('empty-slot', !slot.bond);
      const tds = tr.querySelectorAll('td');
      LAD_DETAIL.forEach((c, j) => { tds[3 + j].outerHTML = slot.bond ? cell(slot.bond, c) : '<td>—</td>'; });
    });
    renderLadderAnalytics();
  }

  function renderLadderAnalytics() {
    const m = BSLadder.metrics(S.slots);
    $('ladderMetrics').innerHTML = [
      metricCard('Step riempiti', `${m.count}/${m.total}`, m.complete ? 'ok' : 'warn'),
      metricCard('Yield medio', fmtNum(m.avgYield) + '%', ''),
      metricCard('Duration media', fmtNum(m.avgDuration), ''),
      metricCard('Cedola media', fmtNum(m.avgCoupon), '')
    ].join('');
    renderWarnings(m);
    BSCharts.ladderTimeline('chartTimeline', S.slots);
    BSCharts.cashflow('chartCashflow', S.slots);
    const expo = BSLadder.exposure(S.slots);
    BSCharts.exposurePie('chartCountry', expo.byCountry);
    BSCharts.exposurePie('chartIssuer', expo.byIssuer);
  }

  function metricCard(label, value, cls) {
    return `<div class="metric ${cls}"><div class="m-label">${label}</div><div class="m-value">${value}</div></div>`;
  }

  function renderWarnings(m) {
    const w = [];
    if (!m.complete) w.push({ t: `${m.total - m.count} step senza bond: amplia tolleranza o allenta i filtri.`, ok: false });
    const expo = BSLadder.exposure(S.slots);
    expo.byCountry.forEach(e => { if (e.share > 0.4 && expo.n > 2) w.push({ t: `Concentrazione paese ${e.key}: ${Math.round(e.share * 100)}% del ladder.`, ok: false }); });
    expo.byIssuer.forEach(e => { if (e.count > 1) w.push({ t: `Emittente ${e.key}: ${e.count} bond nel ladder.`, ok: false }); });
    if (!w.length && m.complete) w.push({ t: 'Ladder completo e ben diversificato.', ok: true });
    $('divWarnings').innerHTML = w.map(x => `<div class="warn-item ${x.ok ? 'ok' : ''}">${esc(x.t)}</div>`).join('');
  }

  /* ---------------- salvataggi cloud ---------------- */
  async function saveSnapshot() {
    if (!S.allBonds.length) return;
    if (!FIREBASE_OK) return toast('Cloud non disponibile', 'err');
    toast('Salvataggio snapshot…');
    try {
      const meta = await BSStore.saveSnapshot({
        name: S.snapshotName || ('Snapshot ' + fmtDate(S.referenceDate || new Date())),
        referenceDate: S.referenceDate, columns: S.columns, bonds: S.allBonds, file: S.currentFile
      });
      S.snapshotId = meta.id;
      toast('Snapshot salvato su cloud ✓', 'ok');
    } catch (e) { console.error(e); toast('Errore salvataggio: ' + e.message, 'err'); }
  }

  async function saveLadder() {
    if (!S.slots.length) return toast('Nessun ladder da salvare', 'err');
    if (!FIREBASE_OK) return toast('Cloud non disponibile', 'err');
    toast('Salvataggio ladder…');
    try {
      await BSStore.saveLadder({
        name: $('ladderName').value || `Ladder ${fmtDate(new Date())}`,
        type: S.ladderType || 'manuale', snapshotId: S.snapshotId, referenceDate: S.referenceDate,
        params: readParams(), filters: readFilters(),
        slots: S.slots, metrics: BSLadder.metrics(S.slots)
      });
      toast('Bond ladder salvato ✓', 'ok');
    } catch (e) { console.error(e); toast('Errore: ' + e.message, 'err'); }
  }

  /* ---------------- storico ---------------- */
  async function loadHistory() {
    if (!FIREBASE_OK) { $('snapshotList').innerHTML = $('ladderList').innerHTML = '<div class="muted">Cloud non disponibile.</div>'; return; }
    $('snapshotList').innerHTML = $('ladderList').innerHTML = '<div class="muted">Caricamento…</div>';
    try {
      const [snaps, ladders] = await Promise.all([BSStore.listSnapshots(), BSStore.listLadders()]);
      renderSnapshotList(snaps);
      renderLadderList(ladders);
    } catch (e) { console.error(e); toast('Errore storico: ' + e.message, 'err'); }
  }

  function renderSnapshotList(snaps) {
    const el = $('snapshotList');
    if (!snaps.length) { el.innerHTML = '<div class="muted">Nessuno snapshot salvato.</div>'; return; }
    el.innerHTML = '';
    snaps.forEach(s => {
      const div = document.createElement('div'); div.className = 'hist-item';
      div.innerHTML = `<div class="hi-main"><span class="hi-name">${esc(s.name)}</span>
        <span class="hi-meta">Rif ${fmtDate(s.referenceDate)} · ${s.rowCount} bond · caricato ${fmtDate(s.uploadedAt)}</span></div>`;
      const act = document.createElement('div'); act.className = 'hi-actions';
      const load = mkBtn('Carica', 'btn-primary', async () => {
        toast('Caricamento snapshot…');
        try {
          const { bonds, columns } = await BSStore.loadSnapshotBonds(s);
          S.allBonds = bonds; S.columns = columns; S.referenceDate = s.referenceDate;
          S.currentFile = null; S.snapshotId = s.id; S.snapshotName = s.name;
          S.facets = BSFilters.facets(bonds);
          populateFilterFacets(); updateTopbar();
          renderUploadSummary(bonds.length, bonds.length, s.referenceDate, s.name, false);
          applyPreset(true); switchTab('dati');
          toast('Snapshot caricato ✓', 'ok');
        } catch (e) { console.error(e); toast('Errore: ' + e.message, 'err'); }
      });
      const del = mkBtn('Elimina', 'btn-danger', async () => {
        if (!confirm('Eliminare questo snapshot?')) return;
        try { await BSStore.deleteSnapshot(s); toast('Eliminato', 'ok'); loadHistory(); }
        catch (e) { toast('Errore: ' + e.message, 'err'); }
      });
      act.append(load, del); div.appendChild(act); el.appendChild(div);
    });
  }

  function renderLadderList(ladders) {
    const el = $('ladderList');
    if (!ladders.length) { el.innerHTML = '<div class="muted">Nessun ladder salvato.</div>'; return; }
    el.innerHTML = '';
    ladders.forEach(l => {
      const m = l.metrics || {};
      const div = document.createElement('div'); div.className = 'hist-item';
      div.innerHTML = `<div class="hi-main"><span class="hi-name">${esc(l.name)} <span class="tag tag-${esc(l.type)}">${esc(l.type)}</span></span>
        <span class="hi-meta">Rif ${fmtDate(l.referenceDate)} · yield ${fmtNum(m.avgYield)}% · dur ${fmtNum(m.avgDuration)} · ${m.count || (l.slots ? l.slots.filter(s => s.bond).length : 0)} bond · ${fmtDate(l.createdAt)}</span></div>`;
      const act = document.createElement('div'); act.className = 'hi-actions';
      const cmp = mkBtn('Confronta con dati correnti', 'btn-primary', () => compareLadder(l));
      const del = mkBtn('Elimina', 'btn-danger', async () => {
        if (!confirm('Eliminare questo ladder?')) return;
        try { await BSStore.deleteLadder(l.id); toast('Eliminato', 'ok'); loadHistory(); }
        catch (e) { toast('Errore: ' + e.message, 'err'); }
      });
      act.append(cmp, del); div.appendChild(act); el.appendChild(div);
    });
  }

  function mkBtn(label, cls, fn) {
    const b = document.createElement('button'); b.className = 'btn btn-sm ' + cls; b.textContent = label; b.onclick = fn; return b;
  }

  /* ---------------- confronto nel tempo ---------------- */
  function compareLadder(l) {
    if (!S.allBonds.length) return toast('Carica/seleziona prima i dati correnti (passo 1)', 'err');
    const byIsin = new Map(S.allBonds.map(b => [b.isincode, b]));
    const now = new Date();

    // Appaia i bond salvati con i dati correnti.
    // NB: nei ladder salvati su Firebase le date sono stringhe ISO -> riconverto in Date.
    const toDate = (v) => v instanceof Date ? v : (v ? new Date(v) : null);
    const pairs = (l.slots || []).filter(s => s.bond).map(s => {
      const saved = { ...s.bond, redemptiondate: toDate(s.bond.redemptiondate) };
      const cur = byIsin.get(saved.isincode) || null;
      return { step: s.step, target: toDate(s.target), saved, cur };
    });
    const present = pairs.filter(p => p.cur);
    const card0 = $('compareCard'); card0.classList.remove('hidden');
    $('compareTitle').textContent = `Confronto nel tempo · ${l.name}`;
    if (!pairs.length) { $('compareBody').innerHTML = '<div class="muted">Questo ladder non contiene bond da confrontare.</div>'; return; }
    if (!present.length) { $('compareBody').innerHTML = '<div class="warn-item">Nessuno dei bond salvati è presente nei dati correnti (probabile scadenza o file diverso). Carica i dati del periodo giusto al passo 1.</div>'; return; }

    // Medie aggregate (solo bond ancora presenti, confronto omogeneo)
    const avg = (arr, pick) => arr.length ? arr.reduce((a, p) => a + (pick(p) || 0), 0) / arr.length : NaN;
    const yThen = avg(present, p => p.saved.grossytm), yNow = avg(present, p => p.cur.grossytm);
    const dThen = avg(present, p => p.saved.grossduration), dNow = avg(present, p => p.cur.grossduration);
    const pThen = avg(present, p => p.saved.price), pNow = avg(present, p => p.cur.price);
    const dY = yNow - yThen, dD = dNow - dThen, dP = pNow - pThen;
    const plPct = isFinite(pThen) && pThen ? (dP / pThen) * 100 : NaN;

    const card = $('compareCard'); card.classList.remove('hidden');
    $('compareTitle').textContent = `Confronto nel tempo · ${l.name}`;

    // --- 1. KPI di sintesi con delta ---
    const kpi = [
      deltaCard('Yield medio', yNow, '%', yThen, dY, 'pp', 'neutral'),
      deltaCard('Duration media', dNow, '', dThen, dD, '', 'neutral'),
      deltaCard('Prezzo medio (mark-to-market)', pNow, '', pThen, dP, ` pt · ${plPct >= 0 ? '+' : ''}${fmtNum(plPct)}%`, 'price'),
      `<div class="metric"><div class="m-label">Bond ancora presenti</div><div class="m-value">${present.length}/${pairs.length}</div>` +
        `<div class="m-delta flat">${pairs.length - present.length} non più nei dati</div></div>`
    ].join('');

    // --- 2. Interpretazione automatica ---
    const interp = [];
    if (dY > 0.05) interp.push(`I rendimenti di mercato sono <b>saliti</b> (${dY >= 0 ? '+' : ''}${fmtNum(dY)} pp): il valore di mercato del ladder è <b>sceso</b> (${fmtNum(dP)} pt, ${fmtNum(plPct)}%) — minusvalenza latente se lo possiedi, ma ricostruendolo oggi otterresti rendimenti più alti.`);
    else if (dY < -0.05) interp.push(`I rendimenti di mercato sono <b>scesi</b> (${fmtNum(dY)} pp): il valore di mercato del ladder è <b>salito</b> (+${fmtNum(dP)} pt, +${fmtNum(plPct)}%) — plusvalenza latente, ma nuovi acquisti oggi rendono meno.`);
    else interp.push(`Rendimenti sostanzialmente <b>stabili</b> (${dY >= 0 ? '+' : ''}${fmtNum(dY)} pp): valore di mercato pressoché invariato (${fmtNum(dP)} pt).`);
    if (isFinite(dD) && dD < -0.02) interp.push(`Duration media in calo da ${fmtNum(dThen)} a ${fmtNum(dNow)}: è il <b>roll-down</b>, le scadenze si avvicinano.`);

    // --- 3. dati per grafico barre ---
    const rungs = pairs.map(p => ({
      label: p.target.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }),
      yThen: p.saved.grossytm, yNow: p.cur ? p.cur.grossytm : null
    }));

    // --- 4. righe per gradino, compatte ---
    const rungRows = pairs.map(p => rungRow(p, now)).join('');

    $('compareBody').innerHTML =
      `<div class="hi-meta" style="margin-bottom:12px">Salvato il ${fmtDate(l.referenceDate)} → dati correnti ${fmtDate(S.referenceDate)} · confronto sui ${present.length} bond ancora quotati</div>` +
      `<div class="metrics">${kpi}</div>` +
      interp.map(t => `<div class="warn-item ${dY > 0.05 ? '' : 'ok'}" style="margin-bottom:6px">${t}</div>`).join('') +
      `<div class="cmp-legend"><span><i class="lg-box" style="background:var(--text3)"></i> salvato</span><span><i class="lg-box" style="background:var(--accent)"></i> oggi</span><span class="lg-sep">·</span><span class="delta-up">▲ prezzo su = plusvalenza</span><span class="delta-down">▼ prezzo giù = minusvalenza</span></div>` +
      `<div class="chart-box" style="margin:8px 0 16px"><canvas id="chartCompare"></canvas></div>` +
      `<div class="cmp-rungs">${rungRows}</div>`;

    BSCharts.compareBars('chartCompare', rungs);
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Card KPI con valore attuale, valore precedente e delta
  function deltaCard(label, now, unit, then, d, dUnit, mode) {
    const dir = !isFinite(d) ? 'flat' : d > 0.001 ? 'up' : d < -0.001 ? 'down' : 'flat';
    // per il prezzo coloriamo verde=su / rosso=giù; per il resto neutro (solo freccia)
    const cls = mode === 'price' ? (dir === 'up' ? 'gain' : dir === 'down' ? 'loss' : 'flat') : dir;
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '▬';
    const dTxt = isFinite(d) ? `${arrow} ${d >= 0 ? '+' : ''}${fmtNum(d)}${dUnit}` : '—';
    return `<div class="metric"><div class="m-label">${label}</div>` +
      `<div class="m-value">${fmtNum(now)}${unit}</div>` +
      `<div class="m-delta ${cls}">da ${fmtNum(then)}${unit} · ${dTxt}</div></div>`;
  }

  function rungRow(p, now) {
    const s = p.saved, c = p.cur;
    const head = `<div class="cr-head"><span class="cr-step">Step ${p.step} · ${p.target.toLocaleDateString('it-IT', { month: 'short', year: 'numeric' })}</span>` +
      `<span class="cr-name mono">${esc(s.isincode)} · ${esc(s.description)} · ${esc(s._country || '')}</span></div>`;
    if (!c) {
      const matured = s.redemptiondate && new Date(s.redemptiondate) < now;
      return `<div class="cmp-rung missing">${head}<div class="cr-note">${matured ? '✓ Scaduto: capitale rimborsato (non più quotato)' : '— Non presente nei dati di oggi'}</div></div>`;
    }
    const dy = c.grossytm - s.grossytm, dp = c.price - s.price, dd = c.grossduration - s.grossduration;
    const yArr = dy > 0.001 ? '▲' : dy < -0.001 ? '▼' : '▬';
    const pCls = dp > 0.001 ? 'delta-up' : dp < -0.001 ? 'delta-down' : '';
    const pArr = dp > 0.001 ? '▲' : dp < -0.001 ? '▼' : '▬';
    return `<div class="cmp-rung">${head}<div class="cr-metrics">` +
      `<span class="cr-m">Yield <b>${fmtNum(s.grossytm)} → ${fmtNum(c.grossytm)}</b> <span class="cr-tag">${yArr} ${dy >= 0 ? '+' : ''}${fmtNum(dy)}</span></span>` +
      `<span class="cr-m">Prezzo <b>${fmtNum(s.price)} → ${fmtNum(c.price)}</b> <span class="cr-tag ${pCls}">${pArr} ${dp >= 0 ? '+' : ''}${fmtNum(dp)}</span></span>` +
      `<span class="cr-m">Duration <b>${fmtNum(s.grossduration)} → ${fmtNum(c.grossduration)}</b> <span class="cr-tag">${dd >= 0 ? '+' : ''}${fmtNum(dd)}</span></span>` +
      `</div></div>`;
  }

  /* ---------------- avvio ---------------- */
  document.addEventListener('DOMContentLoaded', init);
})();
