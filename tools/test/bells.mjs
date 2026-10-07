// Bells, glowing and honey in a running world: a rung bell makes raiders nearby glow (drawn through walls) and sends
// villagers home; a piston pushing a honey block drags what's stuck to it, but not the slime block beside it.
//   node tools/test/bells.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 1 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

const bell = await t.page.evaluate(async () => {
  const { B2 } = await import('/src/world/blocks.ts');
  const { ringBell } = await import('/src/game/stations.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x), y = Math.floor(p.y) + 20, z = Math.floor(p.z) + 6;
    for (let a = -6; a <= 6; a++) for (let c = -3; c <= 8; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 4; b++) w.set(x + a, y + b, z + c, 0); }
    // a wall between the camera and the pillager
    for (let a = -3; a <= 3; a++) for (let b = 0; b < 4; b++) w.set(x + a, y + b, z + 2, 1);
    w.set(x + 4, y, z, B2.BELL);
    const pil = g.interact.spawnMob('pillager', x + 0.5, y, z + 4.5);
    pil.noAi = true;
    const vil = g.interact.spawnMob('villager', x - 3.5, y, z);
    vil.home = { x: x - 5, y, z: z + 6 };
    ringBell(g, x + 4, y, z);
    return { x, y, z, glowing: pil.effects.has('glowing'), going: !!vil.path };
  });
});
ok(bell.glowing, 'a bell makes raiders nearby glow');
ok(bell.going, 'and sends villagers home');
await wait(700);
await t.look(bell.x + 0.5, bell.y + 1.6, bell.z - 2, 0, 5, 70);
await wait(700);
await t.shot('bell-glow');
await t.look(null);

const honey = await t.page.evaluate(async () => {
  const { B, B2, pack } = await import('/src/world/blocks.ts');
  const r = await window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) - 8, y = Math.floor(p.y) + 20, z = Math.floor(p.z) - 8;
    for (let a = -2; a <= 6; a++) for (let c = -2; c <= 3; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 4; b++) w.set(x + a, y + b, z + c, 0); }
    w.set(x, y, z, pack(B.PISTON, 5));
    w.set(x + 1, y, z, B2.HONEY_BLOCK);
    w.set(x + 1, y + 1, z, B.COBBLESTONE);
    w.set(x + 1, y, z + 1, B.SLIME_BLOCK);
    w.set(x - 1, y, z, B.REDSTONE_BLOCK);
    return { x, y, z };
  });
  await new Promise((res) => setTimeout(res, 1500));
  return window.sim((g) => {
    const w = g.world, { x, y, z } = r;
    return { honey: w.getId(x + 2, y, z) === B2.HONEY_BLOCK, stone: w.getId(x + 2, y + 1, z) === B.COBBLESTONE, slime: w.getId(x + 1, y, z + 1) === B.SLIME_BLOCK };
  });
});
ok(honey.honey && honey.stone, 'a pushed honey block drags the block stuck on it');
ok(honey.slime, 'but not a slime block beside it');

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
