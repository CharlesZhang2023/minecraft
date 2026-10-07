// Pictures of the Nether's biomes: travel there and look around at a few places picked by biome.
//   node tools/test/netherlook.mjs [seed]
import { openWorld, wait } from './browser.mjs';
const seed = Number(process.argv[2] ?? 1234);
const t = await openWorld({ seed, mode: 1 });
await t.travel('nether');
// find a column of each biome near the player (the generator is a pure function; ask it directly)
const spots = await t.page.evaluate(async (seed) => {
  const { NetherGen } = await import('/src/world/nethergen.ts');
  const { BIOMES } = await import('/src/world/biomes.ts');
  const g = new NetherGen(seed);
  const want = ['Crimson Forest', 'Warped Forest', 'Soul Sand Valley', 'Basalt Deltas', 'Nether Wastes'];
  const found = {};
  for (let r = 0; r < 600 && Object.keys(found).length < want.length; r += 24)
    for (let a = 0; a < 16; a++) {
      const x = Math.round(Math.cos(a / 16 * Math.PI * 2) * r), z = Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
      const n = BIOMES[g.biomeAt(x, z)].name;
      if (!found[n] && Math.abs(g.biomeAt(x + 40, z) - g.biomeAt(x, z)) === 0) found[n] = [x, z];
    }
  return found;
}, seed);
console.log(spots);
for (const [name, [x, z]] of Object.entries(spots)) {
  await t.page.evaluate(([x, z]) => window.sim((g, p) => { p.setPos(x + 0.5, 70, z + 0.5); p.flying = true; }), [x, z]);
  await wait(1500);
  await t.settle(4000);
  await t.look(x + 0.5, 72, z + 20.5, 180, 15, 80);
  await wait(800);
  await t.shot('nether-' + name.replace(/ /g, '_').toLowerCase());
  await t.look(null);
}
console.log('errors', t.errors.slice(0, 5));
await t.close();
