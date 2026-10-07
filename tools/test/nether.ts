// The 1.16 Nether generator: deterministic, five biomes, their blocks, ancient debris, bastions and fossils.
//   node tools/test/run.mjs tools/test/nether.ts [seed]
import { NetherGen } from '../../src/world/nethergen';
import { BIOMES } from '../../src/world/biomes';
import { BLOCKS, B, B2, STONE2 } from '../../src/world/blocks';
import { BASTION, NETHER_FOSSIL } from '../../src/world/structures/nether';
import { regionStart } from '../../src/world/structure';
import { check, done } from './check';

const seed = Number(process.argv[2] ?? 1234);
const g = new NetherGen(seed);
const hash = (a: Uint16Array) => { let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
// determinism: same chunk twice (and from a fresh generator) is the same
const a = g.generate(3, -5), b = new NetherGen(seed).generate(3, -5);
check(hash(a.blocks) === hash(b.blocks), 'same seed and chunk generate the same blocks');
check(hash(a.blocks) !== hash(new NetherGen(seed + 1).generate(3, -5).blocks), 'another seed differs');

const biomes: Record<string, number> = {};
const blocks: Record<string, number> = {};
const N = 10;
const t0 = performance.now();
for (let cx = -N; cx < N; cx++)
  for (let cz = -N; cz < N; cz++) {
    const c = g.generate(cx * 3, cz * 3);
    for (const v of c.biomes) biomes[BIOMES[v].name] = (biomes[BIOMES[v].name] ?? 0) + 1;
    for (const v of c.blocks) { const n = BLOCKS[v & 0xfff].name; blocks[n] = (blocks[n] ?? 0) + 1; }
  }
const ms = (performance.now() - t0) / (4 * N * N);
console.log('ms/chunk', ms.toFixed(1));
console.log(biomes);
const want = ['Nether Wastes', 'Soul Sand Valley', 'Crimson Forest', 'Warped Forest', 'Basalt Deltas'];
for (const w of want) check((biomes[w] ?? 0) > 0, `biome ${w} appears`);
for (const n of ['ancient_debris', 'nether_gold_ore', 'nether_quartz_ore', 'crimson_nylium', 'warped_nylium', 'soul_soil', 'basalt', 'blackstone', 'crimson_stem', 'warped_stem', 'shroomlight', 'nether_wart_block', 'warped_wart_block', 'weeping_vines', 'twisting_vines_plant', 'crimson_roots', 'warped_roots'])
  check((blocks[n] ?? 0) > 0, `${n} generated (${blocks[n] ?? 0})`);
check((blocks.ancient_debris ?? 0) < (blocks.nether_gold_ore ?? 0) / 4, 'ancient debris is rare');
check(ms < 40, `nether chunks generate fast enough (${ms.toFixed(1)} ms)`);
// structures exist nearby and generate their blocks
let bastions = 0, fossils = 0;
let first = null as ReturnType<typeof regionStart>;
for (let rx = -6; rx < 6; rx++) for (let rz = -6; rz < 6; rz++) { const st = regionStart(BASTION, g, rx, rz); if (st) { bastions++; first ??= st; } if (regionStart(NETHER_FOSSIL, g, rx, rz)) fossils++; }
console.log('bastions', bastions, 'fossils', fossils);
check(bastions > 10, `bastions start in many regions (${bastions}/144)`);
check(fossils > 0, `fossils in soul sand valleys (${fossils})`);
const s = first!;
let gilded = 0, spawns = 0;
for (let cx = Math.floor(s.box.x0 / 16); cx <= Math.floor(s.box.x1 / 16); cx++)
  for (let cz = Math.floor(s.box.z0 / 16); cz <= Math.floor(s.box.z1 / 16); cz++) {
    const c = g.generate(cx, cz);
    for (const v of c.blocks) if ((v & 0xfff) === STONE2.POLISHED_BLACKSTONE_BRICKS || (v & 0xfff) === STONE2.GILDED_BLACKSTONE) gilded++;
    spawns += (c.spawns ?? []).filter((p) => p.type === 'piglin' || p.type === 'piglin_brute' || p.type === 'hoglin' || p.type === 'loot').length;
  }
check(gilded > 500, `a bastion builds its blackstone (${gilded})`);
check(spawns > 3, `a bastion leaves piglins, hoglins and loot chests (${spawns})`);
void B; void B2;
done();
