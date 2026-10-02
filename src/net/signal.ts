// Finding each other: the signaling service (signal/ in the repo, a Cloudflare Worker) only passes connection
// offers between the host and the people joining; once the WebRTC link is up, the game talks peer to peer.
// Where it lives comes from multiplayer.json next to index.html, so the game files stay static: without that file
// (or with "signal": null) online play is simply switched off and offline pairing still works.
import { RtcConn } from './rtc';

export interface IceServer { urls: string | string[]; username?: string; credential?: string }

interface Config { signal: string | null }
let config: Promise<Config> | null = null;

/** Read multiplayer.json once. */
export function loadConfig(): Promise<Config> {
  config ??= fetch(new URL('multiplayer.json', location.href), { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : { signal: null }))
    .then((c: Partial<Config>) => ({ signal: typeof c.signal === 'string' && c.signal ? c.signal : null }))
    .catch(() => ({ signal: null }));
  return config;
}

/** The signaling service's address as http(s) and ws(s) base URLs, or null when online play isn't set up. */
async function bases() {
  const c = await loadConfig();
  if (!c.signal) return null;
  const http = new URL(c.signal.replace(/\/$/, '') + '/', location.href);
  const ws = new URL(http.href);
  ws.protocol = http.protocol === 'https:' ? 'wss:' : 'ws:';
  return { http: http.href, ws: ws.href };
}

export async function onlineAvailable() {
  return !!(await bases());
}

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function randomCode(n = 6) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}
/** Tidy a typed code (case, spaces, dashes). */
export function cleanCode(s: string) {
  return s.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Games hosted from the same network (same public address) that asked to be listed. */
export async function nearbyRooms(): Promise<{ code: string; name: string; players: number }[]> {
  const b = await bases();
  if (!b) return [];
  try {
    const r = await fetch(new URL('lan', b.http), { cache: 'no-store' });
    return r.ok ? ((await r.json()) as { rooms: { code: string; name: string; players: number }[] }).rooms ?? [] : [];
  } catch {
    return [];
  }
}

type Signal = { sdp?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit };

/** Peer connection settings. Debugging: localStorage 'mcw.relay' = '1' forces the TURN relay (tests, odd networks). */
function rtcConfig(ice: IceServer[]): RTCConfiguration {
  let relay = false;
  try { relay = localStorage.getItem('mcw.relay') === '1'; } catch { /* no storage */ }
  return { iceServers: ice as RTCIceServer[], iceTransportPolicy: relay ? 'relay' : 'all' };
}

function socket(url: string): Promise<{ ws: WebSocket; hello: { id: string; ice: IceServer[] } }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; ws.close(); reject(new Error("Couldn't reach the game service")); } }, 12000);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data as string);
      if (m.t === 'hello' && !done) { done = true; clearTimeout(timer); resolve({ ws, hello: m }); }
      else if (m.t === 'error' && !done) { done = true; clearTimeout(timer); reject(new Error(m.reason === 'no such room' ? 'No game with that code' : m.reason === 'room full' ? 'That game is full' : m.reason)); }
    };
    ws.onerror = () => { if (!done) { done = true; clearTimeout(timer); reject(new Error("Couldn't reach the game service")); } };
    ws.onclose = (e) => { if (!done) { done = true; clearTimeout(timer); reject(new Error(e.reason || 'Connection refused')); } };
  });
}

/** Hosting: a room others can join with its code. Each guest gets their own peer connection. */
export class RoomHost {
  private peers = new Map<string, RTCPeerConnection>();
  private ping = 0;
  closed = false;
  /** A guest's data channel is open. */
  onGuest: (conn: RtcConn) => void = () => {};
  /** The signaling connection dropped (new guests can't join until rehosting; current ones keep playing). */
  onLost: () => void = () => {};

  private constructor(public code: string, private key: string, private ws: WebSocket, private ice: IceServer[], private opts: { lan: boolean; name: string }) {
    ws.onmessage = (e) => this.message(JSON.parse(e.data as string));
    ws.onclose = () => { clearInterval(this.ping); if (!this.closed) this.onLost(); };
    this.ping = window.setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send('{"t":"ping"}');
      // stay listed among nearby games
      if (this.opts.lan) ws.send(JSON.stringify({ t: 'list', name: this.opts.name, players: this.players }));
    }, 25000);
  }
  players = 1;

  static async open(opts: { lan: boolean; name: string }): Promise<RoomHost> {
    const b = await bases();
    if (!b) throw new Error('Online play is not set up on this server');
    const key = randomCode(24);
    for (let tries = 0; tries < 5; tries++) {
      const code = randomCode();
      const q = new URLSearchParams({ role: 'host', key, ...(opts.lan ? { lan: '1', name: opts.name.slice(0, 32) } : {}) });
      try {
        const { ws, hello } = await socket(`${b.ws}room/${code}?${q}`);
        return new RoomHost(code, key, ws, hello.ice, opts);
      } catch (e) {
        if (!/taken/.test((e as Error).message)) throw e;
      }
    }
    throw new Error("Couldn't get a room code");
  }

  private send(to: string, data: Signal) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'signal', to, data }));
  }

  private async message(m: { t: string; id?: string; from?: string; data?: Signal }) {
    if (m.t === 'join' && m.id) {
      const id = m.id;
      const pc = new RTCPeerConnection(rtcConfig(this.ice));
      this.peers.set(id, pc);
      const dc = pc.createDataChannel('game', { ordered: true });
      const conn = new RtcConn(pc, dc);
      conn.onOpen = () => { this.peers.delete(id); this.onGuest(conn); };
      pc.onicecandidate = (e) => { if (e.candidate) this.send(id, { cand: e.candidate.toJSON() }); };
      // give up on guests that never get through
      setTimeout(() => { if (this.peers.get(id) === pc) { this.peers.delete(id); conn.close('timeout', false); } }, 50000);
      await pc.setLocalDescription(await pc.createOffer());
      this.send(id, { sdp: pc.localDescription!.toJSON() });
    } else if (m.t === 'signal' && m.from) {
      const pc = this.peers.get(m.from);
      if (!pc) return;
      try {
        if (m.data?.sdp) await pc.setRemoteDescription(m.data.sdp);
        else if (m.data?.cand) await pc.addIceCandidate(m.data.cand);
      } catch { /* a bad offer just fails that guest */ }
    } else if (m.t === 'leave' && m.id) {
      const pc = this.peers.get(m.id);
      if (pc) { this.peers.delete(m.id); pc.close(); }
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.ping);
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    this.ws.close();
  }
}

/** Joining: connect to the game with this code. Resolves once the data channel is open. */
export async function joinRoom(code: string, status: (s: string) => void = () => {}): Promise<RtcConn> {
  const b = await bases();
  if (!b) throw new Error('Online play is not set up on this server');
  status('Finding the game...');
  const { ws, hello } = await socket(`${b.ws}room/${cleanCode(code)}?role=guest`);
  status('Connecting to the host...');
  return new Promise<RtcConn>((resolve, reject) => {
    let pc: RTCPeerConnection | null = null;
    let done = false;
    const fail = (msg: string) => { if (done) return; done = true; clearTimeout(timer); ws.close(); pc?.close(); reject(new Error(msg)); };
    const timer = setTimeout(() => fail("Couldn't connect to the host (their network may block it)"), 45000);
    const pending: RTCIceCandidateInit[] = [];
    ws.onclose = () => { if (!done) fail('The host left'); };
    ws.onmessage = async (e) => {
      const m = JSON.parse(e.data as string) as { t: string; data?: Signal };
      if (m.t === 'closed') return fail('The host left');
      if (m.t !== 'signal' || !m.data) return;
      try {
        if (m.data.sdp) {
          pc = new RTCPeerConnection(rtcConfig(hello.ice));
          pc.onicecandidate = (ev) => { if (ev.candidate) ws.send(JSON.stringify({ t: 'signal', to: 'host', data: { cand: ev.candidate.toJSON() } })); };
          pc.ondatachannel = (ev) => {
            const conn = new RtcConn(pc!, ev.channel);
            const opened = () => { if (done) return; done = true; clearTimeout(timer); ws.close(); resolve(conn); };
            if (ev.channel.readyState === 'open') opened();
            else conn.onOpen = opened;
          };
          await pc.setRemoteDescription(m.data.sdp);
          for (const c of pending.splice(0)) await pc.addIceCandidate(c);
          await pc.setLocalDescription(await pc.createAnswer());
          ws.send(JSON.stringify({ t: 'signal', to: 'host', data: { sdp: pc.localDescription!.toJSON() } }));
        } else if (m.data.cand) {
          if (pc?.remoteDescription) await pc.addIceCandidate(m.data.cand);
          else pending.push(m.data.cand);
        }
      } catch {
        fail('The connection setup failed');
      }
    };
  });
}
