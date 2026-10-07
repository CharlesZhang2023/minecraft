// The Nether update's mobs in a running world: a line-up picture, piglin bartering and gold-armour neutrality,
// zombification in the overworld, striders standing on lava, magma cubes splitting.
//   node tools/test/nethermobs.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 0 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

// a line-up on a platform for the picture (and to see they all exist)
const lineup = await t.sim((g, p) => {
  const w = g.world, x0 = Math.floor(p.x) + 2, y = 150, z0 = Math.floor(p.z) + 6;
  for (let x = -2; x < 20; x++) for (let z = -4; z < 6; z++) { w.set(x0 + x, y - 1, z0 + z, 1); for (let k = 0; k < 4; k++) w.set(x0 + x, y + k, z0 + z, 0); }
  const kinds = ['piglin', 'piglin_brute', 'hoglin', 'zoglin', 'strider', 'magma_cube', 'wither_skeleton', 'zombified_piglin'];
  const made = kinds.map((k, i) => { const m = g.interact.spawnMob(k, x0 + i * 2.4 + 0.5, y, z0 + 0.5); if (m) { m.noAi = true; m.yaw = m.bodyYaw = m.headYaw = 180; } return !!m; });
  return { x0, y, z0, made };
});
ok(lineup.made.every(Boolean), 'all eight Nether mobs spawn ' + JSON.stringify(lineup.made));
await t.settle(1500);
await t.look(lineup.x0 + 9, lineup.y + 2.5, lineup.z0 - 8, 0, 12, 70);
await wait(600);
await t.shot('nethermobs-lineup');
await t.look(null);

// bartering: hand a piglin a gold ingot; after admiring it, it throws out loot
const barter = await t.page.evaluate(async () => {
  const { I, stack } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const pg = g.interact.spawnMob('piglin', p.x + 2, p.y, p.z);
    pg.noAi = false;
    p.inventory.main[p.inventory.selected] = stack(I.GOLD_INGOT, 3);
    const took = pg.interact(g, p.inventory.held());
    const admiring = pg.admireTicks > 0;
    const before = g.entities.filter((e) => e.item).length;
    pg.admireTicks = 1; // skip the admiring
    pg.tick();
    const after = g.entities.filter((e) => e.item).length;
    return { took, admiring, gave: after - before };
  });
});
ok(barter.took && barter.admiring, 'a piglin takes a gold ingot and admires it');
ok(barter.gave > 0, `then barters it for loot (${barter.gave} item stacks)`);

// gold armour: a piglin ignores a player in a golden helmet, but goes for one without
const neutral = await t.page.evaluate(async () => {
  const { ARMOR, stack } = await import('/src/game/items.ts');
  const nm = await import('/src/entity/nethermobs.ts');
  return window.sim((g, p) => {
    p.inventory.armor[0] = stack(ARMOR.golden_helmet);
    const withGold = nm.wearsGold(p);
    p.inventory.armor[0] = null;
    return { withGold, without: nm.wearsGold(p) };
  });
});
ok(neutral.withGold && !neutral.without, 'gold armour counts for piglins');

// zombification: a hoglin brought to the overworld turns into a zoglin after 15 seconds
const zomb = await t.sim((g, p) => {
  const h = g.interact.spawnMob('hoglin', p.x + 3, p.y, p.z);
  const pg = g.interact.spawnMob('piglin', p.x - 3, p.y, p.z);
  h.conversion = 300; pg.conversion = 300;
  h.tick(); pg.tick();
  return { hoglinGone: h.removed, piglinGone: pg.removed, zoglins: g.entities.filter((e) => e.typeName === 'Zoglin').length, zombified: g.entities.filter((e) => e.typeName === 'Zombified Piglin').length };
});
ok(zomb.hoglinGone && zomb.zoglins > 0, 'a hoglin in the overworld becomes a zoglin');
ok(zomb.piglinGone && zomb.zombified > 0, 'a piglin in the overworld becomes a zombified piglin');

// striders on lava: a pool of lava, a strider dropped on it stands on top
const LAVA = await t.run(({ blocks }) => blocks.B.LAVA);
const strider = await t.sim((g, p, LAVA) => {
  const w = g.world, x0 = Math.floor(p.x) + 10, y = 160, z0 = Math.floor(p.z);
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { w.set(x0 + x, y - 2, z0 + z, 1); w.set(x0 + x, y - 1, z0 + z, LAVA); w.set(x0 + x, y, z0 + z, 0); w.set(x0 + x, y + 1, z0 + z, 0); w.set(x0 + x, y + 2, z0 + z, 0); }
  const s = g.interact.spawnMob('strider', x0 + 0.5, y + 1, z0 + 0.5);
  s.noAi = true;
  for (let i = 0; i < 60; i++) s.tick();
  return { y: s.y, top: y, onGround: s.onGround, cold: s.cold, hurt: s.health < s.maxHealth };
}, LAVA);
ok(Math.abs(strider.y - strider.top) < 0.3 && !strider.hurt, `a strider stands on lava unhurt (y ${strider.y.toFixed(2)} vs ${strider.top})`);
ok(!strider.cold, 'and is warm there');

// magma cubes split when they die
const split = await t.sim((g, p) => {
  const m = g.interact.spawnMob('magma_cube', p.x + 4, p.y + 1, p.z + 4);
  m.setSize(4);
  const n0 = g.entities.filter((e) => e.typeName === 'Magma Cube').length;
  m.damage(1000, 'generic');
  return { more: g.entities.filter((e) => e.typeName === 'Magma Cube').length - n0 };
});
ok(split.more >= 2, `a big magma cube splits into smaller ones (${split.more})`);
ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
