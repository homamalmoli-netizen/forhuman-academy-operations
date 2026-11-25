// Service Worker: speichert nur die App-Oberfläche. API-Anfragen werden NIE zwischengespeichert,
// damit keine falschen "gespeichert"-Meldungen entstehen.
const CACHE = 'fh-shell-v1';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/i18n.js', '/icons.js', '/logo.svg', '/shared/codes.js', '/manifest.webmanifest'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});
