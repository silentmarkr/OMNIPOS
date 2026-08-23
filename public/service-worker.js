

const CACHE_VERSION = 'omnipos-shell-v52';

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

  if (url.pathname.startsWith('/api/')) {
    return; 
  }

  if (req.method !== 'GET') {
    return;
  }

  

  

  
  
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
        .catch(() => cached); 

      return cached || networkFetch;
    })
  );
});
