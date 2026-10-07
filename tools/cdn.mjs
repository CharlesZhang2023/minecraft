#!/usr/bin/env node
// Puts the build's big files that are named after their hash (the recorded sound effects and music, the pack
// repository's files) on the CDN: a Cloudflare Worker serving only static files (cdn/wrangler.jsonc), at the address
// in src/net/cdn.ts. The game uses it where it answers quickly and falls back to its own server (mainland China, or
// a file the CDN doesn't have), so the CDN may lag behind the server without breaking anything. After `npm run build`:
//
//   npm run deploy:cdn            (needs wrangler, logged in: it's in signal/node_modules)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist'), out = path.resolve('dist-cdn');
if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('no build in dist/: run npm run build first'); process.exit(1); }
fs.rmSync(out, { recursive: true, force: true });

// everything under these folders except their indexes (those always come from the server)
let files = 0, bytes = 0;
for (const dir of ['sounds', 'packs']) {
  const from = path.join(dist, dir);
  if (!fs.existsSync(from)) continue;
  for (const f of fs.readdirSync(from, { recursive: true })) {
    const src = path.join(from, f);
    if (fs.statSync(src).isDirectory() || path.basename(f) === 'index.json') continue;
    fs.mkdirSync(path.dirname(path.join(out, dir, f)), { recursive: true });
    fs.copyFileSync(src, path.join(out, dir, f));
    files++;
    bytes += fs.statSync(src).size;
  }
}
// what the game asks to see whether the CDN answers (never cached)
fs.writeFileSync(path.join(out, 'cdn.json'), JSON.stringify({ v: 1, built: new Date().toISOString() }) + '\n');
const cached = '  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=31536000, immutable\n';
fs.writeFileSync(path.join(out, '_headers'), `/sounds/*\n${cached}/packs/*\n${cached}/cdn.json\n  Access-Control-Allow-Origin: *\n  Cache-Control: no-store\n`);
console.log(`dist-cdn/: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);

const wrangler = path.resolve('signal/node_modules/.bin/wrangler');
if (!fs.existsSync(wrangler)) { console.error('wrangler not found: run npm install in signal/'); process.exit(1); }
const r = spawnSync(wrangler, ['deploy', '--config', 'cdn/wrangler.jsonc'], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
process.exit(r.status ?? 1);
