/* Le mie scale: elenco delle scale salvate e monitoraggio ai prezzi di oggi. */
import { h, fmtEur, fmtPct, fmtNum, toast, copyText, deltaEl, trendText, badge } from './dom.js';
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

const panelEl = (title, meta, ...body) => h('section', { class: 'panel' },
  h('div', { class: 'ph' }, h('h2', { text: title }), meta == null ? null : typeof meta === 'string' ? h('span', { class: 'meta', text: meta }) : meta), ...body);
const note = text => h('p', { class: 'note', style: { padding: '8px 10px' }, text });
const kpi = (k, v, sub) => h('div', { class: 'kpi' }, h('span', { class: 'k', text: k }), h('span', { class: 'v num' }, v), sub ? h('span', { class: 's' }, sub) : null);
const KIND = { warn: ['watch', 'Attenzione'], info: ['normal', 'Nota'] };
const savedOn = doc => doc.createdAt ? fmt(parseDay(String(doc.createdAt).slice(0, 10))) : '—';

export async function renderSavedList(root, { ds, onOpen }) {
  root.replaceChildren(h('p', { class: 'loading note', text: 'Caricamento delle scale salvate…' }));
  if (!cloudReady()) { root.replaceChildren(panelEl('Le mie scale', null, note('Il salvataggio su cloud non è disponibile: sei offline o Firebase non si è caricato.'))); return; }
  let list;
  try { list = await listLadders(); } catch (e) { root.replaceChildren(panelEl('Le mie scale', null, note(`Le scale non si sono caricate: ${e.message}`))); return; }
  const intro = note(`Ogni scala salvata è confrontata con i prezzi del ${ds ? fmt(ds.refDate) : 'giorno'}: valore attuale, cedole e rimborsi già incassati, risultato.${currentUser() ? '' : ' La consultazione è libera; per salvare o eliminare serve l\'accesso (ACCEDI in alto).'}`);
  if (!list.length) { root.replaceChildren(panelEl('Le mie scale', 'nessuna scala', intro, note('Costruiscine una nelle schede 1 o 2 e premi «Salva la scala».'))); return; }
  const rows = list.map(doc => ({ doc, m: ds ? monitor(doc, ds) : null }));
  const cols = [
    { label: 'Nome', sort: r => r.doc.name || '', cell: r => h('span', { class: 'ttl' }, h('b', { text: r.doc.name || 'Senza nome' }), h('span', { class: 'code', text: TYPE_LABEL[r.doc.type] || r.doc.type || '' })) },
    { label: 'Salvata', sort: r => String(r.doc.createdAt || ''), dir: -1, cell: r => h('span', { class: 'num', text: savedOn(r.doc) }) },
    { label: 'Titoli', r: 1, sort: r => (r.doc.slots || []).length, cell: r => String((r.doc.slots || []).length) },
    { label: 'Investito', r: 1, sort: r => r.m ? r.m.invested : 0, cell: r => r.m ? fmtNum(r.m.invested, 0) : '—' },
    { label: 'Risultato', r: 1, sort: r => r.m ? r.m.pnl : 0, cell: r => r.m ? deltaEl(r.m.pnl, 0, ' €') : '—' },
    { label: 'Rendimento previsto', r: 1, sort: r => (r.doc.metrics || {}).irr ?? -1, cell: r => Number.isFinite((r.doc.metrics || {}).irr) ? fmtPct(r.doc.metrics.irr * 100) : '—' },
    { label: '', cls: 'acts', cell: r => h('button', { type: 'button', class: 'mini', 'aria-label': `Apri ${r.doc.name || 'la scala'}`, text: 'Apri', on: { click: () => onOpen(r.doc.id) } }) }
  ];
  root.replaceChildren(panelEl('Le mie scale', `${list.length} ${list.length === 1 ? 'scala' : 'scale'} · euro`, intro, table(cols, rows, 1, -1, r => ({
    'data-sym': r.doc.id, tabindex: 0, 'aria-label': `${r.doc.name || 'Scala'}: Invio per aprire`,
    on: { click: e => { if (!e.target.closest('button')) onOpen(r.doc.id); }, keydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(r.doc.id); } }
  }))));
}

/** Tabella con intestazioni ordinabili (stessa regola della vista principale). */
function table(cols, rows, sortBy, dir, rowAttrs) {
  let key = sortBy, d = dir;
  const tbody = h('tbody');
  const cmp = (a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), 'it');
  const ths = cols.map((c, i) => {
    const th = h('th', { class: c.r ? 'r' : null, scope: 'col' });
    if (c.sort) { const btn = h('button', { type: 'button' }); btn.addEventListener('click', () => { if (key === i) d = -d; else { key = i; d = c.dir || 1; } paint(); }); th.appendChild(btn); th._btn = btn; }
    else th.textContent = c.label;
    return th;
  });
  function paint() {
    ths.forEach((th, i) => { const c = cols[i]; if (!c.sort) return; const on = key === i;
      th._btn.textContent = c.label + (on ? (d > 0 ? ' ▲' : ' ▼') : '');
      if (on) th.setAttribute('aria-sort', d > 0 ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort'); });
    const list = key != null && cols[key].sort ? rows.slice().sort((a, b) => cmp(cols[key].sort(a), cols[key].sort(b)) * d) : rows;
    tbody.replaceChildren(...list.map(x => h('tr', rowAttrs ? rowAttrs(x) : null, cols.map(c => h('td', { class: c.cls || (c.r ? 'num r' : null) }, c.cell(x))))));
  }
  paint();
  return h('div', { class: 'tscroll' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ths)), tbody));
}

export async function renderSavedDetail(root, { id, ds, onBack, onRebuild }) {
  root.replaceChildren(h('p', { class: 'loading note', text: 'Caricamento della scala…' }));
  const back = h('div', { class: 'actions' }, h('button', { type: 'button', class: 'mini', text: '← Tutte le scale', on: { click: onBack } }));
  if (!cloudReady()) { root.replaceChildren(back, panelEl('Scala salvata', null, note('Cloud non disponibile: impossibile aprire la scala.'))); return; }
  let doc;
  try { doc = await getLadder(id); } catch (e) { root.replaceChildren(back, panelEl('Scala salvata', null, note(`La scala non si è caricata: ${e.message}`))); return; }
  if (!doc) { root.replaceChildren(back, panelEl('Scala salvata', null, note('Scala non trovata: forse è stata eliminata.'))); return; }
  if (!ds) { root.replaceChildren(back, panelEl('Scala salvata', null, note('Servono i dati di oggi per il confronto: caricali dalla data EOD in alto.'))); return; }
  const m = monitor(doc, ds);
  const pnlPct = m.invested ? m.pnl / m.invested * 100 : NaN;
  const dy = m.yNow - m.yThen;
  const months = Math.max(0, Math.round(m.days / 30.4));

  const kpis = h('div', { class: 'kpis' },
    kpi('Investito', fmtEur(m.invested), `${m.pos.length} titoli al ${fmt(m.saved)}`),
    kpi('Valore oggi', fmtEur(m.valueNow), 'prezzo + rateo dei titoli in corso'),
    kpi('Già incassato', fmtEur(m.coupons + m.redeemed), `cedole ${fmtEur(m.coupons)} · rimborsi ${fmtEur(m.redeemed)}`),
    kpi('Risultato', deltaEl(m.pnl, 0, ' €'), Number.isFinite(pnlPct) ? deltaEl(pnlPct, 2, '%') : null),
    kpi('Rendimento dall\'acquisto', Number.isFinite(m.irr) ? deltaEl(m.irr * 100, 2, '%') : '—', 'annualizzato, al netto'));
  const actions = h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'mini', text: '← Tutte le scale', on: { click: onBack } }),
    h('button', { type: 'button', class: 'mini', text: 'Ricostruisci con i dati di oggi', on: { click: () => onRebuild(doc) } }),
    h('button', { type: 'button', class: 'mini', text: 'Copia il link', on: { click: async () => toast(await copyText(shareUrl(doc.id)) ? 'Link copiato: chi lo apre vede questa scala' : shareUrl(doc.id), 'ok') } }),
    h('button', { type: 'button', class: 'mini', text: 'Elimina la scala', on: { click: async () => {
      if (!confirm('Eliminare questa scala?')) return;
      try { await deleteLadder(doc.id); toast('Scala eliminata', 'ok'); onBack(); } catch (e) { toast(e.message, 'err'); }
    } } }));

  const notes = [];
  if (Number.isFinite(dy) && Math.abs(dy) >= 0.05) notes.push(['info', dy > 0
    ? `I rendimenti dei tuoi titoli sono saliti (${trendText(dy, 2, ' punti')}): i prezzi sono scesi (minusvalenza solo sulla carta se tieni fino a scadenza), ma oggi reinvestire renderebbe di più.`
    : `I rendimenti dei tuoi titoli sono scesi (${trendText(dy, 2, ' punti')}): i prezzi sono saliti (plusvalenza latente); tenendo fino a scadenza il rendimento previsto non cambia.`]);
  if (m.pos.some(p => p.assumedNominal)) notes.push(['warn', 'Scala salvata con la versione precedente: i nominali non erano registrati, uso 10.000 € per titolo.']);
  if (m.missing) notes.push(['warn', `${m.missing} titoli non sono nei dati di oggi: il loro valore non è conteggiato.`]);

  const cols = [
    { label: 'Titolo', sort: r => r.p.desc || r.p.isin, cell: r => [h('span', { class: 'sym', text: r.p.isin || '—' }), h('span', { class: 'nm', text: r.p.desc || '' })] },
    { label: 'Scadenza', sort: r => r.p.maturity ?? 0, cell: r => h('span', { class: 'num', text: r.p.maturity != null ? fmt(r.p.maturity) : '—' }) },
    { label: 'Nominale', r: 1, sort: r => r.p.nominal, cell: r => fmtNum(r.p.nominal, 0) },
    { label: 'Prezzo allora', r: 1, cell: r => fmtNum(r.p.price, 2) },
    { label: 'Prezzo oggi', r: 1, sort: r => r.b ? r.b.price - r.p.price : 0, cell: r => r.b ? [fmtNum(r.b.price, 2), ' ', deltaEl((r.b.price / r.p.price - 1) * 100, 2, '%')] : '—' },
    { label: 'Netto allora', r: 1, cell: r => Number.isFinite(r.p.ytmNet) ? fmtPct(r.p.ytmNet) : Number.isFinite(r.p.ytmGross) ? fmtPct(r.p.ytmGross) + ' L' : '—' },
    { label: 'Netto oggi', r: 1, cell: r => r.b ? [fmtPct(r.b.ytmNet), Number.isFinite(r.p.ytmNet) ? h('span', { class: 'dlt', text: ` ${trendText(r.b.ytmNet - r.p.ytmNet, 2)}` }) : null] : '—' },
    { label: 'Valore oggi', r: 1, sort: r => r.mv ?? 0, cell: r => r.mv != null ? fmtNum(r.mv, 0) : '—' },
    { label: 'Stato', cell: r => r.st === 'rimborsato' ? badge('trig', 'Rimborsato') : r.st === 'in corso' ? badge('normal', 'In corso') : badge('watch', 'Non quotato') }
  ];
  root.replaceChildren(...[
    actions,
    panelEl(doc.name || 'Scala salvata', `${TYPE_LABEL[doc.type] || doc.type || ''} · salvata con i dati del ${fmt(m.saved)} · confronto con quelli del ${fmt(ds.refDate)}${months ? ` (${months} mesi dopo)` : ''}`),
    kpis,
    notes.length ? panelEl('Da sapere', `${notes.length} ${notes.length === 1 ? 'nota' : 'note'}`, h('div', { class: 'pb' }, h('div', { class: 'states' }, notes.map(([k, t]) => h('div', { class: 'srow' }, badge(...KIND[k]), h('span', { text: t })))))) : null,
    panelEl('Titoli', 'prezzi e rendimenti netti: al salvataggio → oggi · euro', table(cols, m.rows, 1, 1)),
    h('p', { class: 'note', text: 'Verde e rosso con ▲ ▼ indicano solo variazioni di prezzo o di valore; le variazioni di rendimento sono scritte con segno e freccia.' })
  ].filter(Boolean));
}

export { iso, years };
