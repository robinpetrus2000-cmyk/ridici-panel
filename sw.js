// Offline cache pro Řídicí panel. Při změně souborů zvyš VERZI.
const VERZE = 'rp-v6';
const SHELL = ['./', './index.html', './config.js', './resell.js', './resell.html', './resell.webmanifest', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-180.png'];
const CDN = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERZE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERZE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return; // data vždy živě
  if (CDN.includes(url.hostname)) {
    // knihovny: z cache, jinak stáhnout a uložit
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(VERZE).then(c => c.put(req, copy)); return res;
    })));
    return;
  }
  if (url.origin === location.origin) {
    // vlastní soubory: nejdřív síť (ať máš vždy novou verzi), offline z cache
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(VERZE).then(c => c.put(req, copy)); return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
  }
});

// ---------- notifikace ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Řídicí panel', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Řídicí panel', {
    body: d.body || '', tag: d.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  const external = /^https?:\/\//.test(url) && !url.startsWith(self.registration.scope);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    if (external) return self.clients.openWindow(url);
    const target = new URL(url, self.registration.scope).href;
    for (const c of list) { if (c.url.startsWith(self.registration.scope)) { c.postMessage({ type: 'open', url: target }); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
