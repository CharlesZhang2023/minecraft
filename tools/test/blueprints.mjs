// The Blueprints mod (mods/blueprints) in a running world: the wand picks corners, a selection saves to the
// library, a placement turned a quarter shows as ghost blocks and is verified, pasting builds it (chest contents
// and sign text included) and undo takes it back, files written as .litematic / .schem / .nbt read back the
// same, and easy place puts the right block in the right state from the hotbar. Pictures in output/tests.
//   node tools/test/blueprints.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 4242, mode: 1, mods: ['blueprints'] });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
const page = t.page;
const ev = (fn, args) => page.evaluate(([src, a]) => (0, eval)(src)(window.blueprints, window.game, a), [fn.toString(), args ?? null]);

ok(await page.evaluate(() => !!window.blueprints), 'the mod is loaded');

// a little build in the air above the player: a stone floor, stairs, a chest with diamonds, a sign, a fence, glass
const A = await t.sim((g, p) => {
  const B = window.__mc.BLOCKS, id = (n) => B.findIndex((b) => b?.name === n), w = g.world;
  const x0 = Math.floor(p.x) + 4, y0 = Math.floor(p.y) + 10, z0 = Math.floor(p.z) - 2;
  for (let x = -12; x <= 20; x++) for (let y = -1; y <= 6; y++) for (let z = -12; z <= 20; z++) w.set(x0 + x, y0 + y, z0 + z, 0);
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) w.set(x0 + x, y0, z0 + z, id('stone'));
  w.set(x0 + 1, y0 + 1, z0 + 1, id('oak_stairs') | (1 << 12));
  w.set(x0 + 3, y0 + 1, z0 + 1, id('chest') | (2 << 12));
  w.setTile(x0 + 3, y0 + 1, z0 + 1, { type: 'chest', items: [{ id: window.__mc.ITEMS.get(264) ? 264 : id('diamond_block'), count: 3 }, ...new Array(26).fill(null)] });
  w.set(x0 + 1, y0 + 1, z0 + 3, id('oak_fence'));
  w.set(x0 + 2, y0 + 1, z0 + 3, id('oak_fence'));
  w.set(x0 + 3, y0 + 1, z0 + 3, id('oak_sign') | (4 << 12));
  w.setTile(x0 + 3, y0 + 1, z0 + 3, { type: 'sign', lines: ['Blue', 'prints', '', ''] });
  w.set(x0, y0 + 2, z0, id('glass'));
  p.setPos(x0 + 2.5, y0 + 1, z0 + 2.5);
  p.flying = true;
  return [x0, y0, z0];
});
await t.settle(2000);

// the wand: hold it, look down at the floor, left-click
await t.sim((g, p) => { const it = window.__mc.ITEMS; let wid = -1; for (const [k, d] of it) if (d.key === 'blueprints:wand') wid = k; p.inventory.main[0] = { id: wid, count: 1 }; p.inventory.selected = 0; });
await wait(300);
await page.evaluate(() => { const g = window.game, p = g.player; p.pitch = p.ppitch = 90; g.input.pointerLocked = true; });
await wait(300);
await page.evaluate(() => { window.game.input.mousePressedQ.push(0); });
await wait(300);
const corner = await ev((bp) => bp.state.boxes[0]?.a);
ok(corner && corner[0] === A[0] + 2 && corner[1] === A[1] && corner[2] === A[2] + 2, `the wand picks a corner (${corner})`);
const broke = await t.sim((g, p, a) => g.world.getId(a[0] + 2, a[1], a[2] + 2), A);
ok(broke !== 0, 'and the click doesn\'t break the block');

// save the build
await ev((bp, g, a) => { bp.state.boxes = [{ a: [a[0], a[1], a[2]], b: [a[0] + 4, a[1] + 2, a[2] + 4] }]; bp.state.active = 0; bp.changed(); }, A);
const saved = await ev(async (bp, g) => {
  const s = bp.capture(g, 'Test Hut');
  await bp.library.put(s);
  const list = await bp.library.list();
  const r = s.regions[0];
  return { id: s.id, n: list.length, size: r.size, pal: r.palette.map((p) => p.name + JSON.stringify(p.props)), tiles: r.tiles.map((t) => t.game?.type) };
});
ok(saved.n === 1 && saved.size.join() === '5,3,5', `saved to the library (${saved.size})`);
ok(saved.pal.some((p) => p.startsWith('minecraft:oak_stairs') && p.includes('"facing":"east"')), 'stairs keep their facing in Java words');
ok(saved.pal.some((p) => p.startsWith('minecraft:oak_fence') && p.includes('"east":"true"')), 'fences know their sides');
ok(saved.tiles.includes('chest') && saved.tiles.includes('sign'), 'the chest and sign come along');

// place it 10 blocks east, turned a quarter: ghost blocks, all missing
const B0 = [A[0] + 10, A[1], A[2]];
await ev(async (bp, g, a) => {
  const s = await bp.library.get((await bp.library.list())[0].id);
  bp.addPlacement(new bp.Placement({ id: bp.newId(), schematicId: s.id, name: s.name, origin: a, rotation: 1, mirror: 0, visible: true }, s));
}, B0);
await page.evaluate(() => { const p = window.game.player; p.pitch = p.ppitch = 20; p.yaw = p.pyaw = -90; });
await wait(2500);
const tot = await ev((bp) => bp.totals());
ok(tot.missing === 31 && tot.correct === 0, `the placement is all missing (${tot.missing} missing, ${tot.correct} right)`);
const ghosts = await page.evaluate(() => window.game.ghostLayers.reduce((n, l) => n + [...l.columns.values()].filter((c) => c.mesh).length, 0));
ok(ghosts > 0, `ghost blocks are meshed (${ghosts} columns)`);
await t.look(B0[0] - 3, B0[1] + 4, B0[2] + 6, 225, 30);
await wait(800);
await t.shot('blueprints-ghost');
await t.look(null);

// paste it, then check it was turned: the stairs face south, the chest keeps its diamonds, the sign its words
await ev((bp) => bp.paste('all'));
await page.waitForFunction(() => !window.blueprints.pasting(), null, { timeout: 20000 });
await wait(1500);
const pasted = await t.sim((g, p, a) => {
  const w = g.world, B = window.__mc.BLOCKS;
  // cell (x, z) turned clockwise lands at (-z, x)
  const at = (x, y, z) => { const v = w.get(a[0] - z, a[1] + y, a[2] + x); return `${B[v & 0xfff].name}:${v >>> 12}`; };
  const chest = w.getTile(a[0] - 1, a[1] + 1, a[2] + 3), sign = w.getTile(a[0] - 3, a[1] + 1, a[2] + 3);
  return { stairs: at(1, 1, 1), chest: at(3, 1, 1), floor: at(4, 0, 4), items: chest?.items?.[0]?.count, sign: sign?.lines?.join(' ') };
}, B0);
ok(pasted.stairs === 'oak_stairs:2', `stairs turned to face south (${pasted.stairs})`);
ok(pasted.chest === 'chest:3', `the chest turned to face west (${pasted.chest})`);
ok(pasted.floor === 'stone:0' && pasted.items === 3, `the floor and the chest's diamonds are there (${pasted.floor}, ${pasted.items})`);
ok(pasted.sign === 'Blue prints  ', `the sign keeps its words (${pasted.sign})`);
await wait(1000);
const after = await ev((bp) => bp.totals());
ok(after.missing === 0 && after.wrongBlock === 0 && after.correct >= 30, `the verifier sees it done (${after.correct} right, ${after.missing} missing, ${after.wrongState} wrong state)`);

// undo
await ev((bp) => bp.undo());
await wait(1000);
const undone = await t.sim((g, p, a) => g.world.getId(a[0] - 4, a[1], a[2] + 4), B0);
ok(undone === 0, 'undo takes the paste back');

// files: write each format (for an older and a newer Java), read it back, compare cell by cell
const files = await ev(async (bp) => {
  const s = await bp.library.get((await bp.library.list())[0].id);
  const out = {};
  for (const f of ['litematic', 'schem', 'nbt']) for (const dv of [2586, 3700, 4671]) {
    const w = await bp.write(s, f, dv);
    const r = (await bp.read(w.data, 'x.' + f)).schematic.regions[0], o = s.regions[0];
    let diff = 0;
    for (let i = 0; i < o.blocks.length; i++) {
      const a = o.palette[o.blocks[i]], b = r.palette[r.blocks[i]];
      const key = (st) => st.name + JSON.stringify(Object.entries(st.props).sort());
      if (key(a) !== key(b)) diff++;
    }
    out[`${f}@${dv}`] = `${diff}/${r.tiles.length}`;
  }
  return out;
});
ok(Object.values(files).every((v) => v === '0/2'), `files round-trip in every format and version (${JSON.stringify(files)})`);

// easy place in survival: the stairs come from the hotbar, facing the way the schematic says
await t.sim((g, p) => { p.gameMode = 0; p.flying = false; });
const stairsItem = await t.sim(() => window.__mc.BLOCKS.findIndex((b) => b?.name === 'oak_stairs'));
await t.sim((g, p, it) => { p.inventory.main[3] = { id: it, count: 5 }; p.inventory.selected = 1; }, stairsItem);
// stand on a ledge east of the ghost stairs (at origin + (-1, 1, 1)) and look down at them
await t.sim((g, p, a) => {
  const stone = window.__mc.BLOCKS.findIndex((b) => b?.name === 'stone');
  for (let x = 2; x <= 4; x++) for (let z = 0; z <= 2; z++) g.world.set(a[0] + x, a[1], a[2] + z, stone);
  p.setPos(a[0] + 2.5, a[1] + 1, a[2] + 1.5);
}, B0);
await ev((bp) => { bp.state.easyPlace = true; bp.changed(); });
await wait(600);
// (the hotbar slot is the client's to choose)
await page.evaluate(() => { const g = window.game, p = g.player; p.inventory.selected = 1; p.yaw = p.pyaw = 90; p.pitch = p.ppitch = 16; g.input.pointerLocked = true; });
await wait(300);
await page.evaluate(() => window.game.input.mousePressedQ.push(2));
await wait(800);
const easy = await t.sim((g, p, a) => { const v = g.world.get(a[0] - 1, a[1] + 1, a[2] + 1); return { block: `${window.__mc.BLOCKS[v & 0xfff].name}:${v >>> 12}`, left: p.inventory.main[3]?.count, sel: p.inventory.selected }; }, B0);
ok(easy.block === 'oak_stairs:2', `easy place puts the stairs as the schematic says (${easy.block})`);
ok(easy.left === 4 && easy.sel === 3, `using one from the hotbar (${easy.left} left, slot ${easy.sel})`);

// the menu opens and draws
await ev((bp) => bp.open());
await wait(500);
await t.shot('blueprints-menu');
ok(await page.evaluate(() => window.game.ui.screen?.title === 'Blueprints'), 'the menu opens');

const modErrors = await page.evaluate(async () => (await import('/src/mod/state.ts')).modState.errors.get('blueprints') ?? []);
ok(!modErrors.length, `no mod errors ${JSON.stringify(modErrors).slice(0, 300)}`);
ok(!t.errors.length, `no page errors ${t.errors.slice(0, 3).join(' | ')}`);
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exit(fails.length ? 1 : 0);
