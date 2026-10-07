// Maps in a running world: an empty map fills in around its holder (on the server, then sent to the client), the
// cartography table's zoom / copy / lock, explorer maps finding their structure, and a picture of a map in hand.
//   node tools/test/maps.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 1 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

const made = await t.page.evaluate(async () => {
  const { I7, stack } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    p.setGameMode(0);
    p.pitch = -90;
    p.inventory.main[p.inventory.selected] = stack(I7.MAP, 1);
    g.interact.useNow();
    const h = p.inventory.held();
    p.setGameMode(1);
    return { id: h?.id === I7.FILLED_MAP ? h.tag?.map : null, stored: !!g.meta.maps?.[h?.tag?.map] };
  });
});
ok(made.id !== null && made.id !== undefined && made.stored, `using an empty map makes map #${made.id}`);

await wait(2500);
const drawn = await t.page.evaluate(async (id) => {
  const { mapStore } = await import('/src/game/maps.ts');
  const server = await window.sim((g) => { const d = mapStore(g.meta).get(id); return d ? d.colors.filter((c) => c >= 4).length : -1; });
  const c = window.game.maps.get(id);
  return { server, client: c ? c.colors.filter((v) => v >= 4).length : -1 };
}, made.id);
ok(drawn.server > 2000, `the server draws what's around the holder (${drawn.server} pixels)`);
ok(drawn.client > 2000, `and the client gets it (${drawn.client} pixels)`);
await t.shot('map-held');

const table = await t.page.evaluate(async (id) => {
  const { createMap, lockMap, mapStore } = await import('/src/game/maps.ts');
  const { I, I7, stack } = await import('/src/game/items.ts');
  const g = window.game, p = g.player;
  g.ui.openCartography(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  const s = g.ui.screen;
  s.items[0] = { id: I7.FILLED_MAP, count: 1, tag: { map: id } };
  s.items[1] = stack(I.PAPER);
  const zoomKind = s.kind();
  s.items[1] = stack(I7.MAP);
  const copy = s.result();
  s.items = [null, null];
  g.ui.open(null);
  const server = await window.sim((sg) => {
    const d = mapStore(sg.meta).get(id);
    const z = createMap(sg.meta, d.x, d.z, d.scale + 1, d.dim, d);
    const l = lockMap(sg.meta, d);
    return { zoomScale: z.scale, zoomPixels: z.colors.filter((c) => c >= 4).length, locked: l.locked && l.colors.filter((c) => c >= 4).length === d.colors.filter((c) => c >= 4).length };
  });
  return { zoomKind, copy: copy?.count === 2 && copy.tag.map === id, ...server, name: s.constructor.name };
}, made.id);
ok(table.name === 'CartographyScreen', 'the cartography table opens its screen');
ok(table.zoomKind === 'zoom' && table.zoomScale === 1 && table.zoomPixels > 400, `paper zooms a map out (scale ${table.zoomScale}, ${table.zoomPixels} pixels kept)`);
ok(table.copy, 'an empty map copies it');
ok(table.locked, 'a glass pane locks a copy');

// explorer maps: a cartographer's ocean explorer map, filled in when held
await t.page.evaluate(async () => {
  const { I7 } = await import('/src/game/items.ts');
  return window.sim((g, p) => { p.inventory.main[p.inventory.selected] = { id: I7.FILLED_MAP, count: 1, tag: { explore: 'monument' } }; });
});
await wait(3000);
const explorer = await t.page.evaluate(async () => {
  const { mapStore } = await import('/src/game/maps.ts');
  return window.sim((g, p) => {
    const h = p.inventory.held();
    const d = h?.tag?.map !== undefined ? mapStore(g.meta).get(h.tag.map) : null;
    return { tag: h?.tag, name: h?.name, scale: d?.scale, marks: d?.marks, water: d ? d.colors.filter((c) => c >= 4).length : 0 };
  });
});
ok(explorer.marks?.[0]?.type === 'monument' && explorer.scale === 2, `an explorer map leads to a monument (${JSON.stringify(explorer.marks)})`);
ok(explorer.water > 500, `with the sea sketched in (${explorer.water} pixels)`);
await wait(800);
await t.shot('map-explorer');

// a map in an item frame fills the frame
const frame = await t.page.evaluate(async (id) => {
  const { ItemFrame, Painting } = await import('/src/entity/hanging.ts');
  const { HORIZ } = await import('/src/world/blocks.ts');
  const { I7 } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x), y = Math.floor(p.y) + 1, z = Math.floor(p.z) + 3;
    for (let a = -2; a <= 2; a++) for (let b = -1; b < 3; b++) { w.set(x + a, y + b, z + 1, 1); for (let c = -2; c <= 0; c++) w.set(x + a, y + b, z + c, 0); }
    const f = new ItemFrame(w, g);
    f.hang(x, y, z, HORIZ.findIndex(([dx, dz]) => dx === 0 && dz === 1));
    f.item = { id: I7.FILLED_MAP, count: 1, tag: { map: id } };
    g.addEntity(f);
    // and a painting beside it (both lie flat on the wall's face)
    const pt = new Painting(w, g);
    if (pt.place(x - 2, y + 1, z, f.facing, () => 0)) g.addEntity(pt);
    p.inventory.main[p.inventory.selected] = null;
    return { x, y, z };
  });
}, made.id);
await wait(2500);
await t.look(frame.x - 0.5, frame.y + 1, frame.z - 2.5, 0, 0, 70);
await wait(800);
await t.shot('map-frame');
await t.look(null);

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
