// Dispenser behaviours of 1.9-1.16 in a running world: armour onto an armour stand, a shulker box placed, a sheep
// sheared, a bottle filled with water, a minecart onto a rail, a respawn anchor charged, a tipped arrow shot, a
// fish let out of its bucket.
//   node tools/test/dispensers.mjs
import { openWorld } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 1 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

const r = await t.page.evaluate(async () => {
  const { B, B2, pack, SHULKER_BOXES } = await import('/src/world/blocks.ts');
  const { I, I5, I7, stack, itemId, TIPPED_ARROWS } = await import('/src/game/items.ts');
  return window.sim((g, p) => {
    const w = g.world, dev = g.dims.get(w.dimension).devices;
    const out = {};
    let row = 0;
    // each case: a dispenser facing east at (x, y, z + row), the thing in front at x + 1
    const setup = (item, front) => {
      const x = Math.floor(p.x) + 3, y = Math.floor(p.y) + 30, z = Math.floor(p.z) + row * 3;
      row++;
      for (let a = -1; a <= 3; a++) for (let c = -1; c <= 1; c++) { w.set(x + a, y - 1, z + c, 1); for (let b = 0; b < 3; b++) w.set(x + a, y + b, z + c, 0); }
      w.set(x, y, z, pack(B.DISPENSER, 5));
      w.setTile(x, y, z, { type: 'dispenser', items: [item, ...new Array(8).fill(null)] });
      front?.(x + 1, y, z);
      return { x, y, z, go: () => dev.dispense(x, y, z), slot: () => w.getTile(x, y, z).items[0] };
    };
    let s = setup(stack(itemId('iron_chestplate')), (fx, fy, fz) => { const a = g.interact.spawnMob('armor_stand', fx + 0.5, fy, fz + 0.5); out.standId = a?.id; });
    s.go();
    out.armor = g.entities.find((e) => e.id === out.standId)?.armorItems?.[1]?.id === itemId('iron_chestplate');
    s = setup(stack(SHULKER_BOXES[3]));
    s.go();
    out.shulker = w.getId(s.x + 1, s.y, s.z) === SHULKER_BOXES[3];
    let sheep;
    s = setup(stack(itemId('shears')), (fx, fy, fz) => { sheep = g.interact.spawnMob('sheep', fx + 0.5, fy, fz + 0.5); sheep.noAi = true; });
    s.go();
    out.sheared = !!sheep?.sheared;
    s = setup(stack(I.GLASS_BOTTLE ?? itemId('glass_bottle')), (fx, fy, fz) => w.set(fx, fy, fz, B.WATER));
    s.go();
    out.bottle = g.entities.some((e) => e.item && window.__mc.ITEMS.get(e.item.id).name === 'potion_water' && Math.abs(e.x - (s.x + 1.5)) < 2);
    s = setup(stack(I5.MINECART), (fx, fy, fz) => w.set(fx, fy, fz, B.RAIL));
    s.go();
    out.cart = g.entities.some((e) => e.typeName === 'Minecart' && Math.abs(e.x - (s.x + 1.5)) < 1 && Math.abs(e.z - (s.z + 0.5)) < 1);
    s = setup(stack(B.GLOWSTONE, 2), (fx, fy, fz) => w.set(fx, fy, fz, B2.RESPAWN_ANCHOR));
    s.go();
    out.anchor = w.get(s.x + 1, s.y, s.z) >>> 12;
    s = setup(stack(TIPPED_ARROWS.poison, 4));
    s.go();
    out.tipped = g.entities.some((e) => e.typeName === 'Arrow' && e.tipped === 'poison');
    s = setup(stack(itemId('cod_bucket')));
    s.go();
    out.fish = w.getId(s.x + 1, s.y, s.z) === B.WATER && g.entities.some((e) => e.typeName === 'Cod' && Math.abs(e.x - (s.x + 1.5)) < 2) && s.slot()?.id === I.BUCKET;
    return out;
  });
});
ok(r.armor, 'a dispenser puts armour on an armour stand in front of it');
ok(r.shulker, 'places a shulker box');
ok(r.sheared, 'shears a sheep');
ok(r.bottle, 'fills a bottle with water');
ok(r.cart, 'puts a minecart on a rail');
ok(r.anchor === 1, `charges a respawn anchor with glowstone (${r.anchor})`);
ok(r.tipped, 'shoots tipped arrows');
ok(r.fish, 'empties a fish bucket (water and the fish)');

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
