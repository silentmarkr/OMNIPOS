// OmniPOS Service Worker
// Layunin: pabilisin ang pag-load at paganahin ang basic offline access sa APP SHELL lamang
// (HTML/CSS/JS/fonts/icons). Ang lahat ng /api/ calls ay LAGING dadaan sa network —
// hindi natin gustong mag-serve ng lumang stock/presyo/transactions mula sa cache.

// BUMPED: v38 -> v39 (Device Detail / Relay auto-restore + manual sync
// button sa Reset/Restore panel — index.html at app.js na-update).
// BUMPED: v37 -> v38.
// FIX #1 (CRITICAL): nasira ang file na ito dati — may na-duplicate na content
// (parang na-paste ulit ang buong script sa ibaba ng sarili niya) na nag-resulta
// sa isang UNTERMINATED STRING sa CACHE_VERSION constant. Ibig sabihin, SYNTAX
// ERROR ito sa browser kaya TOTALLY HINDI NAG-REGISTER/NAG-INSTALL ang service
// worker — walang offline support at walang shell caching kahit ano pang
// CACHE_VERSION bump ang gawin habang ganito ang file. Na-clean up na ito, isang
// beses na lang ang buong script.
// FIX #2 (bakit laging kailangan mag-manual bump ng CACHE_VERSION dati): ang
// SHELL_FILES (index.html/style.css/app.js/bt-printer.js/manifest.json/themes)
// ay CACHE-FIRST dati — kaya kahit updated na sa server, ang unang view pagkatapos
// mag-deploy ay LUMANG bersyon pa rin (bago na-refresh sa background). Ngayon,
// NETWORK-FIRST na ang mga ito (subukan munang kumuha mula network, cache lang
// bilang OFFLINE FALLBACK) — kaya laging FRESH ang app shell kapag may connection,
// nang hindi na kailangang tandaan pa na i-bump ang CACHE_VERSION sa bawat release.
// Ang mga bihirang magbago na VENDOR libraries/fonts/icons na lang (VENDOR_ASSETS
// sa ibaba) ang nananatiling cache-first para bilis pa rin ang overall load.
const CACHE_VERSION = 'omnipos-shell-v40';

// Mga file na madalas magbago (core app shell) — NETWORK-FIRST na, cache lang
// bilang offline fallback. Dati kasama ito sa SHELL_ASSETS na cache-first.
const SHELL_FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/bt-printer.js',
  '/manifest.json',
  '/css/themes/theme-dark.css',
  '/css/themes/theme-ocean-pro.css',
  '/css/themes/theme-emerald-pro.css',
  '/css/themes/theme-sunset-pro.css',
  '/css/themes/theme-rosegold-pro.css',
  '/css/themes/theme-cyber-pro.css',
  '/css/themes/theme-noir-pro.css',
  '/css/themes/theme-mintfrost-pro.css'
];

// Mga bihirang magbago na vendor library/font/icon — CACHE-FIRST pa rin
// (mabilis, at hindi naman ito nagbabago kada release).
const VENDOR_ASSETS = [
  '/css/all.min.css',
  '/webfonts/fa-solid-900.woff2',
  '/webfonts/fa-regular-400.woff2',
  '/webfonts/fa-brands-400.woff2',
  '/JsBarcode.all.min.js',
  '/sweetalert2.all.min.js',
  '/html5-qrcode.min.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];

const SHELL_ASSETS = [...SHELL_FILES, ...VENDOR_ASSETS];

// Font Awesome: purong lokal na (VENDOR_ASSETS may '/css/all.min.css' na
// sa itaas), kaya wala nang hiwalay na CDN pre-cache dito — hindi na
// kailangan pang subukang mag-fetch ng cdnjs.cloudflare.com tuwing
// mag-i-install ang service worker offline.

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(SHELL_ASSETS)
        .catch((err) => console.warn('[SW] Pre-cache warning (shell):', err))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Huwag gagalawin/i-cache ang mga API call — dapat laging fresh mula sa server.
  if (url.pathname.startsWith('/api/')) {
    return; // let it hit network normally
  }

  // Non-GET (POST/PUT/DELETE) requests: bypass service worker entirely.
  if (req.method !== 'GET') {
    return;
  }

  // NAVIGATION REQUESTS (kasama ang PWA shortcut launches na may query string
  // gaya ng "/?view=terminal" o "/?view=products" mula sa manifest.json).
  // Dating bug: ang default na "cache.match(req)" sa ibaba ay EXACT MATCH
  // (kasama ang query string), pero ang naka-precache lang ay ang "/" na
  // walang query — kaya kapag OFFLINE, hindi tumutugma ang shortcut URL sa
  // cache at nabibigo ito. Fix: hiwalayin ang navigation requests at gamitin
  // ang cached "/index.html" bilang fallback anuman ang query string —
  // babasahin naman ng client-side JS (app.js) ang "?view=" param pagkatapos
  // mag-load ang page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put('/index.html', resClone));
          }
          return res;
        })
        .catch(() =>
          caches.match('/index.html').then((cached) => cached || caches.match('/'))
        )
    );
    return;
  }

  // SHELL FILES (index.html/style.css/app.js/bt-printer.js/manifest/themes):
  // NETWORK-FIRST. Laging susubukan munang kumuha ng FRESH version mula sa
  // server; ang cache ay OFFLINE FALLBACK na lang kung mabigo ang network.
  // Ito ang nagpapa-guarantee na laging updated ang app shell nang hindi na
  // kailangang manual bump ang CACHE_VERSION kada deploy.
  if (SHELL_FILES.includes(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // VENDOR/static assets (fonts, icons, 3rd-party libs): cache-first,
  // fallback to network, update cache sa background — mabilis dahil bihira
  // lang talaga magbago ang mga ito.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const resClone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached); // offline: gamitin na lang ang cached version

      return cached || networkFetch;
    })
  );
});
