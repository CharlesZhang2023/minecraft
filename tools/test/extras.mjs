// Odds and ends of 1.6-1.9 in a running world: name tags, leads and fence knots, armor stands, skeleton traps,
// respawning the Ender Dragon with four crystals. A picture of a dressed armor stand and a leashed pig.
//   node tools/test/extras.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 0 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
const mods = async (fn, args) => t.page.evaluate(async ([src, a]) => {
  const m = { items: await import('/src/game/items.ts'), blocks: await import('/src/world/blocks.ts'), leash: await import('/src/entity/leash.ts') };
  return window.sim((g, p) => (0, eval)(src)(g, p, m, a));
}, [fn.toString(), args ?? null]);

const named = await mods((g, p, { items, leash }) => {
  const z = g.interact.spawnMob('zombie', p.x + 3, p.y, p.z);
  z.noAi = true;
  const tag = { ...items.stack(items.I3.NAME_TAG), name: 'Bob' };
  const used = leash.useOnMob(g, p, z, tag, () => {});
  // far away, a named monster stays
  z.setPos(p.x + 100, p.y, p.z);
  for (let i = 0; i < 2000; i++) z.despawnCheck();
  const kept = !z.removed;
  const json = z.toJSON();
  return { used, name: z.customName, kept, saved: json.customName };
});
ok(named.used && named.name === 'Bob' && named.saved === 'Bob', 'a name tag names a mob (and it saves)');
ok(named.kept, 'a named monster never despawns');

const lead = await mods((g, p, { items, blocks, leash }) => {
  const w = g.world;
  const pig = g.interact.spawnMob('pig', p.x + 2, p.y, p.z + 2);
  const used = leash.useOnMob(g, p, pig, items.stack(items.I7.LEAD), () => {});
  const held = pig.leashHolder === p;
  // walk away: the pig is pulled along
  pig.setPos(p.x + 8, p.y, p.z);
  for (let i = 0; i < 10; i++) pig.tick();
  const pulled = pig.vx < 0 || pig.x < p.x + 8;
  // tie to a fence
  const fx = Math.floor(p.x) - 2, fy = Math.floor(p.y), fz = Math.floor(p.z) - 2;
  w.set(fx, fy, fz, blocks.B.OAK_FENCE);
  pig.setPos(p.x - 1, p.y, p.z - 1);
  const tied = leash.tieToFence(g, p, fx, fy, fz);
  const knot = pig.leashHolder && pig.leashHolder.typeName === 'Leash Knot';
  // too far: it snaps and drops the lead
  pig.setPos(fx + 15, fy, fz);
  const before = g.entities.filter((e) => e.item?.id === items.I7.LEAD).length;
  pig.tick();
  const snapped = !pig.leashHolder && g.entities.filter((e) => e.item?.id === items.I7.LEAD).length > before;
  return { used, held, pulled, tied, knot, snapped };
});
ok(lead.used && lead.held, 'a lead ties a pig to the player');
ok(lead.pulled, 'and pulls it along');
ok(lead.tied && lead.knot, 'right-clicking a fence ties it to a knot');
ok(lead.snapped, 'pulled too far, the lead snaps and drops');

const stand = await t.page.evaluate(async () => {
  const { stack, ARMOR, itemId } = await import('/src/game/items.ts');
  const { ArmorStand } = await import('/src/entity/armorstand.ts');
  return window.sim((g, p) => {
    const s = new ArmorStand(g.world, g);
    s.setPos(p.x + 2.5, p.y, p.z + 3.5);
    s.yaw = 180;
    g.addEntity(s);
    p.inventory.main[p.inventory.selected] = stack(ARMOR.diamond_chestplate);
    s.interact(g, p.inventory.held());
    p.inventory.main[p.inventory.selected] = stack(ARMOR.golden_helmet);
    s.interact(g, p.inventory.held());
    const worn = !!s.armorItems[1] && !!s.armorItems[0];
    const pig = g.interact.spawnMob('pig', p.x + 4.5, p.y, p.z + 3.5);
    pig.noAi = true; pig.leashHolder = s;
    return { worn, x: s.x, y: s.y, z: s.z, stand: itemId('armor_stand') };
  });
});
ok(stand.worn, 'an armor stand wears the armour put on it');
await t.look(stand.x - 0.5, stand.y + 1.4, stand.z - 3.5, 0, 10, 60);
await wait(1200);
await t.shot('armorstand');
await t.look(null);
const broke = await t.page.evaluate(async () => window.sim((g) => {
  const s = g.entities.find((e) => e.typeName === 'Armor Stand');
  s.attacked(false); s.attacked(false);
  return { gone: s.removed, dropped: g.entities.filter((e) => e.item).length };
}));
ok(broke.gone && broke.dropped >= 3, 'two quick hits knock it down, dropping it and its armour');

const trap = await t.page.evaluate(async () => {
  const { maybeSkeletonTrap } = await import('/src/game/combat.ts');
  return window.sim((g, p) => {
    g.options.difficulty = 2;
    const r = Math.random;
    Math.random = () => 0;
    maybeSkeletonTrap(g, p.x + 30, p.y, p.z);
    Math.random = r;
    const h = g.entities.find((e) => e.typeName === 'Skeleton Horse' && e.trap);
    if (!h) return { trap: false };
    h.setPos(p.x + 5, p.y, p.z);
    h.tick();
    const horses = g.entities.filter((e) => e.typeName === 'Skeleton Horse').length;
    const skeletons = g.entities.filter((e) => e.typeName === 'Skeleton' && e.armorItems?.[0]).length;
    return { trap: true, horses, skeletons };
  });
});
ok(trap.trap, 'a thunderbolt can leave a skeleton trap');
ok(trap.horses >= 4 && trap.skeletons >= 4, `which springs into four skeleton horsemen (${trap.horses} horses, ${trap.skeletons} skeletons)`);

// the dragon comes back: four crystals on the exit portal of a dead dragon
await t.travel('end');
await t.page.evaluate(() => window.sim((g, p) => { p.setGameMode(1); p.flying = true; p.setPos(6.5, 80, 6.5); }));
await wait(2000);
await t.settle(4000, 20000);
const dragon = await t.page.evaluate(async () => {
  const { placeCrystal, tickDragonRespawn } = await import('/src/game/endstuff.ts');
  const { END_CENTER_Y } = await import('/src/world/endgen.ts');
  const { B } = await import('/src/world/blocks.ts');
  return window.sim((g) => {
    for (const e of g.entities) if (e.typeName === 'Ender Dragon') e.removed = true;
    g.meta.dragonKilled = true;
    const w = g.world, F = END_CENTER_Y;
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) { w.set(dx, F, dz, B.BEDROCK); w.set(dx, F + 1, dz, 0); w.set(dx, F + 2, dz, 0); placeCrystal(g, dx, F, dz); }
    const started = (g.meta.dragonRespawn ?? 0) > 0;
    g.meta.dragonRespawn = 1;
    tickDragonRespawn(g);
    return { started, alive: !g.meta.dragonKilled, dragon: g.entities.some((e) => e.typeName === 'Ender Dragon' && !e.removed) };
  });
});
ok(dragon.started, 'four crystals on the exit portal start the dragon respawn');
ok(dragon.alive && dragon.dragon, 'and a new Ender Dragon appears');

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
