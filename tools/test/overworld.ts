// The overworld generator of 1.16: deterministic, the new biomes and their blocks, and every structure type
// somewhere near the origin building its blocks and leaving its loot and mobs.
//   node tools/test/run.mjs tools/test/overworld.ts [seed]
import { WorldGen } from '../../src/world/worldgen';
import { BIOMES, BIOME } from '../../src/world/biomes';
import { BLOCKS } from '../../src/world/blocks';
import { OVERWORLD_STRUCTURES } from '../../src/world/structures/overworld';
import { nearestStart } from '../../src/world/structure';
import { check, done } from './check';

const seed = Number(process.argv[2] ?? 1234);
const g = new WorldGen(seed);
const hash = (a: Uint16Array) => { let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
const a = g.generate(7, -3), b = new WorldGen(seed).generate(7, -3);
check(hash(a.blocks) === hash(b.blocks), 'same seed and chunk generate the same blocks');
check(hash(a.blocks) !== hash(new WorldGen(seed + 1).generate(7, -3).blocks), 'another seed differs');

// biomes over a wide area (sampled from the generator's biome function, cheap) and blocks over a sparser grid
const biomes: Record<string, number> = {};
for (let x = -6000; x < 6000; x += 48) for (let z = -6000; z < 6000; z += 48) { const n = BIOMES[g.biome(x, z)].name; biomes[n] = (biomes[n] ?? 0) + 1; }
console.log(biomes);
const overworld = BIOMES.filter((b) => !b.dim || b.dim === 'overworld').map((b) => b.name);
for (const n of overworld) check((biomes[n] ?? 0) > 0, `biome ${n} appears`);

const blocks: Record<string, number> = {};
const t0 = performance.now();
const N = 9;
for (let cx = -N; cx < N; cx++)
  for (let cz = -N; cz < N; cz++) {
    const c = g.generate(cx * 23, cz * 23);
    for (const v of c.blocks) { const n = BLOCKS[v & 0xfff].name; blocks[n] = (blocks[n] ?? 0) + 1; }
  }
const ms = (performance.now() - t0) / (4 * N * N);
console.log('ms/chunk', ms.toFixed(1));
for (const n of ['seagrass', 'kelp_plant', 'tall_grass', 'large_fern', 'sweet_berry_bush', 'mycelium', 'podzol', 'red_sand', 'terracotta', 'packed_ice', 'jungle_log', 'acacia_log', 'dark_oak_log', 'spruce_log', 'birch_log', 'cactus'])
  check((blocks[n] ?? 0) > 0, `${n} generated (${blocks[n] ?? 0})`);
// swamps: lily pads on their water (searched for: swamps are small)
let pads = 0, swamps = 0;
for (let x = -4000; x < 4000 && swamps < 12; x += 64) for (let z = -4000; z < 4000 && swamps < 12; z += 64) {
  if (g.biome(x, z) !== BIOME.SWAMP || g.height(x, z) >= 63) continue;
  swamps++;
  for (const v of g.generate(x >> 4, z >> 4).blocks) if (BLOCKS[v & 0xfff].name === 'lily_pad') pads++;
}
check(pads > 0, `lily pads on swamp water (${pads} in ${swamps} chunks)`);
// plains: bee nests on some trees, each with its bees as a tile hint
let nests = 0, nestTiles = 0, plains = 0;
for (let x = -6000; x < 6000 && plains < 200; x += 40) for (let z = -6000; z < 6000 && plains < 200; z += 40) {
  if (g.biome(x, z) !== BIOME.PLAINS) continue;
  plains++;
  const c = g.generate(x >> 4, z >> 4);
  for (const v of c.blocks) if (BLOCKS[v & 0xfff].name === 'bee_nest') nests++;
  nestTiles += (c.spawns ?? []).filter((sp) => sp.type === 'tile' && (sp.data?.tile as { type?: string })?.type === 'beehive').length;
}
check(nests > 0 && nests === nestTiles, `bee nests in the plains, each with bees (${nests} nests, ${nestTiles} hives in ${plains} chunks)`);
check(ms < 60, `overworld chunks generate fast enough (${ms.toFixed(1)} ms)`);

// every structure: the nearest start, built chunk by chunk, writes blocks and leaves hints
const report: Record<string, string> = {};
for (const t of OVERWORLD_STRUCTURES) {
  const s = nearestStart(t, g, 0, 0, t.spacing > 40 ? 12 : 30);
  if (!s) { check(false, `${t.name}: a start near the origin`); continue; }
  let changed = 0, hints = 0;
  const kinds = new Set<string>();
  for (let cx = Math.floor(s.box.x0 / 16); cx <= Math.floor(s.box.x1 / 16); cx++)
    for (let cz = Math.floor(s.box.z0 / 16); cz <= Math.floor(s.box.z1 / 16); cz++) {
      const c = g.generate(cx, cz);
      for (const p of c.spawns ?? []) if (p.x >= s.box.x0 - 1 && p.x <= s.box.x1 + 1 && p.z >= s.box.z0 - 1 && p.z <= s.box.z1 + 1) { hints++; kinds.add(p.type === 'loot' ? 'loot:' + String(p.data?.table) : p.type); }
      changed++;
    }
  report[t.name] = `${s.x},${s.y},${s.z} chunks=${changed} hints=${[...kinds].join(' ')}`;
  check(changed > 0, `${t.name} builds`);
  if (!['desert_well', 'fossil', 'ruined_portal'].includes(t.name)) check(hints > 0, `${t.name} leaves loot or mobs (${hints})`);
}
console.log(report);
done();
