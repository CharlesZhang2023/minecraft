// Command blocks in a running world: an impulse block runs once when powered (its ~ is its own position), a chain
// block it points into runs after it, a repeating one keeps running, comparators read success; the editing screen
// (creative) writes the command through the server's twin.
//   node tools/test/commandblocks.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 1 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

const at = await t.page.evaluate(async () => {
  const { COMMAND_BLOCKS, pack, B } = await import('/src/world/blocks.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 3, y = Math.floor(p.y) + 10, z = Math.floor(p.z) + 3;
    for (let a = -2; a <= 6; a++) for (let c = -2; c <= 3; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 6; b++) w.set(x + a, y + b, z + c, 0); }
    // impulse facing east, then a chain block (always active)
    w.set(x, y, z, pack(COMMAND_BLOCKS[0], 5));
    w.setTile(x, y, z, { type: 'command', cmd: 'setblock ~ ~2 ~ stone', auto: false, powered: false, success: 0, last: '' });
    w.set(x + 1, y, z, pack(COMMAND_BLOCKS[1], 5));
    w.setTile(x + 1, y, z, { type: 'command', cmd: 'setblock ~ ~2 ~ glass', auto: true, powered: false, success: 0, last: '' });
    // a repeating block, always active, elsewhere
    w.set(x + 4, y, z + 2, pack(COMMAND_BLOCKS[2], 1));
    w.setTile(x + 4, y, z + 2, { type: 'command', cmd: 'setblock ~ ~3 ~ gold_block', auto: true, powered: false, success: 0, last: '' });
    g.ticker.schedule(x + 4, y, z + 2, 1);
    // power the impulse block
    w.set(x - 1, y, z, B.REDSTONE_BLOCK);
    return { x, y, z };
  });
});
await wait(1200);
const ran = await t.page.evaluate(async ({ x, y, z }) => {
  const { B } = await import('/src/world/blocks.ts');
  const { containerLevel } = await import('/src/game/devices.ts');
  return window.sim((g) => {
    const w = g.world;
    const name = (a, b, c) => window.__mc.BLOCKS[w.getId(a, b, c)].name;
    return { impulse: name(x, y + 2, z), chain: name(x + 1, y + 2, z), repeat: name(x + 4, y + 3, z + 2), out: w.getTile(x, y, z)?.last, comparator: containerLevel(w, x, y, z), stone: B.STONE };
  });
}, at);
ok(ran.impulse === 'stone', `a powered impulse block runs its command at its own position (${ran.impulse}; "${ran.out}")`);
ok(ran.chain === 'glass', `the chain block it points into runs next (${ran.chain})`);
ok(ran.repeat === 'gold_block', `a repeating block keeps running (${ran.repeat})`);
ok(ran.comparator === 1, 'comparators read its success');

// the screen: open it, type a command, Enter
await t.page.evaluate(async ({ x, y, z }) => {
  const { stationUse } = await import('/src/game/stations.ts');
  return window.sim((g, p) => { stationUse(g.interact, x, y, z, g.world.get(x, y, z), p.inventory.held()); });
}, at);
await wait(600);
const scr = await t.page.evaluate(() => window.game.ui.screen?.constructor?.name ?? null);
ok(scr === 'CommandBlockScreen', `using it in creative opens its screen (${scr})`);
await t.page.keyboard.press('Backspace');
for (let i = 0; i < 30; i++) await t.page.keyboard.press('Backspace');
await t.page.keyboard.type('say hello');
await wait(200);
await t.shot('command-block');
await t.page.keyboard.press('Enter');
await wait(600);
const cmd = await t.page.evaluate(({ x, y, z }) => window.sim((g) => g.world.getTile(x, y, z)?.cmd), at);
ok(cmd === 'say hello', `the server's copy writes the command (${cmd})`);

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
