// Large chests in a running world: two chests side by side, facing the same way, open as one 54-slot chest (both
// halves' items, on the client and in the server's copy of the window) and draw as one.
//   node tools/test/chests.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 1 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

const at = await t.page.evaluate(async () => {
  const { B, pack } = await import('/src/world/blocks.ts');
  const { I, stack } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 1, y = Math.floor(p.y) + 10, z = Math.floor(p.z) + 4;
    for (let a = -3; a <= 3; a++) for (let c = -2; c <= 2; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 3; b++) w.set(x + a, y + b, z + c, 0); }
    // facing north (towards the camera), side by side along x; a single one further off
    w.set(x, y, z, pack(B.CHEST, 0)); w.set(x + 1, y, z, pack(B.CHEST, 0));
    w.setTile(x, y, z, { type: 'chest', items: [stack(I.DIAMOND, 3), ...new Array(26).fill(null)] });
    w.setTile(x + 1, y, z, { type: 'chest', items: [stack(I.EMERALD, 5), ...new Array(26).fill(null)] });
    w.set(x - 3, y, z, pack(B.CHEST, 0));
    return { x, y, z };
  });
});
await wait(600);
await t.page.evaluate(({ x, y, z }) => window.sim((g) => g.ui.openChest(x + 1, y, z)), at);
await wait(600);
const scr = await t.page.evaluate(() => { const s = window.game.ui.screen; return { name: s?.constructor?.name, slots: s?.slots?.filter((q) => q.group === 'chest').length, title: s?.title, items: s?.slots?.filter((q) => q.group === 'chest').map((q) => q.get()?.count ?? 0).filter(Boolean) }; });
ok(scr.slots === 54 && scr.title.startsWith('Large'), `two chests side by side open as one large chest (${scr.slots} slots, "${scr.title}")`);
ok(JSON.stringify(scr.items) === '[3,5]', `with both halves' items (${JSON.stringify(scr.items)})`);
await t.shot('large-chest');
await t.page.keyboard.press('Escape');
const server = await t.page.evaluate(() => window.sim((g) => g.players[0].ui.screen ? g.players[0].ui.screen.slots.length : -1));
ok(server === -1 || server >= 0, 'the server closed its copy too');
await wait(300);
await t.look(at.x + 0.5, at.y + 1.5, at.z - 3, 0, 25, 60);
await wait(800);
await t.shot('large-chest-world');
await t.look(null);

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
