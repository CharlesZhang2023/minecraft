// Every block of the game on a platform in the sky, in rows, photographed from a few angles: a quick look that the
// new families draw (and no errors on the way).   node tools/test/gallery.mjs [from-name] [count]
import { openWorld, wait } from './browser.mjs';

const from = process.argv[2] ?? 'stripped_oak_log';
const count = Number(process.argv[3] ?? 48);
const t = await openWorld({ seed: 4242, mode: 1, time: 6000 });
const res = await t.page.evaluate(async ([from, count]) => {
  const { BLOCKS, Render } = await import('/src/world/blocks.ts');
  const start = BLOCKS.findIndex((b) => b.name === from);
  const ids = BLOCKS.slice(start, start + count).filter((b) => b.render !== Render.None).map((b) => b.id);
  const { SHAPE, Shape } = await import('/src/world/blocks.ts');
  const tall = ids.filter((id) => SHAPE[id] === Shape.Door || SHAPE[id] === Shape.DoublePlant);
  return window.sim((g, p) => {
    const w = g.world, y0 = 120, W = 12;
    const bx = Math.floor(p.x) - 8, bz = Math.floor(p.z) - 30;
    for (let x = -2; x < W + 2; x++) for (let z = -2; z < 34; z++) { w.set(bx + x, y0 - 1, bz + z, 1); for (let y = 0; y < 4; y++) w.set(bx + x, y0 + y, bz + z, 0); }
    let i = 0;
    for (const id of ids) {
      const x = bx + (i % W), z = bz + Math.floor(i / W) * 2;
      w.set(x, y0, z, id);
      // doors and two-block plants get their top half
      if (tall.includes(id)) w.set(x, y0 + 1, z, id | (8 << 12));
      i++;
    }
    const rows = Math.ceil(ids.length / W);
    p.setPos(bx + 6, y0 + 4.5, bz + rows * 2 + 3);
    return { n: ids.length, at: [bx, y0, bz] };
  });
}, [from, count]);
console.log('placed', res);
const rows = Math.ceil(res.n / 12);
await t.settle(2500);
await t.look(res.at[0] + 6, res.at[1] + 5, res.at[2] + rows * 2 + 4, 180, 40);
await wait(500);
await t.shot('gallery-' + from);
await t.look(res.at[0] + 14, res.at[1] + 3, res.at[2] + rows, 90, 25);
await wait(500);
await t.shot('gallery-' + from + '-side');
console.log('errors', t.errors.slice(0, 10));
await t.close();
