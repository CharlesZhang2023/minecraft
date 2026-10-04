// Pairing this tab with the agent bridge on the player's own computer (`mc online`): from a link
// (`#agent=<token>[@port]`) or the Options > More... > Agent screen. Small and in the main bundle; the agent itself
// (./index) is fetched only once a tab is paired. Nothing here talks to the game's server.
import type { Client } from '../client/client';
import type { Link } from './index';

export interface Pairing { pair: string; port: number }
export const DEFAULT_PORT = 47821;
const KEY = 'mc-agent-pair', REMEMBER = 'mc-agent-pair-remember';

/** A pairing from what a person pastes: the whole link, `#agent=...`, or just the code (`code` or `code@port`). */
export function parsePairing(text: string): Pairing | null {
  const t = text.trim();
  const m = /(?:agent=)?([\w-]{12,})(?:@(\d{2,5}))?\s*$/.exec(t.includes('agent=') ? t.slice(t.indexOf('agent=')) : t);
  if (!m || m[1] === 'off') return null;
  return { pair: m[1], port: m[2] ? Number(m[2]) : DEFAULT_PORT };
}

const store = (s: Storage, k: string, v: string | null) => { try { if (v === null) s.removeItem(k); else s.setItem(k, v); } catch { /* private mode */ } };
const load = (s: Storage, k: string) => { try { return s.getItem(k); } catch { return null; } };

/**
 * The pairing to start with: a link in the address (taken out of it, so it isn't shared by accident; `#agent=off`
 * unpairs), else this tab's, else one remembered on this device.
 */
export function readPairing(): Pairing | null {
  const m = /(?:^#|&)agent=([\w-]+)(?:@(\d+))?/.exec(location.hash);
  if (m) {
    history.replaceState(null, '', location.pathname + location.search);
    if (m[1] === 'off') { forgetPairing(); return null; }
    const p = { pair: m[1], port: Number(m[2] ?? DEFAULT_PORT) };
    savePairing(p, false);
    return p;
  }
  const raw = load(sessionStorage, KEY) ?? load(localStorage, REMEMBER);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Keep the pairing for this tab (reloads), and on this device too if `remember`. */
export function savePairing(p: Pairing, remember: boolean) {
  store(sessionStorage, KEY, JSON.stringify(p));
  if (remember) store(localStorage, REMEMBER, JSON.stringify(p));
}
export function forgetPairing() {
  store(sessionStorage, KEY, null);
  store(localStorage, REMEMBER, null);
}
export const remembered = () => !!load(localStorage, REMEMBER);

/** The agent connection of this tab (one at most). */
export const agentLink = { link: null as Link | null, pairing: null as Pairing | null, loading: false, error: '' };

/** Connect (or reconnect elsewhere) to the bridge; loads the agent the first time. */
export async function startAgent(game: Client, p: Pairing) {
  agentLink.pairing = p;
  agentLink.error = '';
  if (agentLink.link) { agentLink.link.retarget?.(p.pair, p.port); return; }
  agentLink.loading = true;
  try {
    const m = await import('./index');
    agentLink.link = m.localLink(p.pair, p.port);
    m.attach(game, agentLink.link);
  } catch (e) {
    agentLink.error = (e as Error).message;
  } finally {
    agentLink.loading = false;
  }
}

/** Disconnect and stop trying (the agent stays loaded, idle). */
export function stopAgent() {
  agentLink.link?.stop?.();
  agentLink.pairing = null;
}

export type AgentStatus = 'off' | 'loading' | 'waiting' | 'connected';
export function agentStatus(): AgentStatus {
  if (agentLink.loading) return 'loading';
  if (!agentLink.pairing || !agentLink.link) return 'off';
  return agentLink.link.connected ? 'connected' : 'waiting';
}
