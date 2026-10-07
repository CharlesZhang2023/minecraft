// Block rules and vehicles of 1.9-1.16 in a running world: concrete powder setting in water, the basalt generator,
// bubble columns, honey and magma underfoot, berry bushes, minecarts with chests/furnaces/hoppers/TNT, boats of
// every wood.
//   node tools/test/blockrules.mjs
import { openWorld } from './browser.mjs';

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

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
