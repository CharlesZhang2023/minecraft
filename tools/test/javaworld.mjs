// Whole worlds to and from Java Edition with the Blueprints mod, in a browser: a world with a build, a chest of
// diamonds and a pig is exported as a Java world (.zip), imported back as a new world, and played: the build,
// the chest, the player's inventory and the pig are there. The world list's More... screen offers both.
//   node tools/test/javaworld.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 9090, mode: 1, mods: ['blueprints'] });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
const page = t.page;

// a build next to the player, a chest with diamonds, a pig, and a sword in the hotbar
const A = await t.sim((g, p) => {
  const B = window.__mc.BLOCKS, id = (n) => B.findIndex((b) => b?.name === n), w = g.world;
  const x0 = Math.floor(p.x) + 3, y0 = Math.floor(p.y), z0 = Math.floor(p.z) + 3;
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) w.set(x0 + x, y0 + y, z0, id('gold_block'));
  w.set(x0, y0, z0 + 2, id('oak_stairs') | (2 << 12));
  w.set(x0 + 2, y0, z0 + 2, id('chest'));
  w.setTile(x0 + 2, y0, z0 + 2, { type: 'chest', items: [{ id: window.__mc.ITEMS.get(264) ? 264 : 1, count: 9 }, ...new Array(26).fill(null)] });
  const pig = g.interact.spawnMob('pig', x0 + 1.5, y0, z0 + 5.5); pig.noAi = true;
  let sword = -1; for (const [k, d] of window.__mc.ITEMS) if (d.name === 'diamond_sword') sword = k;
  p.inventory.main[4] = { id: sword, count: 1, ench: { sharpness: 3 } };
  return [x0, y0, z0];
});
await wait(500);
const meta = await page.evaluate(async () => { const g = window.S().g; await g.saveWorld(); return { id: g.meta.id, name: g.meta.name }; });

// export, then import the zip as a new world
const res = await page.evaluate(async (wid) => {
  const bp = window.blueprints;
  const meta = (await (await import('/src/game/storage.ts')).Storage.listWorlds()).find((m) => m.id === wid);
  const ex = await bp.worlds.export(meta, { radius: 2 }, () => {});
  const ar = await bp.worlds.openZip(ex.zip);
  const scan = await bp.worlds.scan(ar);
  const im = await bp.worlds.import(ar, scan, { name: 'Back From Java', radius: null, dims: ['overworld', 'nether', 'end'] }, () => {});
  return { file: ex.file, size: ex.zip.size, chunks: ex.chunks, mobs: ex.mobs, names: ar.names.slice(0, 6), scanName: scan.level.name, player: !!scan.player, imported: im };
}, meta.id);
console.log('  ', JSON.stringify(res).slice(0, 400));
ok(res.chunks >= 13 && res.names.some((n) => n.endsWith('/level.dat')) && res.names.some((n) => /\/region\/r\.-?\d+\.-?\d+\.mca$/.test(n)), `exported a Java world (${res.chunks} chunks, ${(res.size / 1024).toFixed(0)} KB)`);
ok(res.mobs >= 1 && res.names.some((n) => n.includes('/entities/')), `with its mobs (${res.mobs})`);
ok(res.scanName === meta.name && res.player, 'its level.dat and player read back');
ok(res.imported.chunks === res.chunks, `imported every chunk (${res.imported.chunks})`);

// play the imported world
await page.evaluate(async (wid) => {
  const meta = (await (await import('/src/game/storage.ts')).Storage.listWorlds()).find((m) => m.id === wid);
  await window.game.closeWorld(true);
  await (await import('/src/ui/menus.ts')).playWorld(window.game.ui, meta);
}, res.imported.id);
await page.waitForFunction((wid) => window.S?.()?.g?.meta?.id === wid && window.game?.arrived && !window.game.ui.screen && window.game.loadProgress() > 0.99, res.imported.id, { timeout: 60000 });
await wait(1500);
const there = await t.sim((g, p, a) => {
  const B = window.__mc.BLOCKS, w = g.world, v = (x, y, z) => { const b = w.get(x, y, z); return `${B[b & 0xfff].name}:${b >>> 12}`; };
  const chest = w.getTile(a[0] + 2, a[1], a[2] + 2);
  return {
    name: g.meta.name, gold: v(a[0] + 1, a[1] + 1, a[2]), stairs: v(a[0], a[1], a[2] + 2), chest: chest?.items?.[0]?.count,
    sword: p.inventory.main[4]?.ench?.sharpness, pigs: g.entities.filter((e) => e.typeName === 'Pig').length, mode: p.gameMode,
    foreign: w.getChunk(a[0] >> 4, a[2] >> 4)?.foreign,
  };
}, A);
console.log('  ', JSON.stringify(there));
ok(there.name === 'Back From Java', 'the imported world opens');
ok(there.gold === 'gold_block:0' && there.stairs === 'oak_stairs:2', `the build is there (${there.gold}, ${there.stairs})`);
ok(there.chest === 9, `the chest kept its diamonds (${there.chest})`);
ok(there.sword === 3 && there.mode === 1, 'the player kept their enchanted sword and creative mode');
ok(there.pigs >= 1, `the pig came along (${there.pigs})`);
ok(there.foreign === true, 'imported chunks are marked as not from this game\'s generator');
await t.look(A[0] - 3, A[1] + 4, A[2] - 4, -37, 30);
await wait(800);
await t.shot('javaworld-imported');
await t.look(null);

// the world list offers both
await page.evaluate(async () => {
  const menus = await import('/src/ui/menus.ts');
  window.game.ui.open(new menus.SelectWorldScreen(window.game.ui));
});
await wait(800);
const more = await page.evaluate(() => { const s = window.game.ui.screen; const b = s.widgets.find((w) => w.label === 'More...'); if (b) b.onClick(); return !!b; });
await wait(300);
const labels = await page.evaluate(() => window.game.ui.screen.widgets.map((w) => (typeof w.label === 'function' ? w.label() : w.label)));
ok(more && labels.includes('Import Java World...') && labels.includes('Export to Java...'), `the world list's More... offers import and export (${labels.join(', ')})`);
await t.shot('javaworld-more');
await page.evaluate(() => { const s = window.game.ui.screen; s.widgets.find((w) => w.label === 'Import Java World...').onClick(); });
await wait(300);
await t.shot('javaworld-import-screen');

const modErrors = await page.evaluate(async () => (await import('/src/mod/state.ts')).modState.errors.get('blueprints') ?? []);
ok(!modErrors.length, `no mod errors ${JSON.stringify(modErrors).slice(0, 300)}`);
ok(!t.errors.length, `no page errors ${t.errors.slice(0, 3).join(' | ')}`);
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exit(fails.length ? 1 : 0);
