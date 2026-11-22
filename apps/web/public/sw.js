// Khitta service worker: app shell only. Company data (/api) is never cached.
const SHELL = 'khitta-shell-v1';
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Khitta</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#121813;color:#F4F1E8;font-family:system-ui,sans-serif;text-align:center"><div><h1 style="font-size:22px">You are offline</h1><p style="opacity:.7">Khitta needs a connection to load your figures. It will reload when you are back online.</p><p dir="rtl" style="opacity:.7">أنت غير متصل. يحتاج خطة إلى اتصال لتحميل أرقامك.</p></div><script>addEventListener("online",()=>location.reload())</script>';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/khitta-mark.svg', '/khitta-192.png', '/manifest.webmanifest'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api')) return;
  if (r.mode === 'navigate') {
    // pages: network first, the cached shell when offline, a plain note if even that is missing
    e.respondWith(fetch(r).then((res) => { const c = res.clone(); caches.open(SHELL).then((s) => s.put('/', c)); return res; })
      .catch(() => caches.match('/').then((m) => m || new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } }))));
    return;
  }
  if (u.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest|woff2?)$/.test(u.pathname)) {
    // built files have hashed names: cache first
    e.respondWith(caches.match(r).then((m) => m || fetch(r).then((res) => { if (res.ok) { const c = res.clone(); caches.open(SHELL).then((s) => s.put(r, c)); } return res; })));
  }
});
