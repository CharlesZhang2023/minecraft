// A connection between the simulation (server) and a player's client. Messages are plain objects; typed
// arrays (chunk data) may ride along as top-level fields. Single-player uses an in-page loopback pair, other
// players a WebRTC data channel (net/rtc.ts). Both queue what arrives and hand it over on poll(), so each side
// handles messages at a point of its own choosing instead of in the middle of a tick.

export interface Msg { t: string; [k: string]: unknown }

export interface Conn {
  readonly kind: 'local' | 'rtc';
  send(m: Msg): void;
  /** Messages received since the last poll. */
  poll(): Msg[];
  /** Bytes queued but not yet sent (back-pressure for chunk streaming). */
  backlog(): number;
  closed: boolean;
  closeReason: string;
  close(reason?: string): void;
}

/** Two connected ends living in the same page. Messages are copied, so neither side can share objects with the other. */
export function loopbackPair(): [Conn, Conn] {
  const a = new LocalEnd(), b = new LocalEnd();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

class LocalEnd implements Conn {
  readonly kind = 'local';
  peer: LocalEnd | null = null;
  inbox: Msg[] = [];
  closed = false;
  closeReason = '';
  send(m: Msg) {
    if (this.closed || !this.peer) return;
    this.peer.inbox.push(structuredClone(m));
  }
  poll() {
    const r = this.inbox;
    this.inbox = [];
    return r;
  }
  backlog() { return 0; }
  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    const p = this.peer;
    if (p && !p.closed) { p.closed = true; p.closeReason = reason; }
  }
}

// ------------------------------------------------------------------ wire format (used by the WebRTC transport)
// A message is a JSON string unless it carries typed arrays; then it's binary:
//   u32 header length | header JSON ({...msg, $bin: {field: [type, byteOffset, byteLength]}}) | the arrays' bytes

const ARRAY_TYPES: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = { u8: Uint8Array, u16: Uint16Array, i32: Int32Array, f32: Float32Array };
function arrayType(v: ArrayBufferView): string | null {
  if (v instanceof Uint8Array) return 'u8';
  if (v instanceof Uint16Array) return 'u16';
  if (v instanceof Int32Array) return 'i32';
  if (v instanceof Float32Array) return 'f32';
  return null;
}

export function encodeMsg(m: Msg): string | Uint8Array {
  const bins: [string, ArrayBufferView][] = [];
  for (const [k, v] of Object.entries(m)) if (ArrayBuffer.isView(v) && arrayType(v)) bins.push([k, v]);
  if (!bins.length) return JSON.stringify(m);
  const head: Record<string, unknown> = { ...m, $bin: {} };
  let off = 0;
  for (const [k, v] of bins) {
    delete head[k];
    // keep each array aligned to its element size
    off = Math.ceil(off / 4) * 4;
    (head.$bin as Record<string, unknown>)[k] = [arrayType(v), off, v.byteLength];
    off += v.byteLength;
  }
  const hj = new TextEncoder().encode(JSON.stringify(head));
  const start = Math.ceil((4 + hj.length) / 4) * 4;
  const out = new Uint8Array(start + off);
  new DataView(out.buffer).setUint32(0, hj.length, true);
  out.set(hj, 4);
  for (const [k, v] of bins) {
    const [, o] = (head.$bin as Record<string, [string, number, number]>)[k];
    out.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), start + o);
  }
  return out;
}

export function decodeMsg(d: string | Uint8Array): Msg {
  if (typeof d === 'string') return JSON.parse(d) as Msg;
  const len = new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(d.subarray(4, 4 + len))) as Msg & { $bin: Record<string, [string, number, number]> };
  const start = Math.ceil((4 + len) / 4) * 4;
  const bins = head.$bin;
  delete (head as Partial<typeof head>).$bin;
  for (const [k, [type, o, n]] of Object.entries(bins)) {
    const C = ARRAY_TYPES[type];
    if (!C) continue;
    // copy out so the view owns an aligned buffer of its own
    const buf = d.slice(start + o, start + o + n).buffer;
    (head as Record<string, unknown>)[k] = new C(buf);
  }
  return head;
}
