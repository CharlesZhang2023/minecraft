// A Conn over a WebRTC data channel (peer to peer, encrypted by DTLS).
// Every message goes as binary frames: big ones are deflated and split into 16 KB pieces (the size every browser
// agrees on), and the receiving side puts them back together in order.
import { Conn, Msg, encodeMsg, decodeMsg } from './conn';

const PIECE = 16 * 1024;
const COMPRESS_OVER = 1024;
const enum Kind { Whole = 1, Piece = 2 }
const enum Enc { Json = 1, Binary = 2, Deflated = 3 }

const canDeflate = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function pipe(data: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(t));
  return new Uint8Array(await out.arrayBuffer());
}

export class RtcConn implements Conn {
  readonly kind = 'rtc';
  closed = false;
  closeReason = '';
  private inbox: Msg[] = [];
  private sending: Promise<void> = Promise.resolve();
  private receiving: Promise<void> = Promise.resolve();
  private pieces = new Map<number, { total: number; got: Uint8Array[]; n: number }>();
  private nextId = 1;
  /** Bytes handed to the send queue that the channel hasn't taken yet. */
  private queued = 0;
  onOpen: () => void = () => {};

  constructor(public pc: RTCPeerConnection, public dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 256 * 1024;
    dc.onopen = () => this.onOpen();
    dc.onmessage = (e) => this.frame(new Uint8Array(e.data as ArrayBuffer));
    dc.onclose = () => this.close('Connection closed');
    dc.onerror = () => this.close('Connection error');
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.close('Connection lost');
    });
  }

  get open() { return this.dc.readyState === 'open'; }

  send(m: Msg) {
    if (this.closed) return;
    const enc = encodeMsg(m);
    const bytes = typeof enc === 'string' ? new TextEncoder().encode(enc) : enc;
    this.queued += bytes.length;
    const kind = typeof enc === 'string' ? Enc.Json : Enc.Binary;
    // in order, even though compression is asynchronous
    this.sending = this.sending.then(() => this.ship(bytes, kind)).catch(() => this.close('Send failed'));
  }

  private async ship(bytes: Uint8Array, kind: Enc) {
    this.queued -= bytes.length;
    if (this.closed || this.dc.readyState !== 'open') return;
    let body: Uint8Array;
    if (bytes.length > COMPRESS_OVER && canDeflate) {
      const z = await pipe(bytes, new CompressionStream('deflate-raw'));
      body = new Uint8Array(z.length + 2);
      body[0] = Enc.Deflated;
      body[1] = kind;
      body.set(z, 2);
    } else {
      body = new Uint8Array(bytes.length + 1);
      body[0] = kind;
      body.set(bytes, 1);
    }
    // don't let a slow link pile up megabytes inside the browser
    while (this.dc.bufferedAmount > 1024 * 1024 && this.dc.readyState === 'open') await new Promise((r) => setTimeout(r, 20));
    if (body.length + 1 <= PIECE) {
      const f = new Uint8Array(body.length + 1);
      f[0] = Kind.Whole;
      f.set(body, 1);
      this.dc.send(f);
      return;
    }
    const id = this.nextId++, total = Math.ceil(body.length / (PIECE - 9));
    for (let i = 0; i < total; i++) {
      const part = body.subarray(i * (PIECE - 9), (i + 1) * (PIECE - 9));
      const f = new Uint8Array(part.length + 9);
      const v = new DataView(f.buffer);
      f[0] = Kind.Piece;
      v.setUint32(1, id, true);
      v.setUint16(5, i, true);
      v.setUint16(7, total, true);
      f.set(part, 9);
      this.dc.send(f);
    }
  }

  private frame(f: Uint8Array) {
    if (this.closed || f.length < 2) return;
    let body: Uint8Array | null = null;
    if (f[0] === Kind.Whole) body = f.subarray(1);
    else if (f[0] === Kind.Piece && f.length > 9) {
      const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
      const id = v.getUint32(1, true), i = v.getUint16(5, true), total = v.getUint16(7, true);
      if (total > 4096 || i >= total) return this.close('Bad message');
      let p = this.pieces.get(id);
      if (!p) { p = { total, got: [], n: 0 }; this.pieces.set(id, p); }
      if (!p.got[i]) { p.got[i] = f.slice(9); p.n++; }
      if (p.n < p.total) return;
      this.pieces.delete(id);
      const len = p.got.reduce((s, x) => s + x.length, 0);
      body = new Uint8Array(len);
      let o = 0;
      for (const x of p.got) { body.set(x, o); o += x.length; }
    }
    if (!body) return;
    const b = body;
    // decode in arrival order (inflating is asynchronous)
    this.receiving = this.receiving.then(async () => {
      let enc = b[0], data = b.subarray(1);
      if (enc === Enc.Deflated) {
        enc = data[0];
        data = await pipe(data.subarray(1), new DecompressionStream('deflate-raw'));
      }
      const m = decodeMsg(enc === Enc.Json ? new TextDecoder().decode(data) : data);
      if (m && m.t === 'bye') { this.close(String(m.reason ?? 'Disconnected'), false); return; }
      if (m && typeof m.t === 'string') this.inbox.push(m);
    }).catch(() => this.close('Bad message'));
  }

  poll() {
    const r = this.inbox;
    this.inbox = [];
    return r;
  }

  backlog() { return this.queued + this.dc.bufferedAmount; }

  /** Hang up; `tell` lets the other side know why (kicked, server closed...) before the channel goes. */
  close(reason = 'closed', tell = true) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    const end = () => {
      try { this.dc.close(); } catch { /* already closed */ }
      try { this.pc.close(); } catch { /* already closed */ }
    };
    if (tell && this.dc.readyState === 'open') {
      try {
        const body = new TextEncoder().encode(JSON.stringify({ t: 'bye', reason }));
        const f = new Uint8Array(body.length + 2);
        f[0] = Kind.Whole;
        f[1] = Enc.Json;
        f.set(body, 2);
        this.dc.send(f);
      } catch { /* closing anyway */ }
      setTimeout(end, 300);
    } else end();
  }
}
