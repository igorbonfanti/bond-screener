// Service worker minimale — cache app shell (offline capability)
// v13: progetto Firebase separato (igorbonfanti-screener) e accesso opzionale.
// Alzare SEMPRE la versione quando cambia un file in ASSETS: la cache viene
// servita per prima, quindi senza un nome nuovo i client gia' installati
// resterebbero puntati al vecchio progetto.
const CACHE = 'bond-screener-v13';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/firebase_config.js',
  './auth-opzionale.js',
  './js/data.js',
  './js/filters.js',
  './js/ladder.js',
  './js/charts.js',
  './js/store.js',
  './js/export.js',
  './js/app.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  // Non intercettare Firebase / CDN: vanno sempre in rete
  if (url.includes('gstatic.com') || url.includes('googleapis.com') ||
      url.includes('firebaseio') || url.includes('cdn.sheetjs') ||
      url.includes('cdnjs') || url.includes('jsdelivr')) return;
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});
