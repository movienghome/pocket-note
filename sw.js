// 포켓 노트 service worker: opens instantly from the device copy, refreshes files in the background.
const VERSION = 'pn-2026-10-28-2';
const EXT = VERSION + '-ext';
const SHELL = ['./', './index.html', './backend.js', './manifest.webmanifest',
  './vendor/marked.min.js', './vendor/purify.min.js', './vendor/jszip.min.js', './vendor/Sortable.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('pn-') && k !== VERSION && k !== EXT).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function staleWhileRevalidate(req, key) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(key || req, { ignoreSearch: true });
  const net = fetch(req).then(res => { if (res && res.ok) cache.put(key || req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || new Response('오프라인', { status: 503 });
}
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try { const res = await fetch(req, { cache: 'no-store' }); if (res.ok) cache.put(req, res.clone()); return res; }
  catch (e) { return (await cache.match(req, { ignoreSearch: true })) || new Response('', { status: 503 }); }
}
async function cacheFirst(req) {
  const cache = await caches.open(EXT);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.endsWith('/config.js')) { e.respondWith(networkFirst(req)); return; }
    if (req.mode === 'navigate') { e.respondWith(staleWhileRevalidate(req, './index.html')); return; }
    e.respondWith(staleWhileRevalidate(req)); return;
  }
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) { e.respondWith(cacheFirst(req)); return; }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { e.respondWith(cacheFirst(req)); return; }
});
