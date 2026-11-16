// sw.js — service worker: offline app shell and caching. Firebase data traffic is never cached.
const VERSION = '2.1.0';
const SHELL_CACHE = `dailytracker-shell-${VERSION}`;
const RUNTIME_CACHE = 'dailytracker-runtime-v1';
// Keep this list in sync with the files in the repository.
const SHELL = [
  "./",
  "./index.html",
  "./login.html",
  "./manifest.json",
  "./css/app.css",
  "./js/app-nav.js",
  "./js/app.js",
  "./js/auth.js",
  "./js/boot.js",
  "./js/components.js",
  "./js/data.js",
  "./js/firebase-config.js",
  "./js/firebase.js",
  "./js/icons.js",
  "./js/login.js",
  "./js/pwa.js",
  "./js/ui.js",
  "./js/utils.js",
  "./js/workdays.js",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/favicon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-512.png",
  "./js/views/all.js",
  "./js/views/dashboard.js",
  "./js/views/people.js",
  "./js/views/today.js"
];
const SDK = ["https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js", "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js", "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js", "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js"];
const NETWORK_ONLY = [/firebaseio\.com$/, /firebasedatabase\.app$/, /googleapis\.com$/, /^www\.google\.com$/];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map((u) => shell.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    const rt = await caches.open(RUNTIME_CACHE);
    await Promise.race([Promise.all(SDK.map((u) => rt.add(new Request(u, { mode: 'cors' })).catch(() => {}))), new Promise((r) => setTimeout(r, 8000))]);
  })());
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Remove every other cache, including those of the previous (Flightdeck) app.
    for (const k of await caches.keys()) if (k !== SHELL_CACHE && k !== RUNTIME_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  if (NETWORK_ONLY.some((re) => re.test(url.hostname))) return;
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
        if (res.ok && url.origin === self.location.origin) (await caches.open(SHELL_CACHE)).put(url.origin + url.pathname, res.clone());
        return res;
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match(url.origin + url.pathname)) || (await cache.match(url.pathname.endsWith('login.html') ? './login.html' : './index.html')) || Response.error();
      }
    })());
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
      return cached || (await net) || Response.error();
    })());
    return;
  }
  if (['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })());
  }
});
