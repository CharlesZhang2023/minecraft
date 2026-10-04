// Talking to the game from Node: finds the dev server's agent bridge (tools/agent/bridge.ts) and calls the API that
// game tabs answer (src/agent, described in src/agent/spec.ts).
//
//   import { connect } from './tools/agent/client.mjs';
//   const mc = await connect();
//   await mc.call('fill', { from: '~-3 ~-1 ~-3', to: '~3 ~-1 ~3', block: 'gold_block' });
//   const { text } = await mc.map({ radius: 16 });   // every method is also a function
//
// Environment: MC_URL (http://127.0.0.1:5174) or MC_PORT picks a dev server, MC_SESSION a tab.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const AGENT_DIR = path.join(ROOT, 'node_modules/.mc-agent');

export class AgentError extends Error {
  constructor(message, info = {}) { super(message); this.info = info; }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** Dev servers running the bridge (from the files they leave in node_modules/.mc-agent). */
export function servers() {
  let files = [];
  try { files = fs.readdirSync(AGENT_DIR).filter((f) => /^\d+\.json$/.test(f)); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, f), 'utf8'));
      if (!alive(s.pid)) { try { fs.unlinkSync(path.join(AGENT_DIR, f)); } catch { /* fine */ } continue; }
      out.push({ ...s, mtime: fs.statSync(path.join(AGENT_DIR, f)).mtimeMs });
    } catch { /* half-written */ }
  }
  return out;
}

async function get(s, p) {
  const r = await fetch(s.url + '/__mc' + p, { headers: { authorization: `Bearer ${s.token}` } });
  return r.json();
}

/**
 * The bridge to use: MC_URL / MC_PORT, else the one holding the wanted session, else the one whose tabs have a world
 * open (dev servers and `mc online` bridges alike), newest first.
 */
export async function findServer({ url = process.env.MC_URL, port = process.env.MC_PORT, session } = {}) {
  const all = servers();
  if (url || port) {
    const want = url ? new URL(url).port : String(port);
    const s = all.find((x) => String(x.port) === want);
    if (!s) throw new AgentError(`No agent bridge on port ${want}. Running: ${all.map((x) => x.port).join(', ') || 'none'} (start one with \`npm run dev\`, \`mc launch\` or \`mc online\`)`);
    return s;
  }
  if (!all.length) throw new AgentError('No agent bridge is running. For the game on mc.iloveust.com run `mc online` and open the link it prints; for a dev build, `npm run dev` (or `mc launch`).', { code: 'no-server' });
  const scored = await Promise.all(all.map(async (s) => {
    try {
      const r = await get(s, '/sessions');
      const list = r.result ?? [];
      return { s, list, n: list.length + list.filter((x) => x.world).length * 10 };
    } catch { return { s, list: [], n: -1 }; }
  }));
  if (session) { const hit = scored.find((x) => x.list.some((t) => t.sid === session || t.name === session)); if (hit) return hit.s; }
  scored.sort((a, b) => b.n - a.n || b.s.mtime - a.s.mtime);
  if (scored[0].n < 0) throw new AgentError('The agent bridge isn\'t answering', { code: 'no-server' });
  return scored[0].s;
}

/** Every tab connected to any bridge on this computer. */
export async function allSessions() {
  const out = [];
  for (const s of servers()) {
    try { for (const t of (await get(s, '/sessions')).result ?? []) out.push({ ...t, bridge: s.url, bridgeKind: s.kind ?? 'dev' }); } catch { /* down */ }
  }
  return out;
}

/** The tab chosen with `mc use` (if any). */
export function savedSession() {
  try { return fs.readFileSync(path.join(AGENT_DIR, 'session'), 'utf8').trim() || undefined; } catch { return undefined; }
}
export function saveSession(sid) {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  if (sid) fs.writeFileSync(path.join(AGENT_DIR, 'session'), sid);
  else try { fs.unlinkSync(path.join(AGENT_DIR, 'session')); } catch { /* none */ }
}

export async function connect(opts = {}) {
  let session = opts.session ?? process.env.MC_SESSION ?? savedSession();
  const server = opts.server ?? await findServer({ ...opts, session });
  const client = {
    server,
    get session() { return session; },
    set session(s) { session = s; },
    async sessions() {
      const r = await get(server, '/sessions');
      if (!r.ok) throw new AgentError(r.error?.message ?? 'sessions failed');
      return r.result;
    },
    /** Call a method; throws AgentError with the game's message on failure. */
    async call(method, params = {}, { timeout = 120000, session: s = session } = {}) {
      const body = JSON.stringify({ session: s, method, params, timeout });
      let r;
      try {
        r = await fetch(server.url + '/__mc/rpc', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` }, body, signal: AbortSignal.timeout(timeout + 5000) });
      } catch (e) {
        throw new AgentError(`Can't reach the dev server at ${server.url}: ${e.message}`, { code: 'no-server' });
      }
      const j = await r.json().catch(() => ({ ok: false, error: { message: `HTTP ${r.status}` } }));
      // a remembered tab that's gone: fall back to choosing one
      if (!j.ok && s && s === savedSession() && /^No session/.test(j.error?.message ?? '')) {
        saveSession(null);
        session = undefined;
        return client.call(method, params, { timeout });
      }
      if (!j.ok) throw new AgentError(j.error?.message ?? 'failed', { ...j.error, code: r.status === 503 ? 'no-session' : undefined });
      client.lastSession = j.session;
      return j.result;
    },
  };
  // every API method as a function: mc.fill({...})
  return new Proxy(client, {
    get(t, k) {
      if (k in t || typeof k !== 'string' || k === 'then') return t[k];
      return (params, o) => t.call(k, params, o);
    },
  });
}

/** The method catalogue (shared with the game: src/agent/spec.ts). */
export async function spec() {
  const prev = process.emitWarning;
  // Node prints a warning the first time it strips TypeScript types
  process.emitWarning = (w, ...a) => (String(w).includes('Type Stripping') ? undefined : prev.call(process, w, ...a));
  try { return await import(path.join(ROOT, 'src/agent/spec.ts')); } finally { process.emitWarning = prev; }
}
