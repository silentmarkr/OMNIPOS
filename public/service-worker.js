// Old Android WebViews (Chrome 70-75) lack some APIs this worker uses (e.g. Promise.allSettled). Guarded, no-op on modern browsers.
(function () {
  try {
    var G = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this);
    function def(o, k, v) {
      if (o && !(k in o)) { try { Object.defineProperty(o, k, { value: v, writable: true, configurable: true }); } catch (e) {} }
    }
    if (typeof globalThis === 'undefined') def(G, 'globalThis', G);
    def(Object, 'fromEntries', function (it) {
      var o = {}, a = Array.from(it);
      for (var i = 0; i < a.length; i++) o[a[i][0]] = a[i][1];
      return o;
    });
    def(Object, 'hasOwn', function (o, k) { return Object.prototype.hasOwnProperty.call(Object(o), k); });
    if (typeof Promise !== 'undefined') {
      def(Promise, 'allSettled', function (ps) {
        return Promise.all(Array.from(ps, function (p) {
          return Promise.resolve(p).then(
            function (v) { return { status: 'fulfilled', value: v }; },
            function (r) { return { status: 'rejected', reason: r }; });
        }));
      });
    }
    function at(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return (n < 0 || n >= this.length) ? undefined : this[n]; }
    def(Array.prototype, 'at', at);
    def(String.prototype, 'at', function (n) { var r = at.call(this, n); return r === undefined ? undefined : String(r); });
    def(String.prototype, 'replaceAll', function (s, r) {
      var str = String(this);
      if (s instanceof RegExp) {
        if (!s.global) throw new TypeError('replaceAll must be called with a global RegExp');
        return str.replace(s, r);
      }
      return str.replace(new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), r);
    });
    if (typeof Blob !== 'undefined') {
      def(Blob.prototype, 'arrayBuffer', function () {
        var b = this;
        return new Promise(function (res, rej) {
          var f = new FileReader();
          f.onload = function () { res(f.result); };
          f.onerror = function () { rej(f.error); };
          f.readAsArrayBuffer(b);
        });
      });
      def(Blob.prototype, 'text', function () {
        var b = this;
        return new Promise(function (res, rej) {
          var f = new FileReader();
          f.onload = function () { res(f.result); };
          f.onerror = function () { rej(f.error); };
          f.readAsText(b);
        });
      });
    }
    if (typeof AbortSignal !== 'undefined' && typeof AbortController !== 'undefined') {
      def(AbortSignal, 'timeout', function (ms) {
        var c = new AbortController();
        setTimeout(function () { c.abort(); }, ms);
        return c.signal;
      });
    }
  } catch (e) {}
})();

const CACHE_VERSION = 'omnipos-shell-v136';

// A weak store Wi-Fi must never freeze the POS: if the network does not answer within this time and a cached copy
// exists, the cached copy is used right away and the cache is refreshed in the background when the network replies.
const NETWORK_TIMEOUT_MS = 3500;

// Everything required to boot the POS shell and operate the cached UI without a network.
const SHELL_FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/app1.js',
  '/marketplace-ui.js',
  '/daily-digest-ui.js',
  '/offline-storage.js',
  '/bt-printer.js',
  '/bir-wording.js',
  '/lang.js',
  '/lang/tl.json',
  '/printer-manager.js',
  '/usb-printer.js',
  '/faq-knowledge.js',
  '/faq-knowledge.en.js',
  '/faq-lang.js',
  '/faq-engine.js',
  '/qrcode.min.js',
  '/JsBarcode.all.min.js',
  '/sweetalert2.all.min.js',
  '/html5-qrcode.min.js',
  '/manifest.json',
  '/css/all.min.css',
  '/fontawesome.min.css',
  '/css/themes/vivid-base.css',
  '/css/themes/theme-dark.css',
  '/css/themes/theme-ocean-pro.css',
  '/css/themes/theme-emerald-pro.css',
  '/css/themes/theme-sunset-pro.css',
  '/css/themes/theme-rosegold-pro.css',
  '/css/themes/theme-cyber-pro.css',
  '/css/themes/theme-noir-pro.css',
  '/css/themes/theme-mintfrost-pro.css',
  '/css/themes/theme-liquidglass-pro.css',
  '/css/themes/theme-galaxyambient-pro.css',
  '/css/themes/custom-theme.css',
  '/webfonts/fa-solid-900.woff2',
  '/webfonts/fa-regular-400.woff2',
  '/webfonts/fa-brands-400.woff2',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.allSettled(SHELL_FILES.map(async path => {
      try { await cache.add(path); }
      catch (err) { console.warn('[SW] Could not pre-cache', path, err); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Network-first with a timeout. `cacheKey` is what the successful response is stored under (null = do not store).
// `cachedLookup` returns the fallback copy. Resolves to a Response (or Response.error() when nothing is available).
async function networkFirstWithTimeout(event, req, cacheKey, cachedLookup) {
  const networkPromise = fetch(req).then(async network => {
    if (network && network.ok && cacheKey) {
      try { await (await caches.open(CACHE_VERSION)).put(cacheKey, network.clone()); } catch (e) {}
    }
    return network;
  });
  networkPromise.catch(() => {}); // never an unhandled rejection when the timeout wins
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  let first = null;
  try { first = await Promise.race([networkPromise, timeout]); } catch (e) { first = null; }
  if (first) return first;
  const cached = await cachedLookup();
  if (cached) {
    // Keep the worker alive so the slow network response still refreshes the cache.
    event.waitUntil(networkPromise.catch(() => {}));
    return cached;
  }
  try { return await networkPromise; } catch (e) { return Response.error(); }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || req.method !== 'GET') return;

  // API responses must never be served stale by the service worker.
  if (url.pathname.startsWith('/api/')) return;
  // Downloaded language packs are served fresh by the server; lang.js keeps its own offline copy.
  if (url.pathname.startsWith('/lang-dl/')) return;

  if (req.mode === 'navigate') {
    const isRoot = url.pathname === '/' || url.pathname === '/index.html';
    // Only '/index.html' is refreshed by root navigation. Other pages (e.g. customer-display.html) must not overwrite it,
    // otherwise the POS would not open offline.
    event.respondWith(networkFirstWithTimeout(
      event, req, isRoot ? '/index.html' : null,
      async () => {
        if (!isRoot) {
          const exact = await caches.match(req, { ignoreSearch: true });
          if (exact) return exact;
        }
        return (await caches.match('/index.html', { ignoreSearch: true })) || (await caches.match('/', { ignoreSearch: true })) || null;
      }
    ));
    return;
  }

  // App shell: network-first (with timeout) so releases update promptly, cache fallback keeps offline use working.
  if (SHELL_FILES.includes(url.pathname)) {
    event.respondWith(networkFirstWithTimeout(
      event, req, req,
      () => caches.match(req, { ignoreSearch: true })
    ));
    return;
  }

  // Other same-origin static assets: cache-first with a background network refresh.
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) {
      event.waitUntil((async () => {
        try {
          const network = await fetch(req);
          if (network.ok) (await caches.open(CACHE_VERSION)).put(req, network.clone());
        } catch (e) {}
      })());
      return cached;
    }
    try {
      const network = await fetch(req);
      if (network.ok && network.type === 'basic') (await caches.open(CACHE_VERSION)).put(req, network.clone());
      return network;
    } catch (err) {
      return Response.error();
    }
  })());
});
