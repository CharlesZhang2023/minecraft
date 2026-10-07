// The pack repository: static files next to the game (packs/index.json, one file per pack version), built from the
// repo's packs/ folder like the mod repository. Downloads are checked against the SHA-256 in the index, then kept in
// this browser.
import { Storage } from '../game/storage';
import { ZipArchive, decodeImage } from './zip';
import { VALID_PACK_ID, type PackManifest, type PackPackage, type PackRepoEntry, type PackRepoIndex, type ShaderBundle, type ShaderManifest } from './types';

let cached: Promise<PackRepoIndex | null> | null = null;

export function fetchPackIndex(force = false): Promise<PackRepoIndex | null> {
  if (!cached || force) {
    cached = fetch('./packs/index.json', { cache: 'no-cache' })
      .then(async (r) => {
        if (!r.ok) return null;
        const j = (await r.json()) as PackRepoIndex;
        return j && Array.isArray(j.packs) ? j : null;
      })
      .catch(() => null);
  }
  return cached;
}

export async function sha256Bytes(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function cleanPackManifest(m: PackManifest): PackManifest {
  const { id, kind, version, name, description, authors, icon, credit } = m;
  if (!VALID_PACK_ID.test(String(id))) throw new Error(`Bad pack id '${id}'`);
  if (kind !== 'resource' && kind !== 'shader') throw new Error(`Unknown pack kind '${kind}'`);
  return JSON.parse(JSON.stringify({ id, kind, version: String(version ?? '1'), name, description, authors, icon, credit }));
}

/** Download a pack from the repository (verified), keeping it in this browser. */
export async function downloadPack(e: PackRepoEntry, onProgress?: (f: number) => void): Promise<PackPackage> {
  const have = await Storage.getPack(e.sha256);
  if (have) return have;
  const r = await fetch('./packs/' + e.file, { cache: 'no-cache' });
  if (!r.ok || !r.body) throw new Error(`Download failed (${r.status})`);
  // read it in pieces, for a progress bar on big resource packs
  const reader = r.body.getReader(), parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress?.(e.size ? got / e.size : 0);
  }
  const data = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { data.set(p, o); o += p.length; }
  const sha = await sha256Bytes(data.buffer);
  if (sha !== e.sha256) throw new Error('Download is corrupt (checksum mismatch)');
  const manifest = cleanPackManifest(e);
  if (manifest.kind === 'shader') checkShaderBundle(parseBundle(data.buffer));
  const pkg: PackPackage = { manifest, data: data.buffer, sha256: sha, source: 'repo', added: Date.now() };
  await Storage.putPack(pkg);
  return pkg;
}

/** A shader pack's bundle from its stored bytes. */
export function parseBundle(data: ArrayBuffer): ShaderBundle {
  return JSON.parse(new TextDecoder().decode(data)) as ShaderBundle;
}

export function checkShaderBundle(b: ShaderBundle): ShaderBundle {
  const m = b?.manifest as ShaderManifest;
  if (!m || m.kind !== 'shader' || !b.files) throw new Error('Not a shader pack');
  for (const f of [m.gbuffers, m.final, ...(m.common ?? []), ...(m.passes ?? []).map((p) => p.file)]) if (typeof b.files[f] !== 'string') throw new Error(`The shader pack has no ${f}`);
  return b;
}

/**
 * A pack chosen by the player: a resource pack (.zip with pack.mcmeta, Java Edition layout), or a shader pack
 * (.zip with pack.json and its .wgsl files at the top or in one folder, or a built bundle .json).
 */
export async function importPackFile(file: File): Promise<PackPackage> {
  const buf = await file.arrayBuffer();
  const base = file.name.replace(/\.(zip|json)$/i, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'pack';
  let manifest: PackManifest;
  let data = buf;
  if (/\.json$/i.test(file.name)) {
    const b = checkShaderBundle(parseBundle(buf));
    manifest = cleanPackManifest(b.manifest);
  } else {
    const zip = new ZipArchive(buf);
    const names = zip.names();
    const packJson = names.find((n) => /^([^/]+\/)?pack\.json$/.test(n));
    if (packJson) {
      // a shader pack: bundle its files
      const dir = packJson.slice(0, -'pack.json'.length);
      const m = JSON.parse((await zip.text(packJson))!) as ShaderManifest;
      const files: Record<string, string> = {};
      for (const n of names) if (n.startsWith(dir) && /\.(wgsl|json)$/.test(n)) files[n.slice(dir.length)] = (await zip.text(n))!;
      const bundle = checkShaderBundle({ manifest: { ...m, kind: 'shader', id: m.id ?? base }, files });
      manifest = cleanPackManifest(bundle.manifest);
      data = new TextEncoder().encode(JSON.stringify(bundle)).buffer as ArrayBuffer;
    } else {
      const meta = names.find((n) => /^([^/]+\/)?pack\.mcmeta$/.test(n));
      if (!meta) throw new Error('Not a pack: no pack.mcmeta (resource pack) or pack.json (shader pack)');
      const root = meta.slice(0, -'pack.mcmeta'.length);
      let description = '';
      try { const d = JSON.parse((await zip.text(meta))!).pack?.description; description = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => (typeof x === 'string' ? x : x?.text ?? '')).join('') : d?.text ?? ''; } catch { /* no description */ }
      manifest = { id: base, kind: 'resource', version: '1', name: file.name.replace(/\.zip$/i, ''), description, icon: await packIcon(zip, root + 'pack.png') };
    }
  }
  const pkg: PackPackage = { manifest, data, sha256: await sha256Bytes(data), source: 'file', added: Date.now() };
  await Storage.putPack(pkg);
  return pkg;
}

/** A small data: URL of a pack's pack.png. */
export async function packIcon(zip: ZipArchive, name = 'pack.png'): Promise<string | undefined> {
  try {
    const b = await zip.read(name);
    if (!b) return undefined;
    const img = await decodeImage(b);
    const c = new OffscreenCanvas(32, 32), x = c.getContext('2d')!;
    const src = new OffscreenCanvas(img.w, img.h);
    src.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.w, img.h), 0, 0);
    x.imageSmoothingEnabled = img.w > 64;
    x.drawImage(src, 0, 0, 32, 32);
    const blob = await c.convertToBlob({ type: 'image/png' });
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(blob); });
  } catch {
    return undefined;
  }
}
