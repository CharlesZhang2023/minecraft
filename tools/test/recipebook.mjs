// The recipe book in a running world: the green book in the inventory opens the list of recipes for what you carry;
// clicking one moves its ingredients into the grid (on the client and in the server's copy of the window alike).
//   node tools/test/recipebook.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 0 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

await t.page.evaluate(async () => {
  const { stack } = await import('/src/game/items.ts');
  const { B } = await import('/src/world/blocks.ts');
  return window.sim((g, p) => { p.inventory.main[0] = stack(B.OAK_LOG, 5); p.inventory.main[1] = null; });
});
await wait(500);
await t.page.keyboard.press('KeyE');
await wait(500);
const k = await t.page.evaluate(() => window.game.ui.gui.scale);
const at = (x, y) => t.page.mouse.click(x * k, y * k);
// the book button
let pos = await t.page.evaluate(() => { const s = window.game.ui.screen; return [s.left + 104 + 10, s.top + 61 + 9]; });
await at(pos[0], pos[1]);
await wait(400);
const list = await t.page.evaluate(() => { const s = window.game.ui.screen; return { open: s.book.open, items: s.book.list().map((e) => [window.__mc.ITEMS.get(e.r.out.id).name, e.can]) }; });
ok(list.open && list.items.some(([n, c]) => n === 'oak_planks' && c), `the book lists what the logs make (${JSON.stringify(list.items.slice(0, 4))})`);
await t.shot('recipe-book');
// click the planks recipe
pos = await t.page.evaluate(() => {
  const s = window.game.ui.screen, b = s.book, i = b.list().findIndex((e) => window.__mc.ITEMS.get(e.r.out.id).name === 'oak_planks');
  return [s.left - 147 - 2 + 11 + (i % 5) * 25 + 12, s.top + 31 + Math.floor(i / 5) * 25 + 12];
});
await at(pos[0], pos[1]);
await wait(600);
const filled = await t.page.evaluate(async () => {
  const client = window.game.ui.screen.grid.items.map((s) => s ? [window.__mc.ITEMS.get(s.id).name, s.count] : null);
  const server = await window.sim((g) => { const s = g.players[0].ui.screen; return { grid: s?.grid?.items.map((q) => q ? q.count : 0), logs: g.players[0].entity.inventory.main[0]?.count, result: s?.grid?.result?.count }; });
  return { client, server };
});
ok(filled.client[0]?.[0] === 'oak_log' && filled.server.grid?.[0] === 1 && filled.server.logs === 4, `clicking it fills the grid on both sides (${JSON.stringify(filled)})`);
ok(filled.server.result === 4, 'and the planks are ready to take');

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
