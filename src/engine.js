/* Dalle impostazioni dell'utente alla proposta. Funzione pura: gira nel Web Worker
   (interfaccia sempre fluida) o, se il worker non è disponibile, nel thread principale. */
import { applyBasket, issuerCatalog } from './core/basket.js';
import { regularTargets, dateTargets, planCapital, ALWAYS } from './core/capital.js';
import { planIncome } from './core/income.js';
import { parseDay, day } from './core/dates.js';
import { scoreYield } from './core/bond.js';
import { resolveHoldings } from './portfolio.js';
import { RETAIL_BTP } from './data/retail-btp.js';

/** Preferenza per i titoli già posseduti → vantaggio di rendimento nella scelta (0,001 = 0,10 punti percentuali). */
export const PREF_BONUS = { mine: ALWAYS, balanced: 0.001, yield: 1e-6 };

export function basketFromSettings(ds, b) {
  const excluded = new Set(b.excluded || []);
  const issuers = excluded.size
    ? issuerCatalog(ds).filter(e => b.groups[e.area] && !excluded.has(e.issuer)).map(e => e.issuer)
    : null;
  return {
    groups: { euro: !!b.groups.euro, extra: !!b.groups.extra, sov: !!b.groups.sov, corp: false },
    issuers,
    minRating: b.minRating,
    includeUnrated: false,
    maxPrice: b.belowPar ? 100 : (b.maxPrice ?? null),
    minLiquidity: b.minLiquidity,
    includeInflation: !!b.includeInflation,
    includeStepUp: b.includeStepUp !== false
  };
}

export function capitalTargets(ds, c) {
  if (c.schedule === 'dates') {
    const list = (c.dates || []).map(d => ({ day: parseDay(d.date), amount: +d.amount, label: (d.label || '').trim() }))
      .filter(x => x.day != null && x.amount > 0);
    return dateTargets(list, c.flexMonths, ds.settle);
  }
  return regularTargets({
    yearFrom: c.yearFrom, yearTo: c.yearTo, everyMonths: c.schedule === 'semester' ? 6 : 12,
    amount: c.start === 'budget' ? 1 : c.amount
  }, ds.settle);
}

function mapPoints(bonds, from, to, zainetto) {
  return bonds.filter(b => b.maturity > from && b.maturity <= to).map(b => ({
    isin: b.isin, maturity: b.maturity, y: scoreYield(b, zainetto), issuer: b.issuer, country: b.country,
    name: b.issuerName, desc: b.desc, price: b.price, rating: b.rating
  })).filter(p => Number.isFinite(p.y));
}

/** Portafoglio posseduto (st.holdings, solo se l'utente costruisce attorno ai suoi titoli) → dati per il motore. */
function portfolioInput(ds, st, zainetto, basket) {
  const list = Array.isArray(st.holdings) ? st.holdings : [];
  if (!list.length) return { holdings: [], pool: [], bonus: 0, info: null };
  const res = resolveHoldings(list, ds, { zainetto });
  const live = res.filter(r => r.bond && r.status !== 'matured');
  const pref = PREF_BONUS[st.portfolioPref] != null ? st.portfolioPref : 'balanced';
  const byIsin = new Map(ds.bonds.map(b => [b.isin, b]));
  // ISIN con cui si comprano altri pezzi: per i BTP retail con premio è quello di mercato
  const topUpIsin = r => (RETAIL_BTP[r.h.isin] && RETAIL_BTP[r.h.isin].market) || r.h.isin;
  const holdings = live.map(r => ({ isin: r.h.isin, topUpIsin: topUpIsin(r), bond: r.bond, nominal: r.h.nominal, flows: r.flows, value: r.value, status: r.status }));
  // «I miei titoli»: si possono ricomprare anche se i filtri del paniere li escludono (non se scadono fra meno di un mese)
  const inBasket = new Set(basket.map(b => b.isin));
  const pool = pref === 'mine' ? [...new Set(holdings.map(x => x.topUpIsin))].map(i => byIsin.get(i))
    .filter(b => b && !inBasket.has(b.isin) && b.currency === 'EUR' && !b.anomaly && b.maturity > ds.settle + 30) : [];
  return {
    holdings, pool, bonus: PREF_BONUS[pref],
    info: { pref, count: res.length, used: live.length, value: live.reduce((s, r) => s + r.value, 0),
      missing: res.filter(r => r.status === 'missing').map(r => r.h.isin), matured: res.filter(r => r.status === 'matured').map(r => r.h.isin) }
  };
}

export function compute(ds, st) {
  const bk = basketFromSettings(ds, st.basket);
  let { bonds, excluded } = applyBasket(ds, bk);
  const banned = new Set(st.basket.excludedIsins || []);
  if (banned.size) bonds = bonds.filter(b => !banned.has(b.isin));
  const out = { goal: st.goal, basketCount: bonds.length, excluded, refDate: ds.refDate, settle: ds.settle };
  const zainetto = !!st.basket.zainetto;
  const port = portfolioInput(ds, st, zainetto, bonds);
  out.portfolio = port.info;

  if (st.goal === 'capital') {
    const c = st.capital;
    const targets = capitalTargets(ds, c);
    const fixed = {};
    targets.forEach((t, i) => { const isin = st.fixed && st.fixed[t.label]; if (isin) fixed[i] = isin; });
    const budget = c.schedule !== 'dates' && c.start === 'budget' ? Math.max(0, +c.budget || 0) : null;
    const cfg = { targets, useCoupons: c.useCoupons, accumulate: c.accumulate, zainetto, issuerCap: st.basket.issuerCap, budget, fixed, rounding: c.rounding,
      holdings: port.holdings, heldBonus: port.bonus, heldPool: port.pool, carry: st.portfolioCarry !== false };
    out.plan = planCapital(ds, bonds, cfg);
    if (port.holdings.length && out.plan.targets.length) {
      // L'altra scelta sulle eccedenze, per confronto: quanto si comprerebbe oggi (o quanto si riceverebbe)
      const alt = planCapital(ds, bonds, { ...cfg, carry: !cfg.carry });
      out.plan.alt = { carry: !cfg.carry, totalCost: alt.totalCost, idleEuroYears: alt.idleEuroYears || 0,
        perTarget: alt.targets.reduce((s, t) => s + t.amount, 0) / alt.targets.length };
    }
    if (targets.length) out.map = mapPoints(bonds, Math.min(...targets.map(t => t.start)), Math.max(...targets.map(t => t.end)), zainetto);
  } else if (st.goal === 'income') {
    const i = st.income;
    const base = { yearFrom: i.yearFrom, yearTo: i.yearTo, ladder: i.ladder, issuerCap: st.basket.issuerCap, tradeoff: i.tradeoff, zainetto };
    if (i.start === 'target' && i.monthlyTarget > 0) {
      const probe = planIncome(ds, bonds, { ...base, capital: 100000 });
      if (!probe.empty && probe.minMonth > 0) {
        let C = Math.ceil(i.monthlyTarget / probe.minMonth * 100000 / 1000) * 1000;
        let res = planIncome(ds, bonds, { ...base, capital: C });
        for (let k = 0; k < 4 && !res.empty && res.minMonth < i.monthlyTarget; k++) {
          C = Math.ceil(C * i.monthlyTarget / Math.max(1, res.minMonth) / 1000 + 1) * 1000;
          res = planIncome(ds, bonds, { ...base, capital: C });
        }
        out.plan = { ...res, monthlyTarget: i.monthlyTarget };
      } else out.plan = probe;
    } else {
      out.plan = planIncome(ds, bonds, { ...base, capital: Math.max(0, +i.capital || 0) });
    }
    out.map = mapPoints(bonds, day(i.yearFrom, 1, 1) - 1, day(i.yearTo, 12, 31), zainetto);
  }
  return out;
}
