// Command targets in a running world: @a/@p/@e/@s/@r with filters on /give, /kill, /effect, /tp and /execute;
// /say names selectors and signs command blocks with "@"; a command block powered through the solid block a lever
// stands on runs (and acts on the nearest player with @p).
//   node tools/test/selectors.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 1 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

const r = await t.page.evaluate(async () => {
  const { I } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x), y = Math.floor(p.y) + 20, z = Math.floor(p.z);
    for (let a = -6; a <= 6; a++) for (let c = -6; c <= 6; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 8; b++) w.set(x + a, y + b, z + c, 0); }
    p.setPos(x + 0.5, y, z + 0.5);
    const run = (s) => g.commands.run(s);
    const count = (id) => p.inventory.main.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
    const out = {};
    p.inventory.clear();
    out.give = run('/give @a diamond 2'); out.diamonds = count(I.DIAMOND);
    out.giveSelf = run('/give @s emerald'); out.emeralds = count(I.EMERALD);
    const zs = [2, 3, 4].map((d) => { const m = g.interact.spawnMob('zombie', x + d + 0.5, y, z + 0.5); m.noAi = true; return m; });
    const pig = g.interact.spawnMob('pig', x - 3 + 0.5, y, z + 0.5); pig.noAi = true;
    out.kill = run('/kill @e[type=zombie,distance=..10,limit=2,sort=nearest]');
    out.zombiesLeft = zs.map((m, i) => (!m.dead && !m.removed && m.health > 0 ? i : -1)).filter((i) => i >= 0);
    out.effect = run('/effect give @e[type=zombie] speed 10 1');
    out.speed = zs[2].effects.has('speed');
    out.tp = run('/tp @e[type=pig] ~ ~3 ~');
    out.pigY = Math.round(pig.y - y);
    out.exec = run('/execute as @e[type=pig] at @s run setblock ~ ~2 ~ gold_block');
    out.gold = window.__mc.BLOCKS[w.getId(Math.floor(pig.x), Math.floor(pig.y) + 2, Math.floor(pig.z))].name;
    out.ifBlock = run(`/execute if block ~ ~-1 ~ stone`);
    out.unless = run(`/execute unless entity @e[type=pig]`);
    out.bad = run('/kill @x');
    out.none = run('/kill @e[type=creeper]');
    out.name = g.playerOf(p).name;
    out.says = run('/say hello @p');
    out.gm = run('/gamemode survival @s');
    out.mode = p.gameMode;
    run('/gamemode creative');
    return out;
  });
});
ok(r.diamonds === 2 && /to /.test(r.give[0]), `/give @a (${r.give}; ${r.diamonds})`);
ok(r.emeralds === 1, `/give @s (${r.giveSelf})`);
ok(JSON.stringify(r.zombiesLeft) === '[2]', `/kill @e[type=zombie,distance=..10,limit=2,sort=nearest] kills the two nearest (${r.kill}; left ${JSON.stringify(r.zombiesLeft)})`);
ok(r.speed, `/effect give @e[type=zombie] (${r.effect})`);
ok(r.pigY === 3, `/tp @e[type=pig] ~ ~3 ~ (from the runner: ${r.tp}; ${r.pigY})`);
ok(r.gold === 'gold_block', `/execute as @e at @s run ... runs at each entity (${r.exec}; ${r.gold})`);
ok(r.ifBlock[0] === 'Test passed' && r.unless[0]?.startsWith('§c'), `/execute if block passes, unless entity fails (${r.ifBlock} / ${r.unless})`);
ok(r.bad[0]?.startsWith('§c') && r.none[0]?.includes('No entity'), `bad or empty selectors are errors (${r.bad} / ${r.none})`);
ok(r.mode === 0, `/gamemode survival @s (${r.gm})`);
await wait(400);
const chat1 = await t.page.evaluate(() => window.game.ui.chat.lines.map((l) => l.text));
ok(chat1.some((l) => l === `[${r.name}] hello ${r.name}`), `/say names selectors and goes to everyone (${chat1.slice(0, 3)})`);

// a command block powered through the stone a lever stands on
const cb = await t.page.evaluate(async () => {
  const { COMMAND_BLOCKS, B, pack } = await import('/src/world/blocks.ts');
  const { I } = await import('/src/game/items.ts');
  const at = await window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 3, y = Math.floor(p.y), z = Math.floor(p.z) - 3;
    p.inventory.clear();
    w.set(x, y, z, pack(COMMAND_BLOCKS[0], 1));
    w.setTile(x, y, z, { type: 'command', cmd: 'give @p[distance=..30] gold_ingot 3', auto: false, powered: false, success: 0, last: '' });
    w.set(x + 1, y, z + 2, pack(COMMAND_BLOCKS[0], 1));
    w.setTile(x + 1, y, z + 2, { type: 'command', cmd: 'say ready', auto: false, powered: false, success: 0, last: '' });
    w.set(x - 1, y, z, B.STONE);
    w.set(x - 1, y + 1, z, pack(B.LEVER, 0));
    w.set(x + 1, y, z + 1, B.STONE);
    w.set(x + 1, y + 1, z + 1, pack(B.LEVER, 0));
    return { x, y, z };
  });
  await new Promise((res) => setTimeout(res, 300));
  await window.sim((g) => { g.redstone.toggleLever(at.x - 1, at.y + 1, at.z); g.redstone.toggleLever(at.x + 1, at.y + 1, at.z + 1); });
  await new Promise((res) => setTimeout(res, 800));
  return window.sim((g, p) => ({ gold: p.inventory.main.reduce((n, s) => n + (s?.id === I.GOLD_INGOT ? s.count : 0), 0), last: g.world.getTile(at.x, at.y, at.z)?.last, success: g.world.getTile(at.x, at.y, at.z)?.success }));
});
ok(cb.gold === 3, `a command block powered through the block a lever is on runs, @p finds the player (${JSON.stringify(cb)})`);
await wait(300);
const chat2 = await t.page.evaluate(() => window.game.ui.chat.lines.map((l) => l.text));
ok(chat2.some((l) => l === '[@] ready'), `command blocks sign /say with @ (${chat2.slice(0, 3)})`);

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
