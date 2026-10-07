// An End city in a running world: travel to the End, fly out to the nearest city with a ship, and check it's there
// (purpur, shulkers on the walls, the elytra in its frame, loot in the chests). Pictures in output/tests.
//   node tools/test/endcity.mjs [seed]
import { openWorld, wait } from './browser.mjs';

const seed = Number(process.argv[2] ?? 99);
const t = await openWorld({ seed, mode: 1 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
// pick a city with a ship (the generator is a pure function)
const city = await t.page.evaluate(async (seed) => {
  const { EndGen } = await import('/src/world/endgen.ts');
  const { END_CITY } = await import('/src/world/structures/end.ts');
  const { regionStart } = await import('/src/world/structure.ts');
  const g = new EndGen(seed);
  let best = null;
  for (let ring = 3; ring < 14 && !best; ring++)
    for (let rx = -ring; rx <= ring && !best; rx++) for (let rz = -ring; rz <= ring && !best; rz++) {
      const s = regionStart(END_CITY, g, rx, rz);
      if (s && s.pieces.some((p) => p.box.y1 - p.box.y0 === 18)) best = { x: s.x, y: s.y, z: s.z, box: s.box, ship: s.pieces.find((p) => p.box.y1 - p.box.y0 === 18).box };
    }
  return best;
}, seed);
ok(!!city, 'found an End city with a ship ' + JSON.stringify(city && { x: city.x, y: city.y, z: city.z }));
await t.travel('end');
await t.page.evaluate(([x, y, z]) => window.sim((g, p) => { p.flying = true; p.setPos(x + 0.5, y + 30, z + 0.5); }), [city.x, city.y, city.z]);
await wait(3000);
await t.settle(8000);
const sx = (city.ship.x0 + city.ship.x1) / 2, sz = (city.ship.z0 + city.ship.z1) / 2;
const found = await t.page.evaluate(([x0, y0, z0, x1, y1, z1]) => window.sim((g) => {
  const w = g.world;
  let purpur = 0, chests = 0;
  for (let x = x0; x <= x1; x += 2) for (let z = z0; z <= z1; z += 2) for (let y = y0; y <= y1; y++) {
    const id = w.getId(x, y, z);
    if (w.getId(x, y, z) && /purpur/.test(window.__mc.BLOCKS[id].name)) purpur++;
  }
  for (const c of w.chunks.values()) for (const t of c.tiles.values()) if (t.type === 'chest' && t.items?.some((s) => s)) chests++;
  const shulkers = g.entities.filter((e) => e.typeName === 'Shulker').length;
  const frames = g.entities.filter((e) => e.typeName === 'Item Frame');
  return { purpur, chests, shulkers, frames: frames.length, elytra: frames.some((f) => f.item && window.__mc.ITEMS.get(f.item.id)?.name === 'elytra') };
}), [city.box.x0, city.box.y0, city.box.z0, city.box.x1, city.box.y1, city.box.z1]);
console.log(found);
ok(found.purpur > 100, 'the city is built of purpur');
ok(found.shulkers > 0, 'shulkers guard it');
ok(found.chests > 0, 'its chests hold loot');
ok(found.elytra, 'the ship carries the elytra in an item frame');
await t.look(city.x - 30, city.y + 25, city.z - 30, -45, 25, 75);
await wait(1500);
await t.shot('endcity');
await t.look(sx - 18, city.ship.y0 + 14, sz - 18, -45, 20, 70);
await wait(1500);
await t.shot('endcity-ship');
ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
