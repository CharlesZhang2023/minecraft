// Signs and shulker boxes in a running world: typing on a sign (through the client's screen and the server's
// twin), the words drawn on standing and wall signs; a shulker box keeping its contents when broken.
//   node tools/test/signs.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 1 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

const at = await t.page.evaluate(async () => {
  const { WOOD, pack } = await import('/src/world/blocks.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 3, y = Math.floor(p.y) + 1, z = Math.floor(p.z) + 4;
    for (let a = -3; a <= 3; a++) for (let b = 0; b < 4; b++) for (let c = -1; c <= 3; c++) w.set(x + a, y + b, z + c, 0);
    for (let a = -3; a <= 3; a++) for (let c = -1; c <= 3; c++) w.set(x + a, y - 1, z + c, 1);
    for (let a = -3; a <= 3; a++) for (let b = 0; b < 4; b++) w.set(x + a, y + b, z + 3, 1);
    // a standing sign facing the player, and a wall sign on the wall behind
    w.set(x - 1, y, z, pack(WOOD.oak.sign, 8));
    w.set(x + 1, y + 1, z + 2, pack(WOOD.spruce.wallSign, 2));
    g.ui.openSign(x - 1, y, z);
    return { x, y, z };
  });
});
await wait(600);
const open = await t.page.evaluate(() => window.game.ui.screen?.constructor?.name ?? null);
ok(!!open, 'placing a sign opens the edit screen');
await t.page.keyboard.type('Hello');
await t.page.keyboard.press('Enter');
await t.page.keyboard.type('Minecraft 1.16');
await wait(300);
await t.page.keyboard.press('Escape');
await wait(600);
const lines = await t.page.evaluate(([x, y, z]) => window.sim((g) => g.world.getTile(x - 1, y, z)?.lines ?? null), [at.x, at.y, at.z]);
ok(lines && lines[0] === 'Hello' && lines[1] === 'Minecraft 1.16', `the server's sign holds the text (${JSON.stringify(lines)})`);
await t.page.evaluate(([x, y, z]) => window.sim((g) => g.world.setTile(x + 1, y + 1, z + 2, { type: 'sign', lines: ['', 'Wall sign', 'text here', ''] })), [at.x, at.y, at.z]);
await wait(800);
await t.look(at.x + 0.5, at.y + 1.4, at.z - 2.5, 0, 12, 60);
await wait(800);
const dyed = await t.page.evaluate(async ([x, y, z]) => {
  const { DYES, stack } = await import('/src/game/items.ts');
  const { stationUse } = await import('/src/game/stations.ts');
  return window.sim((g, p) => {
    p.inventory.main[p.inventory.selected] = stack(DYES[14]);
    stationUse(g.interact, x + 1, y + 1, z + 2, g.world.get(x + 1, y + 1, z + 2), p.inventory.held());
    return g.world.getTile(x + 1, y + 1, z + 2)?.color;
  });
}, [at.x, at.y, at.z]);
ok(dyed === 14, `a dye colours a sign's words (${dyed})`);
await wait(800);
await t.shot('signs');
await t.look(null);

// shulker boxes: open, fill, break: the item keeps the contents; placing it brings them back
const box = await t.page.evaluate(async () => {
  const { B2 } = await import('/src/world/blocks.ts');
  const { I, stack } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) - 3, y = Math.floor(p.y) + 1, z = Math.floor(p.z) - 3;
    w.set(x, y - 1, z, 1); w.set(x, y, z, B2.SHULKER_BOX); w.set(x, y + 1, z, 0);
    w.setTile(x, y, z, { type: 'chest', items: new Array(27).fill(null) });
    w.getTile(x, y, z).items[3] = stack(I.DIAMOND, 7);
    p.setGameMode(0);
    g.interact.breakBlock(x, y, z);
    const drop = g.entities.find((e) => e.item?.id === B2.SHULKER_BOX);
    const kept = drop?.item?.box?.[3]?.count === 7;
    // put it back
    p.inventory.main[p.inventory.selected] = { ...drop.item };
    drop.removed = true;
    w.set(x, y, z, 0);
    const placed = g.interact.placeBlock({ x, y: y - 1, z, face: 3, hx: x + 0.5, hy: y, hz: z + 0.5 }, p.inventory.held(), window.__mc.ITEMS.get(B2.SHULKER_BOX));
    const back = w.getTile(x, y, z)?.items?.[3]?.count === 7;
    p.setGameMode(1);
    return { kept, placed, back };
  });
});
ok(box.kept, 'a broken shulker box keeps its contents in the item');
ok(box.placed && box.back, 'and placing it puts them back');

// a wither rose withers what walks into it
const rose = await t.page.evaluate(async () => {
  const { B2 } = await import('/src/world/blocks.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) - 4, y = Math.floor(p.y) + 20, z = Math.floor(p.z) - 4;
    w.set(x, y - 1, z, 2); w.set(x, y, z, B2.WITHER_ROSE);
    const pig = g.interact.spawnMob('pig', x + 0.5, y, z + 0.5);
    pig.noAi = true;
    return pig.id;
  });
});
await wait(800);
const withered = await t.page.evaluate((id) => window.sim((g) => g.entities.find((e) => e.id === id)?.effects?.has('wither')), rose);
ok(withered, 'a wither rose withers a pig standing in it');

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
