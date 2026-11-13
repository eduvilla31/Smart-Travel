/* Smart Travel service worker: caches the app shell and map tiles you've seen,
 * so a started tour survives a short signal loss. API calls always go to the network. */
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const TILES = `tiles-${VERSION}`;
const MAX_TILES = 400;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, TILES].includes(k)).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: cache-first.
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok || res.type === 'opaque') {
              const copy = res.clone();
              caches.open(TILES).then((c) => c.put(req, copy)).then(trimTiles);
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Our own files: network-first, fall back to cache when offline.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
    );
  }
});
