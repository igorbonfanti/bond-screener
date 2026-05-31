/* ============================================================
   charts.js — Visualizzazioni (Chart.js)
   - Distribuzione rendimenti universo filtrato
   - Timeline scadenze del ladder (yield per scadenza)
   - Flussi cedolari + rimborsi per anno
   - Esposizione per paese / emittente
   ============================================================ */
const BSCharts = (() => {

  const reg = {};                 // canvasId -> Chart (per distruzione)
  const C = {
    grid: 'rgba(51,56,80,0.4)', text: '#9fa4b8', accent: '#f59e0b',
    accent2: '#fbbf24', green: '#22c55e', blue: '#3b82f6', red: '#ef4444',
    palette: ['#f59e0b', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#14b8a6',
              '#fbbf24', '#6366f1', '#ec4899', '#84cc16', '#f97316', '#06b6d4']
  };

  function destroy(id) { if (reg[id]) { reg[id].destroy(); delete reg[id]; } }
  function ctx(id) { const el = document.getElementById(id); return el ? el.getContext('2d') : null; }
  const baseOpts = (extra = {}) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: C.text, font: { family: 'DM Sans', size: 11 } } } },
    scales: {
      x: { ticks: { color: C.text, font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: C.grid } },
      y: { ticks: { color: C.text, font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: C.grid } }
    },
    ...extra
  });

  // cedola annua per 100 nominale (%). scale = fattore dataset (1 o 100), vedi BSData.couponScale
  function couponPct(b, scale) {
    const c = b.currentcouponrate;
    if (!isFinite(c)) return 0;
    return c * (scale || 1);
  }
  // fallback se non viene passata una scala esplicita
  function couponScaleLocal(bonds) {
    let mx = 0, seen = false;
    bonds.forEach(b => { const c = Math.abs(b.currentcouponrate); if (isFinite(c) && c > 0) { seen = true; if (c > mx) mx = c; } });
    return seen && mx < 0.5 ? 100 : 1;
  }

  /* Distribuzione rendimenti (istogramma) dell'universo filtrato */
  function yieldDistribution(id, bonds) {
    destroy(id);
    const ys = bonds.map(b => b.grossytm).filter(isFinite);
    if (!ys.length) return;
    const min = Math.floor(Math.min(...ys)), max = Math.ceil(Math.max(...ys));
    const step = Math.max(0.5, +((max - min) / 12).toFixed(1)) || 0.5;
    const bins = [];
    for (let x = min; x < max + step; x += step) bins.push({ lo: x, hi: x + step, n: 0 });
    ys.forEach(y => { const i = Math.min(bins.length - 1, Math.floor((y - min) / step)); if (bins[i]) bins[i].n++; });
    reg[id] = new Chart(ctx(id), {
      type: 'bar',
      data: {
        labels: bins.map(b => `${b.lo.toFixed(1)}`),
        datasets: [{ label: 'N° bond per fascia di yield (%)', data: bins.map(b => b.n), backgroundColor: C.accent, borderRadius: 3 }]
      },
      options: baseOpts({ plugins: { legend: { display: false } } })
    });
  }

  /* Timeline scadenze del ladder: una barra per slot (x = data target, y = yield) */
  function ladderTimeline(id, slots) {
    destroy(id);
    const labels = slots.map(s => s.target.toLocaleDateString('it-IT', { month: 'short', year: 'numeric' }));
    const data = slots.map(s => s.bond ? s.bond.grossytm : 0);
    const colors = slots.map(s => s.bond ? C.accent : C.red);
    reg[id] = new Chart(ctx(id), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Yield % per scadenza', data, backgroundColor: colors, borderRadius: 4 }] },
      options: baseOpts({
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { afterLabel: (it) => {
            const b = slots[it.dataIndex].bond;
            return b ? `${b.description}\n${b.isincode} · dur ${(+b.grossduration).toFixed(2)} · ${b.ratingsp}` : 'Step vuoto';
          } } }
        }
      })
    });
  }

  /* Flussi cedolari + rimborsi per anno (nominale 100 per bond) */
  function cashflow(id, slots, scale) {
    destroy(id);
    const bonds = slots.map(s => s.bond).filter(Boolean);
    if (!bonds.length) { return; }
    scale = scale || couponScaleLocal(bonds);
    const byYearCoupon = {}, byYearRedeem = {};
    const thisYear = new Date().getFullYear();
    bonds.forEach(b => {
      if (!(b.redemptiondate instanceof Date)) return;
      const endY = b.redemptiondate.getFullYear();
      const cpn = couponPct(b, scale);
      for (let y = thisYear; y <= endY; y++) byYearCoupon[y] = (byYearCoupon[y] || 0) + cpn;
      byYearRedeem[endY] = (byYearRedeem[endY] || 0) + 100;
    });
    const years = Object.keys({ ...byYearCoupon, ...byYearRedeem }).map(Number).sort((a, b) => a - b);
    reg[id] = new Chart(ctx(id), {
      type: 'bar',
      data: {
        labels: years,
        datasets: [
          { label: 'Cedole (per 100 nom.)', data: years.map(y => +(byYearCoupon[y] || 0).toFixed(2)), backgroundColor: C.accent, borderRadius: 3, stack: 's' },
          { label: 'Rimborsi capitale', data: years.map(y => byYearRedeem[y] || 0), backgroundColor: C.blue, borderRadius: 3, stack: 's' }
        ]
      },
      options: baseOpts({ scales: { x: { stacked: true, ticks: { color: C.text }, grid: { color: C.grid } }, y: { stacked: true, ticks: { color: C.text }, grid: { color: C.grid } } } })
    });
  }

  /* Esposizione per paese (doughnut) */
  function exposurePie(id, expoArr, title) {
    destroy(id);
    if (!expoArr || !expoArr.length) return;
    reg[id] = new Chart(ctx(id), {
      type: 'doughnut',
      data: {
        labels: expoArr.map(e => e.key),
        datasets: [{ data: expoArr.map(e => e.count), backgroundColor: C.palette, borderColor: '#1a1d27', borderWidth: 2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: C.text, font: { family: 'DM Sans', size: 11 }, boxWidth: 12 } },
          title: title ? { display: true, text: title, color: C.text } : { display: false }
        }
      }
    });
  }

  /* Cedole mensili su 1 anno in regime perpetuo (bond reinvestiti identici).
     - opts.amount: importo totale investito (€), ripartito equamente sui gradini.
       Se 0 -> cedole "per 100 nominale".
     - opts.freqMode: 'auto' (IT/US/UK semestrali), '1' (annuali), '2' (semestrali).
     Le cedole semestrali sono divise nei due mesi effettivi (scadenza e scadenza-6m).
     Niente rimborsi di capitale. */
  const MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  const SEMI = new Set(['IT', 'US', 'GB', 'UK']); // emittenti tipicamente a cedola semestrale
  function freqFor(country, mode) { return mode === '1' ? 1 : mode === '2' ? 2 : (SEMI.has(country) ? 2 : 1); }

  function monthlyCoupons(id, slots, opts) {
    destroy(id);
    opts = opts || {};
    const amount = +opts.amount > 0 ? +opts.amount : 0;
    const mode = opts.freqMode || 'auto';
    const bonds = slots.map(s => s.bond).filter(Boolean);
    const scale = opts.scale || couponScaleLocal(bonds);
    const perRung = amount > 0 && bonds.length ? amount / bonds.length : 0;
    const months = new Array(12).fill(0);
    const detail = Array.from({ length: 12 }, () => []);

    bonds.forEach(b => {
      const cpn = couponPct(b, scale);                   // cedola annua per 100 nominale (%)
      if (!cpn || !(b.redemptiondate instanceof Date)) return;
      const price = isFinite(b.price) && b.price > 0 ? b.price : 100;
      // cedola annua: in € se ho l'importo, altrimenti per 100 nominale
      const annual = perRung > 0 ? perRung * cpn / price : cpn;
      const f = freqFor(b._country, mode);
      const pay = annual / f;
      const m = b.redemptiondate.getMonth();
      const payMonths = f === 2 ? [m, (m + 6) % 12] : [m];
      payMonths.forEach(pm => { months[pm] += pay; detail[pm].push(`${b.description || b.isincode} (${f === 2 ? 'sem' : 'ann'}): ${pay.toFixed(2)}`); });
    });

    const annualTot = months.reduce((a, v) => a + v, 0);
    const unit = perRung > 0 ? '€' : 'per 100 nom.';
    reg[id] = new Chart(ctx(id), {
      type: 'bar',
      data: { labels: MESI, datasets: [{ label: `Cedole / mese (${unit})`, data: months.map(v => +v.toFixed(2)), backgroundColor: C.green, borderRadius: 3 }] },
      options: baseOpts({
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label: (it) => `${it.parsed.y.toFixed(2)} ${unit === '€' ? '€' : 'per 100 nom.'}`,
            afterBody: (items) => detail[items[0].dataIndex].slice(0, 10)
          } },
          title: { display: true, text: `Totale annuo: ${annualTot.toFixed(unit === '€' ? 0 : 2)} ${unit}`, color: C.text, font: { size: 11, family: 'JetBrains Mono' } }
        }
      })
    });
    return { annual: annualTot, perRung, unit, count: bonds.length };
  }

  /* Confronto: rendimento salvato vs attuale, barre affiancate per gradino */
  function compareBars(id, rungs) {
    destroy(id);
    if (!rungs || !rungs.length) return;
    reg[id] = new Chart(ctx(id), {
      type: 'bar',
      data: {
        labels: rungs.map(r => r.label),
        datasets: [
          { label: 'Yield salvato %', data: rungs.map(r => r.yThen), backgroundColor: C.text3, borderRadius: 3 },
          { label: 'Yield oggi %', data: rungs.map(r => isFinite(r.yNow) ? r.yNow : null), backgroundColor: C.accent, borderRadius: 3 }
        ]
      },
      options: baseOpts()
    });
  }

  function destroyAll() { Object.keys(reg).forEach(destroy); }

  return { yieldDistribution, ladderTimeline, cashflow, monthlyCoupons, exposurePie, compareBars, destroyAll, couponPct };
})();
