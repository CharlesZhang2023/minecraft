import { buildChunk } from '../src/world/mesher';
import { B } from '../src/world/blocks';
const mk = () => new Uint16Array(16 * 16 * 256);
const chunks = Array.from({ length: 9 }, mk);
const biomes = Array.from({ length: 9 }, () => new Uint8Array(256));
// floor at y=60 everywhere, torch at centre chunk (8,61,8)
for (const c of chunks) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y <= 60; y++) c[x | (z << 4) | (y << 8)] = B.STONE;
chunks[4][8 | (8 << 4) | (61 << 8)] = B.TORCH;
// roof to block sky at y=70 over centre chunk
for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunks[4][x | (z << 4) | (70 << 8)] = B.STONE;
const r = buildChunk(chunks, biomes);
const L = (x: number, y: number, z: number) => { const v = r.light[x | (z << 4) | (y << 8)]; return [v >> 4, v & 15]; };
console.log('torch cell', L(8, 61, 8), 'next', L(9, 61, 8), L(12, 61, 8), 'above', L(8, 62, 8), 'far', L(0, 61, 0));
console.log('verts', r.opaque.byteLength / 16);
// find a vertex near the torch on the floor top face (y=61)
const u8 = new Uint8Array(r.opaque), u16 = new Uint16Array(r.opaque);
let shown = 0;
for (let v = 0; v < r.opaque.byteLength / 16 && shown < 6; v++) {
  const x = u16[v * 8] / 16 - 16, y = u16[v * 8 + 1] / 16 - 16, z = u16[v * 8 + 2] / 16 - 16;
  if (y === 61 && Math.abs(x - 9) < 1.1 && Math.abs(z - 8) < 1.1) { console.log('vtx', x, y, z, 'sky', u8[v * 16 + 10] / 16, 'blk', u8[v * 16 + 11] / 16); shown++; }
}
