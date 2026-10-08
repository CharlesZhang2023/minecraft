// Offline support: the game keeps working with no internet (e.g. playing over a phone hotspot, paired by QR code).
// Pages load network-first (so updates arrive), game files cache-first; the signaling service is never cached.
const CACHE = 'mcw-v2';
/** Sounds and music the game keeps itself (src/net/cdn.ts): not this worker's to clear. */
const KEEP = [CACHE, 'mcw-media'];
const CORE = ['./', './index.html', './manifest.webmanifest', './favicon.png', './apple-touch-icon.png', './icon-192.png', './icon-512.png', './multiplayer.json'];

/** Cache everything this build consists of (listed at build time), including parts that load on demand. */
async function precache() {
  const cache = await caches.open(CACHE);
  let files = [];
  try {
    const r = await fetch('./precache.json', { cache: 'no-cache' });
    if (r.ok) files = (await r.json()).map((f) => './' + f);
  } catch { /* offline: keep what we have */ }
  for (const url of [...CORE, ...files]) {
    if (await cache.match(url)) continue;
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (r.ok) await cache.put(url, r);
    } catch { /* try again next time */ }
  }
}

self.addEventListener('install', (e) => { e.waitUntil(precache().then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// the page asks after each online load, so a new build's files get cached too
self.addEventListener('message', (e) => { if (e.data === 'precache') e.waitUntil(precache()); });

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/signal/')) return;
  const fresh = req.mode === 'navigate' || url.pathname.endsWith('.json');
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (fresh) {
      try {
        const r = await fetch(req);
        if (r.ok) cache.put(req.mode === 'navigate' ? './index.html' : req, r.clone());
        return r;
      } catch {
        return (await cache.match(req.mode === 'navigate' ? './index.html' : req, { ignoreVary: true })) ?? (await cache.match('./', { ignoreVary: true })) ?? Response.error();
      }
    }
    const hit = await cache.match(req, { ignoreVary: true, ignoreSearch: true });
    if (hit) return hit;
    const r = await fetch(req);
    if (r.ok && (url.pathname.includes('/assets/') || url.pathname.includes('/font/'))) cache.put(req, r.clone());
    return r;
  })());
});
