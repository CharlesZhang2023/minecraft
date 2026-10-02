// Offline pairing: two devices on the same Wi-Fi or hotspot connect without any server. The host shows a code
// (as a QR code or text), the joining device reads it and shows its reply, the host reads that, and WebRTC
// connects them directly over the local network.
//
// A full WebRTC offer is ~2 KB of text, too much for a comfortable QR code, so only what can't be guessed is
// kept (ICE credentials, the DTLS fingerprint, which side starts DTLS, and the local network candidates) and the
// rest of the session description is rebuilt on the other side.
import { RtcConn } from './rtc';

const PREFIX = 'MCW1';

interface Compact {
  /** o = offer, a = answer */
  k: 'o' | 'a';
  u: string; // ice-ufrag
  p: string; // ice-pwd
  f: string; // sha-256 fingerprint, hex without colons
  s: string; // setup: actpass / active / passive
  c: [string, number, string][]; // candidates: address, port, type (host / srflx)
}

function compact(sdp: string, kind: 'o' | 'a'): Compact {
  const line = (k: string) => sdp.match(new RegExp(`^a=${k}:(.+)$`, 'm'))?.[1].trim() ?? '';
  const cands: [string, number, string][] = [];
  for (const m of sdp.matchAll(/^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ (host|srflx)/gim)) {
    if (cands.length < 6 && !cands.some((c) => c[0] === m[1] && c[1] === +m[2])) cands.push([m[1], +m[2], m[3]]);
  }
  return { k: kind, u: line('ice-ufrag'), p: line('ice-pwd'), f: line('fingerprint').replace(/^sha-256\s+/i, '').replace(/:/g, ''), s: line('setup'), c: cands };
}

function expand(c: Compact): RTCSessionDescriptionInit {
  const fp = c.f.match(/../g)!.join(':').toUpperCase();
  const lines = [
    'v=0', `o=- ${Date.now()} 2 IN IP4 127.0.0.1`, 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    ...c.c.map(([addr, port, typ], i) => `a=candidate:${i + 1} 1 udp ${typ === 'host' ? 2122260223 - i : 1686052607 - i} ${addr} ${port} typ ${typ}${typ === 'srflx' ? ' raddr 0.0.0.0 rport 0' : ''}`),
    'a=end-of-candidates', `a=ice-ufrag:${c.u}`, `a=ice-pwd:${c.p}`, `a=fingerprint:sha-256 ${fp}`, `a=setup:${c.s}`, 'a=mid:0',
    'a=sctp-port:5000', 'a=max-message-size:262144', '',
  ];
  return { type: c.k === 'o' ? 'offer' : 'answer', sdp: lines.join('\r\n') };
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (ch) => ch.charCodeAt(0));

async function deflate(s: string) {
  const r = new Response(new Blob([s]).stream().pipeThrough(new CompressionStream('deflate-raw')));
  return new Uint8Array(await r.arrayBuffer());
}
async function inflate(b: Uint8Array) {
  return new Response(new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
}

/** The text form of a pairing code (what the QR code holds). */
async function encode(c: Compact) {
  return PREFIX + b64(await deflate(JSON.stringify(c)));
}
async function decode(text: string, want: 'o' | 'a'): Promise<Compact> {
  const t = text.trim().replace(/\s+/g, '');
  if (!t.startsWith(PREFIX)) throw new Error("That isn't a pairing code from this game");
  let c: Compact;
  try {
    c = JSON.parse(await inflate(unb64(t.slice(PREFIX.length))));
  } catch {
    throw new Error('The code is incomplete or mistyped');
  }
  if (c.k !== want) throw new Error(want === 'o' ? "That's a reply code: scan the host's code" : "That's a host code: scan the reply from the joining device");
  if (!c.c?.length) throw new Error('The other device has no local network address (are both on the same Wi-Fi?)');
  return c;
}

/** Wait until every local address has been found (no server: nothing more will trickle in later). */
function gathered(pc: RTCPeerConnection) {
  return new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, 3000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } });
  });
}

/** Host side: a code to show; feed it the reply to get the connection. */
export async function hostPairing(): Promise<{ code: string; accept(reply: string): Promise<RtcConn>; cancel(): void }> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel('game', { ordered: true });
  const conn = new RtcConn(pc, dc);
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const code = await encode(compact(pc.localDescription!.sdp, 'o'));
  return {
    code,
    async accept(reply: string) {
      const c = await decode(reply, 'a');
      await pc.setRemoteDescription(expand(c));
      return opened(conn, 20000);
    },
    cancel() { conn.close('cancelled', false); },
  };
}

/** Joining side: read the host's code, show the reply; the connection opens once the host has read it. */
export async function joinPairing(hostCode: string): Promise<{ code: string; conn: Promise<RtcConn>; cancel(): void }> {
  const c = await decode(hostCode, 'o');
  const pc = new RTCPeerConnection({ iceServers: [] });
  let conn: RtcConn | null = null;
  const ready = new Promise<RtcConn>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("The host didn't connect (scan the reply on the host within 2 minutes)")), 120000);
    pc.ondatachannel = (e) => {
      conn = new RtcConn(pc, e.channel);
      const go = () => { clearTimeout(t); resolve(conn!); };
      if (e.channel.readyState === 'open') go();
      else conn.onOpen = go;
    };
  });
  await pc.setRemoteDescription(expand(c));
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  const code = await encode(compact(pc.localDescription!.sdp, 'a'));
  return { code, conn: ready, cancel() { (conn as RtcConn | null)?.close('cancelled', false); pc.close(); } };
}

function opened(conn: RtcConn, ms: number) {
  return new Promise<RtcConn>((resolve, reject) => {
    if (conn.open) return resolve(conn);
    const t = setTimeout(() => reject(new Error("Couldn't reach the other device (are both on the same network?)")), ms);
    conn.onOpen = () => { clearTimeout(t); resolve(conn); };
  });
}
