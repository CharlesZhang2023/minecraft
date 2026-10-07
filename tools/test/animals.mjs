// The animals of 1.4-1.16 in a running world: mooshroom shearing and stew, fish buckets, shoulder parrots, bees
// and hives (nectar, honey, harvest, anger), turtle eggs hatching, cat taming and creepers fleeing cats, foxes
// carrying items, the wandering trader's trades, dolphins' grace.
//   node tools/test/animals.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 0 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
const mods = async (fn, args) => t.page.evaluate(async ([src, a]) => {
  const m = { items: await import('/src/game/items.ts'), blocks: await import('/src/world/blocks.ts'), animals: await import('/src/entity/animals.ts'), bees: await import('/src/entity/bees.ts') };
  return window.sim((g, p) => (0, eval)(src)(g, p, m, a));
}, [fn.toString(), args ?? null]);

// every animal spawns (and is drawn without errors)
const kinds = ['mooshroom', 'rabbit', 'fox', 'cat', 'ocelot', 'parrot', 'polar_bear', 'panda', 'llama', 'trader_llama', 'turtle', 'dolphin', 'cod', 'salmon', 'pufferfish', 'tropical_fish', 'bee', 'wandering_trader'];
const made = await t.sim((g, p, kinds) => kinds.filter((k) => { const m = g.interact.spawnMob(k, p.x + 3, p.y + 1, p.z + 3); if (m) { m.noAi = true; m.removed = true; } return !m; }), kinds);
ok(made.length === 0, 'all the animals spawn ' + made.join(' '));

// mooshroom: a bowl gives stew; shears make it a cow and drop mushrooms
const moo = await mods((g, p, { items }) => {
  const m = g.interact.spawnMob('mooshroom', p.x + 2, p.y, p.z);
  p.inventory.main[p.inventory.selected] = items.stack(items.I.BOWL, 2);
  m.interact(g, p.inventory.held());
  const stew = p.inventory.main.some((s) => s && s.id === items.I.MUSHROOM_STEW);
  p.inventory.main[p.inventory.selected] = items.stack(items.I.SHEARS);
  const before = g.entities.filter((e) => e.item && e.item.id === items.itemId('red_mushroom')).length;
  m.interact(g, p.inventory.held());
  const after = g.entities.filter((e) => e.item && e.item.id === items.itemId('red_mushroom')).length;
  const cow = g.entities.some((e) => e.typeName === 'Cow' && Math.abs(e.x - m.x) < 0.1);
  return { stew, sheared: m.removed && cow, mushrooms: after - before };
});
ok(moo.stew, 'a bowl on a mooshroom gives mushroom stew');
ok(moo.sheared && moo.mushrooms === 5, `shearing a mooshroom leaves a cow and 5 mushrooms (${moo.mushrooms})`);

// fish: a water bucket scoops a fish in water; the bucket lets it out again
const fish = await mods((g, p, { items, blocks }) => {
  const w = g.world, x0 = Math.floor(p.x) + 4, y = Math.floor(p.y) + 30, z0 = Math.floor(p.z);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) { w.set(x0 + x, y - 1, z0 + z, 1); for (let k = 0; k < 3; k++) w.set(x0 + x, y + k, z0 + z, blocks.B.WATER); }
  const f = g.interact.spawnMob('tropical_fish', x0 + 0.5, y + 1, z0 + 0.5);
  f.noAi = true; f.tick();
  const dbg = [f.inWater, f.y.toFixed(2), w.getId(Math.floor(f.x), Math.floor(f.y), Math.floor(f.z)), blocks.B.WATER].join();
  const col = [f.shape, f.pattern, f.baseColor, f.patternColor].join();
  p.inventory.main[p.inventory.selected] = items.stack(items.I.WATER_BUCKET);
  const caught = f.interact(g, p.inventory.held());
  const held = p.inventory.held();
  const bucket = held && held.id === items.I7.TROPICAL_FISH_BUCKET;
  items.getItem(held.id);
  const { releaseFish } = window.__animals ?? {};
  void releaseFish;
  return { dbg, caught, bucket, gone: f.removed, data: !!held.fish, col, kept: held.fish && [held.fish.shape, held.fish.pattern, held.fish.baseColor, held.fish.patternColor].join() === col };
});
console.log(fish);
ok(fish.caught && fish.bucket && fish.gone, 'a water bucket catches a tropical fish');
ok(fish.data && fish.kept, 'the bucket keeps its colours');
const release = await mods((g, p, { items, animals }) => {
  const held = p.inventory.held();
  const before = g.entities.filter((e) => e.typeName === 'Tropical Fish').length;
  animals.releaseFish(g, held, Math.floor(p.x) + 4, Math.floor(p.y) + 31, Math.floor(p.z));
  const f = g.entities.filter((e) => e.typeName === 'Tropical Fish');
  return { more: f.length - before, fromBucket: f.some((e) => e.fromBucket) };
});
ok(release.more === 1 && release.fromBucket, 'emptying it lets the fish out (and it never despawns)');

// parrots: a tame parrot hops on the shoulder, and off when the player is hurt
const parrot = await mods((g, p, { animals }) => {
  const par = g.interact.spawnMob('parrot', p.x + 1, p.y, p.z);
  par.owner = true; par.ownerName = p.name ?? ''; par.sitting = false;
  const goal = par.goals.find((x) => x.priority === 4);
  let on = false;
  for (let i = 0; i < 2000 && !on; i++) if (goal.canStart(par)) { goal.start(par); on = true; }
  const shoulder = !!(p.shoulderLeft || p.shoulderRight);
  animals.releaseShoulders(g, p);
  const back = g.entities.some((e) => e.typeName === 'Parrot' && !e.removed && e.owner);
  return { on, shoulder, gone: par.removed, back, free: !p.shoulderLeft && !p.shoulderRight };
});
ok(parrot.on && parrot.shoulder && parrot.gone, 'a tame parrot lands on its owner\'s shoulder');
ok(parrot.back && parrot.free, 'and comes off again');

// bees: in and out of a hive, honey from nectar, harvest with a bottle angers them without smoke
const bees = await mods((g, p, { items, blocks, bees }) => {
  const w = g.world, x = Math.floor(p.x) + 6, y = Math.floor(p.y) + 3, z = Math.floor(p.z) + 6;
  w.set(x, y, z, blocks.B2.BEEHIVE);
  const b = g.interact.spawnMob('bee', x + 0.5, y + 1.5, z + 0.5);
  b.hive = { x, y, z }; b.nectar = true;
  const goHome = b.goals.find((q) => q.priority === 2);
  b.setPos(x + 0.5, y + 1.2, z + 0.5);
  if (goHome.canStart(b)) goHome.tick(b);
  const entered = b.removed;
  const tile = w.getTile(x, y, z);
  const inside = tile?.bees?.length ?? 0;
  // fast-forward the bee's stay
  tile.bees[0].ticksIn = 99999;
  g.time = 6000;
  bees.tickHive(g, x, y, z, tile);
  const honey = w.getTile(x, y, z).honey;
  const out = g.entities.filter((e) => e.typeName === 'Bee' && !e.removed).length;
  // fill it up and harvest with a bottle
  w.getTile(x, y, z).honey = 5;
  p.inventory.main[p.inventory.selected] = items.stack(items.itemId('glass_bottle'), 1);
  const got = bees.harvestHive(g, p, x, y, z, p.inventory.held(), () => { p.inventory.main[p.inventory.selected] = null; }, (s) => p.inventory.add(s));
  const bottle = p.inventory.main.some((s) => s && s.id === items.I7.HONEY_BOTTLE);
  const angry = g.entities.filter((e) => e.typeName === 'Bee' && e.angry > 0).length;
  return { entered, inside, honey, out, got, bottle, angry };
});
ok(bees.entered && bees.inside === 1, 'a bee with nectar goes into its hive');
ok(bees.honey === 1 && bees.out >= 1, `it comes out by day and the hive gains honey (${bees.honey})`);
ok(bees.got && bees.bottle, 'a glass bottle takes honey from a full hive');
ok(bees.angry > 0, 'and the bees get angry without a campfire under it');

// turtle eggs hatch into babies that remember the beach
const eggs = await mods((g, p, { blocks }) => {
  const w = g.world, x = Math.floor(p.x) - 6, y = Math.floor(p.y) + 3, z = Math.floor(p.z) - 6;
  w.set(x, y - 1, z, blocks.B.SAND);
  w.set(x, y, z, blocks.pack(blocks.B2.TURTLE_EGG, 2 | (2 << 2)));
  g.time = 18000;
  const ctx = { game: g, world: w, x, y, z, v: w.get(x, y, z), id: blocks.B2.TURTLE_EGG, meta: 2 | (2 << 2), set: (v) => w.set(x, y, z, v), setMeta: () => {} };
  window.__mc.BLOCKS[blocks.B2.TURTLE_EGG].behavior.randomTick(ctx);
  const babies = g.entities.filter((e) => e.typeName === 'Turtle' && e.baby && e.home && e.home.x === x);
  g.time = 6000;
  return { gone: w.getId(x, y, z) === 0, babies: babies.length };
});
ok(eggs.gone && eggs.babies === 3, `three turtle eggs hatch into three babies (${eggs.babies})`);

// cats: raw cod tames one (eventually); creepers run from cats
const cat = await mods((g, p, { items }) => {
  const c = g.interact.spawnMob('cat', p.x + 2, p.y, p.z - 2);
  let tries = 0;
  while (!c.owner && tries < 50) { p.inventory.main[p.inventory.selected] = items.stack(items.I2.COD, 1); c.interact(g, p.inventory.held()); tries++; }
  const cr = g.interact.spawnMob('creeper', c.x + 2, c.y, c.z);
  cr.target = p;
  cr.ai();
  return { tamed: c.owner, sitting: c.sitting, fleeing: !!cr.path && cr.swellDir < 0 };
});
ok(cat.tamed && cat.sitting, 'raw cod tames a cat (and it sits)');
ok(cat.fleeing, 'a creeper near a cat runs away instead of swelling');

// foxes pick up items in their mouths
const fox = await mods((g, p, { items }) => {
  for (const e of g.entities) if (e.item) e.removed = true;
  const f = g.interact.spawnMob('fox', p.x - 3, p.y, p.z + 3);
  const it = g.dropItem(f.x + 0.5, f.y + 0.2, f.z, items.stack(items.I.EMERALD, 1));
  it.pickupDelay = 0;
  const goal = f.goals.find((q) => q.priority === 7);
  let took = false;
  for (let i = 0; i < 400 && !took; i++) { if (goal.canStart(f)) { goal.tick(f); goal.tick(f); } if (f.mouth) took = true; }
  return { took, what: f.mouth?.id === items.I.EMERALD };
});
ok(fox.took && fox.what, 'a fox picks up an emerald in its mouth');

// the wandering trader sells its wares for emeralds
const trader = await t.sim((g, p) => {
  const tr = g.interact.spawnMob('wandering_trader', p.x + 3, p.y, p.z + 3);
  const trades = tr.ensureTrades();
  return { n: trades.length, emeralds: trades.every((x) => x.cost[0] === trades[0].cost[0]) };
});
ok(trader.n >= 6 && trader.emeralds, `the wandering trader has ${trader.n} trades for emeralds`);

// dolphins give swimming players Dolphin's Grace
const dolphin = await mods((g, p, { blocks }) => {
  const w = g.world, x0 = Math.floor(p.x) + 20, y = Math.floor(p.y) + 40, z0 = Math.floor(p.z);
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) for (let k = 0; k < 5; k++) w.set(x0 + x, y + k, z0 + z, blocks.B.WATER);
  const d = g.interact.spawnMob('dolphin', x0 + 0.5, y + 2, z0 + 0.5);
  p.setPos(x0 + 2.5, y + 2, z0 + 0.5);
  p.updateFluidState();
  for (let i = 0; i < 20; i++) d.ai();
  const grace = p.effects.has('dolphins_grace');
  p.setPos(x0 + 30, y + 30, z0);
  return { grace, inWater: p.inWater };
});
ok(dolphin.grace, "a dolphin gives a swimming player Dolphin's Grace");

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
