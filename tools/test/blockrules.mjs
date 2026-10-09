// Block rules and vehicles of 1.9-1.16 in a running world: concrete powder setting in water, the basalt generator,
// bubble columns, honey and magma underfoot, berry bushes, minecarts with chests/furnaces/hoppers/TNT, boats of
// every wood.
//   node tools/test/blockrules.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 0 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
const run = (fn, args) => t.page.evaluate(async ([src, a]) => {
  const m = { blocks: await import('/src/world/blocks.ts'), items: await import('/src/game/items.ts') };
  return window.sim((g, p) => (0, eval)(src)(g, p, m, a));
}, [fn.toString(), args ?? null]);
// a clear spot in the air above the player for each experiment
const spot = (g, p, dx, dz) => { const x = Math.floor(p.x) + dx, y = Math.floor(p.y) + 40, z = Math.floor(p.z) + dz; for (let a = -3; a <= 3; a++) for (let b = -1; b <= 6; b++) for (let c = -3; c <= 3; c++) g.world.set(x + a, y + b, z + c, b === -1 ? 1 : 0); return [x, y, z]; };

const concrete = await run((g, p, { blocks }) => {
  const s = (dx, dz) => { const x = Math.floor(p.x) + dx, y = Math.floor(p.y) + 40, z = Math.floor(p.z) + dz; for (let a = -3; a <= 3; a++) for (let b = -1; b <= 6; b++) for (let c = -3; c <= 3; c++) g.world.set(x + a, y + b, z + c, b === -1 ? 1 : 0); return [x, y, z]; };
  const [x, y, z] = s(10, 0), w = g.world;
  w.set(x + 1, y, z, blocks.B.WATER);
  w.set(x, y, z, blocks.CONCRETE_POWDER[14]);
  g.ticker.neighborChanged(x, y, z);
  return w.getId(x, y, z) === blocks.CONCRETE[14];
});
ok(concrete, 'red concrete powder next to water sets into red concrete');

const basalt = await run((g, p, { blocks }) => {
  const x = Math.floor(p.x) - 10, y = Math.floor(p.y) + 40, z = Math.floor(p.z), w = g.world;
  for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) { w.set(x + a, y - 1, z + c, blocks.B2.SOUL_SOIL); w.set(x + a, y, z + c, 0); }
  w.set(x + 1, y, z, blocks.B2.BLUE_ICE);
  w.set(x, y, z, blocks.pack(blocks.B.LAVA, 1));
  g.ticker.lavaMix(x, y, z);
  return w.getId(x, y, z) === blocks.STONE2.BASALT;
});
ok(basalt, 'lava over soul soil beside blue ice turns to basalt');

const bubbles = await run((g, p, { blocks }) => {
  const x = Math.floor(p.x) + 20, y = Math.floor(p.y) + 40, z = Math.floor(p.z), w = g.world;
  for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 6; b++) w.set(x + a, y + b, z + c, blocks.B.WATER); }
  w.set(x, y - 1, z, blocks.B.SOUL_SAND);
  g.ticker.neighborChanged(x, y - 1, z);
  const col = [0, 1, 2, 3, 4, 5].filter((b) => w.getId(x, y + b, z) === blocks.B2.BUBBLE_COLUMN).length;
  const sq = g.interact.spawnMob('cod', x + 0.5, y + 1, z + 0.5);
  sq.noAi = true;
  const y0 = sq.y;
  for (let i = 0; i < 10; i++) sq.tick();
  return { col, rose: sq.y - y0 };
});
ok(bubbles.col === 6, `soul sand raises a bubble column through the water (${bubbles.col})`);
ok(bubbles.rose > 0.5, `which carries things up (${bubbles.rose.toFixed(2)})`);

const ground = await run((g, p, { blocks }) => {
  const x = Math.floor(p.x), y = Math.floor(p.y) + 50, z = Math.floor(p.z) + 20, w = g.world;
  for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) { w.set(x + a, y - 1, z + c, blocks.B.MAGMA_BLOCK); for (let b = 0; b < 3; b++) w.set(x + a, y + b, z + c, 0); }
  const zb = g.interact.spawnMob('pig', x + 0.5, y, z + 0.5);
  zb.noAi = true;
  for (let i = 0; i < 40; i++) { zb.invulnerable = 0; zb.tick(); }
  const burnt = zb.health < zb.maxHealth;
  w.set(x + 2, y - 1, z, blocks.B.DIRT); w.set(x + 2, y, z, blocks.pack(blocks.B2.SWEET_BERRY_BUSH, 2));
  const pig2 = g.interact.spawnMob('cow', x + 2.5, y + 1, z + 0.5);
  pig2.noAi = true;
  for (let i = 0; i < 30; i++) pig2.tick();
  pig2.px = pig2.x - 0.1;
  pig2.invulnerable = 0;
  const h = pig2.health;
  pig2.environment();
  return { burnt, pricked: pig2.health < h };
});
ok(ground.burnt, 'magma blocks burn what stands on them');
ok(ground.pricked, 'sweet berry bushes prick what moves through them');

const carts = await run((g, p, { blocks, items }) => {
  const x = Math.floor(p.x) - 20, y = Math.floor(p.y) + 40, z = Math.floor(p.z) + 10, w = g.world;
  for (let a = -12; a <= 12; a++) for (let c = -2; c <= 2; c++) { w.set(x + a, y - 1, z + c, 1); w.set(x + a, y, z + c, 0); w.set(x + a, y + 1, z + c, 0); }
  for (let a = -12; a <= 12; a++) w.set(x + a, y, z, blocks.pack(blocks.B.RAIL, 1));
  const out = {};
  // chest cart: contents spill when it's broken
  p.inventory.main[p.inventory.selected] = items.stack(items.I7.CHEST_MINECART);
  const place = (kind, dx) => { const c = new (g.entities.find((e) => e.typeName?.startsWith('Minecart'))?.constructor ?? Object)(); void c; void kind; void dx; };
  void place;
  const mk = (kind, dx) => { const C = window.__Minecart; const c = new C(w, g); c.setKind(kind); c.setPos(x + dx + 0.5, y + 0.0625, z + 0.5); g.addEntity(c); return c; };
  return { x, y, z, mkOk: typeof mk };
});
// the Minecart class from the game's own module graph
await t.page.evaluate(async () => { const m = await import('/src/entity/minecart.ts'); window.__Minecart = m.Minecart; });
const cart = await run((g, p, { blocks, items }, [x, y, z]) => {
  const w = g.world;
  const mk = (kind, dx) => { const c = new window.__Minecart(w, g); c.setKind(kind); c.setPos(x + dx + 0.5, y + 0.0625, z + 0.5); g.addEntity(c); return c; };
  const chest = mk('chest', -10);
  chest.items[0] = items.stack(items.I.DIAMOND, 5);
  const before = g.entities.filter((e) => e.item?.id === items.I.DIAMOND).length;
  chest.damageTaken = 100; chest.attacked(false);
  const spilled = g.entities.filter((e) => e.item?.id === items.I.DIAMOND).length > before;
  const furnace = mk('furnace', -5);
  p.setPos(x - 6.5, y, z + 0.5);
  p.inventory.main[p.inventory.selected] = items.stack(items.I.COAL, 2);
  furnace.interact(g, p.inventory.held());
  const fx = furnace.x;
  for (let i = 0; i < 40; i++) furnace.tick();
  const pushed = furnace.x - fx;
  const hopper = mk('hopper', 2);
  const it = g.dropItem(hopper.x, hopper.y + 0.6, hopper.z, items.stack(items.I.APPLE, 3));
  it.pickupDelay = 0;
  for (let i = 0; i < 8; i++) { hopper.age = i * 4; hopper.tick(); }
  const collected = hopper.items.some((s) => s && s.id === items.I.APPLE);
  w.set(x + 8, y - 1, z, blocks.B.REDSTONE_BLOCK); w.set(x + 8, y, z, blocks.pack(blocks.B.ACTIVATOR_RAIL, 1)); g.redstone.update?.(x + 8, y, z); g.ticker.neighborChanged(x + 8, y, z); if (!(blocks.metaOf(w.get(x + 8, y, z)) & 8)) w.set(x + 8, y, z, blocks.pack(blocks.B.ACTIVATOR_RAIL, 9));
  const tnt = mk('tnt', 8);
  tnt.tick();
  const lit = tnt.fuse > 0;
  tnt.removed = true;
  return { spilled, pushed, collected, lit, fuel: furnace.fuel };
}, [carts.x, carts.y, carts.z]);
ok(cart.spilled, 'a broken chest minecart spills its contents');
ok(cart.pushed > 0.5, `coal sets a furnace minecart moving (${cart.pushed.toFixed(2)})`);
ok(cart.collected, 'a hopper minecart picks up items above it');
ok(cart.lit, 'a powered activator rail lights a TNT minecart');

const boat = await t.page.evaluate(async () => {
  const { Boat } = await import('/src/entity/boat.ts');
  const { BOATS } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const b = new Boat(g.world, g);
    b.wood = 'spruce';
    b.setPos(p.x + 3, p.y + 1, p.z);
    g.addEntity(b);
    b.damageTaken = 100; b.attacked(false);
    return g.entities.some((e) => e.item?.id === BOATS.spruce);
  });
});
ok(boat, 'a spruce boat breaks into a spruce boat');

// plants grow by random ticks; coral dies out of the water
const grow = await t.page.evaluate(() => window.sim((g, p) => {
  const blocks = window.__mc;
  const id = (n) => blocks.BLOCKS.find((b) => b?.name === n).id;
  const w = g.world, x = Math.floor(p.x) + 30, y = Math.floor(p.y) + 40, z = Math.floor(p.z) - 10;
  for (let a = -2; a <= 6; a++) for (let c = -2; c <= 2; c++) { w.set(x + a, y - 1, z + c, id('dirt')); for (let b = 0; b < 8; b++) w.set(x + a, y + b, z + c, 0); }
  // kelp in a water column
  for (let b = 0; b < 6; b++) w.set(x, y + b, z, id('water'));
  w.set(x, y, z, id('kelp'));
  // a beetroot on farmland, a coral block in the air
  w.set(x + 2, y - 1, z, (id('farmland') & 0xfff) | (1 << 12));
  w.set(x + 2, y, z, id('beetroots'));
  w.set(x + 4, y, z, id('tube_coral_block'));
  const tick = (bx, by, bz) => blocks.BLOCKS[w.getId(bx, by, bz)].behavior?.randomTick?.({ game: g, world: w, x: bx, y: by, z: bz, v: w.get(bx, by, bz), id: w.getId(bx, by, bz), meta: w.get(bx, by, bz) >>> 12, setMeta: (m) => w.set(bx, by, bz, (w.get(bx, by, bz) & 0xfff) | (m << 12)), set: (v) => w.set(bx, by, bz, v) });
  g.time = 6000;
  for (let i = 0; i < 200; i++) { let ky = y; while (w.getId(x, ky, z) === id('kelp_plant')) ky++; tick(x, ky, z); tick(x + 2, y, z); }
  tick(x + 4, y, z);
  let h = 0; while ([id('kelp'), id('kelp_plant')].includes(w.getId(x, y + h, z))) h++;
  return { kelp: h, beet: w.get(x + 2, y, z) >>> 12, coral: blocks.BLOCKS[w.getId(x + 4, y, z)].name };
}));
ok(grow.kelp > 2, `kelp grows up through the water (${grow.kelp} tall)`);
ok(grow.beet === 3, `beetroots ripen (stage ${grow.beet})`);
ok(grow.coral === 'dead_tube_coral_block', `coral out of the water dies (${grow.coral})`);

// a chorus flower on end stone grows into a branching plant
const chorus = await t.page.evaluate(() => window.sim((g, p) => {
  const blocks = window.__mc;
  const id = (n) => blocks.BLOCKS.find((b) => b?.name === n).id;
  const w = g.world, x = Math.floor(p.x) - 20, y = Math.floor(p.y) + 40, z = Math.floor(p.z) + 20;
  for (let a = -6; a <= 6; a++) for (let c = -6; c <= 6; c++) for (let b = -1; b < 22; b++) w.set(x + a, y + b, z + c, b < 0 ? id('end_stone') : 0);
  w.set(x, y, z, id('chorus_flower'));
  const tick = (bx, by, bz) => blocks.BLOCKS[w.getId(bx, by, bz)].behavior?.randomTick?.({ game: g, world: w, x: bx, y: by, z: bz, v: w.get(bx, by, bz), id: w.getId(bx, by, bz), meta: w.get(bx, by, bz) >>> 12, setMeta: (m) => w.set(bx, by, bz, (w.get(bx, by, bz) & 0xfff) | (m << 12)), set: (v) => w.set(bx, by, bz, v) });
  for (let i = 0; i < 60; i++)
    for (let a = -6; a <= 6; a++) for (let c = -6; c <= 6; c++) for (let b = 0; b < 22; b++) if (w.getId(x + a, y + b, z + c) === id('chorus_flower')) tick(x + a, y + b, z + c);
  let plant = 0, flowers = 0, wide = 0;
  for (let a = -6; a <= 6; a++) for (let c = -6; c <= 6; c++) for (let b = 0; b < 22; b++) {
    const k = w.getId(x + a, y + b, z + c);
    if (k === id('chorus_plant')) { plant++; if (a || c) wide++; }
    if (k === id('chorus_flower')) flowers++;
  }
  return { plant, flowers, wide };
}));
ok(chorus.plant >= 4 && chorus.flowers >= 1 && chorus.wide >= 1, `a chorus flower grows into a branching plant (${chorus.plant} stalks, ${chorus.wide} off-centre, ${chorus.flowers} flowers)`);

// scaffolding (1.14): towers and overhangs up to six out; the seventh falls; using it on a tower's top adds to the top
const scaf = await t.page.evaluate(async () => {
  const { B2 } = await import('/src/world/blocks.ts');
  const r = await window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 20, y = Math.floor(p.y) + 50, z = Math.floor(p.z) + 20;
    for (let a = -2; a <= 10; a++) for (let c = -2; c <= 2; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 8; b++) w.set(x + a, y + b, z + c, 0); }
    for (let b = 0; b < 3; b++) w.set(x, y + b, z, B2.SCAFFOLDING);
    for (let a = 1; a <= 7; a++) w.set(x + a, y + 2, z, B2.SCAFFOLDING);
    return { x, y, z };
  });
  await new Promise((res) => setTimeout(res, 1500));
  return window.sim((g, p) => {
    const w = g.world, { x, y, z } = r;
    const metas = [];
    for (let a = 0; a <= 7; a++) metas.push(w.getId(x + a, y + 2, z) === B2.SCAFFOLDING ? w.get(x + a, y + 2, z) >>> 12 : -1);
    const held = { id: B2.SCAFFOLDING, count: 5 };
    g.interact.placeBlock({ x, y, z, face: 3, hx: x + 0.5, hy: y + 1, hz: z + 0.5 }, held, window.__mc.ITEMS.get(B2.SCAFFOLDING));
    return { metas, top: w.getId(x, y + 3, z) === B2.SCAFFOLDING };
  });
});
ok(JSON.stringify(scaf.metas.slice(0, 7)) === JSON.stringify([0, 9, 10, 11, 12, 13, 14]) && scaf.metas[7] === -1, `scaffolding counts out from its tower and the seventh falls (${scaf.metas})`);
ok(scaf.top, 'scaffolding used on a tower goes on its top');

// swimming (1.13): sprinting under water lays the player flat (0.6 tall) and moves along the look
const pool = await t.page.evaluate(() => window.sim((g, p) => {
  const w = g.world, x = Math.floor(p.x) - 30, y = Math.floor(p.y) + 60, z = Math.floor(p.z) - 30;
  const water = window.__mc.BLOCKS.find((b) => b?.name === 'water').id;
  for (let a = -4; a <= 4; a++) for (let c = -4; c <= 4; c++) for (let b = 0; b < 6; b++) w.set(x + a, y + b, z + c, water);
  return { x, y, z };
}));
await wait(1500);
const swim = await t.page.evaluate(({ x, y, z }) => {
  const p = window.game.player;
  p.setPos(x + 0.5, y + 2, z + 0.5);
  p.vx = p.vy = p.vz = 0;
  p.sprinting = true; p.flying = false;
  p.updateFluidState();
  p.updateGlide();
  const swimming = p.swimming, h = p.height;
  p.yaw = 0; p.pitch = 30;
  const y0 = p.y, z0 = p.z;
  for (let i = 0; i < 10; i++) p.travel(0, 1);
  return { swimming, h, dove: p.y < y0 - 0.1, ahead: p.z > z0 + 0.3 };
}, pool);
ok(swim.swimming && swim.h < 1, `sprinting under water swims (lying flat, ${swim.h} tall)`);
ok(swim.dove && swim.ahead, 'and moves along the look, diving when looking down');

// through the keys, tick by tick: swimming lasts (lying flat doesn't stop the sprint), and 1.13's water drifts
// down slowly when still, faster when sneaking
const strokes = await t.page.evaluate(({ x, y, z }) => {
  const p = window.game.player, go = (inp, n) => { const seen = []; for (let i = 0; i < n; i++) { p.applyInput(inp); p.tick(); seen.push(p.swimming); } return seen; };
  const still = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
  // from the pool's north side, swimming south through it
  p.setPos(x + 0.5, y + 3, z - 3.5);
  p.vx = p.vy = p.vz = 0; p.yaw = 0; p.pitch = 0; p.swimming = false;
  go(still, 20);
  const sink = p.vy;
  const seen = go({ ...still, forward: 1, sprint: true }, 20).slice(2);
  const speed = Math.hypot(p.vx, p.vz);
  go(still, 10);
  go({ ...still, sneak: true }, 15);
  return { sink, steady: seen.every(Boolean), speed, sneak: p.vy };
}, pool);
ok(strokes.steady, 'holding sprint under water keeps swimming every tick');
ok(strokes.speed > 0.2 && strokes.speed < 0.3, `swimming picks up toward 1.13's 5.6 m/s (${(strokes.speed * 20).toFixed(1)} m/s)`);
ok(strokes.sink < -0.01 && strokes.sink > -0.04, `still in water sinks slowly (${strokes.sink.toFixed(3)} a tick)`);
ok(strokes.sneak < -0.12, `sneaking sinks faster (${strokes.sneak.toFixed(3)} a tick)`);

// a spawner set down holds a pig (1.16) and spawns them
const pigs = await run((g, p, { blocks }) => {
  const x = Math.floor(p.x) - 25, y = Math.floor(p.y) + 40, z = Math.floor(p.z), w = g.world;
  for (let a = -4; a <= 4; a++) for (let c = -4; c <= 4; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 3; b++) w.set(x + a, y + b, z + c, 0); }
  w.set(x, y, z, blocks.B.SPAWNER);
  return w.getTile(x, y, z);
});
ok(pigs?.type === 'spawner' && pigs.mob === 'pig', `a placed spawner holds a pig (${JSON.stringify(pigs)})`);

// flowing water passes kelp, seagrass and waterlogged stairs by: they hold water already (it used to wash kelp out
// of the sea floor as items, endlessly)
const wash = await run((g, p, { blocks }) => {
  const x = Math.floor(p.x), y = Math.floor(p.y) + 40, z = Math.floor(p.z) - 25, w = g.world;
  // (wide enough that no edge within 4 draws the water away from them)
  for (let a = -6; a <= 12; a++) for (let c = -6; c <= 6; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 3; b++) w.set(x + a, y + b, z + c, 0); }
  const id = (n) => blocks.BLOCKS.findIndex((b) => b?.name === n);
  w.set(x + 2, y, z, id('kelp'));
  w.set(x + 4, y, z, id('seagrass'));
  w.set(x + 6, y, z, blocks.pack(id('oak_stairs'), 8));
  window.__wash = [x, y, z];
  w.set(x, y, z, blocks.B.WATER);
  return [x, y, z];
});
await wait(4000);
const washed = await run((g, p, { blocks }) => {
  const [x, y, z] = window.__wash, w = g.world, n = (dx) => blocks.BLOCKS[w.getId(x + dx, y, z)].name;
  const items = g.entities.filter((e) => e.typeName === 'Item' && Math.abs(e.x - x) < 10 && Math.abs(e.z - z) < 4).length;
  return { kelp: n(2), seagrass: n(4), stairs: n(6), water: n(1), items };
});
ok(washed.kelp === 'kelp' && washed.seagrass === 'seagrass' && washed.stairs === 'oak_stairs' && washed.water === 'water' && washed.items === 0, `flowing water leaves kelp, seagrass and waterlogged stairs be (${JSON.stringify(washed)})`);

// explosions destroy dropped items as far as they hurt (items have 5 health), but not nether stars
const blast = await run((g, p, { items }) => {
  const x = Math.floor(p.x) + 25, y = Math.floor(p.y) + 40, z = Math.floor(p.z) + 25, w = g.world;
  for (let a = -8; a <= 8; a++) for (let c = -8; c <= 8; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 4; b++) w.set(x + a, y + b, z + c, 0); }
  const drop = (dx, dz, id) => { const e = g.dropItem(x + 0.5 + dx, y + 0.01, z + 0.5 + dz, { id, count: 1 }); e.vx = e.vy = e.vz = 0; e.onGround = true; return e; };
  const near = [[2, 0], [0, -3], [5, 0], [0, 6], [-4, -4]].map(([a, c]) => drop(a, c, 4));
  const star = drop(1, 1, items.itemId('nether_star'));
  g.interact.explode(x + 0.5, y + 0.49, z + 0.5, 4, false, null);
  return { gone: near.filter((e) => e.removed).length, of: near.length, star: !star.removed };
});
ok(blast.gone === blast.of && blast.star, `a TNT blast destroys the dropped items around it, out to 6 blocks, and leaves the nether star (${JSON.stringify(blast)})`);

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
