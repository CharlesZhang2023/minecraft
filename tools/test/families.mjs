// Block families in a running world: doors, trapdoors and gates open by hand (iron ones don't) and follow redstone,
// slabs merge into a double slab that drops two, stairs turn corners, blocks placed in water hold it, buttons press
// and spring back, two-block plants stand up, and leaves of every wood drop their own sapling.
//   node tools/test/families.mjs   (dev server on MC_PORT, default 5177)
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 99, mode: 0, time: 6000 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

// a stone floor in the sky with the player standing next to it
const base = await t.sim((g, p) => {
  const w = g.world, x0 = Math.floor(p.x) + 3, y0 = 140, z0 = Math.floor(p.z);
  for (let x = -6; x <= 12; x++) for (let z = -6; z <= 12; z++) { w.set(x0 + x, y0 - 1, z0 + z, 1); for (let y = 0; y < 5; y++) w.set(x0 + x, y0 + y, z0 + z, 0); }
  p.setPos(x0 - 4, y0, z0 - 4);
  return [x0, y0, z0];
});
const [X, Y, Z] = base;

/** Place a block the way a player does: a click on the top face of the floor below the target cell. */
const place = (name, x, y, z, opts = {}) => t.page.evaluate(async ([name, x, y, z, opts]) => {
  const { itemByName, stack } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const it = itemByName(name);
    const held = stack(it.id, 4);
    p.inventory.main[p.inventory.selected] = held;
    if (opts.yaw !== undefined) p.yaw = opts.yaw;
    const face = opts.face ?? 3;
    const d = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][face];
    const hit = { x: x - d[0], y: y - d[1], z: z - d[2], face, t: 1, hx: x + 0.5, hy: y - d[1] + (opts.hitY ?? 0.5), hz: z + 0.5 };
    const r = g.interact.placeBlock(hit, held, it);
    return { r, v: g.world.get(x, y, z), up: g.world.get(x, y + 1, z) };
  });
}, [name, x, y, z, opts]);
const use = (x, y, z) => t.sim((g, p, [x, y, z]) => { p.inventory.main[p.inventory.selected] = null; const v = g.world.get(x, y, z); return g.interact.activateBlock({ x, y, z, face: 3, t: 1, hx: x + 0.5, hy: y + 1, hz: z + 0.5 }, v & 0xfff, v); }, [x, y, z]);
const get = (x, y, z) => t.sim((g, p, [x, y, z]) => g.world.get(x, y, z), [x, y, z]);
const ticks = (n) => t.sim((g, p, n) => { for (let i = 0; i < n; i++) g.tick(); }, n);
const ids = await t.run(({ blocks }) => {
  const n = (s) => blocks.BLOCKS.findIndex((b) => b.name === s);
  return { door: n('spruce_door'), iron: n('iron_door'), trap: n('acacia_trapdoor'), gate: n('birch_fence_gate'), slab: n('andesite_slab'), stairs: n('granite_stairs'), button: n('jungle_button'), lever: blocks.B.LEVER, water: blocks.B.WATER, sunflower: n('sunflower'), fence: n('crimson_fence') };
});
const id = (v) => v & 0xfff, meta = (v) => v >>> 12;

// doors
let r = await place('spruce_door', X, Y, Z, { yaw: 0 });
ok(r.r && id(r.v) === ids.door && id(r.up) === ids.door && meta(r.up) & 8, 'door: both halves placed');
await use(X, Y + 1, Z);
ok(meta(await get(X, Y, Z)) & 4, 'door: opens by hand (clicking the top half)');
await use(X, Y, Z);
ok(!(meta(await get(X, Y, Z)) & 4), 'door: closes again');
r = await place('iron_door', X + 2, Y, Z, { yaw: 0 });
await use(X + 2, Y, Z);
ok(!(meta(await get(X + 2, Y, Z)) & 4), 'iron door: a hand does nothing');
await t.run(({ blocks }, [x, y, z]) => window.sim((g) => g.world.set(x, y, z, blocks.B.REDSTONE_BLOCK)), [X + 3, Y, Z]);
await ticks(4);
ok(meta(await get(X + 2, Y, Z)) & 4, 'iron door: redstone opens it');
await t.sim((g, p, [x, y, z]) => g.world.set(x, y, z, 0), [X + 3, Y, Z]);
await ticks(4);
ok(!(meta(await get(X + 2, Y, Z)) & 4), 'iron door: closes when the power goes');
// trapdoor and gate
await place('acacia_trapdoor', X + 4, Y, Z);
await use(X + 4, Y, Z);
ok(meta(await get(X + 4, Y, Z)) & 8, 'trapdoor: opens by hand');
await place('birch_fence_gate', X + 6, Y, Z, { yaw: 0 });
await use(X + 6, Y, Z);
ok(meta(await get(X + 6, Y, Z)) & 4, 'gate: opens by hand');
// slabs
r = await place('andesite_slab', X, Y, Z + 3);
ok(r.r && id(r.v) === ids.slab && meta(r.v) === 0, 'slab: bottom half');
r = await t.page.evaluate(async ([x, y, z]) => {
  const { itemByName, stack } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const it = itemByName('andesite_slab'), held = stack(it.id, 4);
    p.inventory.main[p.inventory.selected] = held;
    g.interact.placeBlock({ x, y, z, face: 3, t: 1, hx: x + 0.5, hy: y + 0.5, hz: z + 0.5 }, held, it);
    return g.world.get(x, y, z);
  });
}, [X, Y, Z + 3]);
ok(meta(r) === 2, 'slab: a second one on top makes a double slab');
const drops = await t.run(({ items }, [v]) => { const { Random } = { Random: class { next() { return 0.5; } int() { return 0; } } }; return items.blockDrops(v & 0xfff, v >>> 12, items.getItem(items.TOOLS.diamond_pickaxe), new Random()).map((s) => s.count); }, [r]);
ok(drops[0] === 2, 'slab: a double slab drops two');
// stairs corners
await place('granite_stairs', X, Y, Z + 6, { yaw: 180 });
await place('granite_stairs', X + 1, Y, Z + 6, { yaw: 180 });
await place('granite_stairs', X + 1, Y, Z + 5, { yaw: 90 });
const shape = await t.page.evaluate(async ([x, y, z]) => {
  const m = await import('/src/world/models.ts');
  return window.sim((g) => m.stairShape(g.world.get(x, y, z) >>> 12, (dx, dy, dz) => g.world.get(x + dx, y + dy, z + dz)));
}, [X + 1, Y, Z + 6]);
ok(shape !== 0, `stairs: a stair meeting another at a right angle turns a corner (shape ${shape})`);
// waterlogging
await t.run(({ blocks }, [x, y, z]) => window.sim((g) => g.world.set(x, y, z, blocks.B.WATER)), [X + 4, Y, Z + 6]);
r = await place('granite_stairs', X + 4, Y, Z + 6, { yaw: 0 });
ok(r.r && meta(r.v) & 8, 'stairs placed in water hold it (waterlogged)');
const logged = await t.run(({ blocks }, v) => blocks.WATERLOGGED[v], r.v);
ok(logged === 1, 'waterlogged state is water for fluids and swimming');
// buttons
await place('jungle_button', X + 6, Y, Z + 3);
await use(X + 6, Y, Z + 3);
ok(meta(await get(X + 6, Y, Z + 3)) & 8, 'button: pressed');
const powered = await t.sim((g, p, [x, y, z]) => g.redstone.isPowered(x, y - 1, z), [X + 6, Y, Z + 3]);
ok(powered, 'button: powers the block it is on');
await ticks(35);
ok(!(meta(await get(X + 6, Y, Z + 3)) & 8), 'button: a wooden button springs back after 30 ticks');
// two-block plants
await t.run(({ blocks }, [x, y, z]) => window.sim((g) => g.world.set(x, y - 1, z, blocks.B.GRASS)), [X + 8, Y, Z + 3]);
r = await place('sunflower', X + 8, Y, Z + 3);
ok(r.r && id(r.up) === ids.sunflower && meta(r.up) === 8, 'sunflower: two blocks tall');
// fences connect across nether and overworld wood
await place('crimson_fence', X + 8, Y, Z + 6);
await place('oak_fence', X + 9, Y, Z + 6);
const conn = await t.page.evaluate(async ([x, y, z]) => {
  const m = await import('/src/world/models.ts');
  return window.sim((g) => m.modelBoxes(g.world.get(x, y, z), (dx, dy, dz) => g.world.get(x + dx, y + dy, z + dz)).length);
}, [X + 8, Y, Z + 6]);
ok(conn === 3, `fence: crimson and oak fences join (${conn} boxes)`);
// leaves: every wood drops its own sapling
const saps = await t.run(({ blocks, items }) => {
  const out = {};
  for (const k of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak']) {
    const w = blocks.WOOD[k];
    let got = 0;
    const rng = { n: 0, next() { return 0; }, int() { return 0; }, bool() { return true; } };
    for (const s of items.blockDrops(w.leaves, 0, undefined, rng)) if (s.id === w.sapling) got++;
    out[k] = got;
  }
  return out;
});
ok(Object.values(saps).every((n) => n === 1), 'leaves drop their own saplings ' + JSON.stringify(saps));
ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
