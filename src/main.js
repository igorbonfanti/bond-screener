/* Bond Ladder v3 — avvio, dati, calcolo nel worker, navigazione, dialoghi. */
import { h, $, logo, icon, toast, debounce, fmtEur, fmtPct, fmtNum, copyText, downloadFile } from './ui/dom.js';
import { loadSettings, saveSettings } from './state.js';
import { loadText } from './data/stfi.js';
import { enrich } from './core/basket.js';
import { loadLatest, loadDemo, readCache, writeCache, clearCache, remoteInfo, STFI_PAGE } from './data/source.js';
import { compute } from './engine.js';
import { mountSettings, renderSettings, goalCard } from './ui/settings.js';
import { renderResults } from './ui/results.js';
import { openSheet, closeSheet } from './ui/sheet.js';
import { renderSavedList, renderSavedDetail } from './ui/saved.js';
import { openHelp } from './ui/help.js';
import { saveLadder, cloudReady } from './cloud.js';
import { fmt, iso, today, parseDay } from './core/dates.js';

const VERSION = '3.1.1';
const app = { ds: null, meta: null, text: null, st: null, result: null, worker: null, workerReady: false, req: 0, pending: new Map(), lastSaved: null };

/* ---------------- Tema (standard Antigravity) ---------------- */
function setTheme(t) {
  const light = t === 'light';
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  $('#themeToggle').textContent = light ? '☀️' : '🌙';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', light ? '#f5f7fa' : '#0f1117');
  try { localStorage.setItem('antigravity-theme', light ? 'light' : 'dark'); } catch { /* */ }
}

/* ---------------- Dati ---------------- */
function dataAge() {
  if (!app.ds) return null;
  return today() - app.ds.refDate;
}
/** Da dove vengono i dati in uso, in parole: {label, sub, tag (breve, per l'indicatore)}. */
function origin(m) {
  if (!m) return { label: 'Nessun dato', sub: '' };
  if (m.source === 'demo') return { label: 'Dati di esempio', sub: 'titoli inventati, solo per provare l\'app' };
  if (m.source === 'manual') { const t = when(m.loadedAt || m.fetchedAt); return { label: 'File caricato da te', sub: [m.fileName, t && 'caricato ' + t].filter(Boolean).join(' · '), tag: 'manuale' }; }
  if (m.from === 'cache') return { label: 'Copia salvata nel browser', sub: `del file automatico${m.loadedAt ? ', scaricato ' + when(m.loadedAt) : ''}`, tag: 'copia locale' };
  return { label: 'File automatico', sub: `scaricato ${when(m.loadedAt)}` };
}

function renderDataPill() {
  const pill = $('#dataPill');
  pill.replaceChildren();
  const age = dataAge(), demo = app.meta && app.meta.source === 'demo', o = origin(app.ds ? app.meta : null);
  pill.className = 'data-pill ' + (!app.ds ? 'none' : demo ? 'stale' : age <= 4 ? 'ok' : 'stale');
  pill.title = app.ds ? `Dati del ${fmt(app.ds.refDate)} — ${o.label}. Tocca per i dettagli.` : 'Nessun dato: tocca per caricarli';
  const tag = app.ds && o.tag ? (app.meta.source === 'manual' ? 'manual' : 'cache') : '';
  if (tag) pill.classList.add('tagged');
  pill.append(...[h('span', { class: 'dot' }),
    !app.ds ? h('span', { text: 'Nessun dato' }) : demo ? h('span', { text: 'Dati di esempio' })
      : h('span', null, h('span', { class: 'hide-sm', text: 'Dati ' }), h('span', { class: 'd-full', text: fmt(app.ds.refDate) }), h('span', { class: 'd-short', text: fmt(app.ds.refDate).slice(0, 5) })),
    tag ? h('span', { class: 'p-tag ' + tag }, icon(tag === 'manual' ? 'upload' : 'data'), h('span', { class: 't-txt', text: o.tag })) : null,
    app.ds ? h('span', { class: 'txt-long faint', text: `· ${app.ds.bonds.length} titoli` }) : null].filter(Boolean));
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
  renderDataPill();
  if (!silent) toast(meta.source === 'manual' ? `File caricato: dati del ${fmt(ds.refDate)}` : `Dati del ${fmt(ds.refDate)} pronti`, 'ok');
  route();
  return true;
}

/** Nessun dato in uso (copia cancellata e file automatico irraggiungibile). */
function dropData() {
  if (app.worker) app.worker.terminate();
  Object.assign(app, { ds: null, meta: null, text: null, result: null, worker: null, workerReady: false });
  renderDataPill();
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
  if (res) res.classList.add('busy');
  try {
    const r = await computeAsync(app.st);
    if (seq !== computeSeq) return;             // arrivato un calcolo più recente
    app.result = r;
    renderBuildResults();
  } catch (e) { toast('Errore di calcolo: ' + e.message, 'err'); }
  finally { if (seq === computeSeq && res) res.classList.remove('busy'); }
}
const scheduleCompute = debounce(runCompute, 160);

function settingsChanged() {
  saveSettings(app.st);
  scheduleCompute();
}

/* ---------------- Navigazione ---------------- */
function currentRoute() {
  const hsh = location.hash || '#/';
  let m;
  if ((m = hsh.match(/^#\/l\/(.+)$/))) return { name: 'ladder', id: decodeURIComponent(m[1]) };
  if ((m = hsh.match(/^#\/s\/(.+)$/))) return { name: 'shared', data: m[1] };
  if (hsh.startsWith('#/scale')) return { name: 'saved' };
  return { name: 'build' };
}

function route() {
  const r = currentRoute();
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', (a.dataset.route === 'saved') === (r.name === 'saved' || r.name === 'ladder')));
  const root = $('#app');
  $('#mobileBar').hidden = true;
  if (r.name === 'shared') {
    try {
      const st = JSON.parse(decodeURIComponent(escape(atob(r.data.replace(/-/g, '+').replace(/_/g, '/')))));
      if (st && st.goal) { app.st = { ...(app.st || {}), ...st }; saveSettings(app.st); toast('Configurazione condivisa caricata', 'ok'); }
    } catch { toast('Link non valido', 'err'); }
    history.replaceState(null, '', '#/');
    return route();
  }
  if (r.name === 'saved' || r.name === 'ladder') {
    const box = h('div', { class: 'results' });
    root.replaceChildren(box);
    if (r.name === 'saved') renderSavedList(box, { ds: app.ds, onOpen: id => { location.hash = '#/l/' + encodeURIComponent(id); } });
    else renderSavedDetail(box, { id: r.id, ds: app.ds, onBack: () => { location.hash = '#/scale'; }, onRebuild: rebuildFrom });
    return;
  }
  if (!app.ds) { root.replaceChildren(noDataView()); return; }
  if (!app.st.goal) { root.replaceChildren(welcomeView()); return; }
  const panel = h('aside', { class: 'panel', id: 'panel', 'aria-label': 'Impostazioni' });
  const results = h('div', { class: 'results', id: 'results', 'aria-live': 'polite' });
  root.replaceChildren(h('div', { class: 'layout' }, panel, results));
  mountSettings({ root: panel, st: app.st, ds: app.ds, changed: (structural) => { settingsChanged(); if (structural && !app.st.goal) route(); } });
  if (app.result && app.result.goal === app.st.goal) renderBuildResults();
  else results.append(h('div', { class: 'card card-pad' }, h('span', { class: 'spinner' }), ' Calcolo della proposta…'));
  $('#mobileBar').hidden = false;
  scheduleCompute();
}

function rebuildFrom(doc) {
  if (doc.v !== 3 || !doc.params) { toast('Scala della versione precedente: parametri non ricostruibili.', 'err'); return; }
  app.st = { ...app.st, ...JSON.parse(JSON.stringify(doc.params)), fixed: {} };
  saveSettings(app.st);
  location.hash = '#/';
  toast('Parametri caricati: proposta ricalcolata con i dati di oggi', 'ok');
}

/* ---------------- Viste senza pannello ---------------- */
function welcomeView() {
  const pick = v => { app.st.goal = v; saveSettings(app.st); route(); };
  const card = (v, ic, title, text) => h('button', { type: 'button', class: 'goal', on: { click: () => pick(v) } }, icon(ic), h('b', { text: title }), h('span', { text }));
  return h('section', { class: 'card welcome' },
    h('h1', { text: 'Che cosa vuoi ottenere?' }),
    h('p', { text: 'Scegli l\'uso della tua scala di titoli di Stato. L\'app seleziona i titoli migliori fra quelli di simpletoolsforinvestors del giorno, con le tasse italiane già calcolate; poi puoi rifinire paniere, rating, scadenze e prezzo.' }),
    h('div', { class: 'goals' },
      card('capital', 'capital', 'Capitale a scadenza', 'Mi servono somme a date precise (università, casa, auto…) oppure la stessa cifra ogni anno.'),
      card('income', 'income', 'Rendita mensile', 'Voglio incassare cedole ogni mese in modo regolare; il capitale torna man mano che i titoli scadono.')),
    h('p', { class: 'help' }, `Dati del ${fmt(app.ds.refDate)} · ${app.ds.bonds.length} titoli · aggiornamento automatico ogni sera`));
}

function noDataView() {
  const file = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, on: { change: e => e.target.files[0] && readFile(e.target.files[0]) } });
  const drop = h('div', { class: 'drop', role: 'button', tabindex: 0, on: {
    click: () => file.click(), keydown: e => { if (e.key === 'Enter') file.click(); },
    dragover: e => { e.preventDefault(); drop.classList.add('drag'); }, dragleave: () => drop.classList.remove('drag'),
    drop: e => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); } } },
    icon('upload'), h('div', null, h('b', { text: 'Carica il file "Dati End of Day"' }), ' — trascinalo qui o tocca per sceglierlo'));
  drop.firstChild.style.cssText = 'width:28px;height:28px;color:var(--accent);margin-bottom:6px';
  return h('section', { class: 'card welcome' },
    h('h1', { text: 'Mancano i dati del giorno' }),
    h('p', { text: 'L\'app si aggiorna da sola ogni sera con i dati di simpletoolsforinvestors.eu. Se è il primo avvio o sei offline, carica tu il file CSV "Dati End of Day" dalla pagina Documenti e download.' }),
    drop, file,
    h('div', { class: 'actions-bar' },
      h('a', { class: 'btn btn-ghost', href: STFI_PAGE, target: '_blank', rel: 'noopener' }, icon('open'), 'Apri simpletoolsforinvestors'),
      h('button', { class: 'btn btn-ghost', on: { click: async () => { try { const d = await loadDemo(); setData(d.text, d.meta); } catch { toast('Dati di esempio non disponibili', 'err'); } } } }, 'Prova con dati di esempio')));
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
  updateMobileBar();
}

function openAlternatives(t) {
  const cur = t.bond;
  const list = t.candidates.slice(0, 40);
  const eff = t.need != null;
  const body = h('div', { class: 'alt-list' }, list.map(c => {
    const b = c.bond, isCur = cur && b.isin === cur.isin;
    const d = cur ? (c.score - t.candidates.find(x => x.bond.isin === cur.isin)?.score) * 100 : NaN;
    return h('button', { type: 'button', class: 'alt' + (isCur ? ' current' : ''), on: { click: () => { closeSheet(); if (!isCur) { app.st.fixed = { ...app.st.fixed, [t.label]: b.isin }; settingsChanged(); toast(`Scelto ${b.desc} per ${t.label}`, 'ok'); } } } },
      h('span', { class: 'a-name' }, h('span', { class: 'iss', text: b.area === 'sov' ? b.issuer.replace('SOV_', '').slice(0, 4) : b.country }), h('span', { text: b.desc })),
      h('span', { class: 'a-yield', text: fmtPct(c.score * 100) }),
      h('span', { class: 'a-meta' },
        h('span', { text: `scade ${fmt(b.maturity)}` }), h('span', { text: `prezzo ${fmtNum(b.price, 2)}` }), h('span', { text: `rating ${b.rating || 'NR'}` }),
        h('span', { text: `liquidità ${'●'.repeat(b.liquidity)}${'○'.repeat(4 - b.liquidity)}` }), h('span', { text: `lotto ${fmtNum(b.lot, 0)}` }),
        isCur ? h('b', { text: 'scelta attuale' }) : Number.isFinite(d) ? h('span', { class: 'a-delta', text: `${d >= 0 ? '+' : '−'}${fmtNum(Math.abs(d), 2)} punti` }) : null));
  }));
  openSheet({ title: `Titoli per ${t.label}`, sub: `${t.candidates.length} titoli del paniere scadono ${t.need != null ? 'nella finestra scelta' : 'in questo periodo'} · ordinati per ${eff ? 'rendimento effettivo alla data (conta anche l\'attesa)' : 'rendimento netto'}`, body,
    foot: t.fixed ? [h('button', { class: 'btn btn-ghost', on: { click: () => { closeSheet(); const f = { ...app.st.fixed }; delete f[t.label]; app.st.fixed = f; settingsChanged(); } } }, 'Torna alla scelta automatica')] : null });
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
  const plan = app.result.plan;
  const def = plan.mode === 'capital' ? `Scala capitale ${fmt(app.ds.refDate)}` : `Rendita ${fmtEur(plan.annual / 12)}/mese ${fmt(app.ds.refDate)}`;
  const input = h('input', { class: 'input text', value: def, 'aria-label': 'Nome della scala' });
  const doSave = async () => {
    try {
      const id = await saveLadder(buildDoc(input.value.trim() || def));
      app.lastSaved = id; closeSheet();
      toast('Scala salvata: la trovi in "Le mie scale"', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSave(); });
  openSheet({ title: 'Salva la scala', sub: 'Salva titoli, nominali e prezzi di oggi: potrai confrontarli con i prezzi dei prossimi giorni.',
    body: h('div', { class: 'field' }, h('label', { text: 'Nome' }), input),
    foot: [h('button', { class: 'btn btn-ghost', on: { click: closeSheet } }, 'Annulla'), h('button', { class: 'btn btn-primary', on: { click: doSave } }, icon('save'), 'Salva')] });
}

async function shareConfig() {
  const json = JSON.stringify(app.st);
  const enc = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = `${location.origin}${location.pathname}#/s/${enc}`;
  if (navigator.share && matchMedia('(max-width: 1080px)').matches) {
    try { await navigator.share({ title: 'Bond Ladder', text: 'La mia configurazione della scala di titoli di Stato', url }); return; } catch { /* annullato */ }
  }
  toast(await copyText(url) ? 'Link copiato: chi lo apre vede la stessa configurazione con i dati del giorno' : url, 'ok');
}

/* ---------------- Barra mobile ---------------- */
function updateMobileBar() {
  const bar = $('#mobileBar');
  if (!bar || !app.result || !app.result.plan) return;
  const p = app.result.plan;
  const main = p.mode === 'capital' ? `${fmtEur(p.totalCost)} da investire` : p.empty ? 'Nessuna proposta' : `${fmtEur(p.annual / 12)} al mese`;
  const sub = p.mode === 'capital' ? `netto ${fmtPct(p.irr * 100)} · ${p.targets.filter(t => t.bond).length}/${p.targets.length} scadenze` : p.empty ? '' : `netto ${fmtPct(p.irr * 100)} · ${p.coveredMonths}/12 mesi`;
  $('#mbMain').textContent = main; $('#mbSub').textContent = sub;
}

/* ---------------- Dialogo dati ---------------- */
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
const insight = (kind, text) => h('div', { class: 'insight ' + kind },
  h('span', { class: 'ico', text: kind === 'good' ? '✓' : kind === 'warn' ? '!' : 'i' }), h('span', { text }));

/** Il file in uso confrontato con il file automatico pubblicato. */
function remoteStatus(remote) {
  const m = app.ds ? app.meta : null;
  if (!remote) return insight('warn', m && m.from === 'cache'
    ? 'Il file automatico adesso non è raggiungibile (sei offline?): stai usando la copia salvata nel browser.'
    : 'Il file automatico adesso non è raggiungibile (sei offline?).');
  const rd = remote.meta.refDate;
  const rdText = `dati del ${dayText(rd)}${remote.meta.fetchedAt ? ', pubblicato ' + when(remote.meta.fetchedAt) : ''}`;
  if (!m) return insight('info', `Il file automatico è disponibile: ${rdText}.`);
  if (m.source === 'demo') return insight('info', `Stai usando dati di esempio. Il file automatico ha i ${rdText}.`);
  if (m.source === 'auto') {
    if (rd === m.refDate) return insight('good', m.from === 'cache'
      ? `La copia nel browser coincide con il file automatico più recente (${rdText}).`
      : `Stai usando il file automatico più recente (${rdText}).`);
    if (rd > m.refDate) return insight('warn', `C'è un file automatico più recente: ${rdText}. Tocca «Usa il file automatico».`);
    return insight('info', `Il file automatico pubblicato ha dati più vecchi di quelli in uso (${dayText(rd)}).`);
  }
  if (rd > m.refDate) return insight('warn', `Il file automatico è più recente del tuo: ${rdText}. Tocca «Usa il file automatico».`);
  if (rd === m.refDate) return insight('info', 'Il file automatico ha la stessa data del tuo file: dal prossimo avvio l\'app userà quello.');
  return insight('info', `Il tuo file è più recente del file automatico (${dayText(rd)}): resta in uso finché non ne esce uno più nuovo.`);
}

function openDataDialog() {
  const file = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, on: { change: async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f && await readFile(f)) paint();
  } } });
  const box = h('div', { class: 'stack data-dlg' });
  let remote = null, checking = true, busy = '', confirmClear = false;

  const check = () => {
    checking = true;
    remoteInfo().then(r => { remote = r; checking = false; paint(); });
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

  const paint = () => {
    const m = app.ds ? app.meta : null, o = origin(m), cached = readCache();
    const kpi = (label, value, sub, cls) => h('div', { class: 'kpi' + (cls ? ' ' + cls : '') }, h('div', { class: 'k-label', text: label }),
      h('div', { class: 'k-value', text: value }), sub ? h('div', { class: 'k-sub', text: sub }) : null);
    const src = (label, value, sub) => h('div', { class: 'src-row' }, h('div', { class: 's-label', text: label }),
      h('div', null, h('div', { class: 's-value', text: value }), sub ? h('div', { class: 's-sub', text: sub }) : null));
    const act = (key, ic, title, sub, cls = '') => h('button', { type: 'button', class: 'dact ' + cls, disabled: !!busy, 'aria-busy': busy === key ? 'true' : null, on: { click: actions[key] } },
      busy === key ? h('span', { class: 'spinner' }) : icon(ic), h('b', { text: title }), h('span', { text: sub }));
    const savedAt = cached && (cached.meta.loadedAt || (cached.meta.source === 'manual' ? cached.meta.fetchedAt : null));
    const recRemote = !!remote && (!m || m.source === 'demo' || remote.meta.refDate > m.refDate || (m.source === 'auto' && m.from === 'cache'));

    box.replaceChildren(
      h('div', { class: 'lbl', text: 'In uso' }),
      m ? h('div', { class: 'kpis' },
        kpi('Data dei prezzi', fmt(app.ds.refDate), `valuta ${fmt(app.ds.settle)}`),
        kpi('Titoli nel file', fmtNum(app.ds.bonds.length, 0)),
        kpi('Origine', o.label, o.sub, 'kpi-wide'))
        : h('p', { class: 'muted', text: 'Nessun dato caricato.' }),
      checking ? h('div', { class: 'insight info' }, h('span', { class: 'spinner' }), h('span', { text: 'Controllo il file automatico pubblicato…' })) : remoteStatus(remote),
      h('div', { class: 'lbl', text: 'Le due fonti' }),
      h('div', { class: 'src-list' },
        src('File automatico', checking ? 'controllo in corso…' : remote ? `dati del ${dayText(remote.meta.refDate)}` : 'non raggiungibile',
          checking ? '' : remote ? `pubblicato ${when(remote.meta.fetchedAt) || '—'} · aggiornato ogni sera dei giorni feriali` : 'riprova quando sei online'),
        src('Copia nel browser', cached ? `dati del ${dayText(cached.meta.refDate)}` : 'nessuna',
          cached ? [cached.meta.source === 'manual' ? `file caricato da te${cached.meta.fileName ? ' (' + cached.meta.fileName + ')' : ''}` : 'file automatico', savedAt ? 'salvata ' + when(savedAt) : ''].filter(Boolean).join(' · ')
            : 'si crea da sola a ogni caricamento: serve per usare l\'app offline')),
      h('div', { class: 'lbl', text: 'Azioni' }),
      h('div', { class: 'dacts' },
        act('remote', 'refresh', 'Usa il file automatico', busy === 'remote' ? 'Scarico il file…' : 'Lo scarica di nuovo adesso e lo mette in uso', recRemote ? 'rec' : ''),
        act('upload', 'upload', 'Carica un file CSV', 'Il file «Dati End of Day» scaricato da simpletoolsforinvestors', !m && !checking && !remote ? 'rec' : ''),
        m && m.source !== 'demo' ? act('download', 'download', 'Scarica il CSV in uso', 'Salva sul dispositivo il file che l\'app sta usando') : null,
        cached || busy === 'clear' ? act('clear', 'trash', confirmClear ? 'Conferma: cancella il tuo file' : 'Cancella la copia nel browser',
          busy === 'clear' ? 'Cancello e scarico il file automatico…' : confirmClear ? 'Il file caricato da te andrà perso: tocca di nuovo per confermare' : 'Elimina i dati salvati qui e riparte dal file automatico',
          'danger' + (confirmClear ? ' confirm' : '')) : null),
      h('p', { class: 'help', text: 'All\'avvio l\'app scarica il file automatico, che un\'automazione su GitHub prende ogni sera dalla pagina Documenti e download di simpletoolsforinvestors. Un file caricato da te resta in uso solo finché è più recente del file automatico. La copia nel browser serve quando sei offline.' }),
      file);
  };

  paint();
  check();
  openSheet({
    title: 'Dati del giorno', sub: 'Fonte: simpletoolsforinvestors.eu — "Rendimenti e durate calcolati End of Day"',
    body: box,
    foot: [h('a', { class: 'btn btn-ghost', href: STFI_PAGE, target: '_blank', rel: 'noopener' }, icon('open'), 'Sito STFI')]
  });
}

/* ---------------- Avvio ---------------- */
async function boot() {
  let theme = 'dark';
  try { theme = localStorage.getItem('antigravity-theme') || 'dark'; } catch { /* */ }
  setTheme(theme);
  $('#themeToggle').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));
  $('#brandLogo').replaceWith(logo());
  $('#dataPill').addEventListener('click', openDataDialog);
  $('#helpBtn').addEventListener('click', openHelp);
  $('#helpLink').addEventListener('click', e => { e.preventDefault(); openHelp(); });
  $('#mbBtn').addEventListener('click', () => {
    const res = $('#results'), panel = $('#panel');
    if (!res || !panel) return;
    const inResults = res.getBoundingClientRect().top < window.innerHeight * 0.4;
    (inResults ? panel : res).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  window.addEventListener('scroll', debounce(() => {
    const res = $('#results');
    if (res) $('#mbBtn').textContent = res.getBoundingClientRect().top < window.innerHeight * 0.4 ? 'Impostazioni ↑' : 'Vedi proposta ↓';
  }, 80), { passive: true });
  window.addEventListener('hashchange', route);
  $('#version').textContent = `v${VERSION}`;
  renderDataPill();
  $('#app').replaceChildren(h('div', { class: 'card card-pad' }, h('span', { class: 'spinner' }), ' Carico i dati del giorno…'));
  try {
    const d = await loadLatest();
    if (d) {
      await setData(d.text, d.meta, { silent: true });
      if (d.meta.from === 'cache' && !d.remote) toast(`File automatico non raggiungibile: in uso la copia salvata nel browser (dati del ${fmt(app.ds.refDate)})`);
      else if (d.meta.from === 'cache' && d.meta.source === 'manual') toast(`In uso il tuo file (dati del ${fmt(app.ds.refDate)}): è più recente del file automatico`);
      return;
    }
  } catch { /* nessun dato */ }
  app.st = loadSettings(null);
  route();
}

boot();
export { parseDay };
