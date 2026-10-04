// The agent bridge: lets programs on this computer (the `mc` command, the MCP server, scripts) drive the game open
// in a browser tab.
//
//   program --HTTP POST /__mc/rpc--> hub --a socket to the tab--> the game tab (src/agent) --> the answer back
//
// The hub (sessions, requests, the local HTTP API) is shared by two hosts:
// - the dev server plugin (`agentBridge`): tabs it serves talk over Vite's own WebSocket (the hot-reload one);
// - the standalone bridge (tools/agent/online.mjs): the deployed game, opened with a pairing link, connects out to it.
// Requests need the token the hub writes to node_modules/.mc-agent/<port>.json and must come from this computer; web
// pages can read neither, so a website can't reach the game through it. Nothing of this runs on the game's server.
// (Plain erasable TypeScript: Node loads this file directly for the standalone bridge.)
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface HubClient { send(event: string, payload?: unknown): void }
interface Session {
  sid: string;
  client: HubClient;
  info: Record<string, unknown>;
  /** When the tab last said hello (it does every few seconds). */
  seen: number;
  since: number;
}
interface Pending { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout>; sid: string }

export const AGENT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../node_modules/.mc-agent');
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const STALE_MS = 30000;

export type Hub = ReturnType<typeof createHub>;

/** Sessions (game tabs), requests to them and the local HTTP API (`/__mc/...`). */
export function createHub(kind: 'dev' | 'online') {
  const token = randomBytes(24).toString('base64url');
  const sessions = new Map<string, Session>();
  const pending = new Map<number, Pending>();
  let nextId = 1;

  /** A tab's message (`mc-agent:hello`, `:bye`, `:res`). */
  const message = (event: string, data: Record<string, unknown> | undefined, client: HubClient) => {
    if (event === 'mc-agent:hello') {
      const sid = String(data?.sid ?? '').slice(0, 64);
      if (!sid) return;
      const info = { ...((data?.info ?? {}) as Record<string, unknown>), via: kind };
      const s = sessions.get(sid);
      if (s) { s.client = client; s.info = info; s.seen = Date.now(); }
      else sessions.set(sid, { sid, client, info, seen: Date.now(), since: Date.now() });
    } else if (event === 'mc-agent:bye') {
      const s = sessions.get(String(data?.sid));
      if (s && s.client === client) sessions.delete(s.sid);
    } else if (event === 'mc-agent:res') {
      const p = pending.get(Number(data?.id));
      if (!p) return;
      pending.delete(Number(data!.id));
      clearTimeout(p.timer);
      p.resolve(data!.error !== undefined ? { ok: false, error: data!.error } : { ok: true, result: data!.result ?? null });
    }
  };
  /** A tab's connection closed. */
  const gone = (client: HubClient) => {
    for (const [sid, s] of sessions) if (s.client === client) {
      sessions.delete(sid);
      for (const [id, p] of pending) if (p.sid === sid) { pending.delete(id); clearTimeout(p.timer); p.resolve({ ok: false, error: { message: 'The game tab closed or reloaded before answering' } }); }
    }
  };

  const live = () => {
    const now = Date.now();
    for (const [sid, s] of sessions) if (now - s.seen > STALE_MS) sessions.delete(sid);
    return [...sessions.values()];
  };
  /** The tab to talk to: the one asked for (an id or the start of one), else the one most likely being watched. */
  const pick = (want?: string): Session | string => {
    const all = live();
    if (!all.length) return kind === 'online' ? 'No game tab is connected to this bridge yet: open the pairing link it printed (mc online).' : 'No game tab is connected. Open the game from this dev server in a browser, or run `mc launch`.';
    if (want) {
      const s = sessions.get(want) ?? all.find((x) => x.sid.startsWith(want) || x.info.name === want);
      return s ?? `No session '${want}'. Connected: ${all.map((x) => x.sid).join(', ')}`;
    }
    const score = (s: Session) => (s.info.world ? 8 : 0) + (s.info.host ? 4 : 0) + (s.info.focused ? 2 : 0) + (s.info.visible ? 1 : 0);
    return all.sort((a, b) => score(b) - score(a) || b.since - a.since)[0];
  };
  const call = (s: Session, method: string, params: unknown, timeout: number) => new Promise<unknown>((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: { message: `No answer from the game in ${Math.round(timeout / 1000)} s (is the tab frozen or busy?)` } }); }, timeout);
    pending.set(id, { resolve, timer, sid: s.sid });
    s.client.send('mc-agent:req', { id, method, params });
  });

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
    const parts: Buffer[] = [];
    let n = 0;
    req.on('data', (b: Buffer) => { n += b.length; if (n > 64 * 1024 * 1024) { reject(new Error('Request too large')); req.destroy(); } else parts.push(b); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });

  /** The local API, mounted at /__mc (`url` is the part after it). */
  const http = async (req: IncomingMessage, res: ServerResponse, url: string) => {
    // this computer only, with the token, and never on behalf of a web page
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return json(res, 403, { ok: false, error: { message: 'Local programs only' } });
    if (req.headers.origin) return json(res, 403, { ok: false, error: { message: 'Not from web pages' } });
    if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { ok: false, error: { message: 'Bad or missing token (see node_modules/.mc-agent/)' } });
    const u = new URL(url || '/', 'http://x');
    try {
      if (req.method === 'GET' && u.pathname === '/ping') return json(res, 200, { ok: true, result: { bridge: 1, kind, sessions: live().length } });
      if (req.method === 'GET' && u.pathname === '/sessions') {
        const chosen = pick();
        return json(res, 200, { ok: true, result: live().map((s) => ({ sid: s.sid, ...s.info, default: typeof chosen !== 'string' && chosen.sid === s.sid, age: Math.round((Date.now() - s.since) / 1000) })) });
      }
      if (req.method === 'POST' && u.pathname === '/rpc') {
        const body = JSON.parse((await readBody(req)) || '{}') as { session?: string; method?: string; params?: unknown; timeout?: number };
        if (!body.method) return json(res, 400, { ok: false, error: { message: 'No method' } });
        const s = pick(body.session);
        if (typeof s === 'string') return json(res, 503, { ok: false, error: { message: s } });
        const timeout = Math.max(1000, Math.min(30 * 60000, Number(body.timeout) || 120000));
        const out = await call(s, body.method, body.params ?? {}, timeout);
        return json(res, 200, { ...(out as object), session: s.sid });
      }
      json(res, 404, { ok: false, error: { message: 'Unknown endpoint' } });
    } catch (e) {
      json(res, 500, { ok: false, error: { message: (e as Error).message } });
    }
  };

  /** Tell local programs where we are and the token (a file per port: several bridges can run). */
  let file = '';
  const announce = (port: number, extra: Record<string, unknown> = {}) => {
    fs.mkdirSync(AGENT_DIR, { recursive: true });
    file = path.join(AGENT_DIR, `${port}.json`);
    fs.writeFileSync(file, JSON.stringify({ url: `http://127.0.0.1:${port}`, port, token, pid: process.pid, kind, root: process.cwd(), ...extra }, null, 2), { mode: 0o600 });
  };
  const retire = () => { try { if (file) fs.unlinkSync(file); } catch { /* gone */ } };
  process.once('exit', retire);

  return { message, gone, http, announce, retire, live };
}

/** The dev server's bridge: every game tab it serves is a session, over Vite's own WebSocket. */
export function agentBridge(): Plugin {
  return {
    name: 'mc-agent-bridge',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const hub = createHub('dev');
      const hot = server.ws;
      for (const ev of ['mc-agent:hello', 'mc-agent:bye', 'mc-agent:res']) hot.on(ev, (data: Record<string, unknown>, client: HubClient) => hub.message(ev, data, client));
      hot.on('vite:client:disconnect', (_d: unknown, client: HubClient) => hub.gone(client));
      server.middlewares.use('/__mc', (req, res) => { void hub.http(req, res, req.url ?? '/'); });
      server.httpServer?.once('listening', () => {
        const a = server.httpServer!.address();
        if (a && typeof a !== 'string') hub.announce(a.port);
      });
      server.httpServer?.once('close', hub.retire);
    },
  };
}
