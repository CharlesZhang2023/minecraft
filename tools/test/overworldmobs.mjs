// The overworld mobs of 1.4-1.16 in a running world: a line-up picture, golems built from blocks, curing a zombie
// villager, a witch's potions, a guardian's laser, stray arrows, evoker fangs, husk hunger, zombies drowning.
//   node tools/test/overworldmobs.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 0 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

const kinds = ['husk', 'drowned', 'stray', 'zombie_villager', 'cave_spider', 'witch', 'pillager', 'vindicator', 'evoker', 'vex', 'ravager', 'guardian', 'elder_guardian', 'phantom', 'iron_golem', 'snow_golem'];
const lineup = await t.sim((g, p, kinds) => {
  const w = g.world, x0 = Math.floor(p.x) + 2, y = 150, z0 = Math.floor(p.z) + 6;
  for (let x = -3; x < 48; x++) for (let z = -5; z < 7; z++) { w.set(x0 + x, y - 1, z0 + z, 1); for (let k = 0; k < 6; k++) w.set(x0 + x, y + k, z0 + z, 0); }
  let x = 0;
  const made = kinds.map((k) => {
    const m = g.interact.spawnMob(k, x0 + x + 0.5, y + (k === 'phantom' || k === 'vex' ? 1.2 : k.includes('guardian') ? 0.5 : 0), z0 + 0.5);
    x += k === 'ravager' || k === 'elder_guardian' ? 4.5 : k === 'iron_golem' ? 3.5 : 2.6;
    if (m) { m.noAi = true; m.yaw = m.bodyYaw = m.headYaw = 180; }
    return !!m;
  });
  return { x0, y, z0, made, width: x };
}, kinds);
ok(lineup.made.every(Boolean), 'all the new overworld mobs spawn ' + kinds.filter((k, i) => !lineup.made[i]).join(' '));
await t.settle(1500);
await t.look(lineup.x0 + 11, lineup.y + 2.5, lineup.z0 - 9, 0, 12, 75);
await wait(700);
await t.shot('owmobs-lineup-1');
await t.look(lineup.x0 + 33, lineup.y + 3, lineup.z0 - 10, 0, 12, 75);
await wait(700);
await t.shot('owmobs-lineup-2');
await t.look(null);
// none of them throw while drawing
ok(t.errors.length === 0, 'they render without errors ' + t.errors.slice(0, 2).join(' | '));

// golems: a pumpkin on a T of iron blocks, and on two snow blocks
const golems = await t.page.evaluate(async () => {
  const { B, B2 } = await import('/src/world/blocks.ts');
  const { buildGolem } = await import('/src/entity/overworldmobs.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 6, y = 170, z = Math.floor(p.z) - 6;
    w.set(x, y, z, B.IRON_BLOCK); w.set(x, y + 1, z, B.IRON_BLOCK); w.set(x - 1, y + 1, z, B.IRON_BLOCK); w.set(x + 1, y + 1, z, B.IRON_BLOCK); w.set(x, y + 2, z, B2.CARVED_PUMPKIN);
    const iron = buildGolem(g, x, y + 2, z);
    w.set(x + 5, y, z, B.SNOW_BLOCK); w.set(x + 5, y + 1, z, B.SNOW_BLOCK); w.set(x + 5, y + 2, z, B2.CARVED_PUMPKIN);
    const snow = buildGolem(g, x + 5, y + 2, z);
    return { iron: iron?.typeName, made: iron?.playerCreated, cleared: w.getId(x, y + 1, z) === 0, snow: snow?.typeName };
  });
});
ok(golems.iron === 'Iron Golem' && golems.made && golems.cleared, 'iron blocks and a pumpkin make an iron golem');
ok(golems.snow === 'Snow Golem', 'snow blocks and a pumpkin make a snow golem');

// curing: weakness plus a golden apple, then (fast-forwarded) a villager with the same profession
const cure = await t.page.evaluate(async () => {
  const { I, stack } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const z = g.interact.spawnMob('zombie_villager', p.x + 3, p.y, p.z);
    z.noAi = true;
    z.profession = 'librarian';
    p.inventory.main[p.inventory.selected] = stack(I.GOLDEN_APPLE, 1);
    const without = z.interact(g, p.inventory.held());
    z.addEffect('weakness', 600, 0);
    const took = z.interact(g, p.inventory.held());
    const curing = z.curing > 0;
    z.curing = 1;
    z.tick();
    const v = g.entities.find((e) => e.typeName === 'Villager' && Math.abs(e.x - z.x) < 0.1 && Math.abs(e.z - z.z) < 0.1);
    return { without, took, curing, gone: z.removed, villager: !!v, prof: v?.profession };
  });
});
ok(!cure.without && cure.took && cure.curing, 'a golden apple starts a cure only while weakened');
ok(cure.gone && cure.villager && cure.prof === 'librarian', 'the cure makes a villager of the same profession');

// witch: throws a splash potion at a player in range
const witch = await t.sim((g, p) => {
  const wch = g.interact.spawnMob('witch', p.x + 5, p.y, p.z);
  const before = g.entities.filter((e) => e.typeName === 'ThrownPotion').length;
  wch.throwPotion(p);
  const after = g.entities.filter((e) => e.typeName === 'ThrownPotion').length;
  wch.health = 5;
  let drank = false;
  for (let i = 0; i < 200 && !drank; i++) { wch.tick(); if (wch.drinking > 0) drank = true; }
  return { threw: after - before, drank };
});
ok(witch.threw === 1, 'a witch throws a splash potion');
ok(witch.drank, 'and drinks a potion when hurt');

// guardian: charges its laser at a player in sight and hurts them
const guardian = await t.page.evaluate(async () => {
  const { B } = await import('/src/world/blocks.ts');
  return window.sim((g, p) => {
    const w = g.world, x0 = Math.floor(p.x), y = 200, z0 = Math.floor(p.z) + 20;
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) for (let k = 0; k < 6; k++) w.set(x0 + x, y + k, z0 + z, B.WATER);
    const gd = g.interact.spawnMob('guardian', x0 + 0.5, y + 2, z0 + 0.5);
    const hp = p.health;
    p.setPos(x0 + 0.5, y + 2, z0 + 4.5);
    let charged = 0;
    const log = [];
    gd.updateFluidState();
    log.push(['start', gd.inWater, w.getId(Math.floor(gd.x), Math.floor(gd.y), Math.floor(gd.z)), B.WATER, gd.x, gd.y, gd.z, w.chunkAt ? !!w.chunkAt(x0, z0) : '?'].join(','));
    for (let i = 0; i < 400 && p.health >= hp; i++) { const had = !!gd.beamTarget; gd.tick(); if (gd.beamTarget) charged++; else if (had) log.push([i, gd.beam, gd.x.toFixed(1), gd.y.toFixed(1), gd.z.toFixed(1), p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1), gd.vx.toFixed(2), gd.vy.toFixed(2), gd.vz.toFixed(2), gd.canSee(p), p.creative, p.dead, gd.dead].join(',')); p.invulnerable = 0; }
    const hurt = hp - p.health;
    p.health = 20;
    return { charged, hurt, log };
  });
});
console.log(guardian.log);
ok(guardian.charged > 30, `a guardian locks its laser on (${guardian.charged} ticks)`);
ok(guardian.hurt > 0, `and the laser hurts (${guardian.hurt})`);

// stray arrows slow; husks make you hungry
const effects = await t.page.evaluate(async () => {
  const { Arrow } = await import('/src/entity/item.ts');
  return window.sim((g, p) => {
    const st = g.interact.spawnMob('stray', p.x + 4, p.y, p.z);
    const a = new Arrow(g.world, g, st);
    a.effect = st.arrowEffect;
    a.setPos(p.x, p.y + 1, p.z - 1);
    a.vx = 0; a.vy = 0; a.vz = 1;
    g.addEntity(a);
    a.tick();
    const slowed = p.effects.has('slowness');
    p.invulnerable = 0;
    const h = g.interact.spawnMob('husk', p.x + 1, p.y, p.z);
    h.onAttack(p);
    return { slowed, hungry: p.effects.has('hunger') };
  });
});
ok(effects.slowed, "a stray's arrow slows");
ok(effects.hungry, "a husk's hit makes you hungry");

// fangs: an evoker casts at a target; the fangs bite
const fangs = await t.sim((g, p) => {
  const ev = g.interact.spawnMob('evoker', p.x + 6, p.y, p.z);
  ev.target = p;
  const cast = ev.cast();
  const n = g.entities.filter((e) => e.typeName === 'Evoker Fangs' || e.typeName === 'Vex').length;
  return { cast, n };
});
ok(fangs.cast && fangs.n > 0, `an evoker casts (fangs or vexes: ${fangs.n})`);

// a zombie held under water becomes a drowned
const drown = await t.page.evaluate(async () => {
  const { B } = await import('/src/world/blocks.ts');
  return window.sim((g, p) => {
    const w = g.world, x0 = Math.floor(p.x) - 20, y = 200, z0 = Math.floor(p.z);
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let k = -1; k < 4; k++) w.set(x0 + x, y + k, z0 + z, k < 0 ? 1 : B.WATER);
    const zb = g.interact.spawnMob('zombie', x0 + 0.5, y, z0 + 0.5);
    zb.drownTicks = 899;
    zb.tick();
    return { gone: zb.removed, drowned: g.entities.some((e) => e.typeName === 'Drowned' && Math.abs(e.x - zb.x) < 1) };
  });
});
ok(drown.gone && drown.drowned, 'a zombie under water turns into a drowned');

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
