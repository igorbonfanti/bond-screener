/* Le mie scale: elenco delle scale salvate e monitoraggio ai prezzi di oggi. */
import { h, icon, fmtEur, fmtPct, fmtNum, fmtSigned, toast, copyText } from './dom.js';
import { fmt, parseDay, iso, years } from '../core/dates.js';
import { cashflows, costPer100, xirr } from '../core/bond.js';
import { listLadders, getLadder, deleteLadder, shareUrl, cloudReady, currentUser } from '../cloud.js';

const TYPE_LABEL = { capitale: 'Capitale a scadenza', rendita: 'Rendita mensile', greedy: 'v2 · greedy', ottimizzato: 'v2 · ottimizzato', manuale: 'v2 · manuale', esistente: 'v2 · portafoglio' };

/** Da documento salvato (v3 o v2) a posizioni uniformi. */
export function positionsOf(doc) {
  if (doc.v === 3) return (doc.slots || []).map(s => ({ ...s, maturity: parseDay(s.maturity), assumedNominal: false }));
  return (doc.slots || []).filter(s => s.bond).map(s => {
    const b = s.bond, mat = b.redemptiondate ? parseDay(String(b.redemptiondate).slice(0, 10)) : null;
    return { isin: b.isincode, desc: b.description, issuerName: b.issuercode, maturity: mat, nominal: s.nominal > 0 ? s.nominal : 10000,
      assumedNominal: !(s.nominal > 0), price: b.price, cost: b.price, ytmNet: null, ytmGross: b.grossytm, coupon: null, months: [], tax: 0.125 };
  });
}

/** Stato attuale di una scala salvata rispetto ai dati di oggi. */
export function monitor(doc, ds) {
  const pos = positionsOf(doc);
  const saved = parseDay(doc.settle || doc.referenceDate || '') ?? (doc.createdAt ? parseDay(String(doc.createdAt).slice(0, 10)) : ds.settle);
  const byIsin = new Map(ds.bonds.map(b => [b.isin, b]));
  const rows = [], flows = [];
  let invested = 0, valueNow = 0, coupons = 0, redeemed = 0, missing = 0;
  for (const p of pos) {
    const inv = p.nominal * (p.cost || p.price || 100) / 100;
    invested += inv;
    flows.push({ day: saved, amount: -inv });
    const b = byIsin.get(p.isin);
    const ref = b || (p.coupon != null && p.maturity != null ? { ...p, freq: (p.months || []).length, zc: !p.coupon, issuePrice: 100 } : null);
    let cp = 0, rd = 0, st = 'in corso', mv = null;
    if (ref) {
      for (const f of cashflows(ref, saved)) if (f.day <= ds.settle) {
        const v = p.nominal / 100 * f.net;
        if (f.kind === 'coupon') cp += v; else rd += v;
        flows.push({ day: f.day, amount: v });
      }
    }
    if (p.maturity != null && p.maturity <= ds.settle) st = 'rimborsato';
    else if (b) { mv = p.nominal * costPer100(b, ds.settle) / 100; flows.push({ day: ds.settle, amount: mv }); }
    else { st = 'non quotato oggi'; missing++; }
    coupons += cp; redeemed += rd; valueNow += mv || 0;
    rows.push({ p, b, inv, mv, cp, rd, st });
  }
  const total = valueNow + coupons + redeemed;
  const days = ds.settle - saved;
  const irr = days >= 30 && !missing ? xirr(flows.sort((a, c) => a.day - c.day)) : NaN;
  const wy = (f) => { let s = 0, w = 0; for (const r of rows) if (r.b && r.mv) { const v = f(r); if (Number.isFinite(v)) { s += v * r.mv; w += r.mv; } } return w ? s / w : NaN; };
  const yNow = wy(r => r.b.ytmNet), yThen = wy(r => r.p.ytmNet);
  return { pos, rows, invested, valueNow, coupons, redeemed, total, pnl: total - invested, days, irr, yNow, yThen, missing, saved };
}

export async function renderSavedList(root, { ds, onOpen }) {
  root.replaceChildren(h('div', { class: 'card card-pad' }, h('span', { class: 'spinner' }), ' Caricamento delle scale salvate…'));
  if (!cloudReady()) { root.replaceChildren(h('div', { class: 'card card-pad' }, 'Il salvataggio su cloud non è disponibile (sei offline o Firebase non si è caricato).')); return; }
  let list;
  try { list = await listLadders(); } catch (e) { root.replaceChildren(h('div', { class: 'card card-pad' }, `Errore: ${e.message}`)); return; }
  const head = h('div', { class: 'card card-pad' }, h('h2', { style: { fontSize: '18px' }, text: 'Le mie scale' }),
    h('p', { class: 'muted', style: { marginTop: '4px' } }, 'Ogni scala salvata viene confrontata con i prezzi di oggi: valore attuale, cedole incassate, plus o minus. ',
      currentUser() ? '' : 'La consultazione è libera; per salvare o eliminare serve l\'accesso.'));
  if (!list.length) { root.replaceChildren(head, h('div', { class: 'card card-pad muted', text: 'Nessuna scala salvata. Costruiscine una e premi "Salva".' })); return; }
  const items = list.map(doc => {
    const m = ds ? monitor(doc, ds) : null;
    const metrics = doc.metrics || {};
    return h('div', { class: 'card saved-item' },
      h('div', { class: 'si-main' }, h('span', { class: 'si-name', text: doc.name || 'Senza nome' }),
        h('span', { class: 'si-meta', text: `${TYPE_LABEL[doc.type] || doc.type || ''} · salvata il ${doc.createdAt ? fmt(parseDay(String(doc.createdAt).slice(0, 10))) : '—'} · ${(doc.slots || []).length} titoli` }),
        m ? h('span', { class: 'si-meta' }, `investito ${fmtEur(m.invested)} · oggi `, h('b', { class: m.pnl >= 0 ? 'delta-pos' : 'delta-neg', text: `${fmtSigned(m.pnl)}` }),
          Number.isFinite(metrics.irr) ? ` · rendimento previsto ${fmtPct(metrics.irr * 100)}` : '') : null),
      h('div', { class: 'si-actions' }, h('button', { class: 'btn btn-primary btn-sm', on: { click: () => onOpen(doc.id) } }, icon('open'), 'Apri')));
  });
  root.replaceChildren(head, h('div', { class: 'saved-list' }, items));
}

export async function renderSavedDetail(root, { id, ds, onBack, onRebuild }) {
  root.replaceChildren(h('div', { class: 'card card-pad' }, h('span', { class: 'spinner' }), ' Caricamento…'));
  if (!cloudReady()) { root.replaceChildren(h('div', { class: 'card card-pad' }, 'Cloud non disponibile: impossibile aprire la scala condivisa.')); return; }
  let doc;
  try { doc = await getLadder(id); } catch (e) { root.replaceChildren(h('div', { class: 'card card-pad', text: `Errore: ${e.message}` })); return; }
  if (!doc) { root.replaceChildren(h('div', { class: 'card card-pad', text: 'Scala non trovata (forse è stata eliminata).' })); return; }
  if (!ds) { root.replaceChildren(h('div', { class: 'card card-pad', text: 'Servono i dati di oggi per il confronto: caricali dall\'indicatore in alto.' })); return; }
  const m = monitor(doc, ds);
  const pnlPct = m.invested ? m.pnl / m.invested * 100 : NaN;
  const dy = m.yNow - m.yThen;
  const hero = h('section', { class: 'card hero' },
    h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
      h('button', { class: 'btn btn-ghost btn-sm', on: { click: onBack } }, '← Tutte le scale'),
      h('span', { class: 'tag', text: TYPE_LABEL[doc.type] || doc.type })),
    h('div', null, h('h2', { style: { fontSize: '22px' }, text: doc.name || 'Scala salvata' }),
      h('p', { class: 'hero-line', text: `Salvata con i dati del ${fmt(m.saved)} · confronto con i dati del ${fmt(ds.refDate)} (${Math.max(0, Math.round(m.days / 30.4))} mesi dopo)` })),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'k-label', text: 'Investito' }), h('div', { class: 'k-value', text: fmtEur(m.invested) })),
      h('div', { class: 'kpi' }, h('div', { class: 'k-label', text: 'Valore oggi' }), h('div', { class: 'k-value', text: fmtEur(m.valueNow) }), h('div', { class: 'k-sub', text: 'prezzo + rateo dei titoli in corso' })),
      h('div', { class: 'kpi' }, h('div', { class: 'k-label', text: 'Già incassato' }), h('div', { class: 'k-value', text: fmtEur(m.coupons + m.redeemed) }), h('div', { class: 'k-sub', text: `cedole ${fmtEur(m.coupons)} · rimborsi ${fmtEur(m.redeemed)}` })),
      h('div', { class: 'kpi' }, h('div', { class: 'k-label', text: 'Risultato' }), h('div', { class: 'k-value ' + (m.pnl >= 0 ? 'delta-pos' : 'delta-neg'), text: fmtSigned(m.pnl) }), h('div', { class: 'k-sub', text: Number.isFinite(pnlPct) ? fmtSigned(pnlPct, 2, '%') : '' })),
      h('div', { class: 'kpi' }, h('div', { class: 'k-label', text: 'Rendimento dall\'acquisto' }), h('div', { class: 'k-value', text: Number.isFinite(m.irr) ? fmtPct(m.irr * 100) : '—' }), h('div', { class: 'k-sub', text: 'annualizzato, al netto' }))),
    h('div', { class: 'actions-bar' },
      h('button', { class: 'btn btn-primary', on: { click: () => onRebuild(doc) } }, icon('refresh'), 'Ricostruisci con i dati di oggi'),
      h('button', { class: 'btn btn-ghost', on: { click: async () => toast(await copyText(shareUrl(doc.id)) ? 'Link copiato: chi lo apre vede questa scala' : shareUrl(doc.id), 'ok') } }, icon('share'), 'Copia link'),
      h('button', { class: 'btn btn-danger', on: { click: async () => {
        if (!confirm('Eliminare questa scala?')) return;
        try { await deleteLadder(doc.id); toast('Scala eliminata', 'ok'); onBack(); } catch (e) { toast(e.message, 'err'); }
      } } }, icon('trash'), 'Elimina')));

  const notes = [];
  if (Number.isFinite(dy) && Math.abs(dy) >= 0.05) notes.push(h('div', { class: 'insight info' }, h('span', { class: 'ico', text: 'i' }), h('span', {
    text: dy > 0 ? `I rendimenti dei tuoi titoli sono saliti di ${fmtNum(dy, 2)} punti: i prezzi sono scesi (minusvalenza solo sulla carta se tieni fino a scadenza), ma oggi reinvestire renderebbe di più.`
      : `I rendimenti dei tuoi titoli sono scesi di ${fmtNum(-dy, 2)} punti: i prezzi sono saliti (plusvalenza latente); tenendo fino a scadenza il rendimento previsto non cambia.` })));
  if (m.pos.some(p => p.assumedNominal)) notes.push(h('div', { class: 'insight warn' }, h('span', { class: 'ico', text: '!' }), h('span', { text: 'Scala salvata con la versione precedente: i nominali non erano registrati, uso 10.000 € per titolo.' })));
  if (m.missing) notes.push(h('div', { class: 'insight warn' }, h('span', { class: 'ico', text: '!' }), h('span', { text: `${m.missing} titoli non sono nei dati di oggi: il loro valore non è conteggiato.` })));

  const table = h('div', { class: 'table-wrap' }, h('table', { class: 't' },
    h('thead', null, h('tr', null, ['Titolo', 'Scadenza', 'Nominale', 'Prezzo allora', 'Prezzo oggi', 'Netto allora', 'Netto oggi', 'Valore oggi', 'Stato'].map((t, i) => h('th', { class: i >= 2 && i <= 7 ? 'r' : '', text: t })))),
    h('tbody', null, m.rows.map(r => h('tr', null,
      h('td', { text: r.p.desc || r.p.isin }), h('td', { text: r.p.maturity != null ? fmt(r.p.maturity) : '—' }),
      h('td', { class: 'r', text: fmtNum(r.p.nominal, 0) }), h('td', { class: 'r', text: fmtNum(r.p.price, 2) }),
      h('td', { class: 'r ' + (r.b ? (r.b.price >= r.p.price ? 'delta-pos' : 'delta-neg') : ''), text: r.b ? fmtNum(r.b.price, 2) : '—' }),
      h('td', { class: 'r', text: Number.isFinite(r.p.ytmNet) ? fmtPct(r.p.ytmNet) : Number.isFinite(r.p.ytmGross) ? fmtPct(r.p.ytmGross) + ' L' : '—' }),
      h('td', { class: 'r', text: r.b ? fmtPct(r.b.ytmNet) : '—' }),
      h('td', { class: 'r', text: r.mv != null ? fmtNum(r.mv, 0) : '—' }), h('td', { text: r.st }))))));
  root.replaceChildren(...[hero, notes.length ? h('div', { class: 'insights' }, notes) : null,
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Titoli' }), h('span', { class: 'sub', text: 'prezzi e rendimenti netti: al salvataggio → oggi' })),
      h('div', { class: 'card-body' }, table))].filter(Boolean));
}

export { iso, years };
