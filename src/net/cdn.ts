// Big downloads (the recorded sounds and music, the pack repository's files) come from a CDN when it answers
// quickly, else from the game's own server. The CDN (a Cloudflare Worker serving only static files, deployed with
// `npm run deploy:cdn`) is fast nearly everywhere but can't be reached from mainland China, where the server
// serves them. Only files named after their content's hash come from the CDN (indexes always come from the
// server), and one the CDN doesn't have or can't send is fetched from the server instead.
const CDN = import.meta.env?.PROD ? 'https://mc-cdn.charles2023.workers.dev/' : '';
const ORIGIN = typeof location === 'undefined' ? '/' : new URL(import.meta.env?.BASE_URL ?? '/', location.href).href;
/** How long the CDN has to answer before this visit uses the server. */
const PROBE_MS = 2500;
/** Where downloaded sounds and music are kept in this browser (the service worker leaves it alone). */
const MEDIA = 'mcw-media';

let base: Promise<string> | null = null;

/** Where hashed files come from on this visit: the CDN's base URL, or the server's. */
export function assetBase(): Promise<string> {
  return (base ??= probe());
}

async function probe(): Promise<string> {
  if (!CDN || typeof fetch !== 'function') return ORIGIN;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), PROBE_MS);
  try {
    const r = await fetch(CDN + 'cdn.json', { cache: 'no-store', signal: ac.signal });
    return r.ok ? CDN : ORIGIN;
  } catch {
    return ORIGIN;
  } finally {
    clearTimeout(t);
  }
}

/** A hashed file (a path from the game's folder, like 'sounds/music/calm1-c07f56b6d6.ogg'), from the CDN or the server. */
export async function fetchAsset(path: string): Promise<Response> {
  const b = await assetBase();
  if (b !== ORIGIN) {
    try {
      const r = await fetch(b + path);
      if (r.ok) return r;
    } catch { /* the server, then */ }
  }
  return fetch(ORIGIN + path);
}

/** The key a file is kept under in this browser: the server's URL for it, wherever it came from. */
const keyOf = (path: string) => ORIGIN + path;

const media = (): Promise<Cache | null> => (typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(MEDIA).catch(() => null));

/**
 * A hashed file kept in this browser once downloaded (sounds, music), so it's fetched at most once and plays
 * offline. Null when it can't be had (offline and never downloaded, or not on the server).
 */
export async function cachedAsset(path: string): Promise<Blob | null> {
  const key = keyOf(path);
  // any of the game's caches (the service worker's precache had the sound effects before they were kept here)
  try {
    const hit = typeof caches === 'undefined' ? undefined : await caches.match(key);
    if (hit) return await hit.blob();
  } catch { /* download it */ }
  try {
    const r = await fetchAsset(path);
    if (!r.ok) return null;
    const blob = await r.blob();
    const store = await media();
    if (store) store.put(key, new Response(blob, { headers: { 'content-type': blob.type || 'application/octet-stream' } })).catch(() => {});
    return blob;
  } catch {
    return null;
  }
}

/** Forget kept files that aren't these (an earlier build's music). */
export async function pruneAssets(paths: string[]) {
  const store = await media();
  if (!store) return;
  const keep = new Set(paths.map(keyOf));
  for (const req of await store.keys()) if (!keep.has(req.url)) await store.delete(req);
}
