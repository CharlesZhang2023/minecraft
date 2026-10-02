// Multiplayer signaling for mc.iloveust.com. It only introduces WebRTC peers to each other and hands out
// short-lived TURN credentials; no game traffic ever passes through here. Each room is one Durable Object
// that holds the host's and guests' WebSockets (hibernating, so idle rooms cost nothing).
//
//   GET /health                                   → "ok"
//   GET /room/<CODE>?role=host&key=<secret>       → WebSocket, as the room's host (key lets it reconnect)
//       &lan=1&name=<world>                         ... and list it for devices on the same network
//   GET /room/<CODE>?role=guest                   → WebSocket, as a guest
//   GET /lan                                      → {rooms: [{code, name, players}]} listed from your network
// Also served under /signal/... (mc.iloveust.com proxies /signal/ here so the game can stay same-origin).
//
// Messages are JSON text frames:
//   → you    {t:'hello', id, ice, peers?}   on connect; the host's id is 'host', peers = guests already there
//   → host   {t:'join', id} / {t:'leave', id}
//   → anyone {t:'signal', from, data}        relayed from {t:'signal', to, data}; guests can only talk to the host
//   host →   {t:'kick', id}
//   host →   {t:'list', name, players}       keeps a listed room fresh (every ~25 s)
//   {t:'ping'} is answered with {t:'pong'} without waking the room.
// Close codes: 4001 room taken, 4002 replaced by a reconnect, 4003 kicked, 4004 no host, 4008 bad/too many
// messages, 4010 host left, 4029 room full.
import { DurableObject } from 'cloudflare:workers';

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  LOBBY: DurableObjectNamespace<Lobby>;
  /** openresty's proxy sends the player's real address with this secret (direct requests use Cloudflare's). */
  PROXY_SECRET?: string;
  TURN_HOST: string;
  TURN_SECRET?: string;
  ALLOWED_ORIGINS: string;
}

interface Peer { id: string; role: 'host' | 'guest'; key?: string; replaced?: boolean; lan?: string; name?: string }

const MAX_GUESTS = 16;
const MAX_MESSAGE = 16 * 1024;
const TURN_TTL = 24 * 3600;
const CODE = /^[A-Za-z0-9]{4,12}$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/signal(?=\/)/, '');
    if (path === '/health') return new Response('ok');
    if (path === '/lan') {
      const net = netKey(clientIp(req, env));
      const rooms = net ? await env.LOBBY.get(env.LOBBY.idFromName(net)).list() : [];
      return Response.json({ rooms }, { headers: { 'Cache-Control': 'no-store', ...cors(req, env) } });
    }
    const m = path.match(/^\/room\/([^/]+)$/);
    if (!m || !CODE.test(m[1])) return new Response('not found', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected a websocket', { status: 426 });
    if (!originOk(req.headers.get('Origin'), env)) return new Response('forbidden', { status: 403 });
    const code = m[1].toUpperCase();
    // the room learns which network its host is on (for the nearby-games list), never the address itself
    const headers = new Headers(req.headers);
    headers.set('X-Net', netKey(clientIp(req, env)) ?? '');
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(req, { headers }));
  },
} satisfies ExportedHandler<Env>;

function clientIp(req: Request, env: Env): string | null {
  const proxied = !!env.PROXY_SECRET && req.headers.get('X-Proxy-Secret') === env.PROXY_SECRET;
  return (proxied ? req.headers.get('X-Client-IP') : null) ?? req.headers.get('CF-Connecting-IP');
}

/** Devices on one network share a public IPv4 address, or an IPv6 /64 prefix. */
function netKey(ip: string | null): string | null {
  if (!ip) return null;
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const a = head ? head.split(':') : [], b = tail ? tail.split(':') : [];
  const full = [...a, ...new Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return full.slice(0, 4).map((g) => parseInt(g || '0', 16).toString(16)).join(':') + '::/64';
}

function cors(req: Request, env: Env): Record<string, string> {
  const o = req.headers.get('Origin');
  return o && originOk(o, env) ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin' } : {};
}

/** Games listed per network, for "nearby games" (entries vanish if their host stops refreshing them). */
export class Lobby extends DurableObject<Env> {
  async register(code: string, name: string, players: number) {
    await this.ctx.storage.put('room:' + code, { code, name: name.slice(0, 32), players: Math.max(1, Math.min(99, players | 0)), at: Date.now() });
  }
  async unregister(code: string) {
    await this.ctx.storage.delete('room:' + code);
  }
  async list() {
    const now = Date.now(), out: { code: string; name: string; players: number }[] = [];
    for (const [k, v] of await this.ctx.storage.list<{ code: string; name: string; players: number; at: number }>({ prefix: 'room:' })) {
      if (now - v.at > 70000) await this.ctx.storage.delete(k);
      else out.push({ code: v.code, name: v.name, players: v.players });
    }
    return out;
  }
}

function originOk(origin: string | null, env: Env) {
  if (!origin) return false;
  if (env.ALLOWED_ORIGINS.split(',').some((o) => o.trim() === origin)) return true;
  try {
    // dev servers: localhost and private-LAN addresses (phones testing against a laptop)
    const { protocol, hostname: h } = new URL(origin);
    return protocol === 'http:' && (h === 'localhost' || h === '127.0.0.1' || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(h));
  } catch {
    return false;
  }
}

export class Room extends DurableObject<Env> {
  /** Per-socket token buckets (lost on hibernation, which only makes them more lenient). */
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.pathname.split('/').pop()!.toUpperCase();
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'guest';
    const { 0: client, 1: server } = new WebSocketPair();

    const refuse = (closeCode: number, reason: string) => {
      server.accept();
      server.send(JSON.stringify({ t: 'error', reason }));
      server.close(closeCode, reason);
      return new Response(null, { status: 101, webSocket: client });
    };

    const hosts = this.ctx.getWebSockets('host');
    let peer: Peer;
    if (role === 'host') {
      const key = url.searchParams.get('key') ?? '';
      if (key.length < 16 || key.length > 128) return refuse(4008, 'host key must be 16-128 characters');
      for (const old of hosts) {
        const o = old.deserializeAttachment() as Peer;
        if (o.key !== key) return refuse(4001, 'room code taken');
        // the same host reconnecting (network blip, reload): retire the old socket quietly
        old.serializeAttachment({ ...o, replaced: true });
        old.close(4002, 'replaced');
      }
      peer = { id: 'host', role, key };
      const net = req.headers.get('X-Net');
      if (url.searchParams.get('lan') === '1' && net) {
        peer.lan = net;
        peer.name = (url.searchParams.get('name') ?? 'Minecraft world').slice(0, 32);
        await this.env.LOBBY.get(this.env.LOBBY.idFromName(net)).register(code, peer.name, 1);
      }
    } else {
      if (!hosts.length) return refuse(4004, 'no such room');
      if (this.ctx.getWebSockets('guest').length >= MAX_GUESTS) return refuse(4029, 'room full');
      peer = { id: crypto.randomUUID().slice(0, 8), role };
    }

    this.ctx.acceptWebSocket(server, role === 'host' ? ['host'] : ['guest', peer.id]);
    server.serializeAttachment({ ...peer, code });
    const ice = await this.iceServers(`${code}-${peer.id}`);
    if (role === 'host') {
      const peers = this.ctx.getWebSockets('guest').map((g) => (g.deserializeAttachment() as Peer).id);
      server.send(JSON.stringify({ t: 'hello', id: 'host', ice, peers }));
    } else {
      server.send(JSON.stringify({ t: 'hello', id: peer.id, ice }));
      this.toHost({ t: 'join', id: peer.id });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const me = ws.deserializeAttachment() as Peer;
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE || !this.allow(me.id)) return ws.close(4008, 'bad or too many messages');
    let m: { t?: unknown; to?: unknown; id?: unknown; data?: unknown; name?: unknown; players?: unknown };
    try {
      m = JSON.parse(raw);
    } catch {
      return ws.close(4008, 'bad message');
    }
    if (m.t === 'signal' && typeof m.to === 'string') {
      if (me.role === 'guest' && m.to !== 'host') return;
      const target = m.to === 'host' ? this.ctx.getWebSockets('host') : this.ctx.getWebSockets(m.to);
      for (const t of target) t.send(JSON.stringify({ t: 'signal', from: me.id, data: m.data }));
    } else if (m.t === 'kick' && me.role === 'host' && typeof m.id === 'string' && m.id !== 'host') {
      for (const g of this.ctx.getWebSockets(m.id)) g.close(4003, 'kicked');
    } else if (m.t === 'list' && me.role === 'host' && me.lan) {
      const code = this.code(ws);
      const name = typeof (m as { name?: unknown }).name === 'string' ? ((m as { name: string }).name).slice(0, 32) : me.name ?? '';
      if (code) await this.env.LOBBY.get(this.env.LOBBY.idFromName(me.lan)).register(code, name, Number((m as { players?: unknown }).players) || 1);
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.gone(ws, code);
  }

  async webSocketError(ws: WebSocket) {
    this.gone(ws, 1011);
  }

  /** The room's code (kept on each socket, since a hibernated room forgets everything else). */
  private code(ws: WebSocket) {
    return (ws.deserializeAttachment() as Peer & { code?: string }).code ?? null;
  }

  private gone(ws: WebSocket, code: number) {
    const me = ws.deserializeAttachment() as Peer & { code?: string };
    if (me.role === 'host' && me.lan && me.code && !me.replaced) this.ctx.waitUntil(this.env.LOBBY.get(this.env.LOBBY.idFromName(me.lan)).unregister(me.code));
    this.buckets.delete(me.id);
    try {
      ws.close(code >= 3000 && code < 5000 ? code : 1000);
    } catch {
      // already closed
    }
    if (me.replaced) return;
    if (me.role === 'host') {
      for (const g of this.ctx.getWebSockets('guest')) {
        try {
          g.send(JSON.stringify({ t: 'closed', reason: 'host left' }));
          g.close(4010, 'host left');
        } catch {
          // closing anyway
        }
      }
    } else {
      this.toHost({ t: 'leave', id: me.id });
    }
  }

  private toHost(msg: object) {
    for (const h of this.ctx.getWebSockets('host')) {
      try {
        h.send(JSON.stringify(msg));
      } catch {
        // host socket closing
      }
    }
  }

  /** 20 messages a second, bursts of 100: plenty for SDP and trickled ICE candidates. */
  private allow(id: string) {
    const now = Date.now();
    const b = this.buckets.get(id) ?? { tokens: 100, at: now };
    b.tokens = Math.min(100, b.tokens + ((now - b.at) / 1000) * 20);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens--;
    this.buckets.set(id, b);
    return true;
  }

  /** STUN everywhere, plus our coturn with time-limited credentials (coturn's use-auth-secret / TURN REST API). */
  private async iceServers(user: string): Promise<RTCIceServerJSON[]> {
    const host = this.env.TURN_HOST;
    const list: RTCIceServerJSON[] = [{ urls: [`stun:${host}:3478`, 'stun:stun.cloudflare.com:3478'] }];
    const secret = this.env.TURN_SECRET;
    if (!secret) return list;
    const username = `${Math.floor(Date.now() / 1000) + TURN_TTL}:${user}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username)));
    const credential = btoa(String.fromCharCode(...sig));
    list.push({
      urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`, `turns:${host}:5349?transport=tcp`],
      username,
      credential,
    });
    return list;
  }
}

interface RTCIceServerJSON { urls: string[]; username?: string; credential?: string }
