// Glyphs for text the game's own bitmap font doesn't cover (Chinese, and anything else typed into chat or on signs),
// from GNU Unifont like Minecraft's: tools/i18n/unifont-<version>.hex.gz (plain Unifont hex, plane 0).
//
// - font/<set>-<hash>.bin: every glyph a translation needs, loaded with the language (src/i18n/<lang>*.ts are scanned
//   for their characters); "base" holds the language names the Language screen shows in every language.
// - font/unifont-<version>/<page>.bin: all of Unifont by 256-character page, fetched when other text needs one.
// - font/index.json names them.
//
// Formats: a page is 256 kind bytes (0 none, 1 narrow 8x16, 2 wide 16x16) and then the bitmaps in order (a row is 1
// or 2 bytes, top row first, high bit leftmost); a set is records of [code point u16le][kind u8][bitmap].
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'tools/i18n';
const I18N = 'src/i18n';

interface Font { version: string; glyphs: Map<number, Buffer> }

function readFont(): Font {
  const file = fs.readdirSync(DIR).find((f) => /^unifont-[\d.]+\.hex\.gz$/.test(f));
  if (!file) throw new Error(`no unifont-<version>.hex.gz in ${DIR}`);
  const glyphs = new Map<number, Buffer>();
  for (const line of gunzipSync(fs.readFileSync(path.join(DIR, file))).toString('latin1').split('\n')) {
    const m = /^([0-9A-F]{4}):([0-9A-F]{32}|[0-9A-F]{64})$/.exec(line.trim());
    if (m) glyphs.set(parseInt(m[1], 16), Buffer.from(m[2], 'hex'));
  }
  return { version: /unifont-([\d.]+)\.hex/.exec(file)![1], glyphs };
}

/** The characters a set needs: everything outside ASCII in its source files. */
function setChars(files: string[]): number[] {
  const cps = new Set<number>();
  for (const f of files) for (const ch of fs.readFileSync(f, 'utf8')) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0x7e && cp <= 0xffff) cps.add(cp);
  }
  return [...cps].sort((a, b) => a - b);
}

function setFiles(): Record<string, string[]> {
  const sets: Record<string, string[]> = { base: [path.join(I18N, 'i18n.ts')] };
  for (const f of fs.readdirSync(I18N).sort()) {
    const m = /^([a-z]{2}_[a-z]{2})(?:_\w+)?\.ts$/.exec(f);
    if (m) (sets[m[1]] ??= []).push(path.join(I18N, f));
  }
  return sets;
}

function buildSet(font: Font, cps: number[]): Buffer {
  const parts: Buffer[] = [];
  for (const cp of cps) {
    const g = font.glyphs.get(cp);
    if (!g) continue;
    const head = Buffer.alloc(3);
    head.writeUInt16LE(cp, 0);
    head[2] = g.length === 32 ? 2 : 1;
    parts.push(head, g);
  }
  return Buffer.concat(parts);
}

function buildPage(font: Font, page: number): Buffer | null {
  const kinds = Buffer.alloc(256), maps: Buffer[] = [];
  for (let i = 0; i < 256; i++) {
    const g = font.glyphs.get(page * 256 + i);
    if (!g) continue;
    kinds[i] = g.length === 32 ? 2 : 1;
    maps.push(g);
  }
  return maps.length ? Buffer.concat([kinds, ...maps]) : null;
}

const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 10);

/** Everything under font/, by path. */
function build(): Map<string, Buffer> {
  const font = readFont(), out = new Map<string, Buffer>();
  const index: { pages: string; sets: Record<string, string> } = { pages: `font/unifont-${font.version}/`, sets: {} };
  for (const [name, files] of Object.entries(setFiles())) {
    const data = buildSet(font, setChars(files));
    const file = `font/${name}-${hash(data)}.bin`;
    index.sets[name] = file;
    out.set(file, data);
  }
  for (let p = 0; p < 256; p++) {
    const data = buildPage(font, p);
    if (data) out.set(`${index.pages}${p.toString(16).padStart(2, '0')}.bin`, data);
  }
  out.set('font/index.json', Buffer.from(JSON.stringify(index)));
  return out;
}

export function fontPlugin(): Plugin {
  let cache: Map<string, Buffer> | null = null;
  return {
    name: 'unifont',
    configureServer(server) {
      // a translation changing can add characters: rebuild on the next request
      server.watcher.on('change', (f) => { if (f.includes(path.join('src', 'i18n'))) cache = null; });
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith('/font/')) return next();
        const data = (cache ??= build()).get(url.slice(1));
        if (!data) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', url.endsWith('.json') ? 'application/json' : 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(data);
      });
    },
    generateBundle() {
      for (const [fileName, source] of build()) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}
