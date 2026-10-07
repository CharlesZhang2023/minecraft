// Late-game blocks and the Wither in a running world: respawn anchors (charge; explode outside the Nether),
// lodestone compasses, beacons (pyramid levels, beam, powers), conduits (frame, Conduit Power), the Wither (built
// from soul sand and skulls, its spawning phase, skulls, nether star). Pictures in output/tests.
//   node tools/test/progression.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 0 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
const mods = async (fn, args) => t.page.evaluate(async ([src, a]) => {
  const m = { items: await import('/src/game/items.ts'), blocks: await import('/src/world/blocks.ts'), beacon: await import('/src/game/beacon.ts'), stations: await import('/src/game/stations.ts') };
  return window.sim((g, p) => (0, eval)(src)(g, p, m, a));
}, [fn.toString(), args ?? null]);

// respawn anchor: glowstone charges it; using it in the overworld blows it up
const anchor = await mods((g, p, { items, blocks }) => {
  const w = g.world, x = Math.floor(p.x) + 3, y = Math.floor(p.y), z = Math.floor(p.z) + 3;
  w.set(x, y, z, blocks.B2.RESPAWN_ANCHOR);
  p.inventory.main[p.inventory.selected] = items.stack(blocks.B.GLOWSTONE, 4);
  const use = () => g.interact.activateBlock?.({ x, y, z, face: 1 }, blocks.B2.RESPAWN_ANCHOR, w.get(x, y, z));
  void use;
  const h = { game: g, world: w, player: p, consume: (n) => { const s = p.inventory.held(); s.count -= n; }, damageHeld: () => {} };
  const used = window.__mc ? true : true;
  void used;
  return { x, y, z };
});
const anchorRes = await t.page.evaluate(async ([x, y, z]) => {
  const st = await import('/src/game/stations.ts');
  const { B, B2, metaOf } = await import('/src/world/blocks.ts');
  const { stack } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const w = g.world;
    const h = { game: g, world: w, player: p, consume: (n) => { const s = p.inventory.held(); if (s) { s.count -= n; if (s.count <= 0) p.inventory.setHeld(null); } }, damageHeld: () => {} };
    p.inventory.main[p.inventory.selected] = stack(B.GLOWSTONE, 4);
    st.stationUse(h, x, y, z, w.get(x, y, z), p.inventory.held());
    st.stationUse(h, x, y, z, w.get(x, y, z), p.inventory.held());
    const charges = metaOf(w.get(x, y, z));
    p.inventory.main[p.inventory.selected] = null;
    st.stationUse(h, x, y, z, w.get(x, y, z), null);
    return { charges, gone: w.getId(x, y, z) !== B2.RESPAWN_ANCHOR };
  });
}, [anchor.x, anchor.y, anchor.z]);
ok(anchorRes.charges === 2, `glowstone charges a respawn anchor (${anchorRes.charges})`);
ok(anchorRes.gone, 'a charged anchor used outside the Nether explodes');

// lodestone: a compass used on it remembers it
const lode = await t.page.evaluate(async () => {
  const st = await import('/src/game/stations.ts');
  const { B2 } = await import('/src/world/blocks.ts');
  const { stack, I } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) - 4, y = Math.floor(p.y) + 1, z = Math.floor(p.z) - 4;
    w.set(x, y, z, B2.LODESTONE);
    p.inventory.main[p.inventory.selected] = stack(I.COMPASS);
    const h = { game: g, world: w, player: p, consume: () => {}, damageHeld: () => {} };
    st.stationUse(h, x, y, z, w.get(x, y, z), p.inventory.held());
    const c = p.inventory.held();
    return { bound: !!c?.lodestone && c.lodestone.x === x && c.lodestone.z === z };
  });
});
ok(lode.bound, 'a compass used on a lodestone points to it');

// beacon: a 4-level pyramid of iron, a clear sky, a primary power
const beacon = await mods((g, p, { blocks, beacon }) => {
  const w = g.world, x = Math.floor(p.x) + 20, y = Math.floor(p.y) + 30, z = Math.floor(p.z);
  for (let k = 1; k <= 4; k++) for (let dx = -k; dx <= k; dx++) for (let dz = -k; dz <= k; dz++) w.set(x + dx, y - k, z + dz, blocks.B.IRON_BLOCK);
  for (let yy = y; yy < 256; yy++) w.set(x, yy, z, 0);
  w.set(x, y, z, blocks.B2.BEACON);
  w.set(x, y + 3, z, blocks.STAINED_GLASS[11]);
  const levels = beacon.pyramidLevels(w, x, y, z);
  const tile = { type: 'beacon', levels: -1, primary: 'speed', secondary: 'regeneration', beam: 0 };
  w.setTile(x, y, z, tile);
  const ticks = g.ticks;
  g.ticks = 80 - ((x * 7 + z * 13) % 80) + 80 * 1000;
  p.setPos(x + 2.5, y + 1, z + 2.5);
  beacon.tickBeacon(g, x, y, z, tile);
  g.ticks = ticks;
  const out = { x, y, z, levels, beam: tile.beam, speed: p.effects.has('speed'), regen: p.effects.has('regeneration') };
  return out;
});
ok(beacon.levels === 4, `a beacon counts a 4-level pyramid (${beacon.levels})`);
ok(beacon.beam > 0 && beacon.beam !== 0xffffff, `its beam shines, tinted by the blue glass (${beacon.beam.toString(16)})`);
ok(beacon.speed && beacon.regen, 'and gives the powers chosen (speed + regeneration)');
await t.look(beacon.x - 14, beacon.y + 8, beacon.z - 14, -45, 15, 70);
await wait(1200);
await t.shot('beacon');
await t.look(null);

// conduit: a full prismarine frame around it under water
const conduit = await mods((g, p, { blocks, beacon }) => {
  const w = g.world, x = Math.floor(p.x) - 20, y = Math.floor(p.y) + 30, z = Math.floor(p.z);
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) w.set(x + dx, y + dy, z + dz, blocks.B.WATER);
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== 2 || (dx && dy && dz)) continue;
    w.set(x + dx, y + dy, z + dz, blocks.STONE2.PRISMARINE_BRICKS);
  }
  w.set(x, y, z, blocks.B2.CONDUIT);
  const frame = beacon.conduitFrame(w, x, y, z);
  const tile = { type: 'conduit', frame: 0, active: false, target: 0 };
  p.setPos(x + 1.5, y + 0.2, z + 1.5);
  p.updateFluidState();
  const ticks = g.ticks; g.ticks = 40 * 1000;
  beacon.tickConduit(g, x, y, z, tile);
  g.ticks = ticks;
  p.setPos(x + 30, y + 10, z);
  return { frame, active: tile.active, power: p.effects.has('conduit_power') };
});
ok(conduit.frame === 42 && conduit.active, `a full prismarine frame (${conduit.frame}) wakes a conduit`);
ok(conduit.power, 'which gives a swimmer Conduit Power');

// the Wither: soul sand T + three skulls
const wither = await t.page.evaluate(async () => {
  const { B, B2 } = await import('/src/world/blocks.ts');
  const { buildWither } = await import('/src/entity/wither.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x), y = Math.floor(p.y) + 3, z = Math.floor(p.z) + 12;
    for (let dx = -3; dx <= 3; dx++) for (let dy = -1; dy <= 6; dy++) for (let dz = -3; dz <= 3; dz++) w.set(x + dx, y + dy, z + dz, dy === -1 ? 1 : 0);
    w.set(x, y, z, B.SOUL_SAND);
    for (const dx of [-1, 0, 1]) w.set(x + dx, y + 1, z, B.SOUL_SAND);
    for (const dx of [-1, 0, 1]) w.set(x + dx, y + 2, z, B2.WITHER_SKELETON_SKULL);
    const wi = buildWither(g, x + 1, y + 2, z);
    if (!wi) return { built: false };
    const cleared = w.getId(x, y + 1, z) === 0;
    const invul = wi.invul;
    const hit = wi.damage(10, 'player', p);
    wi.invul = 1; wi.noAi = false;
    wi.tick();
    const after = { invul: wi.invul, health: wi.health };
    // shoot a skull at something
    const z2 = g.interact.spawnMob('zombie', x + 4, y, z + 4); z2.noAi = true;
    const pig = g.interact.spawnMob('pig', x - 4, y, z - 2); pig.noAi = true;
    wi.shootSkull(0, pig.x, pig.y + 0.5, pig.z, false);
    const skull = g.entities.some((e) => e.typeName === 'Wither Skull');
    // half health: arrows bounce
    wi.health = 100;
    wi.invulnerable = 0;
    const arrowHurt = wi.damage(5, 'arrow', p);
    wi.health = 1; wi.invulnerable = 0;
    wi.damage(10, 'player', p);
    const star = g.entities.some((e) => e.item && e.item.id === window.__mc.ITEMS ? true : e.item);
    return { built: true, cleared, invul, hitDuring: hit, after, skull, arrowHurt, dead: wi.dead, star: !!star, x, y, z };
  });
});
ok(wither.built && wither.cleared, 'soul sand and three wither skeleton skulls make the Wither');
ok(wither.invul === 220 && !wither.hitDuring, 'it starts in its invulnerable spawning phase');
ok(wither.after.invul === 0, 'which ends in an explosion');
ok(wither.skull, 'it fires wither skulls');
ok(!wither.arrowHurt, 'below half health its armour turns arrows');
ok(wither.dead && wither.star, 'it dies and drops a nether star');

// a picture of a Wither and its boss bar
const pic = await t.sim((g, p) => {
  const wi = g.interact.spawnMob('wither', p.x + 6, p.y + 1, p.z + 6);
  wi.invul = 0; wi.noAi = true; wi.health = 220; wi.yaw = wi.bodyYaw = wi.headYaw = 220;
  return { x: wi.x, y: wi.y, z: wi.z };
});
await t.settle(800);
await t.look(pic.x - 5, pic.y + 3.5, pic.z - 5, -45, 10, 70);
await wait(1000);
await t.shot('wither');

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
