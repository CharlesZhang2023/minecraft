// Banners in a running world: the crafting recipe, the loom adding pattern layers, placing a patterned banner (the
// tile keeps the layers) and breaking it (the item keeps them), the ominous banner's design, and a picture.
//   node tools/test/banners.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 1 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

const recipe = await t.page.evaluate(async () => {
  const { craft } = await import('/src/game/recipes.ts');
  const { I, I10, stack, DYES } = await import('/src/game/items.ts');
  const { WOOL_COLORS, BANNERS, B } = await import('/src/world/blocks.ts');
  const w = stack(WOOL_COLORS[14]);
  const r = craft([w, w, w, w, w, w, null, stack(I.STICK), null], 3, 3);
  const f = craft([stack(I.PAPER), stack(B.OXEYE_DAISY), null, null], 2, 2);
  void DYES;
  return { banner: r?.id === BANNERS[14], flower: f?.id === I10.FLOWER_BANNER_PATTERN };
});
ok(recipe.banner, 'six red wool and a stick make a red banner');
ok(recipe.flower, 'paper and an oxeye daisy make the flower banner pattern');

// the loom: a white banner and blue dye, pick the cross; then the flower charge with the pattern item
const loom = await t.page.evaluate(async () => {
  const { stack, DYES, itemId } = await import('/src/game/items.ts');
  const { BANNERS } = await import('/src/world/blocks.ts');
  const g = window.game, p = g.player;
  g.ui.openLoom(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  const s = g.ui.screen;
  s.items[0] = stack(BANNERS[0]); s.items[1] = stack(DYES[11]);
  s.sel = 'sc';
  const one = s.result();
  s.items[0] = { ...one }; s.items[1] = stack(DYES[14]); s.items[2] = stack(itemId('flower_banner_pattern'));
  const offered = s.offered();
  s.sel = 'flo';
  const two = s.result();
  // six layers is the most
  s.items[0] = { ...two, banner: new Array(6).fill({ p: 'bs', c: 1 }) };
  const full = s.result();
  s.items = [null, null, null];
  g.ui.open(null);
  return { name: s.constructor.name, one: one?.banner, two: two?.banner, offered, full };
});
ok(loom.name === 'LoomScreen', 'using the loom opens its screen');
ok(JSON.stringify(loom.one) === '[{"p":"sc","c":11}]', `a layer in the dye's colour (${JSON.stringify(loom.one)})`);
ok(loom.offered.length === 1 && loom.offered[0] === 'flo' && loom.two?.length === 2, 'a pattern item offers just its design, layered on top');
ok(loom.full === null, 'no seventh layer');

const placed = await t.page.evaluate(async () => {
  const { BANNERS, WALL_BANNERS, metaOf, idOf, pack } = await import('/src/world/blocks.ts');
  const { I9 } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 3, y = Math.floor(p.y) + 1, z = Math.floor(p.z) + 4;
    for (let a = -4; a <= 4; a++) for (let b = 0; b < 5; b++) for (let c = -1; c <= 3; c++) w.set(x + a, y + b, z + c, 0);
    for (let a = -4; a <= 4; a++) for (let c = -1; c <= 3; c++) w.set(x + a, y - 1, z + c, 1);
    for (let a = -4; a <= 4; a++) for (let b = 0; b < 5; b++) w.set(x + a, y + b, z + 3, 1);
    const ITEMS = window.__mc.ITEMS;
    const layers = [{ p: 'sc', c: 11 }, { p: 'flo', c: 14 }];
    const held = { id: BANNERS[0], count: 1, banner: layers };
    const a = g.interact.placeBlock({ x: x - 2, y: y - 1, z, face: 3, hx: x - 1.5, hy: y, hz: z + 0.5 }, held, ITEMS.get(BANNERS[0]));
    const tile = w.getTile(x - 2, y, z);
    // a wall banner on the wall behind (the wall's north face is face 4 or 5: try both)
    const wb = { id: BANNERS[4], count: 1, banner: [{ p: 'bt', c: 15 }, { p: 'mc', c: 14 }] };
    let wall = false;
    for (const face of [0, 1, 2, 4, 5]) {
      if (g.interact.placeBlock({ x: x + 1, y: y + 2, z: z + 3, face, hx: x + 1.5, hy: y + 2.5, hz: z + 3 }, wb, ITEMS.get(BANNERS[4])) && WALL_BANNERS.includes(idOf(w.get(x + 1, y + 2, z + 2)))) { wall = true; break; }
      w.set(x + 1, y + 2, z + 2, 0); w.set(x + 1, y + 2, z + 4, 1);
    }
    // the ominous banner
    const om = { id: I9.OMINOUS_BANNER, count: 1 };
    g.interact.placeBlock({ x: x + 3, y: y - 1, z: z + 1, face: 3, hx: x + 3.5, hy: y, hz: z + 1.5 }, om, ITEMS.get(I9.OMINOUS_BANNER));
    const omt = w.getTile(x + 3, y, z + 1);
    // break the first one in survival: the drop keeps the layers
    p.setGameMode(0);
    g.interact.breakBlock(x - 2, y, z);
    const drop = g.entities.find((e) => e.item?.id === BANNERS[0] && e.item.banner);
    p.setGameMode(1);
    const back = { id: BANNERS[0], count: 1, banner: layers };
    g.interact.placeBlock({ x: x - 2, y: y - 1, z, face: 3, hx: x - 1.5, hy: y, hz: z + 0.5 }, back, ITEMS.get(BANNERS[0]));
    // turn the standing ones to face the camera (north: rotation 8), keeping their tiles
    for (const [bx, bz] of [[x - 2, z], [x + 3, z + 1]]) { const tl = w.getTile(bx, y, bz); w.set(bx, y, bz, pack(BANNERS[0], 8)); w.setTile(bx, y, bz, tl); }
    void metaOf;
    return { x, y, z, placed: a && JSON.stringify(tile?.patterns) === JSON.stringify(layers), wall, ominous: idOf(w.get(x + 3, y, z + 1)) === BANNERS[0] && omt?.patterns?.length === 8, dropped: JSON.stringify(drop?.item?.banner) === JSON.stringify(layers) };
  });
});
ok(placed.placed, 'a placed banner keeps its layers in its tile');
ok(placed.wall, 'a banner placed on a wall hangs as a wall banner');
ok(placed.ominous, 'the ominous banner places as a white banner with the illager design');
ok(placed.dropped, 'broken, the banner drops with its layers');

await wait(800);
await t.look(placed.x + 0.5, placed.y + 1.6, placed.z - 3, 0, 8, 60);
await wait(1000);
await t.shot('banners');
await t.look(null);

// a banner on a shield; patterned banners and shields show their designs in the inventory
const shield = await t.page.evaluate(async () => {
  const { craft } = await import('/src/game/recipes.ts');
  const { I7, stack } = await import('/src/game/items.ts');
  const { BANNERS } = await import('/src/world/blocks.ts');
  const layers = [{ p: 'cr', c: 15 }, { p: 'mc', c: 4 }];
  const out = craft([stack(I7.SHIELD), { id: BANNERS[11], count: 1, banner: layers }, null, null], 2);
  await window.sim((g, p) => {
    p.inventory.main[0] = out;
    p.inventory.main[1] = { id: BANNERS[11], count: 1, banner: layers };
    p.inventory.main[2] = { id: BANNERS[14], count: 1, banner: [{ p: 'flo', c: 0 }, { p: 'bo', c: 15 }] };
  });
  return { base: out?.tag?.shieldBase, layers: out?.banner?.length };
});
ok(shield.base === 11 && shield.layers === 2, 'a banner crafted onto a shield gives it its colour and patterns');
await wait(500);
await t.page.keyboard.press('KeyE');
await wait(500);
await t.shot('banner-icons');
await t.page.keyboard.press('Escape');

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
