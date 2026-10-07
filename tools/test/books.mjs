// Books and lecterns in a running world: writing in a book and quill (typed through the client's screen and the
// server's twin) and signing it; a lectern holding the book (comparators read its page); copying a written book;
// buckets and bottles left in the crafting grid; comparators reading the newer blocks.
//   node tools/test/books.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 1 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

await t.page.evaluate(async () => {
  const { I7, stack } = await import('/src/game/items.ts');
  return window.sim((g, p) => { p.pitch = -90; p.inventory.main[p.inventory.selected] = stack(I7.WRITABLE_BOOK, 1); g.interact.useNow(); });
});
await wait(600);
const open = await t.page.evaluate(() => window.game.ui.screen?.constructor?.name ?? null);
ok(open === 'BookScreen', `a book and quill opens for writing (${open})`);
await t.page.keyboard.type('Hello world');
await t.page.keyboard.press('PageDown');
await t.page.keyboard.type('Second page');
await wait(300);
await t.shot('book-edit');
// press Sign (a real click, so the server's twin gets it too), type the title, Enter signs
const at = await t.page.evaluate(() => { const s = window.game.ui.screen, k = window.game.ui.gui.scale; const b = s.buttons().find((q) => q.id === 'signing'); return [(b.x + b.w / 2) * k, (b.y + b.h / 2) * k]; });
await t.page.mouse.click(at[0], at[1]);
await wait(300);
await t.page.keyboard.type('My Book');
await t.page.keyboard.press('Enter');
await wait(800);
const signed = await t.page.evaluate(async () => {
  const { I11 } = await import('/src/game/items.ts');
  return window.sim((g, p) => { const h = p.inventory.held(); return { written: h?.id === I11.WRITTEN_BOOK, tag: h?.tag }; });
});
ok(signed.written && signed.tag?.title === 'My Book' && signed.tag.pages?.[0] === 'Hello world' && signed.tag.pages?.[1] === 'Second page', `signing makes a written book (${JSON.stringify(signed.tag)})`);

// the lectern: the book goes on it; comparators read the page
const lect = await t.page.evaluate(async () => {
  const { B2, pack, metaOf } = await import('/src/world/blocks.ts');
  const { stationUse } = await import('/src/game/stations.ts');
  const { containerLevel } = await import('/src/game/devices.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 2, y = Math.floor(p.y), z = Math.floor(p.z) + 3;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 3; b++) w.set(x + a, y + b, z + c, 0); }
    w.set(x, y, z, pack(B2.LECTERN, 2));
    const used = stationUse(g.interact, x, y, z, w.get(x, y, z), p.inventory.held());
    const tile = w.getTile(x, y, z);
    const first = containerLevel(w, x, y, z);
    tile.page = 1;
    const last = containerLevel(w, x, y, z);
    return { used, book: !!tile?.items?.[0], flag: (metaOf(w.get(x, y, z)) & 4) !== 0, first, last, x, y, z };
  });
});
ok(lect.used && lect.book && lect.flag, 'a written book goes onto a lectern');
ok(lect.first === 1 && lect.last === 15, `comparators read the lectern's page (${lect.first} on the first, ${lect.last} on the last)`);
await wait(500);
await t.look(lect.x + 0.5, lect.y + 1.8, lect.z - 1.5, 0, 40, 60);
await wait(800);
await t.shot('lectern');
await t.look(null);

const crafting = await t.page.evaluate(async () => {
  const { craft, craftRemainder } = await import('/src/game/recipes.ts');
  const { I, I7, I11, stack } = await import('/src/game/items.ts');
  const { B2, pack } = await import('/src/world/blocks.ts');
  const { containerLevel } = await import('/src/game/devices.ts');
  const book = { id: I11.WRITTEN_BOOK, count: 1, tag: { pages: ['a'], title: 'T', author: 'A', generation: 0 } };
  const copy = craft([book, stack(I7.WRITABLE_BOOK), stack(I7.WRITABLE_BOOK), null], 2);
  const kept = craftRemainder(book);
  const bucket = craftRemainder(stack(I.MILK_BUCKET));
  const levels = await window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) - 3, y = Math.floor(p.y) + 5, z = Math.floor(p.z) - 3;
    w.set(x, y, z, pack(B2.COMPOSTER, 5)); const comp = containerLevel(w, x, y, z);
    w.set(x, y, z, pack(B2.CAULDRON, 2)); const caul = containerLevel(w, x, y, z);
    w.set(x, y, z, B2.BARREL); w.setTile(x, y, z, { type: 'chest', items: [stack(I.DIAMOND, 64), ...new Array(26).fill(null)] }); const barrel = containerLevel(w, x, y, z);
    w.set(x, y, z, 0);
    return { comp, caul, barrel };
  });
  return { copy: copy?.id === I11.WRITTEN_BOOK && copy.count === 2 && copy.tag.generation === 1, kept: kept?.id === I11.WRITTEN_BOOK, bucket: bucket?.id === I.BUCKET, ...levels };
});
ok(crafting.copy && crafting.kept, 'a written book and books and quill craft into copies, the original stays');
ok(crafting.bucket, 'milk buckets used in a recipe leave their buckets');
ok(crafting.comp === 5 && crafting.caul === 2 && crafting.barrel === 1, `comparators read composters, cauldrons and barrels (${crafting.comp}, ${crafting.caul}, ${crafting.barrel})`);

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
