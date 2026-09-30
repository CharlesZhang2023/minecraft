import { WorldGen } from '../src/world/worldgen';
import { buildChunk } from '../src/world/mesher';
import { BIOMES } from '../src/world/biomes';
import { BLOCKS } from '../src/world/blocks';
import { writeFileSync } from 'fs';

const seed = Number(process.argv[2] ?? 12345);
const g = new WorldGen(seed);
let t = performance.now();
const N = 6;
const chunks: Record<string, { blocks: Uint16Array; biomes: Uint8Array }> = {};
for (let cx = -N; cx < N; cx++) for (let cz = -N; cz < N; cz++) chunks[cx + ',' + cz] = g.generate(cx, cz);
const genMs = (performance.now() - t) / (4 * N * N);
console.log('gen ms/chunk', genMs.toFixed(2));
t = performance.now();
let quads = 0, n = 0;
for (let cx = -N + 1; cx < N - 1; cx++) for (let cz = -N + 1; cz < N - 1; cz++) {
  const cs: Uint16Array[] = [], bs: Uint8Array[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const c = chunks[(cx + dx) + ',' + (cz + dz)]; cs.push(c.blocks); bs.push(c.biomes); }
  const r = buildChunk(cs, bs);
  quads += r.opaque.byteLength / 64 + r.trans.byteLength / 64; n++;
}
console.log('mesh ms/chunk', ((performance.now() - t) / n).toFixed(2), 'avg quads', (quads / n).toFixed(0));
// biome counts
const counts: Record<string, number> = {};
const blockCounts: Record<string, number> = {};
for (const c of Object.values(chunks)) { for (const b of c.biomes) counts[BIOMES[b].name] = (counts[BIOMES[b].name] ?? 0) + 1; for (const v of c.blocks) { const nm = BLOCKS[v & 0xfff].name; blockCounts[nm] = (blockCounts[nm] ?? 0) + 1; } }
console.log(counts);
console.log(Object.entries(blockCounts).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => k + ':' + v).join(' '));

// large-scale biome/height map (1 px = 8 blocks)
const W = 256;
const img = Buffer.alloc(W * W * 3);
for (let pz = 0; pz < W; pz++) for (let px = 0; px < W; px++) {
  const x = (px - W / 2) * 8, z = (pz - W / 2) * 8;
  const p = g.params(x, z);
  const sh = Math.round(p.base);
  const bi = g.biomeAt(x, z, sh, p);
  const cols: Record<string, number> = { Ocean: 0x2040a0, 'Frozen Ocean': 0x7090d0, Beach: 0xe0d8a0, Plains: 0x80c060, Desert: 0xf0e090, 'Windswept Hills': 0x808080, Forest: 0x207020, 'Birch Forest': 0x60a060, Taiga: 0x306050, 'Snowy Plains': 0xf0f0f0, 'Snowy Taiga': 0xa0c0b0, River: 0x3070f0, Swamp: 0x405030, 'Snowy Beach': 0xf0f0e0, 'Frozen River': 0xa0c0f0, Savanna: 0xb0a040, 'Flower Forest': 0x40a040 };
  let c = cols[BIOMES[bi].name] ?? 0xff00ff;
  const shadeF = Math.min(1.3, Math.max(0.5, 0.6 + (sh - 40) / 150));
  const i = (pz * W + px) * 3;
  img[i] = Math.min(255, ((c >> 16) & 255) * shadeF); img[i + 1] = Math.min(255, ((c >> 8) & 255) * shadeF); img[i + 2] = Math.min(255, (c & 255) * shadeF);
}
writeFileSync('shots/biomes.ppm', Buffer.concat([Buffer.from(`P6 ${W} ${W} 255\n`), img]));
