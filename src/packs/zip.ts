// Reading .zip files (resource packs, shader packs) in the browser: the central directory is parsed here and each
// file is inflated on demand with the browser's DecompressionStream. No ZIP64 or encryption (packs don't use them).

export interface ZipEntry { name: string; method: number; csize: number; size: number; offset: number }

export class ZipArchive {
  readonly entries = new Map<string, ZipEntry>();
  private bytes: Uint8Array;
  private dv: DataView;

  constructor(data: ArrayBuffer) {
    this.bytes = new Uint8Array(data);
    this.dv = new DataView(data);
    const n = this.bytes.length;
    // the end-of-central-directory record: within the last 64 KB (it may be followed by a comment)
    let eocd = -1;
    for (let i = n - 22; i >= Math.max(0, n - 65557); i--) if (this.dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a zip file');
    const count = this.dv.getUint16(eocd + 10, true);
    let p = this.dv.getUint32(eocd + 16, true);
    if (count > 50000) throw new Error('Too many files in the zip');
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (p + 46 > n || this.dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged zip (central directory)');
      const method = this.dv.getUint16(p + 10, true);
      const csize = this.dv.getUint32(p + 20, true), size = this.dv.getUint32(p + 24, true);
      const nameLen = this.dv.getUint16(p + 28, true), extraLen = this.dv.getUint16(p + 30, true), commentLen = this.dv.getUint16(p + 32, true);
      const offset = this.dv.getUint32(p + 42, true);
      const name = dec.decode(this.bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
      if (!name.endsWith('/')) this.entries.set(name, { name, method, csize, size, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  /** The archive's file names. */
  names() { return [...this.entries.keys()]; }

  has(name: string) { return this.entries.has(name); }

  /** A file's bytes (null when it isn't there). */
  async read(name: string): Promise<Uint8Array | null> {
    const e = this.entries.get(name);
    if (!e) return null;
    const p = e.offset;
    if (this.dv.getUint32(p, true) !== 0x04034b50) throw new Error(`Damaged zip (${name})`);
    const start = p + 30 + this.dv.getUint16(p + 26, true) + this.dv.getUint16(p + 28, true);
    const raw = this.bytes.subarray(start, start + e.csize);
    if (e.method === 0) return raw;
    if (e.method !== 8) throw new Error(`${name}: unsupported compression`);
    if (e.size > 64 * 1024 * 1024) throw new Error(`${name} is too big`);
    const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async text(name: string): Promise<string | null> {
    const b = await this.read(name);
    return b ? new TextDecoder().decode(b).replace(/^﻿/, '') : null;
  }
}

/** A PNG (or any image the browser reads) as RGBA pixels, not premultiplied. */
export async function decodeImage(bytes: Uint8Array): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  bmp.close();
  return { w: c.width, h: c.height, data: d };
}
