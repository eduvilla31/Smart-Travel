/* Smart Travel service worker: caches the app shell and map tiles you've seen,
 * so a started tour survives a short signal loss. API calls always go to the network. */
const VERSION = 'v7';
const SHELL = `shell-${VERSION}`;
const TILES = `tiles-${VERSION}`;
const MAX_TILES = 400;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png'])));
  self.skipWaiting();
});

// Save the app's own built files (their names change with every update) as soon as
// the helper starts, so the app opens offline even after a single visit.
async function cacheAppFiles() {
  try {
    const html = await (await fetch('./', { cache: 'no-store' })).text();
    const files = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
    const cache = await caches.open(SHELL);
    await cache.put('./', new Response(html, { headers: { 'Content-Type': 'text/html' } }));
    await cache.addAll(files);
    // Lazy-loaded parts are named inside the main script: cache those too (not the voice engine).
    for (const f of files.filter((x) => x.endsWith('.js'))) {
      const js = await (await cache.match(f)).text();
      const more = [...js.matchAll(/["'`](?:\.\/|assets\/)?([\w.-]+\.(?:js|css))["'`]/g)].map((m) => `./assets/${m[1]}`);
      await Promise.all([...new Set(more)].map((u) => cache.add(u).catch(() => undefined)));
    }
  } catch {
    /* offline right now: files get cached as they are used */
  }
}

self.addEventListener('activate', (e) => {
  e.waitUntil(cacheAppFiles());
  e.waitUntil(
    // Only remove our own older shell/tile caches. The voice model ("transformers-cache")
    // and saved voice audio ("smart-travel-voice") must survive app updates.
    caches.keys().then((keys) => Promise.all(keys.filter((k) => /^(shell|tiles)-/.test(k) && ![SHELL, TILES].includes(k)).map((k) => caches.delete(k)))),
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
      caches.match(req, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            // Only CORS-readable tiles: opaque ones would eat the storage quota.
            if (res.ok) {
              const copy = res.clone();
              caches.open(TILES).then((c) => c.put(req, copy)).then(trimTiles);
            }
            return res;
          }),
      ),
    );
    return;
  }

  // The voice model and speech engine are large and cached by the voice library itself.
  if (url.origin === self.location.origin && /\/(models|ort)\//.test(url.pathname)) return;

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
        .catch(() => caches.match(req, { ignoreVary: true }).then((hit) => hit || caches.match('index.html', { ignoreVary: true }))),
    );
  }
});
