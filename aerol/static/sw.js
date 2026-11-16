// Offline shell: the watch simulator, alert engine and charts run entirely from these cached files.
const VERSION = 'aerol-v3';
const SHELL = ['/', '/earth/', '/mobile/', '/styles.css', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/data/research.json',
  '/ui/main.js', '/ui/dom.js', '/ui/transport.js', '/ui/watch.js', '/ui/watch-screens.js', '/ui/charts.js', '/ui/earth.js', '/ui/earth-timeline.js', '/ui/earth-observed.js', '/ui/earth-crew.js', '/ui/selfcare-view.js', '/core/selfcare.js',
  '/core/util.js', '/core/schedule.js', '/core/radiation.js', '/core/models.js', '/core/vitals.js', '/core/rules.js', '/core/schema.js', '/core/events.js', '/core/store.js', '/core/research.js', '/core/export.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/downloads/')) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request).then(hit => hit || (e.request.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
