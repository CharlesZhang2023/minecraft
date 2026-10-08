// Structure blocks, jigsaws, the debug stick and item frames read by comparators, in a running world:
//   save a box (a structure void inside is skipped), load it turned and mirrored, detect a box from corner blocks,
//   load by redstone, the screen writing the tile and saving through the server's twin; a jigsaw generating a chain
//   of pieces from a pool; the debug stick picking and stepping a block's properties; a comparator reading the
//   rotation of an item in a frame on the far side of a block.
//   node tools/test/structures.mjs
import { openWorld, wait, english } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 1 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

// ---------------------------------------------------------------- save, load turned, void, mirror
const s1 = await t.page.evaluate(async () => {
  const { B, pack, STRUCTURE_BLOCK, STRUCTURE_VOID } = await import('/src/world/blocks.ts');
  const sb = await import('/src/game/structureblocks.ts');
  const { parseBlock, formatBlock } = await import('/src/agent/blockspec.ts');
  const { I } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 4, y = Math.floor(p.y) + 12, z = Math.floor(p.z) + 4;
    for (let a = -8; a <= 12; a++) for (let c = -8; c <= 12; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 6; b++) w.set(x + a, y + b, z + c, 0); }
    // the thing to save: an L of planks, a stair facing east, a chest with a diamond, a structure void
    w.set(x, y, z, pack(STRUCTURE_BLOCK, 0));
    const t0 = sb.structureTile(w, x, y, z);
    Object.assign(t0, { name: 'test:thing', pos: [1, 0, 0], size: [3, 2, 2] });
    w.setTile(x, y, z, t0);
    w.set(x + 1, y, z, B.OAK_PLANKS); w.set(x + 2, y, z, B.OAK_PLANKS); w.set(x + 3, y, z, B.OAK_PLANKS); w.set(x + 1, y, z + 1, B.OAK_PLANKS);
    w.set(x + 2, y + 1, z, parseBlock('oak_stairs[facing=east]'));
    w.set(x + 3, y, z + 1, B.CHEST); w.setTile(x + 3, y, z + 1, { type: 'chest', items: [{ id: I.DIAMOND, count: 1 }, ...new Array(26).fill(null)] });
    w.set(x + 3, y + 1, z + 1, STRUCTURE_VOID);
    const msg = sb.saveStructure(g, x, y, z);
    const tpl = sb.getTemplate(g, 'test:thing');
    // load it turned a quarter clockwise at a load block
    const lx = x, ly = y, lz = z + 6;
    w.set(lx, ly, lz, pack(STRUCTURE_BLOCK, 1));
    const t1 = sb.structureTile(w, lx, ly, lz);
    Object.assign(t1, { name: 'test:thing', pos: [0, 0, 1], rotation: 1 });
    w.setTile(lx, ly, lz, t1);
    w.set(lx - 1, ly + 1, lz + 3, B.GLASS); // where the void lands: must stay glass
    const first = sb.loadStructure(g, lx, ly, lz, true);
    const sized = [...sb.structureTile(w, lx, ly, lz).size];
    const second = sb.loadStructure(g, lx, ly, lz, true);
    // (x, z) -> (-z, x) about the corner (lx, lz + 1): cell (0,0) stays, cell (2,0) -> (0,2), cell (1,0,y1) the stair -> (0,1)
    const name = (a, b, c) => window.__mc.BLOCKS[w.getId(a, b, c)].name;
    const ox = lx, oz = lz + 1;
    const r = {
      msg, first, second, sized, size: tpl?.size, voids: [...tpl.blocks].filter((v) => v < 0).length,
      corner: name(ox, ly, oz), far: name(ox, ly, oz + 2), arm: name(ox - 1, ly, oz),
      stair: formatBlock(w.get(ox, ly + 1, oz + 1)), chest: name(ox - 1, ly, oz + 2), chestItems: w.getTile(ox - 1, ly, oz + 2)?.items?.filter(Boolean).length,
      voidKept: name(ox - 1, ly + 1, oz + 2),
    };
    // mirrored front-back (x flipped) at another spot
    const mx = x + 8, mz = z;
    w.set(mx, y, mz, pack(STRUCTURE_BLOCK, 1));
    Object.assign(sb.structureTile(w, mx, y, mz), { name: 'test:thing', pos: [0, 0, 0], mirror: 2, size: [3, 2, 2] });
    sb.loadStructure(g, mx, y, mz, false);
    r.mirrored = [name(mx, y, mz), name(mx - 2, y, mz), formatBlock(w.get(mx - 1, y + 1, mz))];
    return r;
  });
});
ok(/saved/.test(s1.msg) && JSON.stringify(s1.size) === '[3,2,2]', `save mode saves the box (${s1.msg}, ${JSON.stringify(s1.size)})`);
ok(s1.voids === 1, `a structure void is left out of it (${s1.voids})`);
ok(/load again/.test(s1.first) && JSON.stringify(s1.sized) === '[3,2,2]', `the first Load only sizes the box (${s1.first})`);
ok(/loaded/.test(s1.second), `the second places it (${s1.second})`);
ok(s1.corner === 'oak_planks' && s1.far === 'oak_planks' && s1.arm === 'oak_planks', `turned a quarter about its corner (${s1.corner}, ${s1.far}, ${s1.arm})`);
ok(s1.stair === 'oak_stairs[facing=south]', `blocks turn with it (${s1.stair})`);
ok(s1.chest === 'chest' && s1.chestItems === 1, `tiles come along (${s1.chest}, ${s1.chestItems})`);
ok(s1.voidKept === 'glass', `where the void was, the world is kept (${s1.voidKept})`);
ok(s1.mirrored[0] === 'oak_planks' && s1.mirrored[1] === 'oak_planks' && s1.mirrored[2] === 'oak_stairs[facing=west]', `mirrored front to back (${s1.mirrored})`);

// ---------------------------------------------------------------- corners, redstone, entities
const s2 = await t.page.evaluate(async () => {
  const { B, pack, STRUCTURE_BLOCK } = await import('/src/world/blocks.ts');
  const sb = await import('/src/game/structureblocks.ts');
  const r = await window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) - 10, y = Math.floor(p.y) + 20, z = Math.floor(p.z) - 10;
    for (let a = -1; a <= 8; a++) for (let c = -1; c <= 8; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 6; b++) w.set(x + a, y + b, z + c, 0); }
    const corner = (a, b, c) => { w.set(a, b, c, pack(STRUCTURE_BLOCK, 2)); Object.assign(sb.structureTile(w, a, b, c), { name: 'test:box' }); };
    w.set(x, y, z, pack(STRUCTURE_BLOCK, 0));
    Object.assign(sb.structureTile(w, x, y, z), { name: 'test:box', entities: true });
    corner(x + 1, y, z + 1); corner(x + 6, y + 4, z + 5);
    const det = sb.detectStructure(g, x, y, z);
    const st = sb.structureTile(w, x, y, z);
    w.set(x + 3, y + 1, z + 3, B.GOLD_BLOCK);
    w.set(x + 4, y, z + 3, B.STONE);
    const pig = g.interact.spawnMob('pig', x + 4.5, y + 1, z + 3.5); pig.noAi = true;
    // a pulse of redstone saves it
    w.set(x - 1, y, z, B.REDSTONE_BLOCK);
    return { x, y, z, det, pos: st.pos, size: st.size };
  });
  await new Promise((res) => setTimeout(res, 400));
  return { ...r, ...(await window.sim((g) => { const tp = sb.getTemplate(g, 'test:box'); return { saved: !!tp, ents: tp?.entities.map((e) => e.type) }; })) };
});
ok(/detected/.test(s2.det) && JSON.stringify(s2.pos) === '[2,1,2]' && JSON.stringify(s2.size) === '[4,3,3]', `Detect fits the box inside the corner blocks (${s2.det} ${JSON.stringify(s2.pos)} ${JSON.stringify(s2.size)})`);
ok(s2.saved && s2.ents?.includes('pig'), `redstone saves it, with entities when asked (${JSON.stringify(s2.ents)})`);

// ---------------------------------------------------------------- the screen
const at = await t.page.evaluate(async () => {
  const { pack, STRUCTURE_BLOCK } = await import('/src/world/blocks.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 2, y = Math.floor(p.y), z = Math.floor(p.z) - 3;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (let b = 0; b < 3; b++) w.set(x + a, y + b, z + c, 0);
    w.set(x, y, z, pack(STRUCTURE_BLOCK, 3));
    return { x, y, z };
  });
});
await wait(500);
await t.page.evaluate(async ({ x, y, z }) => {
  const { stationUse } = await import('/src/game/stations.ts');
  return window.sim((g, p) => { stationUse(g.interact, x, y, z, g.world.get(x, y, z), p.inventory.held()); });
}, at);
await wait(700);
const scr = await t.page.evaluate(() => window.game.ui.screen?.constructor?.name ?? null);
ok(scr === 'StructureBlockScreen', `using a structure block in creative opens its screen (${scr})`);
// switch to save mode (Data -> Save), name it, set the size, and press SAVE (real clicks: the server's twin gets them)
const clickField = async (id) => {
  const f = await t.page.evaluate((id) => { const s = window.game.ui.screen; const f = s.fields().find((q) => q.id === id); return f && { x: f.x + 4, y: f.y + 4 }; }, id);
  const scale = await t.page.evaluate(() => window.game.ui.gui.scale);
  await t.page.mouse.click(f.x * scale, f.y * scale);
};
const clickButton = async (label) => {
  const b = await t.page.evaluate((label) => { const s = window.game.ui.screen; const b = s.buttons().find((q) => q.label.startsWith(label)); return b && { x: b.x + 4, y: b.y + 4 }; }, label);
  const scale = await t.page.evaluate(() => window.game.ui.gui.scale);
  await t.page.mouse.click(b.x * scale, b.y * scale);
  await wait(150);
};
await clickButton('Mode');
await wait(200);
await clickField('name');
await t.page.keyboard.type('ui_test');
await clickField('s0');
await t.page.keyboard.press('Backspace'); await t.page.keyboard.type('2');
await clickField('s1');
await t.page.keyboard.press('Backspace'); await t.page.keyboard.type('2');
await clickField('s2');
await t.page.keyboard.press('Backspace'); await t.page.keyboard.type('2');
await wait(200);
await t.shot('structure-block-screen');
await clickButton('SAVE');
await wait(700);
const ui = await t.page.evaluate(async ({ x, y, z }) => {
  const sb = await import('/src/game/structureblocks.ts');
  return window.sim((g) => { const tl = g.world.getTile(x, y, z); return { name: tl?.name, size: tl?.size, mode: g.world.get(x, y, z) >>> 12, saved: !!sb.getTemplate(g, 'minecraft:ui_test') }; });
}, at);
ok(ui.name === 'ui_test' && JSON.stringify(ui.size) === '[2,2,2]' && ui.mode === 0, `the screen writes name, size and mode through the server (${JSON.stringify(ui)})`);
ok(ui.saved, 'and its SAVE button saves');
await wait(600);
await t.look(at.x + 0.5, at.y + 2.5, at.z + 4.5, 180, 30, 70);
await wait(800);
await t.shot('structure-block-box');
await t.look(null);

// ---------------------------------------------------------------- jigsaw
const jg = await t.page.evaluate(async () => {
  const { pack, JIGSAW, JIGSAW_ORIENTS, B } = await import('/src/world/blocks.ts');
  const sb = await import('/src/game/structureblocks.ts');
  const jw = await import('/src/game/jigsaw.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 20, y = Math.floor(p.y) + 30, z = Math.floor(p.z) - 20;
    for (let a = -2; a <= 40; a++) for (let c = -4; c <= 4; c++) for (let b = -1; b < 6; b++) w.set(x + a, y + b, z + c, 0);
    const orient = (f, tp) => JIGSAW_ORIENTS.findIndex(([a, b]) => a === f && b === tp);
    // a 3x3x3 room of bricks: a jigsaw in the west wall (facing west) and one in the east wall (facing east)
    const bx = x, by = y, bz = z;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) w.set(bx + a, by + b, bz + c, a === 1 && b === 1 && c === 1 ? 0 : B.BRICKS);
    const jig = (a, b, c, f, tile) => { w.set(a, b, c, pack(JIGSAW, orient(f, 1))); w.setTile(a, b, c, { type: 'jigsaw', joint: 'rollable', final: 'minecraft:glowstone', ...tile }); };
    jig(bx, by + 1, bz + 1, 4, { name: 'test:door', target: 'test:door', pool: 'test:rooms' });
    jig(bx + 2, by + 1, bz + 1, 5, { name: 'test:door', target: 'test:door', pool: 'test:rooms' });
    const tpl = sb.captureTemplate(g, bx, by, bz, 3, 3, 3, false, '');
    // keep it as a saved structure in the pool
    g.meta.structures ??= {};
    w.set(bx + 10, by, bz, pack(window.__mc.BLOCKS.find((d) => d?.name === 'structure_block').id, 0));
    Object.assign(sb.structureTile(w, bx + 10, by, bz), { name: 'test:rooms/a', pos: [-10, 0, 0], size: [3, 3, 3] });
    sb.saveStructure(g, bx + 10, by, bz);
    void tpl;
    // clear the original, put a single jigsaw facing east to generate from
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) w.set(bx + a, by + b, bz + c, 0);
    w.set(bx + 10, by, bz, 0);
    jig(bx + 2, by + 1, bz + 1, 5, { name: 'test:door', target: 'test:door', pool: 'test:rooms' });
    const msg = jw.generateJigsaw(g, bx + 2, by + 1, bz + 1, 3, false);
    const name = (a, b, c) => window.__mc.BLOCKS[w.getId(a, b, c)].name;
    // pieces east of the jigsaw: rooms at x+3..5, x+6..8, x+9..11
    return { msg, r1: name(bx + 3, by, bz), r2: name(bx + 6, by, bz), r3: name(bx + 9, by, bz), r4: name(bx + 12, by, bz), joint: name(bx + 3, by + 1, bz + 1), pool: jw.poolTemplates(g, 'test:rooms') };
  });
});
ok(/Generated 3 pieces/.test(english(jg.msg)), `a jigsaw generates 3 levels of pieces from its pool (${jg.msg}; pool ${JSON.stringify(jg.pool)})`);
ok(jg.r1 === 'bricks' && jg.r2 === 'bricks' && jg.r3 === 'bricks' && jg.r4 === 'air', `joined end to end, no further (${jg.r1} ${jg.r2} ${jg.r3} ${jg.r4})`);
ok(jg.joint === 'glowstone', `joined jigsaws turn into their final state (${jg.joint})`);

// ---------------------------------------------------------------- debug stick
const ds = await t.page.evaluate(async () => {
  const { I12, stack } = await import('/src/game/items.ts');
  const { debugStick } = await import('/src/game/debugstick.ts');
  const { parseBlock, formatBlock } = await import('/src/agent/blockspec.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) - 3, y = Math.floor(p.y) + 40, z = Math.floor(p.z) + 3;
    w.set(x, y, z, parseBlock('oak_stairs[facing=north]'));
    w.set(x, y - 1, z, 0);
    const s = stack(I12.DEBUG_STICK);
    const bars = [];
    const orig = g.ui.hud.actionBar;
    g.ui.hud.actionBar = (m) => bars.push(m);
    try {
      debugStick(g, p, s, x, y, z, true, false); // facing -> east
      const a = formatBlock(w.get(x, y, z));
      debugStick(g, p, s, x, y, z, false, false); // pick the next property: half
      debugStick(g, p, s, x, y, z, true, false);
      const b = formatBlock(w.get(x, y, z));
      // wheat: age
      w.set(x + 2, y - 1, z, parseBlock('farmland'));
      w.set(x + 2, y, z, parseBlock('wheat'));
      debugStick(g, p, s, x + 2, y, z, true, false);
      debugStick(g, p, s, x + 2, y, z, true, true); debugStick(g, p, s, x + 2, y, z, true, true);
      const c = formatBlock(w.get(x + 2, y, z));
      w.set(x + 4, y, z, parseBlock('stone'));
      debugStick(g, p, s, x + 4, y, z, true, false);
      return { a, b, c, bars };
    } finally { g.ui.hud.actionBar = orig; }
  });
});
ok(ds.a === 'oak_stairs[facing=east]', `the debug stick steps the picked property (${ds.a})`);
ok(ds.b === 'oak_stairs[facing=east,half=top]', `attacking picks the next one (${ds.b})`);
ok(ds.c === 'wheat[age=7]', `sneaking steps back, round to the last value (${ds.c})`);
const bars = ds.bars.map(english);
ok(bars.some((m) => m === 'selected "half" (bottom)') && bars.some((m) => m === '"facing" to east') && bars.at(-1) === '"minecraft:stone" has no properties', `it says what it did (${JSON.stringify(bars)})`);

// ---------------------------------------------------------------- item frames into comparators
const fr = await t.page.evaluate(async () => {
  const { B, pack } = await import('/src/world/blocks.ts');
  const { stack, I } = await import('/src/game/items.ts');
  const { ItemFrame } = await import('/src/entity/hanging.ts');
  const r = await window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 6, y = Math.floor(p.y) + 50, z = Math.floor(p.z) - 6;
    for (let a = -1; a <= 4; a++) for (let c = -1; c <= 1; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 3; b++) w.set(x + a, y + b, z + c, 0); }
    // comparator at x+2 facing east (input from the west: x+1 is stone, the frame hangs at x on its west face)
    w.set(x + 1, y, z, B.STONE);
    w.set(x + 2, y, z, pack(B.COMPARATOR, 1));
    w.setTile(x + 2, y, z, { type: 'comparator', out: 0 });
    w.set(x + 3, y, z, pack(B.REDSTONE_WIRE, 0));
    const frame = new ItemFrame(w, g);
    frame.hang(x, y, z, 1);
    frame.item = stack(I.DIAMOND);
    frame.rotation = 3;
    g.addEntity(frame);
    g.ticker.schedule(x + 2, y, z, 2);
    return { x, y, z };
  });
  await new Promise((res) => setTimeout(res, 800));
  return window.sim((g) => ({ wire: g.world.get(r.x + 3, r.y, r.z) >>> 12, out: g.world.getTile(r.x + 2, r.y, r.z)?.out }));
});
ok(fr.out === 4 && fr.wire === 4, `a comparator reads an item frame behind a block: rotation 3 gives 4 (${JSON.stringify(fr)})`);

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
