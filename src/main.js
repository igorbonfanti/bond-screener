/* Bond Ladder v3 — avvio, dati, calcolo nel worker, schede e indirizzi, barra comandi, dialoghi.
   Aspetto: design system «Terminale ambra» (css/terminale.css); qui solo struttura e comportamento. */
import { h, $, toast, debounce, fmtEur, fmtPct, fmtNum, copyText, downloadFile, badge, trendText } from './ui/dom.js';
import { loadSettings, saveSettings } from './state.js';
import { loadText } from './data/stfi.js';
import { enrich } from './core/basket.js';
import { loadLatest, loadDemo, readCache, writeCache, clearCache, remoteInfo, STFI_PAGE } from './data/source.js';
import { compute } from './engine.js';
import { mountSettings, renderSettings } from './ui/settings.js';
import { renderResults } from './ui/results.js';
import { openSheet, closeSheet } from './ui/sheet.js';
import { renderSavedList, renderSavedDetail } from './ui/saved.js';
import { openHelp, shortcutsOn } from './ui/help.js';
import { saveLadder, cloudReady, currentUser, openLogin } from './cloud.js';
import { fmt, iso, parseDay, day, parts, weekday } from './core/dates.js';

const VERSION = '3.3.0';
const INTRO_KEY = 'bondladder.intro';
const CVD_KEY = 'bondladder.cvd';
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* navigazione privata */ } }
};
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const app = { ds: null, meta: null, text: null, st: null, result: null, worker: null, workerReady: false, req: 0, pending: new Map(), lastSaved: null, booting: false, settings: null };

/* ---------------- Dati: data EOD, stato e origine ---------------- */
/** "oggi alle 23:13", "ieri alle 18:40", "il 22/09/2026 alle 21:05" (ora locale). */
function when(isoStr) {
  const d = isoStr ? new Date(isoStr) : null;
  if (!d || isNaN(d)) return '';
  const hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const n = new Date();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
  return diff === 0 ? `oggi alle ${hm}` : diff === -1 ? `ieri alle ${hm}` : `il ${d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })} alle ${hm}`;
}
const dayText = isoDay => { const d = parseDay(isoDay); return d == null ? '—' : fmt(d); };

/** Da dove vengono i dati in uso, in parole: {label, sub, tag (breve, accanto alla data EOD)}. */
function origin(m) {
  if (!m) return { label: 'Nessun dato', sub: '' };
  if (m.source === 'demo') return { label: 'Dati di esempio', sub: 'titoli inventati, solo per provare l\'app' };
  if (m.source === 'manual') { const t = when(m.loadedAt || m.fetchedAt); return { label: 'File caricato da te', sub: [m.fileName, t && 'caricato ' + t].filter(Boolean).join(' · '), tag: 'manuale' }; }
  if (m.from === 'cache') return { label: 'Copia salvata nel browser', sub: `del file automatico${m.loadedAt ? ', scaricato ' + when(m.loadedAt) : ''}`, tag: 'copia locale' };
  return { label: 'File automatico', sub: `scaricato ${when(m.loadedAt)}` };
}

/** Sedute di Borsa Italiana: giorni feriali tranne le chiusure fisse, il Venerdì santo e il lunedì dell'Angelo. */
const CLOSED = ['01-01', '05-01', '08-15', '12-24', '12-25', '12-26', '12-31'];
function easter(y) {   // domenica di Pasqua, calendario gregoriano
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), x = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - x - k) % 7, m = Math.floor((a + 11 * x + 22 * l) / 451), n = x + l - 7 * m + 114;
  return day(y, Math.floor(n / 31), (n % 31) + 1);
}
function isSession(dn) {
  const w = weekday(dn);
  if (w === 0 || w === 6) return false;
  const { y, m, d } = parts(dn), e = easter(y);
  return dn !== e - 2 && dn !== e + 1 && !CLOSED.includes(`${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
}
/** Sedute che mancano fra i prezzi in uso e gli ultimi attesi. Il file del giorno arriva la sera
    (l'automazione gira alle 17:40 e alle 21:10 UTC, a volte in ritardo): fino alle 22:30 UTC basta la seduta precedente. */
function sessionsBehind(ref, now = new Date()) {
  const n = now;
  let last = day(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate());
  if (!(isSession(last) && n.getUTCHours() * 60 + n.getUTCMinutes() >= 22 * 60 + 30)) do last--; while (!isSession(last));
  let k = 0;
  for (let d = last; d > ref; d--) if (isSession(d)) k++;
  return k;
}

/** Data EOD nella barra comandi: data dei prezzi, badge di freschezza e, se non è il file automatico, l'origine. */
function renderClock() {
  const c = $('#dataClock');
  const m = app.ds ? app.meta : null, o = origin(m);
  let fresh;
  if (!m) fresh = ['stale', 'Nessun dato'];
  else if (m.source === 'demo') fresh = ['late', 'Dati di esempio'];
  else {
    const k = sessionsBehind(app.ds.refDate);
    fresh = k === 0 ? ['ok', 'Aggiornato'] : [k === 1 ? 'late' : 'stale', `${k} ${k === 1 ? 'seduta' : 'sedute'} indietro`];
  }
  c.replaceChildren(h('span', null, 'EOD ', h('b', { text: app.ds ? fmt(app.ds.refDate) : '—' })),
    h('span', { class: 'clock-st' }, h('span', { class: 'fresh ' + fresh[0], text: fresh[1] }), o.tag ? h('span', { class: 'org', text: o.tag }) : null));
  c.setAttribute('aria-label', `Dati di fine giornata${app.ds ? ' del ' + fmt(app.ds.refDate) : ''}: ${fresh[1].toLowerCase()}${m ? ', ' + o.label.toLowerCase() : ''}. Apri i dettagli sui dati`);
  renderStatus();
}

/** Riga di stato: la data dei prezzi, quanti titoli e quando è stato generato il file in uso. */
function renderStatus() {
  const m = app.ds ? app.meta : null;
  let t = 'nessun dato caricato';
  if (m) {
    const gen = m.source === 'demo' ? 'dati di esempio, titoli inventati'
      : m.source === 'manual' ? `file caricato da te${m.loadedAt ? ' ' + when(m.loadedAt) : ''}`
      : `file pubblicato ${when(m.publishedAt) || '—'}${m.from === 'cache' ? ', copia salvata nel browser' : ''}`;
    t = `prezzi del ${fmt(app.ds.refDate)} · ${fmtNum(app.ds.bonds.length, 0)} titoli · ${gen}`;
  }
  $('#stFile').textContent = t + ' ·';
}

async function setData(text, meta, { silent = false } = {}) {
  let ds;
  try { ds = enrich(loadText(text)); } catch (e) { toast(e.message, 'err'); return false; }
  app.ds = ds;
  app.text = text;
  app.meta = { ...meta, refDate: iso(ds.refDate) };        // fa fede la data scritta nel file
  if (meta.source !== 'demo' && meta.from !== 'cache') writeCache(text, { ...app.meta, from: undefined });
  if (!app.st) app.st = loadSettings(ds.refDate);
  startWorker(text);
  renderClock();
  if (!silent) toast(meta.source === 'manual' ? `File caricato: dati del ${fmt(ds.refDate)}` : `Dati del ${fmt(ds.refDate)} pronti`, 'ok');
  route();
  return true;
}

/** Nessun dato in uso (copia cancellata e file automatico irraggiungibile). */
function dropData() {
  if (app.worker) app.worker.terminate();
  Object.assign(app, { ds: null, meta: null, text: null, result: null, worker: null, workerReady: false });
  renderClock();
  route();
}

function startWorker(text) {
  app.workerReady = false;
  if (app.worker) app.worker.terminate();
  app.worker = null;
  try {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { type, id } = e.data;
      if (type === 'loaded') { app.workerReady = true; scheduleCompute(); return; }
      const p = app.pending.get(id);
      if (!p) return;
      app.pending.delete(id);
      if (type === 'result') p.resolve(e.data.result); else p.reject(new Error(e.data.message));
    };
    w.onerror = () => { app.worker = null; app.workerReady = false; };
    w.postMessage({ type: 'load', text });
    app.worker = w;
  } catch { app.worker = null; }
}

function computeAsync(st) {
  if (app.worker && app.workerReady) {
    const id = ++app.req;
    return new Promise((resolve, reject) => {
      app.pending.set(id, { resolve, reject });
      app.worker.postMessage({ type: 'compute', id, settings: JSON.parse(JSON.stringify(st)) });
    });
  }
  return new Promise(resolve => setTimeout(() => resolve(compute(app.ds, st)), 0));   // ripiego senza worker
}

let computeSeq = 0;
async function runCompute() {
  if (!app.ds || !app.st || !app.st.goal || currentRoute().name !== 'build') return;
  const seq = ++computeSeq;
  const res = $('#results');
  if (res) { res.classList.add('busy'); res.setAttribute('aria-busy', 'true'); }
  try {
    const r = await computeAsync(app.st);
    if (seq !== computeSeq) return;             // arrivato un calcolo più recente
    app.result = r;
    renderBuildResults();
  } catch (e) { toast('Errore di calcolo: ' + e.message, 'err'); }
  finally { if (seq === computeSeq && res) { res.classList.remove('busy'); res.removeAttribute('aria-busy'); } }
}
const scheduleCompute = debounce(runCompute, 160);

function settingsChanged() {
  saveSettings(app.st);
  scheduleCompute();
}

/* ---------------- Schede e indirizzi ---------------- */
const TABS = { capital: '#/capitale', income: '#/rendita', saved: '#/scale' };

function currentRoute() {
  const hsh = location.hash || '#/';
  let m;
  if ((m = hsh.match(/^#\/l\/(.+)$/))) return { name: 'ladder', id: decodeURIComponent(m[1]) };
  if ((m = hsh.match(/^#\/s\/(.+)$/))) return { name: 'shared', data: m[1] };
  if (hsh.startsWith('#/scale')) return { name: 'saved' };
  if (hsh.startsWith('#/rendita')) return { name: 'build', goal: 'income' };
  if (hsh.startsWith('#/capitale')) return { name: 'build', goal: 'capital' };
  return { name: 'build', goal: null };
}

function selectTab(view) {
  document.querySelectorAll('#tabs [role="tab"]').forEach(t => {
    const on = t.dataset.view === view;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  });
  $('#view').setAttribute('aria-labelledby', 'tab-' + view);
}

function go(view) {
  if (location.hash !== TABS[view]) location.hash = TABS[view];
  else route();
}

function route() {
  const r = currentRoute();
  const view = $('#view');
  showBar(false);
  if (r.name === 'shared') {
    try {
      const st = JSON.parse(decodeURIComponent(escape(atob(r.data.replace(/-/g, '+').replace(/_/g, '/')))));
      if (st && st.goal) { app.st = { ...(app.st || {}), ...st }; saveSettings(app.st); toast('Configurazione condivisa caricata', 'ok'); }
    } catch { toast('Link non valido', 'err'); }
    history.replaceState(null, '', TABS[app.st && app.st.goal === 'income' ? 'income' : 'capital']);
    return route();
  }
  if (r.name === 'saved' || r.name === 'ladder') {
    selectTab('saved');
    const box = h('div', { class: 'stack' });
    view.replaceChildren(box);
    if (r.name === 'saved') renderSavedList(box, { ds: app.ds, onOpen: id => { location.hash = '#/l/' + encodeURIComponent(id); } });
    else renderSavedDetail(box, { id: r.id, ds: app.ds, onBack: () => { location.hash = TABS.saved; }, onRebuild: rebuildFrom });
    return;
  }
  const goal = r.goal || (app.st && app.st.goal === 'income' ? 'income' : 'capital');
  if (!r.goal) history.replaceState(null, '', TABS[goal]);
  selectTab(goal);
  if (!app.ds) { view.replaceChildren(app.booting ? h('p', { class: 'loading note', text: 'Caricamento dei dati…' }) : noDataView()); return; }
  if (app.st.goal !== goal) { app.st.goal = goal; saveSettings(app.st); }
  const panel = h('aside', { class: 'side stack', id: 'panel', 'aria-label': 'Impostazioni' });
  const results = h('div', { class: 'results stack', id: 'results', 'aria-live': 'polite' });
  view.replaceChildren(...[store.get(INTRO_KEY) ? null : introBox(), h('div', { class: 'layout' }, panel, results)].filter(Boolean));
  app.settings = { root: panel, st: app.st, ds: app.ds, changed: settingsChanged, basketMeta: app.settings ? app.settings.basketMeta : '' };
  mountSettings(app.settings);
  if (app.result && app.result.goal === goal) renderBuildResults();
  else results.append(h('p', { class: 'loading note', text: 'Calcolo della proposta…' }));
  showBar(true);
  scheduleCompute();
}

function rebuildFrom(doc) {
  if (doc.v !== 3 || !doc.params) { toast('Scala della versione precedente: parametri non ricostruibili.', 'err'); return; }
  app.st = { ...app.st, ...JSON.parse(JSON.stringify(doc.params)), fixed: {} };
  saveSettings(app.st);
  location.hash = TABS[app.st.goal === 'income' ? 'income' : 'capital'];
  toast('Parametri caricati: proposta ricalcolata con i dati di oggi', 'ok');
}

/* ---------------- Benvenuto e dati mancanti ---------------- */
function introBox() {
  const box = h('section', { class: 'intro', 'aria-label': 'Benvenuto' },
    h('p', null, 'Costruisce una ', h('b', { text: 'scala di titoli di Stato' }), ' con i prezzi di chiusura di simpletoolsforinvestors.eu, aggiornati ogni sera, e le tasse italiane già calcolate.'),
    h('ol', null,
      h('li', null, 'Scegli la vista: ', h('b', { text: 'capitale a scadenza' }), ' per avere somme a date precise, ', h('b', { text: 'rendita mensile' }), ' per incassare cedole regolari.'),
      h('li', null, 'Imposta importi, scadenze e titoli ammessi: la proposta si ricalcola a ogni modifica.'),
      h('li', null, 'Controlla titoli e nominali, poi salva la scala per confrontarla con i prezzi dei giorni successivi.')),
    h('div', { class: 'intro-btns' },
      h('button', { type: 'button', class: 'mini', text: 'Ho capito', on: { click: () => { store.set(INTRO_KEY, '1'); box.remove(); $('#view').focus({ preventScroll: true }); } } }),
      h('button', { type: 'button', class: 'mini', 'aria-haspopup': 'dialog', text: 'Apri la guida', on: { click: openHelp } })));
  return box;
}

function noDataView() {
  const file = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, on: { change: e => { const f = e.target.files[0]; e.target.value = ''; if (f) readFile(f); } } });
  const drop = h('div', { class: 'drop', role: 'button', tabindex: 0, 'aria-label': 'Carica il file Dati End of Day: trascinalo qui oppure premi Invio per sceglierlo', on: {
    click: () => file.click(), keydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } },
    dragover: e => { e.preventDefault(); drop.classList.add('drag'); }, dragleave: () => drop.classList.remove('drag'),
    drop: e => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); } } },
    h('b', { text: 'Carica il file «Dati End of Day»' }), h('span', { text: 'trascinalo qui o tocca per sceglierlo' }));
  let busy = false;
  const retry = h('button', { type: 'button', class: 'mini', text: 'Riprova il file automatico', on: { click: async () => {
    if (busy) return;
    busy = true; retry.textContent = 'Scarico il file…';
    const d = await loadLatest({ force: true }).catch(() => null);
    busy = false;
    if (d) setData(d.text, d.meta);
    else { retry.textContent = 'Riprova il file automatico'; toast('File automatico non raggiungibile: controlla la connessione', 'err'); }
  } } });
  return h('section', { class: 'panel nodata' },
    h('div', { class: 'ph' }, h('h2', { text: 'Mancano i dati del giorno' }), h('span', { class: 'meta', text: 'file automatico non raggiungibile' })),
    h('div', { class: 'pb stack' },
      h('p', { class: 'lead', text: 'L\'app si aggiorna da sola ogni sera con i dati di simpletoolsforinvestors.eu. Se sei offline al primo avvio, carica tu il file CSV «Dati End of Day» dalla pagina Documenti e download.' }),
      drop, file,
      h('div', { class: 'actions' },
        retry,
        h('a', { class: 'mini', href: STFI_PAGE, target: '_blank', rel: 'noopener', text: 'Apri simpletoolsforinvestors' }),
        h('button', { type: 'button', class: 'mini', text: 'Prova con dati di esempio', on: { click: async () => { try { const d = await loadDemo(); setData(d.text, d.meta); } catch { toast('Dati di esempio non disponibili', 'err'); } } } }))));
}

async function readFile(f) {
  try { const text = await f.text(); return await setData(text, { source: 'manual', fileName: f.name, loadedAt: new Date().toISOString() }); }
  catch (e) { toast('Lettura non riuscita: ' + e.message, 'err'); return false; }
}

/* ---------------- Risultati del costruttore ---------------- */
function renderBuildResults() {
  const box = $('#results');
  if (!box || !app.result) return;
  renderResults(box, { st: app.st, result: app.result, actions: {
    onSwap: (label, isin) => { app.st.fixed = { ...app.st.fixed, [label]: isin }; settingsChanged(); toast(`Titolo cambiato per ${label}`, 'ok'); },
    onUnfix: (label) => { const f = { ...app.st.fixed }; delete f[label]; app.st.fixed = f; settingsChanged(); },
    onExclude: (isin, desc) => { app.st.basket.excludedIsins = [...new Set([...(app.st.basket.excludedIsins || []), isin])]; settingsChanged(); renderSettings(); toast(`Escluso: ${desc}`, 'ok'); },
    onAlternatives: openAlternatives,
    onSave: openSave,
    onShare: shareConfig
  } });
  const meta = `${fmtNum(app.result.basketCount, 0)} su ${fmtNum(app.ds.bonds.length, 0)} titoli`;
  if (app.settings) app.settings.basketMeta = meta;
  const el = $('#basketMeta');
  if (el) el.textContent = meta;
  updateMobileBar();
}

/** Titoli che possono coprire una scadenza: tabella nel dialogo, una riga si sceglie con clic o Invio. */
function openAlternatives(t) {
  const cur = t.bond;
  const list = t.candidates.slice(0, 40);
  const eff = t.need != null;
  const curC = cur ? t.candidates.find(x => x.bond.isin === cur.isin) : null;
  const choose = b => {
    closeSheet();
    if (cur && b.isin === cur.isin) return;
    app.st.fixed = { ...app.st.fixed, [t.label]: b.isin };
    settingsChanged();
    toast(`Scelto ${b.desc} per ${t.label}`, 'ok');
  };
  const liq = n => '●'.repeat(Math.max(0, Math.min(4, n))) + '○'.repeat(4 - Math.max(0, Math.min(4, n)));
  let focusSet = false;
  const rows = list.map(c => {
    const b = c.bond, isCur = !!cur && b.isin === cur.isin;
    const d = curC && !isCur ? (c.score - curC.score) * 100 : NaN;
    const auto = !focusSet && (isCur || !cur);
    if (auto) focusSet = true;
    return h('tr', { class: isCur ? 'sel' : null, 'data-sym': b.isin, tabindex: 0, 'data-autofocus': auto ? '' : null,
      'aria-label': `${b.desc}, scade il ${fmt(b.maturity)}, ${eff ? 'rendimento effettivo' : 'rendimento netto'} ${fmtPct(c.score * 100)}${isCur ? ', in uso' : ''}. Invio per sceglierlo`,
      on: { click: () => choose(b), keydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(b); } } } },
      h('td', null, h('span', { class: 'sym', text: b.isin }), h('span', { class: 'nm', text: b.desc }), isCur ? h('span', { class: 'tags' }, h('span', { class: 'tag', text: 'in uso' })) : null),
      h('td', { class: 'num r', text: fmtPct(c.score * 100) }),
      h('td', { class: 'num r', text: Number.isFinite(d) ? trendText(d, 2) : '—' }),
      h('td', { class: 'num', text: fmt(b.maturity) }),
      h('td', { class: 'num r', text: fmtNum(b.price, 2) }),
      h('td', { text: b.rating || 'NR' }),
      h('td', { class: 'liq', title: `liquidità ${b.liquidity} su 4`, text: liq(b.liquidity) }),
      h('td', { class: 'num r', text: fmtNum(b.lot, 0) }));
  });
  const th = (text, r, sort) => h('th', { scope: 'col', class: r ? 'r' : null, 'aria-sort': sort || null, text: text + (sort ? ' ▼' : '') });
  const body = h('div', { class: 'stack' },
    h('p', { class: 'note', text: `Scegli una riga (clic o Invio) per usare quel titolo in ${t.label}: la proposta si ricalcola. «Differenza» è in punti percentuali rispetto al titolo in uso.` }),
    list.length ? h('div', { class: 'tscroll' }, h('table', { class: 't' },
      h('caption', { class: 'sr', text: `Titoli per ${t.label}` }),
      h('thead', null, h('tr', null, th('Titolo'), th(eff ? 'Effettivo' : 'Netto', 1, 'descending'), th('Differenza', 1), th('Scade il'), th('Prezzo', 1), th('Rating'), th('Liquidità'), th('Lotto', 1))),
      h('tbody', null, rows)))
      : h('p', { class: 'empty', text: 'Nessun titolo del paniere scade in questo periodo: allarga il paniere o la finestra.' }));
  openSheet({ title: `Titoli per ${t.label}`, wide: true,
    sub: `${t.candidates.length} titoli · ${eff ? 'rendimento effettivo alla data (conta anche l\'attesa)' : 'rendimento netto'}${t.candidates.length > list.length ? ` · i primi ${list.length}` : ''}`,
    body,
    foot: t.fixed ? [h('button', { type: 'button', class: 'mini', text: 'Torna alla scelta automatica', on: { click: () => { closeSheet(); const f = { ...app.st.fixed }; delete f[t.label]; app.st.fixed = f; settingsChanged(); } } })] : null });
}

function buildDoc(name) {
  const plan = app.result.plan, ds = app.ds;
  const clean = v => (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) ? null : v;
  const slots = plan.positions.map(p => ({
    isin: p.bond.isin, desc: p.bond.desc, issuer: p.bond.issuer, issuerName: p.bond.issuerName, country: p.bond.country, area: p.bond.area,
    maturity: iso(p.bond.maturity), nominal: p.nominal, price: p.bond.price, cost: clean(p.bond.cost), ytmNet: clean(p.bond.ytmNet),
    ytmSuperNet: clean(p.bond.ytmSuperNet), coupon: p.bond.coupon, months: p.bond.months, lot: p.bond.lot, tax: p.bond.tax,
    target: plan.mode === 'capital' ? plan.targets[p.target].label : null
  }));
  const received = plan.schedule.reduce((s, f) => s + f.net, 0);
  const { goal, capital, income, basket } = app.st;
  return {
    v: 3, name, type: plan.mode === 'capital' ? 'capitale' : 'rendita', createdAt: new Date().toISOString(),
    referenceDate: iso(ds.refDate), settle: iso(ds.settle),
    params: JSON.parse(JSON.stringify({ goal, capital, income, basket })),
    metrics: { totalCost: clean(plan.totalCost), irr: clean(plan.irr), yieldNet: clean(plan.summary.yieldNet), duration: clean(plan.summary.duration), received: clean(received),
      annual: clean(plan.annual ?? null), minMonth: clean(plan.minMonth ?? null) },
    slots
  };
}

function openSave() {
  if (!app.result || !app.result.plan || !app.result.plan.positions || !app.result.plan.positions.length) { toast('Niente da salvare', 'err'); return; }
  if (!cloudReady()) { toast('Cloud non disponibile: sei offline?', 'err'); return; }
  // il modulo di accesso sta fuori dal dialogo: si apre da solo, prima del dialogo
  if (!currentUser()) { openLogin(); toast('Accedi per salvare, poi premi di nuovo «Salva la scala». La consultazione resta libera.'); return; }
  const plan = app.result.plan;
  const def = plan.mode === 'capital' ? `Scala capitale ${fmt(app.ds.refDate)}` : `Rendita ${fmtEur(plan.annual / 12)}/mese ${fmt(app.ds.refDate)}`;
  const input = h('input', { id: 'saveName', class: 'input text', value: def, maxlength: 80, autocomplete: 'off' });
  const btn = h('button', { type: 'button', class: 'mini primary', text: 'Salva la scala' });
  let saving = false;
  const doSave = async () => {
    if (saving) return;
    saving = true; btn.disabled = true; btn.textContent = 'Salvo…';
    try {
      const id = await saveLadder(buildDoc(input.value.trim() || def));
      app.lastSaved = id; closeSheet();
      toast('Scala salvata: la trovi in «Le mie scale»', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { saving = false; btn.disabled = false; btn.textContent = 'Salva la scala'; }
  };
  btn.addEventListener('click', doSave);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSave(); });
  openSheet({ title: 'Salva la scala', sub: 'titoli, nominali e prezzi di oggi',
    body: h('div', { class: 'save-name' }, h('label', { class: 'lbl', for: 'saveName', text: 'Nome della scala' }), input,
      h('p', { class: 'note', text: 'In «Le mie scale» la confronti con i prezzi dei giorni successivi: valore, cedole e rimborsi incassati, risultato.' })),
    foot: [h('button', { type: 'button', class: 'mini', text: 'Annulla', on: { click: () => closeSheet() } }), btn] });
}

async function shareConfig() {
  const json = JSON.stringify(app.st);
  const enc = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = `${location.origin}${location.pathname}#/s/${enc}`;
  if (navigator.share && matchMedia('(max-width: 1100px)').matches) {
    try { await navigator.share({ title: 'Bond Ladder', text: 'La mia configurazione della scala di titoli di Stato', url }); return; } catch { /* annullato */ }
  }
  toast(await copyText(url) ? 'Link copiato: chi lo apre vede la stessa configurazione con i dati del giorno' : url, 'ok');
}

/* ---------------- Barra in basso sul telefono ---------------- */
function showBar(on) {
  $('#mobileBar').hidden = !on;
  document.body.classList.toggle('has-bar', on);
}

function updateMobileBar() {
  if (!app.result || !app.result.plan) return;
  const p = app.result.plan;
  const main = p.mode === 'capital' ? `${fmtEur(p.totalCost)} da investire` : p.empty ? 'Nessuna proposta' : `${fmtEur(p.annual / 12)} al mese`;
  const sub = p.mode === 'capital' ? `netto ${fmtPct(p.irr * 100)} · ${p.targets.filter(t => t.bond).length}/${p.targets.length} scadenze` : p.empty ? '' : `netto ${fmtPct(p.irr * 100)} · ${p.coveredMonths}/12 mesi`;
  $('#mbMain').textContent = main; $('#mbSub').textContent = sub;
}

function updateBarButton() {
  const res = $('#results');
  if (res) $('#mbBtn').textContent = res.getBoundingClientRect().top < window.innerHeight * 0.4 ? 'Impostazioni ↑' : 'Vedi proposta ↓';
}

/* ---------------- Dialogo dei dati ---------------- */
/** Il file in uso confrontato con il file automatico pubblicato: [stato del badge, parola, motivo]. */
function remoteStatus(remote) {
  const m = app.ds ? app.meta : null;
  const OK = 'trig', WARN = 'watch', NOTE = 'normal';
  if (!remote) return [WARN, 'Attenzione', m && m.from === 'cache'
    ? 'Il file automatico adesso non è raggiungibile (sei offline?): stai usando la copia salvata nel browser.'
    : 'Il file automatico adesso non è raggiungibile (sei offline?).'];
  const rd = remote.meta.refDate;
  const rdText = `dati del ${dayText(rd)}${remote.meta.fetchedAt ? ', pubblicato ' + when(remote.meta.fetchedAt) : ''}`;
  if (!m) return [NOTE, 'Nota', `Il file automatico è disponibile: ${rdText}.`];
  if (m.source === 'demo') return [NOTE, 'Nota', `Stai usando dati di esempio. Il file automatico ha i ${rdText}.`];
  if (m.source === 'auto') {
    if (rd === m.refDate) return [OK, 'OK', m.from === 'cache'
      ? `La copia nel browser coincide con il file automatico più recente (${rdText}).`
      : `Stai usando il file automatico più recente (${rdText}).`];
    if (rd > m.refDate) return [WARN, 'Attenzione', `C'è un file automatico più recente: ${rdText}. Scegli «Usa il file automatico».`];
    return [NOTE, 'Nota', `Il file automatico pubblicato ha dati più vecchi di quelli in uso (${dayText(rd)}).`];
  }
  if (rd > m.refDate) return [WARN, 'Attenzione', `Il file automatico è più recente del tuo: ${rdText}. Scegli «Usa il file automatico».`];
  if (rd === m.refDate) return [NOTE, 'Nota', 'Il file automatico ha la stessa data del tuo file: dal prossimo avvio l\'app userà quello.'];
  return [NOTE, 'Nota', `Il tuo file è più recente del file automatico (${dayText(rd)}): resta in uso finché non ne esce uno più nuovo.`];
}

function openDataDialog() {
  const file = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, on: { change: async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f && await readFile(f) && box.isConnected) paint();
  } } });
  const box = h('div', { class: 'stack data-dlg' });
  let remote = null, checking = true, busy = '', confirmClear = false, lastAct = null;

  const check = () => {
    checking = true;
    remoteInfo().then(r => { remote = r; checking = false; if (box.isConnected) paint(); });
  };

  /** Scarica adesso il file automatico e lo mette in uso; false se non è raggiungibile. */
  const useRemote = async () => {
    const d = await loadLatest({ force: true });
    if (!d) return false;
    remote = d.remote; checking = false;
    return setData(d.text, d.meta, { silent: true });
  };

  const run = async (key, fn) => {
    if (busy) return;
    busy = key; paint();
    try { await fn(); } catch (e) { toast(e.message, 'err'); }
    busy = ''; confirmClear = false;
    if (box.isConnected) paint();
  };

  const actions = {
    remote: () => run('remote', async () => {
      if (await useRemote()) toast(`In uso il file automatico: dati del ${fmt(app.ds.refDate)}`, 'ok');
      else { remote = null; checking = false; toast('File automatico non raggiungibile: controlla la connessione', 'err'); }
    }),
    upload: () => file.click(),
    download: () => {
      downloadFile(`stfi-dati-${iso(app.ds.refDate)}.csv`, app.text);
      toast('CSV in uso scaricato', 'ok');
    },
    clear: () => {
      if (app.meta && app.meta.source === 'manual' && !confirmClear) { confirmClear = true; paint(); return; }
      run('clear', async () => {
        clearCache();
        if (await useRemote()) toast(`Copia cancellata: in uso il file automatico appena scaricato (dati del ${fmt(app.ds.refDate)})`, 'ok');
        else {
          remote = null; checking = false;
          if (app.meta && app.meta.source !== 'demo') dropData();
          toast('Copia cancellata. Il file automatico non è raggiungibile: carica un file a mano', 'err');
        }
      });
    }
  };

  const kpi = (k, v, s, word) => h('div', { class: word ? 'kpi wide' : 'kpi' }, h('span', { class: 'k', text: k }), h('span', { class: word ? 'v word' : 'v num', text: v }), s ? h('span', { class: 's', text: s }) : null);

  const paint = () => {
    const m = app.ds ? app.meta : null, o = origin(m), cached = readCache();
    const act = (key, title, sub, cls = '') => h('button', { type: 'button', class: 'dact' + (cls ? ' ' + cls : ''), data: { act: key }, disabled: !!busy, 'aria-busy': busy === key ? 'true' : null,
      on: { click: () => { lastAct = key; actions[key](); } } }, h('b', { text: title }), h('span', { text: sub }));
    const savedAt = cached && (cached.meta.loadedAt || (cached.meta.source === 'manual' ? cached.meta.fetchedAt : null));
    const recRemote = !!remote && (!m || m.source === 'demo' || remote.meta.refDate > m.refDate || (m.source === 'auto' && m.from === 'cache'));
    const [state, word, text] = checking ? ['cool', 'Controllo', 'Controllo il file automatico pubblicato…'] : remoteStatus(remote);
    const active = document.activeElement;
    const refocus = box.contains(active) ? (active.dataset.act || lastAct) : (!active || active === document.body ? lastAct : null);

    box.replaceChildren(
      m ? h('div', { class: 'kpis' },
        kpi('Data dei prezzi', fmt(app.ds.refDate), `valuta ${fmt(app.ds.settle)}`),
        kpi('Titoli nel file', fmtNum(app.ds.bonds.length, 0)),
        kpi('Origine', o.label, o.sub, true))
        : h('p', { class: 'note', text: 'Nessun dato caricato.' }),
      h('div', { class: 'states', role: 'status' }, h('div', { class: 'srow' }, badge(state, word), h('span', { text }))),
      h('h3', { class: 'lbl', text: 'Le due fonti' }),
      h('dl', { class: 'facts' },
        h('dt', { text: 'File automatico' }),
        h('dd', null, checking ? 'controllo in corso…' : remote ? `dati del ${dayText(remote.meta.refDate)}` : 'non raggiungibile',
          checking ? null : h('span', { class: 'note', text: remote ? `pubblicato ${when(remote.meta.fetchedAt) || '—'} · aggiornato ogni sera dei giorni feriali` : 'riprova quando sei online' })),
        h('dt', { text: 'Copia nel browser' }),
        h('dd', null, cached ? `dati del ${dayText(cached.meta.refDate)}` : 'nessuna',
          h('span', { class: 'note', text: cached
            ? [cached.meta.source === 'manual' ? `file caricato da te${cached.meta.fileName ? ' (' + cached.meta.fileName + ')' : ''}` : 'file automatico', savedAt ? 'salvata ' + when(savedAt) : ''].filter(Boolean).join(' · ')
            : 'si crea da sola a ogni caricamento: serve per usare l\'app offline' }))),
      h('h3', { class: 'lbl', text: 'Azioni' }),
      h('div', { class: 'dacts' },
        act('remote', 'Usa il file automatico', busy === 'remote' ? 'Scarico il file…' : 'Lo scarica di nuovo adesso e lo mette in uso', recRemote ? 'rec' : ''),
        act('upload', 'Carica un file CSV', 'Il file «Dati End of Day» scaricato da simpletoolsforinvestors', !m && !checking && !remote ? 'rec' : ''),
        m && m.source !== 'demo' ? act('download', 'Scarica il CSV in uso', 'Salva sul dispositivo il file che l\'app sta usando') : null,
        cached || busy === 'clear' ? act('clear', confirmClear ? 'Conferma: cancella il tuo file' : 'Cancella la copia nel browser',
          busy === 'clear' ? 'Cancello e scarico il file automatico…' : confirmClear ? 'Il file caricato da te andrà perso: scegli di nuovo per confermare' : 'Elimina i dati salvati qui e riparte dal file automatico',
          confirmClear ? 'confirm' : '') : null),
      h('p', { class: 'note', text: 'All\'avvio l\'app scarica il file automatico, che un\'automazione su GitHub prende ogni sera dalla pagina Documenti e download di simpletoolsforinvestors. Un file caricato da te resta in uso solo finché è più recente del file automatico. La copia nel browser serve quando sei offline.' }),
      file);
    if (refocus) { const el = box.querySelector(`[data-act="${refocus}"]`); if (el && !el.disabled) el.focus({ preventScroll: true }); }
  };

  paint();
  check();
  openSheet({
    title: 'Dati del giorno', sub: 'simpletoolsforinvestors.eu · End of Day',
    body: box,
    foot: [h('a', { class: 'mini', href: STFI_PAGE, target: '_blank', rel: 'noopener', text: 'Apri il sito STFI' })]
  });
}

/* ---------------- Barra comandi ---------------- */
const NARROW = matchMedia('(max-width: 600px)');   // sul telefono il segnaposto intero non ci sta
const cmdHint = () => NARROW.matches ? 'CAP, REN, SCALE, ISIN, HELP' : 'Comando: CAP, REN, SCALE, DATI, un ISIN, HELP · poi Invio';
let cmdTimer = 0;
/** Comando non riconosciuto: messaggio nel segnaposto, in rosso, per 4 secondi (e letto dai lettori di schermo). */
function cmdError(msg, short) {
  const form = $('#cmd'), input = $('#cmdInput');
  input.value = '';
  input.placeholder = NARROW.matches && short ? short : msg;
  form.classList.add('err');
  $('#cmdStatus').textContent = msg;
  clearTimeout(cmdTimer);
  cmdTimer = setTimeout(() => { form.classList.remove('err'); input.placeholder = cmdHint(); $('#cmdStatus').textContent = ''; }, 4000);
}

/** Un ISIN: se è nella proposta porta alla sua riga, altrimenti dice dov'è. */
function findIsin(isin) {
  const res = currentRoute().name === 'build' ? $('#results') : null;
  const hit = res && [...res.querySelectorAll('tbody .code, tbody .sym')].find(el => el.textContent === isin);
  const row = hit && hit.closest('tr');
  if (row) {
    row.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    if (!row.hasAttribute('tabindex')) row.tabIndex = -1;
    row.focus({ preventScroll: true });
    row.classList.add('hl');
    setTimeout(() => row.classList.remove('hl'), 2500);
    return;
  }
  const b = app.ds && app.ds.bonds.find(x => x.isin === isin);
  if (!b) { cmdError(`${isin}: ISIN non presente nei dati del giorno`, `${isin}: non c'è`); return; }
  toast(`${b.desc} (${isin}) non è nella proposta: scade il ${fmt(b.maturity)}, prezzo ${fmtNum(b.price, 2)}, rendimento netto ${fmtPct(b.ytmNet)}.`);
}

const VIEW_CMDS = { 1: 'capital', CAP: 'capital', CAPITALE: 'capital', 2: 'income', REN: 'income', RENDITA: 'income', 3: 'saved', SCALE: 'saved', SCALA: 'saved', SALVATE: 'saved' };
function runCommand(raw) {
  const text = String(raw || '').trim();
  const q = text.toUpperCase().replace(/\s+/g, ' ');
  if (!q) return;
  const input = $('#cmdInput');
  const done = () => { input.value = ''; };
  if (VIEW_CMDS[q]) { done(); go(VIEW_CMDS[q]); return; }
  if (['DATI', 'EOD', 'DATA'].includes(q)) { done(); openDataDialog(); return; }
  if (['HELP', 'GUIDA', 'AIUTO', '?'].includes(q)) { done(); openHelp(); return; }
  if (q === 'CVD') { done(); toggleCvd(); return; }
  if (/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(q)) { done(); findIsin(q); return; }
  cmdError(`«${text.slice(0, 24)}»: comando non trovato. Prova CAP, REN, SCALE, DATI, HELP o un ISIN`, `«${text.slice(0, 10)}»: non trovato`);
}

function toggleCvd() {
  const on = !document.documentElement.classList.contains('cvd');
  document.documentElement.classList.toggle('cvd', on);
  $('#cvdBtn').setAttribute('aria-pressed', String(on));
  store.set(CVD_KEY, on ? '1' : '0');
  toast(on ? 'Colori per daltonici: su in azzurro, giù in rosso' : 'Colori normali: su in verde, giù in rosso', 'ok');
}

/** Accesso (script condiviso con altri progetti): il suo pulsante resta nascosto, quello nella barra ne riflette lo stato. */
function wireLogin() {
  const btn = $('#loginBtn');
  btn.addEventListener('click', () => openLogin());
  const sync = () => {
    const u = currentUser(), email = u && u.email;
    btn.textContent = email ? 'Esci' : 'Accedi';
    btn.title = email ? `Accesso come ${email}: scegli per uscire` : 'Accedi per salvare le scale: la consultazione resta libera';
    btn.setAttribute('aria-label', email ? `Esci da ${email}` : 'Accedi per salvare');
    btn.hidden = false;
  };
  const watch = src => { sync(); new MutationObserver(sync).observe(src, { childList: true, characterData: true, subtree: true }); };
  const src = document.getElementById('accessoPulsante');
  if (src) { watch(src); return; }
  const obs = new MutationObserver(() => {
    const s = document.getElementById('accessoPulsante');
    if (s) { obs.disconnect(); watch(s); }
  });
  obs.observe(document.body, { childList: true });
}

/** Schede con frecce, Home e Fine; tasti 1–3, / e ? (si spengono dalla guida). */
function wireKeys() {
  const tabs = [...document.querySelectorAll('#tabs [role="tab"]')];
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => go(t.dataset.view));
    t.addEventListener('keydown', e => {
      const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (k == null) return;
      e.preventDefault();
      const next = tabs[(k + tabs.length) % tabs.length];
      next.focus();
      go(next.dataset.view);
    });
  });
  document.addEventListener('keydown', e => {
    if (!shortcutsOn() || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    const tg = e.target;
    if (tg && tg.closest && tg.closest('input, textarea, select, [contenteditable="true"], #accessoForm')) return;
    if (e.key >= '1' && e.key <= '3') {
      e.preventDefault();
      const v = ['capital', 'income', 'saved'][+e.key - 1];
      go(v);
      $('#tab-' + v).focus({ preventScroll: true });
    } else if (e.key === '/') { e.preventDefault(); $('#cmdInput').focus(); }
    else if (e.key === '?') { e.preventDefault(); openHelp(); }
  });
}

/* ---------------- Avvio ---------------- */
async function boot() {
  const cvd = $('#cvdBtn');
  cvd.setAttribute('aria-pressed', String(document.documentElement.classList.contains('cvd')));
  cvd.addEventListener('click', toggleCvd);
  $('#dataClock').addEventListener('click', openDataDialog);
  $('#helpBtn').addEventListener('click', openHelp);
  $('#cmd').addEventListener('submit', e => { e.preventDefault(); runCommand($('#cmdInput').value); });
  $('#cmdInput').placeholder = cmdHint();
  NARROW.addEventListener('change', () => { if (!$('#cmd').classList.contains('err')) $('#cmdInput').placeholder = cmdHint(); });
  $('#mbBtn').addEventListener('click', () => {
    const res = $('#results'), panel = $('#panel');
    if (!res || !panel) return;
    const inResults = res.getBoundingClientRect().top < window.innerHeight * 0.4;
    (inResults ? panel : res).scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  });
  window.addEventListener('scroll', debounce(updateBarButton, 80), { passive: true });
  window.addEventListener('hashchange', route);
  wireKeys();
  wireLogin();
  $('#version').textContent = `v${VERSION}`;
  renderClock();
  app.booting = true;
  let d = null;
  try { d = await loadLatest(); } catch { /* nessun dato */ }
  app.booting = false;
  if (d && await setData(d.text, d.meta, { silent: true })) {
    if (d.meta.from === 'cache' && !d.remote) toast(`File automatico non raggiungibile: in uso la copia salvata nel browser (dati del ${fmt(app.ds.refDate)})`);
    else if (d.meta.from === 'cache' && d.meta.source === 'manual') toast(`In uso il tuo file (dati del ${fmt(app.ds.refDate)}): è più recente del file automatico`);
    return;
  }
  if (!app.st) app.st = loadSettings(null);
  route();
}

boot();
