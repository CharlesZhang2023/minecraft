#!/usr/bin/env node
// The standalone agent bridge, for the deployed game (https://mc.iloveust.com) or any build: runs on this computer
// only. The game tab, opened with the pairing link this prints, connects OUT to it (ws://127.0.0.1); the `mc` command
// and the MCP server reach that tab through it exactly as through the dev server. Nothing runs on the game's server.
//
//   node tools/agent/online.mjs [--port 47821] [--site https://mc.iloveust.com] [--origin https://other.example]
//
// The tab must come from an allowed origin (the site, or localhost) and show the pairing token (kept in
// node_modules/.mc-agent/pair, so links keep working after restarts); programs use the API token like the dev bridge.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prevWarn = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('Type Stripping') ? undefined : prevWarn.call(process, w, ...a));
const { createHub, AGENT_DIR } = await import('./bridge.ts');
process.emitWarning = prevWarn;

export const DEFAULT_PORT = 47821;
export const DEFAULT_SITE = 'https://mc.iloveust.com';

/** The pairing token (made once, kept). */
export function pairToken() {
  const f = path.join(AGENT_DIR, 'pair');
  try { const t = fs.readFileSync(f, 'utf8').trim(); if (/^[\w-]{16,}$/.test(t)) return t; } catch { /* none yet */ }
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  const t = crypto.randomBytes(18).toString('base64url');
  fs.writeFileSync(f, t, { mode: 0o600 });
  return t;
}
export const pairLink = (site, port, pair) => `${site.replace(/\/$/, '')}/#agent=${pair}${port === DEFAULT_PORT ? '' : '@' + port}`;

// ------------------------------------------------------------------ a small WebSocket server (RFC 6455)
function accept(req, socket, onText, onClose) {
  const key = req.headers['sec-websocket-key'];
  const hash = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${hash}\r\n\r\n`);
  socket.setNoDelay(true);
  let buf = Buffer.alloc(0), parts = [], closed = false;
  const frame = (op, data) => {
    const n = data.length;
    const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
    if (!closed) socket.write(Buffer.concat([head, data]));
  };
  const close = () => { if (closed) return; frame(8, Buffer.alloc(0)); closed = true; socket.end(); onClose(); };
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 15, masked = buf[1] & 0x80;
      let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 256 * 1024 * 1024) return close();
      if (buf.length < off + (masked ? 4 : 0) + len) return;
      const mask = masked ? buf.subarray(off, off + 4) : null;
      off += masked ? 4 : 0;
      const data = Buffer.from(buf.subarray(off, off + len));
      buf = buf.subarray(off + len);
      if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      if (op === 8) return close();
      if (op === 9) { frame(10, data); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) {
        parts.push(data);
        if (fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; onText(text); }
      }
    }
  });
  socket.on('close', () => { if (!closed) { closed = true; onClose(); } });
  socket.on('error', () => {});
  // keep idle connections alive through anything that drops them
  const ping = setInterval(() => frame(9, Buffer.alloc(0)), 20000);
  socket.on('close', () => clearInterval(ping));
  return { send: (text) => frame(1, Buffer.from(text, 'utf8')), close };
}

export async function serve({ port = DEFAULT_PORT, site = DEFAULT_SITE, origins = [] } = {}) {
  const hub = createHub('online');
  const pair = pairToken();
  const allowed = new Set([new URL(site).origin, ...origins.map((o) => new URL(o).origin)]);
  const okOrigin = (o) => !!o && (allowed.has(o) || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(o));
  const server = http.createServer((req, res) => {
    // a browser (the game page) asking whether it may talk to this computer: Chrome's local network checks
    if (req.method === 'OPTIONS') {
      const o = req.headers.origin;
      if (okOrigin(o)) {
        res.setHeader('access-control-allow-origin', o);
        res.setHeader('access-control-allow-methods', 'GET');
        if (req.headers['access-control-request-private-network']) res.setHeader('access-control-allow-private-network', 'true');
      }
      res.statusCode = 204;
      return res.end();
    }
    if (req.url?.startsWith('/__mc/')) return void hub.http(req, res, req.url.slice(5));
    res.statusCode = 404;
    res.end('Minecraft agent bridge\n');
  });
  server.on('upgrade', (req, socket) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const origin = req.headers.origin;
    if (u.pathname !== '/game' || !okOrigin(origin) || u.searchParams.get('pair') !== pair || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    let client = null;
    const ws = accept(req, socket, (text) => {
      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (m && typeof m.e === 'string') hub.message(m.e, m.d, client);
    }, () => hub.gone(client));
    client = { send: (event, payload) => ws.send(JSON.stringify({ e: event, d: payload })) };
    console.log(new Date().toISOString(), 'game tab connected from', origin);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  hub.announce(port, { site, link: pairLink(site, port, pair) });
  const bye = () => { hub.retire(); process.exit(0); };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
  return { port, link: pairLink(site, port, pair), server };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const origins = argv.flatMap((a, i) => (a === '--origin' ? [argv[i + 1]] : []));
  serve({ port: Number(opt('port', DEFAULT_PORT)), site: opt('site', DEFAULT_SITE), origins }).then((r) => {
    console.log(`Agent bridge on 127.0.0.1:${r.port}. Open the game with:\n  ${r.link}`);
  }).catch((e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${opt('port', DEFAULT_PORT)} is taken (another bridge?)` : e); process.exit(1); });
}
