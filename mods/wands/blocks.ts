// The materials spells make that the game doesn't have: thin puddles of acid, oil, blood, slime, toxic sludge,
// alcohol and the like (creatures standing in them pick up the stain, see server.ts), gunpowder that goes off
// near fire, flammable gas, cement that sets, and the short-lived walls of Summon Wall / Summon Platform.
import type { ModContext, BlockCtx } from '../sdk';

interface Puddle { key: string; name: string; color: string; alpha: number; flammable?: boolean }
export const PUDDLES: Puddle[] = [
  { key: 'acid', name: 'Acid', color: '#a0ff40', alpha: 200 },
  { key: 'oil', name: 'Oil', color: '#3a3024', alpha: 230, flammable: true },
  { key: 'blood', name: 'Blood', color: '#a01010', alpha: 220 },
  { key: 'slime', name: 'Slime', color: '#60c040', alpha: 200 },
  { key: 'toxic', name: 'Toxic Sludge', color: '#80e030', alpha: 210 },
  { key: 'alcohol', name: 'Alcohol', color: '#e0d090', alpha: 150, flammable: true },
  { key: 'urine', name: 'Urine', color: '#e8e040', alpha: 170 },
  { key: 'gunpowder', name: 'Gunpowder', color: '#404040', alpha: 255, flammable: true },
  { key: 'cement', name: 'Wet Cement', color: '#a8a8a8', alpha: 255 },
];
/** Blocks that should get a scheduled tick when a spell places them (and after how long). */
export const SCHEDULE: Record<string, number> = { 'wands:cement': 80, 'wands:gas': 400 };

export function registerBlocks(mod: ModContext) {
  const mc = mod.mc;
  const fireNear = (c: BlockCtx) => {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const n = mc.BLOCKS[c.neighbor(dx, dy, dz) & 0xfff]?.name;
      if (n === 'fire' || n === 'lava') return true;
    }
    return false;
  };
  for (const p of PUDDLES) {
    mod.block(p.key, p.name, {
      render: mc.Render.Model, tex: `wands:${p.key}`, hardness: 0, sound: p.key === 'gunpowder' ? 'sand' : 'slime', opaque: false, solid: false,
      translucent: p.alpha < 255, lightOpacity: 0, replaceable: true, needsSupport: true, flammable: !!p.flammable, drop: null, item: false,
    }, {
      model: (_m, _nb, f) => [{ x0: 0, y0: 0, z0: 0, x1: 16, y1: 1, z1: 16, tex: f.slice(0, 6) }],
      collision: () => [],
      selection: () => [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1 / 16, z1: 1 }],
      canStay: (c) => !!mc.BLOCKS[c.neighbor(0, -1, 0) & 0xfff]?.solid,
      neighborChanged: (c) => {
        if (!p.flammable || !fireNear(c)) return;
        if (p.key === 'gunpowder') { c.set(0); c.game.interact?.explode(c.x + 0.5, c.y + 0.5, c.z + 0.5, 1.6, false, null); }
        else c.set(mc.B.FIRE);
      },
      randomTick: (c) => {
        if (p.key === 'cement') { c.set(mc.blockByName('smooth_stone')!.id); return; }
        if (p.key === 'acid') {
          // eats the block below now and then, and sinks into the hole
          const below = mc.BLOCKS[c.neighbor(0, -1, 0) & 0xfff];
          if (below && below.hardness >= 0 && below.hardness <= 2.5 && !below.fluid && Math.random() < 0.5) { c.world.set(c.x, c.y - 1, c.z, 0); c.set(0); return; }
        }
        if (p.key !== 'gunpowder' && Math.random() < 0.25) c.set(0);
      },
      scheduledTick: (c) => { if (p.key === 'cement') c.set(mc.blockByName('smooth_stone')!.id); },
    });
    mod.client.texture(`wands:${p.key}`, (r) => {
      const img = mc.pixels.newImg();
      const v = parseInt(p.color.slice(1), 16), base = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const k = 0.85 + r.next() * 0.3;
        mc.pixels.set(img, x, y, base.map((c) => Math.min(255, Math.round(c * k))) as [number, number, number], p.alpha);
      }
      return img;
    });
  }
  // flammable gas: hangs in the air, goes off near fire, thins out by itself
  mod.block('gas', 'Flammable Gas', { render: mc.Render.Model, tex: 'wands:gas', hardness: 0, sound: 'none', opaque: false, solid: false, translucent: true, lightOpacity: 0, replaceable: true, drop: null, item: false, selectable: false }, {
    model: (_m, nb, f) => {
      // only the faces that border something else, so a cloud of it is a single faint shape
      const same = (dx: number, dy: number, dz: number) => (nb ? nb(dx, dy, dz) : 0) === (nb ? nb(0, 0, 0) : -1);
      return same(0, 1, 0) && same(0, -1, 0) && same(1, 0, 0) && same(-1, 0, 0) && same(0, 0, 1) && same(0, 0, -1) ? [] : [{ x0: 0, y0: 0, z0: 0, x1: 16, y1: 16, z1: 16, tex: f.slice(0, 6) }];
    },
    collision: () => [],
    selection: () => [],
    neighborChanged: (c) => { if (fireNear(c)) c.schedule(2); },
    scheduledTick: (c) => {
      if (fireNear(c)) { c.set(mc.B.FIRE); c.game.interact?.explode(c.x + 0.5, c.y + 0.5, c.z + 0.5, 1.4, true, null); }
      else if (Math.random() < 0.5) c.set(0);
      else c.schedule(200);
    },
    randomTick: (c) => { if (Math.random() < 0.3) c.set(0); },
  });
  mod.client.texture('wands:gas', (r) => {
    const img = mc.pixels.newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) mc.pixels.set(img, x, y, [190 + Math.floor(r.next() * 20), 230, 160], 40);
    return img;
  });
  // the walls of Summon Wall and Summon Platform: solid while they last
  mod.block('magic_wall', 'Magic Wall', { tex: 'wands:magic_wall', hardness: 0.5, sound: 'glass', opaque: false, translucent: true, lightOpacity: 0, light: 6, drop: null, item: false }, {
    scheduledTick: (c) => c.set(0),
    // left over after a reload (scheduled ticks may not survive it): they fade on their own
    randomTick: (c) => c.set(0),
  });
  mod.client.texture('wands:magic_wall', () => {
    const img = mc.pixels.newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      mc.pixels.set(img, x, y, edge ? [200, 170, 255] : [140, 100, 230], edge ? 230 : 110);
    }
    return img;
  });
}
