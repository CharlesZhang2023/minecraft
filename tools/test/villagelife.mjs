// Village life (1.14) in a running world: villagers claim beds and sleep in them at night, pick up food and breed when
// willing and a bed is free, and summon an iron golem when three of them haven't seen one for a while.
//   node tools/test/villagelife.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 1 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

const r = await t.page.evaluate(async () => {
  const { BEDS, pack, B2 } = await import('/src/world/blocks.ts');
  const { villagerTick } = await import('/src/entity/villagers.ts');
  const { I, stack } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 4, y = Math.floor(p.y) + 30, z = Math.floor(p.z) + 4;
    for (let a = -8; a <= 8; a++) for (let c = -8; c <= 8; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 5; b++) w.set(x + a, y + b, z + c, 0); }
    // three beds facing south (foot at z, head at z + 1)
    for (const bx of [x - 3, x, x + 3]) g.interact.setAll([[bx, y, z, pack(BEDS[14], 2)], [bx, y, z + 1, pack(BEDS[14], 2 | 8)]]);
    w.set(x, y, z - 5, B2.BELL);
    const v1 = g.interact.spawnMob('villager', x + 0.5, y, z - 2);
    const v2 = g.interact.spawnMob('villager', x + 1.5, y, z - 2);
    // a home: the nearest free bed
    v1.age = v1.id % 200; villagerTick(v1);
    v2.age = v2.id % 200; villagerTick(v2);
    const homes = [v1.home, v2.home];
    // night: walk to bed and lie down
    g.time = 13000;
    v1.setPos(v1.home.x + 0.5, y, v1.home.z - 0.5);
    v1.ai();
    const slept = v1.sleeping;
    // food on the ground is picked up; two willing villagers and a free bed make a baby
    g.time = 3000;
    v1.ai();
    const woke = !v1.sleeping;
    v1.setPos(x + 0.5, y, z - 2);
    const bread = g.dropItem(v2.x, v2.y + 0.2, v2.z, stack(I.BREAD, 3));
    v2.age = 10; villagerTick(v2);
    const picked = v2.food;
    v1.food = 12; v2.food = 12; v1.breedCooldown = v2.breedCooldown = 0;
    const before = g.entities.filter((e) => e.typeName === 'Villager').length;
    v1.age = 50; villagerTick(v1);
    const babies = g.entities.filter((e) => e.typeName === 'Villager' && e.baby).length;
    const after = g.entities.filter((e) => e.typeName === 'Villager').length;
    // golems: three villagers who haven't seen one
    const v3 = g.interact.spawnMob('villager', x + 2.5, y, z - 3);
    for (const v of [v1, v2, v3]) v.sawGolem = -10000;
    g.ticks = Math.max(g.ticks, 1000);
    let golem = false;
    for (let i = 0; i < 40 && !golem; i++) { v1.age = 25; v1.panicTicks = 5; villagerTick(v1); golem = g.entities.some((e) => e.typeName === 'Iron Golem' && e.distanceTo(v1) < 12); }
    // for the picture: night again, both asleep
    g.time = 14000;
    v1.panicTicks = 0;
    for (const v of [v1, v2]) { v.setPos(v.home.x + 0.5, y, v.home.z - 0.5); v.ai(); }
    void bread;
    return { x, y, z, homes, distinct: homes[0] && homes[1] && (homes[0].x !== homes[1].x), slept, woke, picked, babies, grew: after - before, golem, asleep: [v1.sleeping, v2.sleeping] };
  });
});
ok(r.distinct, `villagers claim beds of their own (${JSON.stringify(r.homes)})`);
ok(r.slept && r.woke, 'they sleep in them at night and wake in the morning');
ok(r.picked >= 12, `they pick up food (${r.picked} points of bread)`);
ok(r.grew === 1 && r.babies === 1, 'two willing villagers with a free bed make a baby');
ok(r.golem, 'three villagers who haven\'t seen a golem summon one');
await wait(1000);
await t.look(r.x + 0.5, r.y + 3, r.z - 2.5, 0, 45, 70);
await wait(800);
await t.shot('villagers-asleep');
await t.look(null);

// a zombie siege: zombies come in from the village's edge at night
const before = await t.page.evaluate(() => window.sim((g, p) => { g.time = 18500; g.dims.get('overworld').spawner.startSiege(p.x, p.y, p.z); return g.entities.filter((e) => e.typeName === 'Zombie').length; }));
await wait(3000);
const after = await t.page.evaluate(() => window.sim((g) => g.entities.filter((e) => e.typeName === 'Zombie').length));
ok(after - before >= 3, `a siege brings zombies (${after - before} so far)`);

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
