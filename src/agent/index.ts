// Connects this game tab to an agent bridge, so programs on the player's own computer (the `mc` command, the MCP
// server for AI agents, scripts) can look at and change the world. Two ways:
// - development: the dev server's bridge, over Vite's own WebSocket (`hmrLink`);
// - any build, the deployed site included: the standalone bridge on this computer (tools/agent/online.mjs), which
//   the tab connects out to when opened with its pairing link `#agent=<token>` (`localLink`). Nothing is loaded or
//   connected without that link, and nothing runs on the game's server.
// main.ts loads this module only in those two cases.
import type { Client } from '../client/client';
import { Events } from '../mod/events';
import { Agent } from './agent';
import { makeMethods, safe } from './methods';
import { METHODS } from './spec';
import { Storage } from '../game/storage';
import { playWorld } from '../ui/menus';

interface Req { id: number; method: string; params?: Record<string, unknown> }

/** How messages travel between this tab and a bridge. */
export interface Link {
  kind: 'dev' | 'online';
  send(event: string, data: unknown): void;
  on(event: string, fn: (data: never) => void): void;
  /** Called (again) whenever the connection is (re)made. */
  onOpen(fn: () => void): void;
  readonly connected: boolean;
}

/** The dev server's bridge, over Vite's hot-reload socket. */
export function hmrLink(): Link | null {
  const hot = import.meta.hot;
  if (!hot) return null;
  return {
    kind: 'dev', connected: true,
    send: (e, d) => hot.send(e, d as never),
    on: (e, fn) => hot.on(e, fn as never),
    onOpen: (fn) => hot.on('vite:ws:connect', fn),
  };
}

/** The standalone bridge on this computer (ws://127.0.0.1:<port>), reconnecting while the tab is open. */
export function localLink(pair: string, port: number): Link {
  const handlers = new Map<string, ((d: never) => void)[]>();
  const opens: (() => void)[] = [];
  let ws: WebSocket | null = null, wait = 1000;
  const link: Link = {
    kind: 'online',
    get connected() { return ws?.readyState === WebSocket.OPEN; },
    send: (e, d) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ e, d })); },
    on: (e, fn) => { const l = handlers.get(e) ?? []; l.push(fn); handlers.set(e, l); },
    onOpen: (fn) => { opens.push(fn); },
  };
  const connect = () => {
    try { ws = new WebSocket(`ws://127.0.0.1:${port}/game?pair=${encodeURIComponent(pair)}`); } catch { setTimeout(connect, wait); return; }
    ws.onopen = () => { wait = 1000; for (const f of opens) f(); };
    ws.onmessage = (m) => {
      let msg: { e?: string; d?: unknown };
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      for (const f of handlers.get(String(msg.e)) ?? []) f(msg.d as never);
    };
    // the bridge isn't running (yet), or stopped: keep trying, more slowly
    ws.onclose = () => { ws = null; setTimeout(connect, wait); wait = Math.min(wait * 1.6, 15000); };
  };
  connect();
  return link;
}

export function attach(game: Client, link: Link) {
  const agent = new Agent(game);
  const methods = makeMethods(agent);
  agent.listen();
  Events.serverTick.register((g) => (methods.__runTasks as unknown as (g: unknown) => void)(g));

  // frames the game draws tell waiting requests that time moved
  const frame = game.frame.bind(game);
  game.frame = (now: number) => { frame(now); agent.frameDone(); };

  // the same tab keeps its session id across reloads
  let sid = '';
  try { sid = sessionStorage.getItem('mc-agent-sid') ?? ''; } catch { /* private mode */ }
  if (!sid) {
    sid = Math.random().toString(36).slice(2, 10);
    try { sessionStorage.setItem('mc-agent-sid', sid); } catch { /* fine */ }
  }
  const q = new URLSearchParams(location.search);
  const info = () => {
    const s = game.server, meta = s?.meta;
    return {
      name: q.get('agent') || undefined,
      world: game.panorama ? null : meta?.name ?? (game.world ? '(guest)' : null), host: !!s, dimension: game.panorama ? null : game.world?.dimension ?? null,
      visible: document.visibilityState === 'visible', focused: document.hasFocus(), headless: navigator.webdriver, url: location.origin + location.pathname + location.search,
      player: game.player && !game.panorama ? [Math.round(game.player.x), Math.round(game.player.y), Math.round(game.player.z)] : null,
    };
  };
  const hello = () => link.send('mc-agent:hello', { sid, info: info() });

  // a background tab of the agent's own (`?agent=name`) goes back into its world after a reload
  let reopen: string | null = null;
  try { reopen = q.has('agent') && !q.has('autoplay') ? sessionStorage.getItem('mc-agent-world') : null; } catch { /* fine */ }
  if (reopen) {
    void (async () => {
      const meta = (await Storage.listWorlds()).find((w) => w.id === reopen);
      if (meta && !game.server) playWorld(game.ui, meta);
    })();
  }

  // a worker's timer keeps running in background tabs (the page's own timers are slowed to once a minute there)
  const timer = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 25)'], { type: 'text/javascript' })));
  let lastHello = 0, lastCheck = 0, said = '';
  timer.onmessage = () => {
    agent.pump();
    (methods.__tick as () => void)();
    const now = performance.now();
    // say hello every few seconds, and soon after anything about this tab changes (a world opened...)
    if (now - lastCheck > 500) {
      lastCheck = now;
      const i = JSON.stringify({ ...info(), player: null });
      if (i !== said || now - lastHello > 5000) { said = i; lastHello = now; hello(); }
    }
  };
  hello();
  link.onOpen(hello);
  document.addEventListener('visibilitychange', hello);
  window.addEventListener('focus', hello);
  window.addEventListener('blur', hello);
  window.addEventListener('pagehide', () => link.send('mc-agent:bye', { sid }));

  link.on('mc-agent:req', async (req: Req) => {
    agent.busy++;
    let reply: { id: number; result?: unknown; error?: unknown };
    try {
      const fn = req.method.startsWith('__') ? undefined : methods[req.method];
      if (!fn) throw new Error(`No method '${req.method}'. Methods: ${Object.keys(METHODS).join(', ')}`);
      reply = { id: req.id, result: safe(await fn(req.params ?? {}), -100) };
    } catch (e) {
      const err = e as Error;
      reply = { id: req.id, error: { message: err?.message ?? String(e), ...(METHODS[req.method] ? { usage: METHODS[req.method].params } : {}) } };
    } finally {
      agent.busy--;
      agent.lastBusy = performance.now();
    }
    link.send('mc-agent:res', reply);
  });

  // the deployed game says plainly that something on this computer can drive it, and how to stop that
  if (link.kind === 'online') {
    let was = false;
    link.onOpen(() => {
      if (!was) game.ui.chat.add('§dAn agent on this computer is connected to this tab (mc online). To stop it, close the tab or add #agent=off to the address.');
      was = true;
    });
    Events.hudRender.register(({ ctx, client, width }) => {
      if (client.hideHud) return;
      const gui = client.ui.gui;
      const t = link.connected ? 'Agent' : 'Agent: waiting for mc online';
      const x = width - gui.font.width(t) - 3;
      ctx.fillStyle = link.connected ? '#55FF55' : '#777777';
      ctx.fillRect(x - 7, 4, 4, 4);
      gui.text(ctx, t, x, 3, link.connected ? '#FFFFFF' : '#AAAAAA');
    });
  }
  (window as unknown as { agent: unknown }).agent = { agent, methods, sid, link };
}
