// The mod repository: static files next to the game (mods/index.json plus one ES module per mod version), built
// from the repo's mods/ folder. Nothing on the server runs for it: it's plain file hosting, and every download is
// checked against the SHA-256 the index lists before it's stored or run.
import type { ModManifest, ModPackage } from './types';
import { Storage } from '../game/storage';

export interface RepoEntry extends ModManifest {
  sha256: string;
  size: number;
  /** Path of the module, relative to mods/. */
  file: string;
}
export interface RepoIndex { schemaVersion: 1; mods: RepoEntry[] }

let cached: Promise<RepoIndex | null> | null = null;

/** The repository's index (null offline / when the site has none). */
export function fetchIndex(force = false): Promise<RepoIndex | null> {
  if (!cached || force) {
    cached = fetch('./mods/index.json', { cache: 'no-cache' })
      .then(async (r) => {
        if (!r.ok) return null;
        const j = (await r.json()) as RepoIndex;
        return j && Array.isArray(j.mods) ? j : null;
      })
      .catch(() => null);
  }
  return cached;
}

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Only what a manifest may hold (an index entry carries file / size / sha too). */
export function cleanManifest(m: ModManifest): ModManifest {
  const { schemaVersion, id, version, name, description, authors, environment, entrypoints, depends, breaks, icon } = m;
  return JSON.parse(JSON.stringify({ schemaVersion, id, version, name, description, authors, environment, entrypoints, depends, breaks, icon }));
}

export const VALID_ID = /^[a-z0-9_-]{1,40}$/;
export function checkManifest(m: unknown): ModManifest {
  const o = m as ModManifest;
  if (!o || typeof o !== 'object') throw new Error('No manifest');
  if (!VALID_ID.test(String(o.id)) || o.id === 'minecraft') throw new Error(`Bad mod id '${o.id}'`);
  if (typeof o.version !== 'string' || !o.version) throw new Error('Missing version');
  return cleanManifest({ ...o, schemaVersion: 1 });
}

/** Download a mod from the repository (verified), keeping it in this browser. */
export async function download(e: RepoEntry): Promise<ModPackage> {
  const have = await Storage.getMod(e.sha256);
  if (have) return have;
  const r = await fetch('./mods/' + e.file, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const code = await r.text();
  const sha = await sha256(code);
  if (sha !== e.sha256) throw new Error('Download is corrupt (checksum mismatch)');
  const pkg: ModPackage = { manifest: checkManifest(e), code, sha256: sha, source: 'repo', added: Date.now() };
  await Storage.putMod(pkg);
  return pkg;
}

/** A mod module's own manifest (its `manifest` export), read by importing it. */
export async function readManifest(code: string): Promise<ModManifest> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    const m = (await import(/* @vite-ignore */ url)) as { manifest?: unknown };
    return checkManifest(m.manifest);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A mod file chosen by the player (a built mod module: ES module with a `manifest` export). */
export async function importFile(code: string, source: ModPackage['source'] = 'file'): Promise<ModPackage> {
  const manifest = await readManifest(code);
  const pkg: ModPackage = { manifest, code, sha256: await sha256(code), source, added: Date.now() };
  await Storage.putMod(pkg);
  return pkg;
}
