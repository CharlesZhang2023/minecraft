// Java Edition's region files (Anvil, r.<x>.<z>.mca): 32 x 32 chunks each, behind a table of where each one's
// 4 KiB sectors start. A chunk is a length, a compression byte (1 gzip, 2 zlib, 3 none, 4 LZ4) and its NBT; one
// too big for the file lives in c.<x>.<z>.mcc beside it.
import * as N from './nbt';
import type { Compound } from './nbt';

const SECTOR = 4096;

async function pipe(data: Uint8Array, s: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(s)).arrayBuffer());
}

/** Region file name and the chunk's place in it. */
export const regionName = (cx: number, cz: number) => `r.${cx >> 5}.${cz >> 5}.mca`;

/** The chunks present in a region file: [index (x + z * 32), sector offset, sector count]. */
export function regionChunks(data: Uint8Array): [number, number, number][] {
  const out: [number, number, number][] = [];
  if (data.length < 2 * SECTOR) return out;
  for (let i = 0; i < 1024; i++) {
    const off = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2], n = data[i * 4 + 3];
    if (off >= 2 && n > 0 && off * SECTOR < data.length) out.push([i, off, n]);
  }
  return out;
}

/**
 * One chunk's NBT from a region file (null if it's in a form this can't read). `external` reads the .mcc file a
 * large chunk was moved to.
 */
export async function readRegionChunk(data: Uint8Array, off: number, external?: () => Promise<Uint8Array | null>): Promise<Compound | null> {
  const p = off * SECTOR;
  if (p + 5 > data.length) return null;
  const len = ((data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3]) >>> 0;
  const type = data[p + 4];
  let body: Uint8Array | null;
  if (type & 128) body = external ? await external() : null;
  else body = data.subarray(p + 5, p + 4 + len);
  if (!body) return null;
  let raw: Uint8Array;
  switch (type & 127) {
    case 1: raw = await pipe(body, new DecompressionStream('gzip')); break;
    case 2: raw = await pipe(body, new DecompressionStream('deflate')); break;
    case 3: raw = body; break;
    default: return null; // LZ4 (a server setting) or a custom format
  }
  return N.parse(raw).root;
}

/** Builds a region file from chunks' NBT (zlib, like the game). */
export class RegionWriter {
  private chunks = new Map<number, Uint8Array>();
  /** Add chunk (cx, cz) (anywhere in this region). */
  async add(cx: number, cz: number, nbt: Compound) {
    const z = await pipe(N.write(nbt), new CompressionStream('deflate'));
    this.chunks.set((cx & 31) + (cz & 31) * 32, z);
  }
  get size() { return this.chunks.size; }
  finish(): Uint8Array {
    let sectors = 2;
    const placed: [number, number, number, Uint8Array][] = [];
    for (const [i, z] of this.chunks) {
      const n = Math.ceil((z.length + 5) / SECTOR);
      if (n > 255) continue; // over a megabyte: never from this game
      placed.push([i, sectors, n, z]);
      sectors += n;
    }
    const out = new Uint8Array(sectors * SECTOR);
    const dv = new DataView(out.buffer);
    const now = Math.floor(Date.now() / 1000);
    for (const [i, off, n, z] of placed) {
      out[i * 4] = off >> 16; out[i * 4 + 1] = (off >> 8) & 255; out[i * 4 + 2] = off & 255; out[i * 4 + 3] = n;
      dv.setUint32(SECTOR + i * 4, now);
      const p = off * SECTOR;
      dv.setUint32(p, z.length + 1);
      out[p + 4] = 2;
      out.set(z, p + 5);
    }
    return out;
  }
}
