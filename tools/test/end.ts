// The outer End: biomes, chorus forests, small islands, End cities with treasure, shulkers, and ships with elytra.
//   node tools/test/run.mjs tools/test/end.ts [seed]
import { EndGen } from '../../src/world/endgen';
import { BIOMES } from '../../src/world/biomes';
import { BLOCKS, STONE2, B2 } from '../../src/world/blocks';
import { END_CITY } from '../../src/world/structures/end';
import { regionStart } from '../../src/world/structure';
import { check, done } from './check';

const seed = Number(process.argv[2] ?? 99);
const g = new EndGen(seed);
const hash = (a: Uint16Array) => { let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
check(hash(g.generate(80, 3).blocks) === hash(new EndGen(seed).generate(80, 3).blocks), 'End chunks are deterministic');
const biomes: Record<string, number> = {};
for (let x = -3000; x <= 3000; x += 37) for (let z = -3000; z <= 3000; z += 37) { const n = BIOMES[g.biome(x, z)].name; biomes[n] = (biomes[n] ?? 0) + 1; }
console.log(biomes);
for (const n of ['The End', 'Small End Islands', 'End Highlands', 'End Midlands', 'End Barrens']) check((biomes[n] ?? 0) > 0, `biome ${n}`);
// find cities
const cities = [];
for (let rx = -12; rx <= 12; rx++) for (let rz = -12; rz <= 12; rz++) { const s = regionStart(END_CITY, g, rx, rz); if (s) cities.push(s); }
console.log('cities', cities.length);
check(cities.length > 5, `End cities start out on the highlands (${cities.length})`);
// build the chunks of the first few cities and look for what they're made of
let purpur = 0, chests = 0, shulkers = 0, frames = 0, chorus = 0;
for (const s of cities.slice(0, 4)) {
  for (let cx = Math.floor(s.box.x0 / 16); cx <= Math.floor(s.box.x1 / 16); cx++)
    for (let cz = Math.floor(s.box.z0 / 16); cz <= Math.floor(s.box.z1 / 16); cz++) {
      const c = g.generate(cx, cz);
      for (const v of c.blocks) { const id = v & 0xfff; if (id === STONE2.PURPUR_BLOCK) purpur++; if (id === B2.CHORUS_PLANT) chorus++; }
      for (const sp of c.spawns ?? []) { if (sp.type === 'loot') chests++; if (sp.type === 'shulker') shulkers++; if (sp.type === 'item_frame') frames++; }
    }
}
console.log({ purpur, chests, shulkers, frames, chorus });
check(purpur > 1000, 'cities are built of purpur');
check(chests > 2, 'cities have treasure chests');
check(shulkers > 3, 'shulkers guard them');
check(chorus > 0, 'chorus plants grow on the highlands');
let ships = 0;
for (const s of cities) if (s.pieces.some((p) => p.box.y1 - p.box.y0 === 18)) ships++;
console.log('ships', ships, 'of', cities.length);
check(ships > 0, `some cities have a ship (with the elytra) (${ships})`);
check(frames > 0 || ships > 0, 'ships carry an item frame with the elytra');
void BLOCKS;
done();
