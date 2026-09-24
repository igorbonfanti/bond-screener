/* Bond Ladder v3 — avvio, dati, calcolo nel worker, navigazione, dialoghi. */
import { h, $, logo, icon, toast, debounce, fmtEur, fmtPct, fmtNum, copyText } from './ui/dom.js';
import { loadSettings, saveSettings } from './state.js';
import { loadText } from './data/stfi.js';
import { enrich } from './core/basket.js';
import { loadLatest, loadDemo, writeCache, STFI_PAGE } from './data/source.js';
import { compute } from './engine.js';
import { mountSettings, renderSettings, goalCard } from './ui/settings.js';
import { renderResults } from './ui/results.js';
import { openSheet, closeSheet } from './ui/sheet.js';
import { renderSavedList, renderSavedDetail } from './ui/saved.js';
import { openHelp } from './ui/help.js';
import { saveLadder, cloudReady } from './cloud.js';
import { fmt, iso, today, parseDay } from './core/dates.js';

const VERSION = '3.0.0';
const app = { ds: null, meta: null, st: null, result: null, worker: null, workerReady: false, req: 0, pending: new Map(), lastSaved: null };

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
function renderDataPill() {
  const pill = $('#dataPill');
  pill.replaceChildren();
  const age = dataAge();
  pill.className = 'data-pill ' + (!app.ds ? 'none' : app.meta && app.meta.source === 'demo' ? 'stale' : age <= 4 ? 'ok' : 'stale');
  pill.append(h('span', { class: 'dot' }),
    !app.ds ? h('span', { text: 'Nessun dato' }) : app.meta.source === 'demo' ? h('span', { text: 'Dati di esempio' })
      : h('span', null, h('span', { class: 'hide-sm', text: 'Dati ' }), fmt(app.ds.refDate)),
    app.ds ? h('span', { class: 'txt-long faint', text: `· ${app.ds.bonds.length} titoli` }) : null);
}

async function setData(text, meta, { silent = false } = {}) {
  let ds;
  try { ds = enrich(loadText(text)); } catch (e) { toast(e.message, 'err'); return false; }
  app.ds = ds;
  app.meta = { ...meta, refDate: meta.refDate || iso(ds.refDate) };
  if (meta.source !== 'demo') writeCache(text, app.meta);
  if (!app.st) app.st = loadSettings(ds.refDate);
  startWorker(text);
  renderDataPill();
  if (!silent) toast(meta.source === 'manual' ? `File caricato: dati del ${fmt(ds.refDate)}` : `Dati del ${fmt(ds.refDate)} pronti`, 'ok');
  route();
  return true;
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
  try { const text = await f.text(); await setData(text, { source: 'manual', fileName: f.name, fetchedAt: new Date().toISOString() }); closeSheet(); }
  catch (e) { toast('Lettura non riuscita: ' + e.message, 'err'); }
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
function openDataDialog() {
  const file = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, on: { change: e => e.target.files[0] && readFile(e.target.files[0]) } });
  const src = !app.meta ? '—' : app.meta.source === 'auto' ? 'automatici (aggiornati ogni sera)' : app.meta.source === 'manual' ? `caricati da file${app.meta.fileName ? ' (' + app.meta.fileName + ')' : ''}` : app.meta.source === 'demo' ? 'di esempio (inventati)' : 'copia locale';
  openSheet({
    title: 'Dati del giorno', sub: 'Fonte: simpletoolsforinvestors.eu — "Rendimenti e durate calcolati End of Day"',
    body: h('div', { class: 'stack' },
      app.ds ? h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('div', { class: 'k-label', text: 'Data dei prezzi' }), h('div', { class: 'k-value', text: fmt(app.ds.refDate) }), h('div', { class: 'k-sub', text: `valuta ${fmt(app.ds.settle)}` })),
        h('div', { class: 'kpi' }, h('div', { class: 'k-label', text: 'Titoli nel file' }), h('div', { class: 'k-value', text: fmtNum(app.ds.bonds.length, 0) })),
        h('div', { class: 'kpi' }, h('div', { class: 'k-label', text: 'Origine' }), h('div', { class: 'k-value', style: { fontSize: '14px', whiteSpace: 'normal' }, text: src })))
        : h('p', { class: 'muted', text: 'Nessun dato caricato.' }),
      h('p', { class: 'help', text: 'Ogni sera un\'automazione su GitHub scarica il file dalla pagina Documenti e download di simpletoolsforinvestors e lo pubblica qui. Se ti serve un file più recente puoi caricarlo a mano.' }),
      file),
    foot: [
      h('a', { class: 'btn btn-ghost', href: STFI_PAGE, target: '_blank', rel: 'noopener' }, icon('open'), 'Sito STFI'),
      h('button', { class: 'btn btn-ghost', on: { click: async () => { const d = await loadLatest(); if (d) { closeSheet(); setData(d.text, d.meta); } else toast('Nessun dato automatico disponibile', 'err'); } } }, icon('refresh'), 'Aggiorna'),
      h('button', { class: 'btn btn-primary', on: { click: () => file.click() } }, icon('upload'), 'Carica file CSV')]
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
    if (d) { await setData(d.text, d.meta, { silent: true }); return; }
  } catch { /* nessun dato */ }
  app.st = loadSettings(null);
  route();
}

boot();
export { parseDay };
