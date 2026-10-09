// Minecraft's NBT (named binary tags), big-endian, as Java Edition writes it: read and write every tag type, with
// gzip / zlib handled by the browser's compression streams. Tags keep their exact types (an int stays an int,
// longs are BigInts), so a file read in and written back out says the same thing to the game that made it.

export type Tag =
  | { t: 'byte'; v: number }
  | { t: 'short'; v: number }
  | { t: 'int'; v: number }
  | { t: 'long'; v: bigint }
  | { t: 'float'; v: number }
  | { t: 'double'; v: number }
  | { t: 'bytes'; v: Int8Array }
  | { t: 'string'; v: string }
  | { t: 'list'; of: TagType; v: Tag[] }
  | { t: 'compound'; v: Record<string, Tag> }
  | { t: 'ints'; v: Int32Array }
  | { t: 'longs'; v: BigInt64Array };
export type TagType = Tag['t'] | 'end';
export type Compound = Extract<Tag, { t: 'compound' }>;
export type List = Extract<Tag, { t: 'list' }>;

const TYPES: TagType[] = ['end', 'byte', 'short', 'int', 'long', 'float', 'double', 'bytes', 'string', 'list', 'compound', 'ints', 'longs'];

// ------------------------------------------------------------------ building tags
export const byte = (v: number): Tag => ({ t: 'byte', v });
export const short = (v: number): Tag => ({ t: 'short', v });
export const int = (v: number): Tag => ({ t: 'int', v });
export const long = (v: bigint | number): Tag => ({ t: 'long', v: BigInt(v) });
export const float = (v: number): Tag => ({ t: 'float', v });
export const double = (v: number): Tag => ({ t: 'double', v });
export const str = (v: string): Tag => ({ t: 'string', v });
export const bytes = (v: Int8Array): Tag => ({ t: 'bytes', v });
export const ints = (v: Int32Array | number[]): Tag => ({ t: 'ints', v: v instanceof Int32Array ? v : Int32Array.from(v) });
export const longs = (v: BigInt64Array): Tag => ({ t: 'longs', v });
export const comp = (v: Record<string, Tag | undefined> = {}): Compound => {
  const out: Record<string, Tag> = {};
  for (const [k, t] of Object.entries(v)) if (t) out[k] = t;
  return { t: 'compound', v: out };
};
export const list = (of: TagType, v: Tag[]): List => ({ t: 'list', of: v.length ? of : 'end', v });
export const intList = (a: number[]) => list('int', a.map(int));
export const doubleList = (a: number[]) => list('double', a.map(double));

// ------------------------------------------------------------------ reading tags
export function get(c: Tag | undefined, k: string): Tag | undefined {
  return c?.t === 'compound' ? c.v[k] : undefined;
}
export function num(t: Tag | undefined, def = 0): number {
  if (!t) return def;
  switch (t.t) {
    case 'byte': case 'short': case 'int': case 'float': case 'double': return t.v;
    case 'long': return Number(t.v);
  }
  return def;
}
export function text(t: Tag | undefined, def = ''): string {
  return t?.t === 'string' ? t.v : def;
}
export function compound(t: Tag | undefined): Compound | undefined {
  return t?.t === 'compound' ? t : undefined;
}
export function items(t: Tag | undefined): Tag[] {
  return t?.t === 'list' ? t.v : [];
}
/** Three ints: an int array, a list of ints, or an {x, y, z} compound. */
export function vec3(t: Tag | undefined): [number, number, number] | null {
  if (!t) return null;
  if (t.t === 'ints' && t.v.length === 3) return [t.v[0], t.v[1], t.v[2]];
  if (t.t === 'list' && t.v.length === 3) return [num(t.v[0]), num(t.v[1]), num(t.v[2])];
  if (t.t === 'compound' && t.v.x && t.v.y && t.v.z) return [num(t.v.x), num(t.v.y), num(t.v.z)];
  return null;
}

// ------------------------------------------------------------------ binary
class Reader {
  private p = 0;
  private dv: DataView;
  constructor(private b: Uint8Array) { this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  private need(n: number) { if (this.p + n > this.b.length) throw new Error('NBT data ends too soon'); }
  u8() { this.need(1); return this.b[this.p++]; }
  i8() { this.need(1); return this.dv.getInt8(this.p++); }
  i16() { this.need(2); const v = this.dv.getInt16(this.p); this.p += 2; return v; }
  u16() { this.need(2); const v = this.dv.getUint16(this.p); this.p += 2; return v; }
  i32() { this.need(4); const v = this.dv.getInt32(this.p); this.p += 4; return v; }
  i64() { this.need(8); const v = this.dv.getBigInt64(this.p); this.p += 8; return v; }
  f32() { this.need(4); const v = this.dv.getFloat32(this.p); this.p += 4; return v; }
  f64() { this.need(8); const v = this.dv.getFloat64(this.p); this.p += 8; return v; }
  str() {
    const n = this.u16();
    this.need(n);
    const s = decodeMutf8(this.b, this.p, n);
    this.p += n;
    return s;
  }
  count() {
    const n = this.i32();
    if (n < 0 || n > 1 << 28) throw new Error('NBT array length out of range');
    return n;
  }
  payload(type: number, depth: number): Tag {
    if (depth > 512) throw new Error('NBT nested too deep');
    switch (type) {
      case 1: return { t: 'byte', v: this.i8() };
      case 2: return { t: 'short', v: this.i16() };
      case 3: return { t: 'int', v: this.i32() };
      case 4: return { t: 'long', v: this.i64() };
      case 5: return { t: 'float', v: this.f32() };
      case 6: return { t: 'double', v: this.f64() };
      case 7: {
        const n = this.count();
        this.need(n);
        const v = new Int8Array(n);
        v.set(new Int8Array(this.b.buffer, this.b.byteOffset + this.p, n));
        this.p += n;
        return { t: 'bytes', v };
      }
      case 8: return { t: 'string', v: this.str() };
      case 9: {
        const of = this.u8(), n = this.count();
        if (!TYPES[of]) throw new Error(`bad NBT list type ${of}`);
        const v: Tag[] = [];
        for (let i = 0; i < n; i++) v.push(this.payload(of, depth + 1));
        return { t: 'list', of: TYPES[of], v };
      }
      case 10: {
        const v: Record<string, Tag> = {};
        for (;;) {
          const ty = this.u8();
          if (ty === 0) break;
          const name = this.str();
          v[name] = this.payload(ty, depth + 1);
        }
        return { t: 'compound', v };
      }
      case 11: {
        const n = this.count();
        this.need(n * 4);
        const v = new Int32Array(n);
        for (let i = 0; i < n; i++) v[i] = this.i32();
        return { t: 'ints', v };
      }
      case 12: {
        const n = this.count();
        this.need(n * 8);
        const v = new BigInt64Array(n);
        for (let i = 0; i < n; i++) v[i] = this.i64();
        return { t: 'longs', v };
      }
    }
    throw new Error(`bad NBT tag type ${type}`);
  }
}

class Writer {
  buf = new Uint8Array(1 << 16);
  dv = new DataView(this.buf.buffer);
  p = 0;
  private room(n: number) {
    if (this.p + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.p + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf.subarray(0, this.p));
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }
  u8(v: number) { this.room(1); this.buf[this.p++] = v & 255; }
  i16(v: number) { this.room(2); this.dv.setInt16(this.p, v); this.p += 2; }
  i32(v: number) { this.room(4); this.dv.setInt32(this.p, v); this.p += 4; }
  i64(v: bigint) { this.room(8); this.dv.setBigInt64(this.p, v); this.p += 8; }
  str(s: string) {
    const b = encodeMutf8(s);
    if (b.length > 65535) throw new Error('NBT string too long');
    this.room(2 + b.length);
    this.dv.setUint16(this.p, b.length);
    this.p += 2;
    this.buf.set(b, this.p);
    this.p += b.length;
  }
  payload(t: Tag) {
    switch (t.t) {
      case 'byte': this.u8(t.v); break;
      case 'short': this.i16(t.v); break;
      case 'int': this.i32(t.v); break;
      case 'long': this.i64(BigInt.asIntN(64, t.v)); break;
      case 'float': this.room(4); this.dv.setFloat32(this.p, t.v); this.p += 4; break;
      case 'double': this.room(8); this.dv.setFloat64(this.p, t.v); this.p += 8; break;
      case 'bytes': this.i32(t.v.length); this.room(t.v.length); this.buf.set(new Uint8Array(t.v.buffer, t.v.byteOffset, t.v.length), this.p); this.p += t.v.length; break;
      case 'string': this.str(t.v); break;
      case 'list': {
        const of = t.v.length ? t.v[0].t : 'end';
        this.u8(TYPES.indexOf(t.v.length ? of : t.of === 'end' ? 'end' : t.of));
        this.i32(t.v.length);
        for (const e of t.v) {
          if (e.t !== of) throw new Error(`NBT list of ${of} holds a ${e.t}`);
          this.payload(e);
        }
        break;
      }
      case 'compound':
        for (const [k, e] of Object.entries(t.v)) {
          this.u8(TYPES.indexOf(e.t));
          this.str(k);
          this.payload(e);
        }
        this.u8(0);
        break;
      case 'ints': this.i32(t.v.length); this.room(t.v.length * 4); for (const x of t.v) { this.dv.setInt32(this.p, x); this.p += 4; } break;
      case 'longs': this.i32(t.v.length); this.room(t.v.length * 8); for (const x of t.v) { this.dv.setBigInt64(this.p, x); this.p += 8; } break;
    }
  }
}

/** Java's "modified UTF-8": a NUL is two bytes, characters outside the BMP are their two surrogates encoded apart. */
function decodeMutf8(b: Uint8Array, start: number, n: number): string {
  let s = '';
  const end = start + n;
  for (let i = start; i < end;) {
    const c = b[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if ((c & 0xe0) === 0xc0) s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else { const c2 = b[i++], c3 = b[i++]; s += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f)); }
  }
  return s;
}
function encodeMutf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 1 && c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

/** The root tag of uncompressed NBT data, and its name. */
export function parse(data: Uint8Array): { name: string; root: Compound } {
  const r = new Reader(data);
  const type = r.u8();
  if (type !== 10) throw new Error('not NBT data (the first tag is not a compound)');
  const name = r.str();
  return { name, root: r.payload(10, 0) as Compound };
}

export function write(root: Compound, name = ''): Uint8Array {
  const w = new Writer();
  w.u8(10);
  w.str(name);
  w.payload(root);
  return w.buf.slice(0, w.p);
}

// ------------------------------------------------------------------ compression
async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
/** Undo gzip or zlib if the data has it (Java writes NBT files gzipped, sometimes not compressed at all). */
export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (data[0] === 0x1f && data[1] === 0x8b) return pipe(data, new DecompressionStream('gzip'));
  if (data[0] === 0x78 && (data[0] * 256 + data[1]) % 31 === 0) return pipe(data, new DecompressionStream('deflate'));
  return data;
}
export const gzip = (data: Uint8Array) => pipe(data, new CompressionStream('gzip'));

/** Read a (possibly compressed) NBT file. */
export async function readFile(data: Uint8Array) {
  return parse(await inflate(data));
}
/** Write a gzipped NBT file. */
export async function writeFile(root: Compound, name = ''): Promise<Uint8Array> {
  return gzip(write(root, name));
}

// ------------------------------------------------------------------ JSON (game data embedded in files)
/** NBT to plain JSON-safe values (for showing, or for data that came from JSON). Longs become numbers. */
export function toPlain(t: Tag): unknown {
  switch (t.t) {
    case 'long': return Number(t.v);
    case 'bytes': case 'ints': return [...t.v];
    case 'longs': return [...t.v].map(Number);
    case 'list': return t.v.map(toPlain);
    case 'compound': { const o: Record<string, unknown> = {}; for (const [k, e] of Object.entries(t.v)) o[k] = toPlain(e); return o; }
    default: return t.v;
  }
}
