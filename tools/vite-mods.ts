// Builds the mod repository: every folder in mods/ with a mod.json becomes one ES module (bundled and minified
// with rolldown), named after its id, version and hash, plus mods/index.json listing them with their SHA-256.
// In development the same files are served live, rebuilt when their sources change; in a build they're emitted
// into dist/mods/. The deployed repository is plain static files: nothing new runs on the server.
import type { Plugin } from 'vite';
import { rolldown } from 'rolldown';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface Built { entry: Record<string, unknown> & { id: string; file: string }; code: string; stamp: string }

const MANIFEST_KEYS = ['schemaVersion', 'id', 'version', 'name', 'description', 'authors', 'environment', 'entrypoints', 'depends', 'breaks', 'icon'];

function sourcesStamp(dir: string): string {
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

async function buildMod(folder: string): Promise<Built> {
  const raw = JSON.parse(fs.readFileSync(path.join(folder, 'mod.json'), 'utf8'));
  if (!/^[a-z0-9_-]{1,40}$/.test(raw.id)) throw new Error(`${folder}: bad mod id '${raw.id}'`);
  const manifest: Record<string, unknown> = { schemaVersion: 1 };
  for (const k of MANIFEST_KEYS) if (raw[k] !== undefined) manifest[k] = raw[k];
  const bundle = await rolldown({ input: path.join(folder, raw.entry ?? 'main.ts'), platform: 'browser', logLevel: 'warn' });
  const { output } = await bundle.generate({ format: 'esm', minify: true });
  await bundle.close();
  const chunk = output[0];
  // a mod reaches the game through its context (mod.mc), never by importing the game's own files
  if (chunk.imports.length) throw new Error(`${raw.id}: imports ${chunk.imports.join(', ')} at runtime (use \`import type\` and mod.mc)`);
  let code = chunk.code;
  if (!chunk.exports.includes('manifest')) code += `\nexport const manifest = ${JSON.stringify(manifest)};\n`;
  const sha256 = createHash('sha256').update(code).digest('hex');
  const file = `${raw.id}/${raw.id}-${raw.version}-${sha256.slice(0, 8)}.js`;
  return { entry: { ...manifest, id: raw.id, sha256, size: code.length, file }, code, stamp: sourcesStamp(folder) };
}

export function modsPlugin(root = 'mods'): Plugin {
  const dir = path.resolve(root);
  const folders = () => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'mod.json'))).map((d) => path.join(dir, d.name)) : []);
  const cache = new Map<string, Built>();
  async function buildAll(dev: boolean): Promise<Built[]> {
    const out: Built[] = [];
    for (const f of folders()) {
      const have = cache.get(f);
      if (dev && have && have.stamp === sourcesStamp(f)) { out.push(have); continue; }
      try {
        const b = await buildMod(f);
        cache.set(f, b);
        out.push(b);
      } catch (e) {
        if (!dev) throw e;
        console.error('[mods]', (e as Error).message);
      }
    }
    return out;
  }
  const index = (list: Built[]) => JSON.stringify({ schemaVersion: 1, mods: list.map((b) => b.entry) }, null, 1);
  return {
    name: 'mod-repository',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith('/mods/')) return next();
        try {
          const list = await buildAll(true);
          if (url === '/mods/index.json') {
            res.setHeader('Content-Type', 'application/json');
            res.end(index(list));
            return;
          }
          const hit = list.find((b) => '/mods/' + b.entry.file === url);
          if (!hit) { res.statusCode = 404; res.end('no such mod file'); return; }
          res.setHeader('Content-Type', 'text/javascript');
          res.end(hit.code);
        } catch (e) {
          res.statusCode = 500;
          res.end(String((e as Error).message));
        }
      });
    },
    async generateBundle() {
      const list = await buildAll(false);
      for (const b of list) this.emitFile({ type: 'asset', fileName: 'mods/' + b.entry.file, source: b.code });
      this.emitFile({ type: 'asset', fileName: 'mods/index.json', source: index(list) });
    },
  };
}
