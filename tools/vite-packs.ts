// Builds the pack repository from packs/: every folder with a pack.json becomes one file, named after its id, version
// and hash, and packs/index.json lists them with their SHA-256 (like the mod repository, plain static files).
//
// - Shader packs (kind "shader"): pack.json is the manifest; it and the folder's .wgsl files are bundled into one JSON.
// - Resource packs (kind "resource"): a zip in the folder named by pack.json's "zip", or a pack.mcmeta + assets/ folder
//   that is zipped here. Packs made by other people (their zips) aren't kept in git: a folder whose zip is missing is
//   left out with a warning.
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

interface Built { entry: Record<string, unknown> & { id: string; file: string }; data: Buffer; stamp: string; type: string }

const KEYS = ['id', 'kind', 'version', 'name', 'description', 'authors', 'icon', 'credit'];

function stamp(dir: string): string {
  let s = '';
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else s += p + ':' + fs.statSync(p).mtimeMs + ';';
    }
  };
  walk(dir);
  return s;
}

function files(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? files(path.join(dir, f.name), base) : [path.relative(base, path.join(dir, f.name)).split(path.sep).join('/')]));
}

/** A zip of these files (deflated). */
function zip(entries: [string, Buffer][]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const local: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name), comp = deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    local.push(h, n, comp);
    central.push(c, n);
    off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}

function build(folder: string): Built | null {
  const raw = JSON.parse(fs.readFileSync(path.join(folder, 'pack.json'), 'utf8'));
  if (!/^[a-z0-9_-]{1,40}$/.test(raw.id)) throw new Error(`${folder}: bad pack id '${raw.id}'`);
  const manifest: Record<string, unknown> = {};
  for (const k of KEYS) if (raw[k] !== undefined) manifest[k] = raw[k];
  let data: Buffer, ext: string, type: string;
  if (raw.kind === 'shader') {
    const all: Record<string, string> = {};
    for (const f of files(folder)) if (/\.wgsl$/.test(f)) all[f] = fs.readFileSync(path.join(folder, f), 'utf8');
    for (const f of [raw.gbuffers, raw.final, ...(raw.common ?? []), ...(raw.passes ?? []).map((p: { file: string }) => p.file)]) if (!(f in all)) throw new Error(`${raw.id}: no ${f}`);
    data = Buffer.from(JSON.stringify({ manifest: raw, files: all }));
    ext = 'json';
    type = 'application/json';
  } else if (raw.kind === 'resource') {
    if (raw.zip) {
      const p = path.join(folder, raw.zip);
      if (!fs.existsSync(p)) { console.warn(`[packs] ${raw.id}: ${raw.zip} isn't here, so the pack is left out`); return null; }
      data = fs.readFileSync(p);
    } else {
      if (!fs.existsSync(path.join(folder, 'pack.mcmeta'))) throw new Error(`${raw.id}: no pack.mcmeta or zip`);
      data = zip(files(folder).filter((f) => f !== 'pack.json').map((f) => [f, fs.readFileSync(path.join(folder, f))]));
    }
    ext = 'zip';
    type = 'application/zip';
  } else throw new Error(`${raw.id}: kind must be "shader" or "resource"`);
  // a small icon for the list: the pack's own pack.png (next to pack.json), if small enough to inline
  const png = path.join(folder, raw.iconFile ?? 'pack.png');
  if (!manifest.icon && fs.existsSync(png) && fs.statSync(png).size < 48 * 1024) manifest.icon = 'data:image/png;base64,' + fs.readFileSync(png).toString('base64');
  const sha256 = createHash('sha256').update(data).digest('hex');
  const file = `${raw.id}/${raw.id}-${raw.version}-${sha256.slice(0, 8)}.${ext}`;
  return { entry: { ...manifest, id: raw.id, sha256, size: data.length, file }, data, stamp: stamp(folder), type };
}

export function packsPlugin(root = 'packs'): Plugin {
  const dir = path.resolve(root);
  const folders = () => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'pack.json'))).map((d) => path.join(dir, d.name)) : []);
  const cache = new Map<string, Built | null>();
  const stamps = new Map<string, string>();
  function buildAll(dev: boolean): Built[] {
    const out: Built[] = [];
    for (const f of folders()) {
      const st = stamp(f);
      if (dev && stamps.get(f) === st && cache.has(f)) { const b = cache.get(f); if (b) out.push(b); continue; }
      try {
        const b = build(f);
        cache.set(f, b);
        stamps.set(f, st);
        if (b) out.push(b);
      } catch (e) {
        if (!dev) throw e;
        console.error('[packs]', (e as Error).message);
      }
    }
    return out;
  }
  const index = (list: Built[]) => JSON.stringify({ schemaVersion: 1, packs: list.map((b) => b.entry) }, null, 1);
  return {
    name: 'pack-repository',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith('/packs/')) return next();
        try {
          const list = buildAll(true);
          if (url === '/packs/index.json') {
            res.setHeader('Content-Type', 'application/json');
            res.end(index(list));
            return;
          }
          const hit = list.find((b) => '/packs/' + b.entry.file === url);
          if (!hit) { res.statusCode = 404; res.end('no such pack file'); return; }
          res.setHeader('Content-Type', hit.type);
          res.end(hit.data);
        } catch (e) {
          res.statusCode = 500;
          res.end(String((e as Error).message));
        }
      });
    },
    generateBundle() {
      const list = buildAll(false);
      for (const b of list) this.emitFile({ type: 'asset', fileName: 'packs/' + b.entry.file, source: b.data });
      this.emitFile({ type: 'asset', fileName: 'packs/index.json', source: index(list) });
    },
  };
}
