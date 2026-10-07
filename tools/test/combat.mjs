// 1.9-1.16 combat in a running world: the attack charge, sweeping, shields (front only, axes disable them),
// crossbows (loading, multishot), tridents (thrown, loyalty), the totem of undying, the off hand (F), mending,
// frost walker, lightning on mobs, netherite floating in lava. Pictures of the poses in output/tests.
//   node tools/test/combat.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 0 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
const mods = async (fn, args) => t.page.evaluate(async ([src, a]) => {
  const m = { items: await import('/src/game/items.ts'), blocks: await import('/src/world/blocks.ts'), combat: await import('/src/game/combat.ts'), enchant: await import('/src/game/enchant.ts') };
  return window.sim((g, p) => (0, eval)(src)(g, p, m, a));
}, [fn.toString(), args ?? null]);

// the attack charge: a sword recharges in 12.5 ticks; a weak swing does a fifth of the damage
const charge = await mods((g, p, { items, combat }) => {
  p.inventory.main[p.inventory.selected] = items.stack(items.TOOLS.diamond_sword);
  p.attackTicks = 0;
  const s0 = combat.attackStrength(p, 0);
  p.attackTicks = 13;
  const s1 = combat.attackStrength(p, 0);
  const z = g.interact.spawnMob('zombie', p.x + 1.5, p.y, p.z); z.noAi = true;
  p.attackTicks = 0;
  const h0 = z.health; g.interact.attack(z); const weak = h0 - z.health;
  z.invulnerable = 0; p.attackTicks = 20; p.vy = 0; p.fallDistance = 0;
  const h1 = z.health; g.interact.attack(z); const strong = h1 - z.health;
  const d = items.getItem(items.TOOLS.diamond_axe);
  return { s0, s1, weak, strong, axe: [d.attack, d.attackSpeed] };
});
ok(charge.s0 < 0.1 && charge.s1 >= 1, `the attack charge refills (${charge.s0.toFixed(2)} -> ${charge.s1})`);
ok(charge.weak > 0 && charge.weak < charge.strong / 3, `a spammed swing is weak (${charge.weak.toFixed(1)} vs ${charge.strong.toFixed(1)})`);
ok(charge.axe[0] === 9 && charge.axe[1] === 1, 'axes hit for 9 at one swing a second (diamond)');

// sweeping: a full sword swing on the ground hits the mobs next to the target too
const sweep = await mods((g, p, { items }) => {
  p.inventory.main[p.inventory.selected] = items.stack(items.TOOLS.iron_sword);
  const a = g.interact.spawnMob('zombie', p.x + 1.8, p.y, p.z); a.noAi = true;
  const b = g.interact.spawnMob('zombie', p.x + 1.8, p.y, p.z + 0.8); b.noAi = true;
  p.attackTicks = 30; p.px = p.x; p.pz = p.z; p.onGround = true; p.sprinting = false; p.fallDistance = 0;
  g.interact.attack(a);
  return { a: a.maxHealth - a.health, b: b.maxHealth - b.health };
});
ok(sweep.a >= 6 && sweep.b > 0, `a sword sweep hurts the zombie beside the target (${sweep.a}, ${sweep.b})`);

// shields: block from the front, not the back; an axe disables them
const shield = await mods((g, p, { items }) => {
  p.inventory.offhand = items.stack(items.I7.SHIELD);
  p.inventory.main[p.inventory.selected] = null;
  p.yaw = 0; // looking +z
  p.blocking = true; p.shieldCooldown = 0;
  p.health = 20; p.invulnerable = 0;
  const front = g.interact.spawnMob('zombie', p.x, p.y, p.z + 1.5); front.noAi = true;
  const blocked = !p.damage(5, 'mob', front);
  const hpFront = p.health;
  p.invulnerable = 0;
  const back = g.interact.spawnMob('zombie', p.x, p.y, p.z - 1.5); back.noAi = true;
  p.damage(5, 'mob', back);
  const hpBack = p.health;
  p.invulnerable = 0; p.health = 20;
  const vin = g.interact.spawnMob('vindicator', p.x, p.y, p.z + 1.5); vin.noAi = true;
  p.damage(5, 'mob', vin);
  const disabled = p.shieldCooldown > 0 && !p.blocking;
  p.blocking = false; p.health = 20;
  return { blocked, hpFront, hpBack, disabled, worn: (p.inventory.offhand?.damage ?? 0) > 0 };
});
ok(shield.blocked && shield.hpFront === 20, 'a shield blocks a hit from the front');
ok(shield.hpBack < 20, 'but not from behind');
ok(shield.disabled, "an axe knocks the shield out for a while");
ok(shield.worn, 'and blocking wears the shield');

// the off hand: F swaps
const swap = await mods((g, p, { items }) => {
  p.inventory.main[p.inventory.selected] = items.stack(items.I.APPLE, 3);
  p.inventory.offhand = items.stack(items.I7.SHIELD);
  g.interact.swapOffhand();
  return { main: p.inventory.held()?.id === items.I7.SHIELD, off: p.inventory.offhand?.id === items.I.APPLE };
});
ok(swap.main && swap.off, 'F swaps the main and off hands');

// crossbows: load (multishot uses one arrow), then fire three
const xbow = await mods((g, p, { items, combat }) => {
  const cb = { ...items.stack(items.I7.CROSSBOW), ench: { multishot: 1 } };
  p.inventory.main[p.inventory.selected] = cb;
  p.inventory.offhand = null;
  p.inventory.main[5] = items.stack(items.I.ARROW, 10);
  const loaded = combat.loadCrossbow(g, p, cb);
  const arrows = p.inventory.main[5]?.count;
  const before = g.entities.filter((e) => e.typeName === 'Arrow').length;
  combat.fireCrossbow(g, p, cb, g.eyePos(1), (yaw, pitch) => g.lookVec(yaw, pitch));
  const after = g.entities.filter((e) => e.typeName === 'Arrow').length;
  return { loaded, arrows, shot: after - before, empty: !cb.charged, ticks: combat.crossbowLoadTicks({ ...cb, ench: { quick_charge: 3 } }) };
});
ok(xbow.loaded && xbow.arrows === 9, 'a crossbow loads one arrow');
ok(xbow.shot === 3 && xbow.empty, `multishot fires three (${xbow.shot})`);
ok(xbow.ticks === 10, 'quick charge III loads in half a second');

// tridents: thrown, they fly; a loyal one comes back
const trident = await mods((g, p, { items, combat }) => {
  const tr = { ...items.stack(items.I7.TRIDENT), ench: { loyalty: 3 } };
  p.inventory.main[p.inventory.selected] = tr;
  combat.releaseTrident(g, p, tr, 20, g.eyePos(1), g.lookVec(p.yaw, -30), () => p.inventory.setHeld(null), () => {});
  const thrown = g.entities.find((e) => e.typeName === 'Trident');
  const gone = !p.inventory.held();
  let back = false;
  if (thrown) { thrown.inGround = true; for (let i = 0; i < 200 && !thrown.removed; i++) thrown.tick(); back = thrown.removed && p.inventory.main.some((s) => s && s.id === items.I7.TRIDENT); }
  return { thrown: !!thrown, gone, back };
});
ok(trident.thrown && trident.gone, 'a trident is thrown from the hand');
ok(trident.back, 'and a loyal one returns to it');

// the totem of undying
const totem = await mods((g, p, { items }) => {
  p.inventory.offhand = items.stack(items.I7.TOTEM_OF_UNDYING);
  p.health = 2; p.invulnerable = 0; p.dead = false;
  p.damage(50, 'mob', null);
  const alive = !p.dead && p.health >= 1;
  const regen = p.effects.has('regeneration');
  p.health = 20; p.clearEffects();
  return { alive, regen, used: !p.inventory.offhand };
});
ok(totem.alive && totem.regen && totem.used, 'a totem of undying saves a dying player');

// mending, frost walker
const ench = await mods((g, p, { items, blocks, combat }) => {
  const sw = { ...items.stack(items.TOOLS.iron_sword), damage: 50, ench: { mending: 1 } };
  p.inventory.main[p.inventory.selected] = sw;
  const left = combat.mend(p, 10);
  const w = g.world, x0 = Math.floor(p.x), y = Math.floor(p.y) + 40, z0 = Math.floor(p.z);
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) { w.set(x0 + dx, y - 1, z0 + dz, blocks.B.WATER); w.set(x0 + dx, y, z0 + dz, 0); }
  p.inventory.armor[3] = { ...items.ARMOR.diamond_boots ? items.stack(items.ARMOR.diamond_boots) : items.stack(1), ench: { frost_walker: 2 } };
  p.setPos(x0 + 0.5, y, z0 + 0.5); p.onGround = true;
  combat.combatTick(p);
  const frozen = w.getId(x0 + 2, y - 1, z0) === blocks.B2.FROSTED_ICE;
  p.inventory.armor[3] = null;
  p.setPos(x0 + 0.5, y + 30, z0 + 0.5);
  return { damage: sw.damage, left, frozen };
});
ok(ench.damage === 30 && ench.left === 0, `mending turns xp into repairs (damage ${ench.damage}, xp left ${ench.left})`);
ok(ench.frozen, 'frost walker freezes the water underfoot');

// lightning: a pig becomes a zombified piglin, a creeper charges
const bolt = await mods((g, p, { combat }) => {
  g.options.difficulty = 2;
  const pig = g.interact.spawnMob('pig', p.x + 30, p.y, p.z);
  const cr = g.interact.spawnMob('creeper', p.x + 30.5, p.y, p.z + 0.5); cr.noAi = true;
  combat.strikeLightning(g, pig.x, pig.y, pig.z);
  return { pig: pig.removed && g.entities.some((e) => e.typeName === 'Zombified Piglin' && Math.abs(e.x - pig.x) < 0.1), charged: cr.charged };
});
ok(bolt.pig, 'lightning turns a pig into a zombified piglin');
ok(bolt.charged, 'and charges a creeper');

// netherite doesn't burn in lava
const lava = await mods((g, p, { items, blocks }) => {
  const w = g.world, x0 = Math.floor(p.x) - 10, y = Math.floor(p.y) + 40, z0 = Math.floor(p.z);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { w.set(x0 + dx, y - 1, z0 + dz, 1); w.set(x0 + dx, y, z0 + dz, blocks.B.LAVA); w.set(x0 + dx, y + 1, z0 + dz, 0); }
  const a = g.dropItem(x0 + 0.5, y + 0.3, z0 + 0.5, items.stack(items.TOOLS.netherite_sword));
  const b = g.dropItem(x0 + 0.5, y + 0.3, z0 + 0.5, items.stack(items.TOOLS.diamond_sword));
  for (let i = 0; i < 5; i++) { a.tick(); b.tick(); }
  return { netherite: !a.removed, diamond: b.removed };
});
ok(lava.netherite && lava.diamond, 'netherite floats in lava while diamond burns');

// pictures: a player-shaped mob can't hold a shield, so check the client's own player in third person
await t.page.evaluate(async () => {
  const { stack, I7, TOOLS } = await import('/src/game/items.ts');
  window.sim((g, p) => { p.inventory.main[p.inventory.selected] = stack(TOOLS.iron_sword); p.inventory.offhand = stack(I7.SHIELD); p.blocking = true; p.using = 'shield'; });
});
await wait(500);
await t.page.evaluate(() => { const c = window.game; c.thirdPerson = 2; const p = c.player; p.inventory.offhand = window.S().sp.entity.inventory.offhand; p.blocking = true; });
await wait(800);
await t.shot('combat-shield');
await t.page.evaluate(() => { const c = window.game; c.thirdPerson = 0; });
await wait(600);
await t.shot('combat-firstperson');

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
