/* Modalità «Passività indicizzata»: la scala più economica che paga un affitto che cresce con l'inflazione.
   Cash-flow matching come programmazione lineare (brief §4), su più scenari d'inflazione insieme.

   Variabili: x_i = nominale del titolo i in pezzi da 100; c0 = liquidità iniziale (su XEON); λ (solo «massimizza scala»).
   Vincoli, per ogni scenario s e ogni scadenza dell'affitto k (cumulati: la liquidità matura al tasso netto XEON):
     c0·G(oggi→t_k) + Σ_i x_i · A_{i,k,s}  ≥  Σ_{j≤k} λ·L_{j,s}·G(t_j→t_k)
   dove A_{i,k,s} = flussi netti del titolo arrivati entro t_k (cedole, rimborsi, meno bollo e tasse annuali),
   ciascuno capitalizzato dalla sua data a t_k. Così il saldo di cassa dopo ogni pagamento non è mai negativo.
   Vincoli di portafoglio sul COSTO dei titoli (la liquidità iniziale non conta): quota minima indicizzata, tetto per
   emittente, tetto per titolo. Obiettivo: costo minimo (o λ massimo con capitale dato).
   Poi i nominali si arrotondano al lotto (programma intero sui titoli scelti, o riparazione) e si ricontrolla tutto
   con la simulazione esatta di cassa (simulate). */
import { day, parts, years } from './dates.js';
import { cashflows, couponDates, accrued } from './bond.js';
import { series, refIndexRaw, indexRatio } from './indice.js';
import { FISCO_DEFAULT, xeonNet } from './fisco-parametri.js';
import { scenarioFns, liabilities } from './passivita.js';

/** Tipo di indicizzazione di un titolo del file STFI: 'BTPEI' (HICP), 'BTPITALIA' (FOI) o null (nominale). */
export function linkerType(b) {
  if (!b.inflation) return null;
  if (/BTP\s*ITALIA/i.test(b.desc)) return 'BTPITALIA';
  if (/^BTP\s*i\b/i.test(b.desc) || /BTP\s*€\s*i/i.test(b.desc)) return 'BTPEI';
  return 'ALTRO';                                   // indicizzati esteri: non gestiti (il file oggi non ne ha)
}

/* ---------------- crescita della liquidità (XEON) ---------------- */
export function growthFor(estr, f) {
  // fattore di crescita cumulato dal 1/1 di un anno di riferimento: C(d); G(a, b) = C(b) / C(a).
  // Tasso netto costante nell'anno solare; anni calcolati una volta sola.
  const yStart = new Map(), rate = new Map();
  const r = y => { if (!rate.has(y)) rate.set(y, Math.log(1 + xeonNet(estr(y), f)) / 365.25); return rate.get(y); };
  const Y0 = 2000;
  const startLog = y => {                               // log C al 1/1 dell'anno y
    if (yStart.has(y)) return yStart.get(y);
    let v = 0;
    for (let k = Y0; k < y; k++) v += r(k) * (day(k + 1, 1, 1) - day(k, 1, 1));
    yStart.set(y, v);
    return v;
  };
  const C = d => { const y = parts(d).y; return startLog(y) + r(y) * (d - day(y, 1, 1)); };
  return (a, b) => (b <= a ? 1 : Math.exp(C(b) - C(a)));
}

/* ---------------- flussi per titolo e scenario ---------------- */

/** Prezzo di mercato stimato (per il bollo), per 100 nominale e in termini reali: da quello di oggi a 100 in linea retta. */
function realPriceAt(b, settle, dn) {
  const T = b.maturity - settle;
  return T > 0 ? b.price + (100 - b.price) * Math.min(1, Math.max(0, (dn - settle) / T)) : 100;
}

/** Bollo dell'anno solare y sul titolo (per 100), addebitato il 31/12 (o alla scadenza), pro rata dei giorni posseduti. */
function bolloFlows(b, settle, f, mvAt) {
  const out = [];
  const y0 = parts(settle).y, y1 = parts(b.maturity).y;
  for (let y = y0; y <= y1; y++) {
    const from = Math.max(settle, day(y, 1, 1)), to = Math.min(b.maturity, day(y + 1, 1, 1));
    if (to <= from) continue;
    const at = Math.min(day(y, 12, 31), b.maturity);
    out.push({ day: at, kind: 'bollo', net: -f.bollo * mvAt(at) * (to - from) / 365 });
  }
  return out;
}

/**
 * Strumenti dell'universo con costo e flussi netti per 100 nominale, per ogni scenario.
 * ctx: { settle, f (fisco), infl: { hicp, foi } (serie note {mese: valore}), bases: { isin: { irBase } },
 *        scen: [{ id, fns }] }
 * Restituisce { items: [{ b, type, index, cost, ciSettle, flows: { [sid]: [{day, kind, net}] } }], skipped: [{b, why}] }
 */
export function buildInstruments(bonds, ctx) {
  const { settle, f = FISCO_DEFAULT, scen } = ctx;
  const items = [], skipped = [];
  for (const b of bonds) {
    const type = linkerType(b);
    if (!type) {
      // titolo nominale: flussi dell'app (fiscalità già verificata), uguali in tutti gli scenari, più il bollo
      const base = cashflows(b, settle).map(x => ({ day: x.day, kind: x.kind, net: x.net }));
      const fl = base.concat(bolloFlows(b, settle, f, dn => realPriceAt(b, settle, dn)));
      const flows = {};
      for (const s of scen) flows[s.id] = fl;
      items.push({ b, type: 'NOM', index: null, cost: b.cost, flows });
      continue;
    }
    if (type === 'ALTRO') { skipped.push({ b, why: 'indicizzato estero: regole non gestite' }); continue; }
    const info = ctx.bases && ctx.bases[b.isin];
    if (!info || !Number.isFinite(info.irBase)) { skipped.push({ b, why: 'manca l\'indice base del titolo (CI ufficiale non disponibile)' }); continue; }
    if (type === 'BTPITALIA' && !ctx.btpItalia) { skipped.push({ b, why: 'regole BTP Italia non ancora caricate' }); continue; }
    const index = type === 'BTPEI' ? 'HICP' : 'FOI';
    // calendario e cedola reale dalle regole MEF quando il file STFI non li ha (p. es. un titolo appena emesso)
    const bb = info.freq && info.mesiCedola && (!b.freq || !b.months || !b.months.length)
      ? { ...b, freq: info.freq, months: info.mesiCedola, zc: false, coupon: Number.isFinite(info.cedolaReale) ? info.cedolaReale : b.coupon } : b;
    const flows = {};
    let cost = null, ciSettle = null;
    for (const s of scen) {
      const ser = s.series[index];
      const ci = dn => indexRatio(ser, dn, info.irBase);
      if (cost == null) {
        if (type === 'BTPITALIA') ({ cost, ciSettle } = ctx.btpItalia.cost(bb, settle, ci, f, info));
        else {
          ciSettle = ci(settle);
          // costo vero: (prezzo reale + rateo reale) × CI di regolamento, meno il credito d'imposta sul rateo
          const acc = accrued(bb, settle);
          cost = (bb.price + acc) * ciSettle - acc * ciSettle * f.aliquotaTitoliStato;
        }
      }
      flows[s.id] = type === 'BTPEI' ? btpEiFlows(bb, settle, ci, ciSettle, f)
        : ctx.btpItalia.flows(bb, settle, ci, ciSettle, f, info)
          .concat(bolloFlows(bb, settle, f, dn => realPriceAt(bb, settle, dn) * (info.sottotipo === 'BTP_ITALIA_SI' ? 1 : ci(dn))));
    }
    items.push({ b, type, index, cost, ciSettle, flows, sottotipo: info.sottotipo || null });
  }
  return { items, skipped };
}

/** BTP€i: cedola reale × CI della data, capitale 100 × max(CI, 1) a scadenza; 12,5% su cedole e rivalutazione;
    bollo sul valore di mercato stimato (prezzo reale × CI). Rivalutazione tassata «a scadenza» o «annuale» (parametro). */
export function btpEiFlows(b, settle, ci, ciSettle, f) {
  const t = f.aliquotaTitoliStato, out = [];
  for (const c of couponDates(b, settle, b.maturity)) {
    const g = b.coupon / b.freq * ci(c);
    out.push({ day: c, kind: 'coupon', net: g * (1 - t) });
  }
  const ciT = Math.max(1, ci(b.maturity));
  const paidBase = b.price * ciSettle;                          // prezzo pagato (secco) in euro, per 100
  let taxed = 0;
  if (f.rivalutazioneBtpEi === 'annuale') {
    // ogni 31/12: imposta sull'aumento della rivalutazione 100 × (CI − CI_regolamento), senza tornare indietro
    let peak = ciSettle;
    for (let y = parts(settle).y; y < parts(b.maturity).y; y++) {
      const d = day(y, 12, 31);
      if (d <= settle) continue;
      const c = ci(d);
      if (c > peak) { const tax = (c - peak) * 100 * t; out.push({ day: d, kind: 'tassa', net: -tax }); taxed += tax; peak = c; }
    }
  }
  // base imponibile a scadenza (parametro DA VERIFICARE, fisco-parametri.js):
  //  'emissione' = provento 100 × max(CI,1) − prezzo di emissione della prima tranche (lettura del D.Lgs. 239/96,
  //                art. 11 c. 2): chi compra sul secondario a CI alto paga su tutta la rivalutazione; la minusvalenza
  //                che ne nasce (redditi diversi) non è usata qui (prudente);
  //  'acquisto'  = imposta sulla differenza fra rimborso e prezzo pagato (prezzo reale × CI di regolamento).
  const issue = Number.isFinite(b.issuePrice) && b.issuePrice > 0 ? b.issuePrice : 100;
  const gain = f.baseImponibileBtpEi === 'acquisto' ? 100 * ciT - paidBase : 100 * ciT - issue;
  const total = Math.max(0, gain) * t;
  out.push({ day: b.maturity, kind: 'redemption', net: 100 * ciT - Math.max(0, total - taxed) });
  return out.concat(bolloFlows(b, settle, f, dn => realPriceAt(b, settle, dn) * ci(dn)));
}

/* ---------------- modello lineare ---------------- */

/**
 * Prepara i dati del modello: per ogni scenario le scadenze dell'affitto e i coefficienti A_{i,k,s}.
 * cfg: { L0, yearFrom, yearTo, schedule, realSpread, index, scenarios: ids da coprire (vincolo), estr }
 */
export function prepare(items, ctx, cfg) {
  const { settle } = ctx;
  const out = { scen: [] };
  for (const s of ctx.scen) {
    const L = liabilities(cfg, s.fns);
    const G = s.G;
    const K = L.length;
    const A = items.map(it => {
      const row = new Float64Array(K);
      for (const fl of it.flows[s.id]) {
        for (let k = 0; k < K; k++) if (fl.day < L[k].day || (fl.day === L[k].day && fl.kind !== 'bollo')) row[k] += fl.net * G(fl.day, L[k].day);
      }
      return row;
    });
    const g0 = L.map(l => G(settle, l.day));
    const need = L.map((l, k) => L.slice(0, k + 1).reduce((acc, j) => acc + j.amount * G(j.day, l.day), 0));
    out.scen.push({ id: s.id, L, A, g0, need });
  }
  return out;
}

const num = v => { const r = Number(v.toPrecision(12)); return Object.is(r, -0) ? 0 : r; };
const term = (c, name, first) => {
  const v = num(c);
  if (v === 0) return '';
  return `${v < 0 ? ' - ' : first ? ' ' : ' + '}${Math.abs(v)} ${name}`;
};

/**
 * Testo del modello in formato CPLEX LP. Le variabili sono in LOTTI: n_i = nominale / lotto (u_i = lotto/100 pezzi
 * da 100), così il programma intero dà nominali multipli del lotto.
 * opt: { mode: 'mincost'|'maxscale', budget, robust: [ids], minLinker, issuerCap: {issuer: share}, titleCap,
 *        fixed: {isin: lotti}, ints: bool, only: Set di indici ammessi (gli altri a zero) }
 */
export function lpText(items, prep, opt) {
  const n = items.length, lines = [];
  const u = items.map(it => it.b.lot / 100);
  const live = i => !opt.only || opt.only.has(i);
  const costTerms = items.map((it, i) => live(i) ? term(it.cost * u[i], `n${i}`, false) : '').join('') + ' + c0';
  if (opt.mode === 'maxscale') lines.push('Maximize', ' obj: lam');
  else lines.push('Minimize', ` obj:${costTerms.replace(/^ \+ /, ' ')}`);
  lines.push('Subject To');
  for (const s of prep.scen) {
    if (!opt.robust.includes(s.id)) continue;
    s.L.forEach((l, k) => {
      let row = term(s.g0[k], 'c0', true);
      for (let i = 0; i < n; i++) if (live(i)) row += term(s.A[i][k] * u[i], `n${i}`, false);
      if (opt.mode === 'maxscale') { row += term(-s.need[k], 'lam', false); lines.push(` cov_${s.id}_${k}:${row} >= 0`); }
      else lines.push(` cov_${s.id}_${k}:${row} >= ${num(s.need[k])}`);
    });
  }
  if (opt.mode === 'maxscale') lines.push(` budget:${costTerms.replace(/^ \+ /, ' ')} <= ${num(opt.budget)}`);
  const share = (pick, m, sense, name) => {
    let row = '';
    items.forEach((it, i) => { if (live(i)) row += term(it.cost * u[i] * ((pick(it, i) ? 1 : 0) - m), `n${i}`, row === ''); });
    if (row) lines.push(` ${name}:${row} ${sense} 0`);
  };
  // quota indicizzata sul costo dei titoli (la liquidità iniziale non conta): Σ_lk C n − m Σ C n ≥ 0
  if (opt.minLinker > 0) share(it => it.type !== 'NOM', opt.minLinker, '>=', 'linker');
  for (const [iss, cap] of Object.entries(opt.issuerCap || {})) if (cap < 1) share(it => it.b.issuer === iss, cap, '<=', `cap_${iss.replace(/\W/g, '_')}`);
  if (opt.titleCap > 0 && opt.titleCap < 1) items.forEach((it, i) => { if (live(i)) share((jt, j) => j === i, opt.titleCap, '<=', `tcap_${i}`); });
  lines.push('Bounds');
  items.forEach((it, i) => {
    const fx = opt.fixed && opt.fixed[it.b.isin];
    if (!live(i)) lines.push(` n${i} = 0`);
    else if (fx != null) lines.push(` n${i} = ${num(fx)}`);
  });
  if (opt.mode === 'maxscale') lines.push(' lam >= 0');
  if (opt.ints) {
    const g = items.map((it, i) => live(i) ? `n${i}` : null).filter(Boolean);
    if (g.length) lines.push('Generals', ' ' + g.join(' '));
  }
  lines.push('End');
  return lines.join('\n');
}

/* ---------------- soluzione e simulazione ---------------- */

/** Risolve il testo LP con HiGHS. Restituisce { status, n: Float64Array, c0, lam, obj } o lancia un errore leggibile. */
export function solveWith(highs, text, n, opts = {}) {
  const r = highs.solve(text, { output_flag: false, mip_rel_gap: 1e-5, ...opts });
  // con un limite di tempo il programma intero restituisce la migliore soluzione trovata (rispetta tutti i vincoli)
  const timed = r.Status === 'Time limit reached' && r.Columns && Number.isFinite(r.ObjectiveValue) && r.Columns.n0 && Number.isFinite(r.Columns.n0.Primal);
  if (r.Status !== 'Optimal' && !timed) return { status: r.Status };
  const col = name => (r.Columns[name] ? r.Columns[name].Primal : 0);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, col(`n${i}`));
  return { status: 'Optimal', timed, n: out, c0: Math.max(0, col('c0')), lam: col('lam'), obj: r.ObjectiveValue };
}

/** Saldo di cassa dopo ogni pagamento, per scenario, con i lotti n e la liquidità iniziale c0 (λ moltiplica l'affitto). */
export function simulate(items, prep, n, c0, lam = 1) {
  const res = {};
  for (const s of prep.scen) {
    const bal = s.L.map((l, k) => {
      let v = c0 * s.g0[k];
      items.forEach((it, i) => { if (n[i]) v += n[i] * it.b.lot / 100 * s.A[i][k]; });
      return v - lam * s.need[k];
    });
    // primo pagamento non coperto; capitale in più che servirebbe oggi (sul conto XEON) per coprire tutto
    const first = bal.findIndex(v => v < -0.5);
    const extra = Math.max(0, ...bal.map((v, k) => -v / s.g0[k]));
    res[s.id] = { bal, first: first < 0 ? null : s.L[first], lastCovered: first < 0 ? s.L[s.L.length - 1] : (first > 0 ? s.L[first - 1] : null),
      extra, deficit: Math.max(0, -Math.min(0, ...bal)) };
  }
  return res;
}
