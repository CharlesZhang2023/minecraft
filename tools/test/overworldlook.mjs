// Overworld structures in a running world: fly to the nearest of each, let it load, check its chests got their loot,
// and take a picture of it (output/tests/ow-<type>.png).
//   node tools/test/overworldlook.mjs [seed] [type,type,...]
import { openWorld, wait } from './browser.mjs';

const seed = Number(process.argv[2] ?? 1234);
const only = process.argv[3]?.split(',');
const t = await openWorld({ seed, mode: 1 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
const starts = await t.page.evaluate(async ([seed, only]) => {
  const { WorldGen } = await import('/src/world/worldgen.ts');
  const { OVERWORLD_STRUCTURES } = await import('/src/world/structures/overworld.ts');
  const { nearestStart } = await import('/src/world/structure.ts');
  const g = new WorldGen(seed);
  const out = [];
  for (const s of OVERWORLD_STRUCTURES) {
    if (only && !only.includes(s.name)) continue;
    if (!only && ['buried_treasure', 'mineshaft', 'fossil'].includes(s.name)) continue; // underground: nothing to see
    const st = nearestStart(s, g, 0, 0, 30);
    if (st) out.push({ type: s.name, x: st.x, y: st.y, z: st.z, box: st.box });
  }
  return out;
}, [seed, only]);
for (const s of starts) {
  const { box } = s;
  const mx = (box.x0 + box.x1) / 2, mz = (box.z0 + box.z1) / 2, size = Math.max(box.x1 - box.x0, box.z1 - box.z0);
  await t.page.evaluate(([x, y, z]) => window.sim((g, p) => { p.flying = true; p.setPos(x, y, z); }), [mx, s.y + 20, mz]);
  await wait(2500);
  await t.settle(6000, 20000);
  const found = await t.page.evaluate(([x0, y0, z0, x1, y1, z1]) => window.sim((g) => {
    let chests = 0, full = 0, blocks = 0;
    for (const c of g.world.chunks.values()) for (const [i, tl] of c.tiles) {
      const x = c.cx * 16 + (i & 15), z = c.cz * 16 + ((i >> 4) & 15), y = i >> 8;
      if (x < x0 - 1 || x > x1 + 1 || z < z0 - 1 || z > z1 + 1 || y < y0 - 1 || y > y1 + 1) continue;
      if (tl.type === 'chest' || tl.type === 'dispenser') { chests++; if (tl.items?.some((q) => q)) full++; }
    }
    for (let x = x0; x <= x1; x += 2) for (let z = z0; z <= z1; z += 2) for (let y = y0; y <= y1; y++) if (g.world.getId(x, y, z)) blocks++;
    return { chests, full, blocks };
  }), [box.x0, box.y0, box.z0, box.x1, box.y1, box.z1]);
  console.log(s.type, s.x, s.y, s.z, found);
  if (found.chests) ok(found.full === found.chests, `${s.type}: its chests hold loot (${found.full}/${found.chests})`);
  const d = Math.max(22, size * 1.1);
  await t.look(mx - d * 0.6, s.y + d * 0.85, mz - d * 0.6, -45, 45, 70);
  await wait(1200);
  await t.shot('ow-' + s.type);
}
ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
