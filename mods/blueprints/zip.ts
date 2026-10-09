// Zip archives, read and written in the browser (a Java world travels as a folder, or a .zip of one). Reading
// takes only the parts of a File it needs, so a large world isn't loaded whole; entries are stored or deflated
// (and Zip64 sizes and offsets are understood). Writing deflates each file.

export interface Archive {
  /** Every file's path (folders end in /), forward slashes. */
  readonly names: string[];
  read(name: string): Promise<Uint8Array>;
}

interface Entry { method: number; csize: number; size: number; local: number }

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 2 ** 32;

async function slice(f: Blob, a: number, b: number) { return new Uint8Array(await f.slice(a, b).arrayBuffer()); }
async function pipe(data: Uint8Array, s: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(s)).arrayBuffer());
}

/** Open a zip file. */
export async function openZip(f: Blob): Promise<Archive> {
  // the end-of-directory record is in the last 64 KiB
  const tailStart = Math.max(0, f.size - 65558);
  const tail = await slice(f, tailStart, f.size);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  let count = u16(tail, eocd + 10), cdSize = u32(tail, eocd + 12), cdOff = u32(tail, eocd + 16);
  // Zip64: the locator sits just before
  if (cdOff === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && u32(tail, loc) === 0x07064b50) {
      const z = await slice(f, u64(tail, loc + 8), u64(tail, loc + 8) + 56);
      count = u64(z, 32); cdSize = u64(z, 40); cdOff = u64(z, 48);
    }
  }
  const cd = await slice(f, cdOff, cdOff + cdSize);
  const entries = new Map<string, Entry>();
  const utf8 = new TextDecoder();
  for (let p = 0, k = 0; k < count && p + 46 <= cd.length; k++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const method = u16(cd, p + 10);
    let csize = u32(cd, p + 20), size = u32(cd, p + 24);
    const nlen = u16(cd, p + 28), xlen = u16(cd, p + 30), clen = u16(cd, p + 32);
    let local = u32(cd, p + 42);
    const name = utf8.decode(cd.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');
    // Zip64 extra field: the sizes and offset that didn't fit
    for (let x = p + 46 + nlen; x + 4 <= p + 46 + nlen + xlen;) {
      const id = u16(cd, x), len = u16(cd, x + 2);
      if (id === 1) {
        let q = x + 4;
        if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
        if (csize === 0xffffffff) { csize = u64(cd, q); q += 8; }
        if (local === 0xffffffff) { local = u64(cd, q); }
      }
      x += 4 + len;
    }
    entries.set(name, { method, csize, size, local });
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: [...entries.keys()],
    async read(name: string) {
      const e = entries.get(name);
      if (!e) throw new Error(`${name} isn't in the zip`);
      const head = await slice(f, e.local, e.local + 30);
      const start = e.local + 30 + u16(head, 26) + u16(head, 28);
      const data = await slice(f, start, start + e.csize);
      if (e.method === 0) return data;
      if (e.method === 8) return pipe(data, new DecompressionStream('deflate-raw'));
      throw new Error(`${name} is compressed in a way this can't read (method ${e.method})`);
    },
  };
}

/** A folder picked in the browser (input with webkitdirectory): files by their path inside it. */
export function folderArchive(files: File[]): Archive {
  const map = new Map<string, File>();
  for (const f of files) map.set((f.webkitRelativePath || f.name).replace(/\\/g, '/'), f);
  return {
    names: [...map.keys()],
    async read(name: string) {
      const f = map.get(name);
      if (!f) throw new Error(`${name} isn't in the folder`);
      return new Uint8Array(await f.arrayBuffer());
    },
  };
}

// ------------------------------------------------------------------ writing
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Builds a zip one file at a time (each deflated as it's added), then hands back the whole as a Blob. */
export class ZipWriter {
  private parts: BlobPart[] = [];
  private central: Uint8Array[] = [];
  private offset = 0;
  private count = 0;

  async add(name: string, data: Uint8Array) {
    const nameB = new TextEncoder().encode(name);
    const comp = await pipe(data, new CompressionStream('deflate-raw'));
    const stored = comp.length >= data.length;
    const body = stored ? data : comp;
    const crc = crc32(data);
    if (this.offset + body.length > 0xfffffff0 || data.length > 0xfffffff0) throw new Error('The world is too big for a zip (4 GB)');
    const local = new Uint8Array(30 + nameB.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, stored ? 0 : 8, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, body.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameB.length, true);
    local.set(nameB, 30);
    const cen = new Uint8Array(46 + nameB.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, stored ? 0 : 8, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, this.offset, true);
    cen.set(nameB, 46);
    this.parts.push(local as BlobPart, body as BlobPart);
    this.central.push(cen);
    this.offset += local.length + body.length;
    this.count++;
  }

  finish(): Blob {
    const cdSize = this.central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, this.count, true); ev.setUint16(10, this.count, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...(this.central as BlobPart[]), end as BlobPart], { type: 'application/zip' });
  }
}
