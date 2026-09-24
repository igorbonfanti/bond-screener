// Service worker di Bond Ladder v3.
// Strategia "prima la rete": online si ha sempre l'ultima versione (niente più cache da
// alzare a mano come nella v2), offline si usa la copia salvata. I dati del giorno
// restano anche nel browser (localStorage) grazie all'app.
const CACHE = 'bond-ladder-v3';
const SHELL = [
  './', './index.html', './manifest.json', './styles/app.css', './assets/icon.svg', './assets/icon-192.png',
  './auth-opzionale.js', './vendor/lp-solver.mjs',
  './src/main.js', './src/worker.js', './src/engine.js', './src/state.js', './src/cloud.js',
  './src/data/stfi.js', './src/data/source.js',
  './src/core/dates.js', './src/core/bond.js', './src/core/basket.js', './src/core/select.js', './src/core/flow.js',
  './src/core/capital.js', './src/core/income.js', './src/core/lp.js',
  './src/ui/dom.js', './src/ui/charts.js', './src/ui/settings.js', './src/ui/results.js', './src/ui/sheet.js', './src/ui/saved.js', './src/ui/help.js'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function networkFirst(req, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const fromCache = () => caches.match(req, { ignoreSearch: true });
    const timer = setTimeout(async () => { const c = await fromCache(); if (c && !done) { done = true; resolve(c); } }, timeoutMs);
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      clearTimeout(timer);
      if (!done) { done = true; resolve(res); }
    }).catch(async () => {
      clearTimeout(timer);
      if (done) return;
      done = true;
      resolve((await fromCache()) || (req.mode === 'navigate' ? await caches.match('./index.html') : Response.error()));
    });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) {           // font: dalla cache, aggiornati in background
    e.respondWith(caches.match(req).then(c => {
      const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) caches.open(CACHE).then(k => k.put(req, res.clone())); return res; }).catch(() => c);
      return c || net;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;   // Firebase, GitHub raw…: sempre rete
  e.respondWith(networkFirst(req));
});
