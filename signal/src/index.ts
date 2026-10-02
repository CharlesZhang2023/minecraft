// Multiplayer signaling for mc.iloveust.com. It only introduces WebRTC peers to each other and hands out
// short-lived TURN credentials; no game traffic ever passes through here. Each room is one Durable Object
// that holds the host's and guests' WebSockets (hibernating, so idle rooms cost nothing).
//
//   GET /health                                   → "ok"
//   GET /room/<CODE>?role=host&key=<secret>       → WebSocket, as the room's host (key lets it reconnect)
//   GET /room/<CODE>?role=guest                   → WebSocket, as a guest
// Also served under /signal/... (mc.iloveust.com proxies /signal/ here so the game can stay same-origin).
//
// Messages are JSON text frames:
//   → you    {t:'hello', id, ice, peers?}   on connect; the host's id is 'host', peers = guests already there
//   → host   {t:'join', id} / {t:'leave', id}
//   → anyone {t:'signal', from, data}        relayed from {t:'signal', to, data}; guests can only talk to the host
//   host →   {t:'kick', id}
//   {t:'ping'} is answered with {t:'pong'} without waking the room.
// Close codes: 4001 room taken, 4002 replaced by a reconnect, 4003 kicked, 4004 no host, 4008 bad/too many
// messages, 4010 host left, 4029 room full.
import { DurableObject } from 'cloudflare:workers';

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  TURN_HOST: string;
  TURN_SECRET?: string;
  ALLOWED_ORIGINS: string;
}

interface Peer { id: string; role: 'host' | 'guest'; key?: string; replaced?: boolean }

const MAX_GUESTS = 16;
const MAX_MESSAGE = 16 * 1024;
const TURN_TTL = 24 * 3600;
const CODE = /^[A-Za-z0-9]{4,12}$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/signal(?=\/)/, '');
    if (path === '/health') return new Response('ok');
    const m = path.match(/^\/room\/([^/]+)$/);
    if (!m || !CODE.test(m[1])) return new Response('not found', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected a websocket', { status: 426 });
    if (!originOk(req.headers.get('Origin'), env)) return new Response('forbidden', { status: 403 });
    const code = m[1].toUpperCase();
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
  },
} satisfies ExportedHandler<Env>;

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
    } else {
      if (!hosts.length) return refuse(4004, 'no such room');
      if (this.ctx.getWebSockets('guest').length >= MAX_GUESTS) return refuse(4029, 'room full');
      peer = { id: crypto.randomUUID().slice(0, 8), role };
    }

    this.ctx.acceptWebSocket(server, role === 'host' ? ['host'] : ['guest', peer.id]);
    server.serializeAttachment(peer);
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
    let m: { t?: unknown; to?: unknown; id?: unknown; data?: unknown };
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
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.gone(ws, code);
  }

  async webSocketError(ws: WebSocket) {
    this.gone(ws, 1011);
  }

  private gone(ws: WebSocket, code: number) {
    const me = ws.deserializeAttachment() as Peer;
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
