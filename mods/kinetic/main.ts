// Kinetics: rotational power, in the spirit of Create. Sources (hand crank, windmill bearing) spin the shafts
// lined up with them; a millstone on a vertical shaft grinds what you put in. Shows tile entities that tick on
// the server, a power network spread through neighbouring blocks, animated tile renderers on the client (the
// rotating parts aren't in the chunk mesh at all), custom shapes, sounds, a new item, and a HUD readout.
import type { ModContext, BlockCtx, Box, Shape, RenderContext, Mat4, ItemStack } from '../sdk';

/** Rotation axis: 0 x, 1 y, 2 z. */
type Axis = 0 | 1 | 2;
interface KTile { type?: string; speed: number; stamp: number; turn?: number; input?: ItemStack | null; progress?: number }

const AXIS_OF_FACE = [0, 0, 1, 1, 2, 2] as const;
const DIRS: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
/** Degrees per tick. */
const CRANK = 12, WIND = 6;
const GRIND: Record<string, [string, number]> = {
  cobblestone: ['gravel', 1], gravel: ['sand', 1], wheat: ['kinetic:flour', 2], bone: ['bone_meal', 3],
  sugar_cane: ['sugar', 2], stone: ['cobblestone', 1], sandstone: ['sand', 4], wool: ['string', 4],
};

const bar = (axis: Axis, r = 2): Box => {
  const lo = 8 - r, hi = 8 + r;
  const b = axis === 0 ? [0, lo, lo, 16, hi, hi] : axis === 1 ? [lo, 0, lo, hi, 16, hi] : [lo, lo, 0, hi, hi, 16];
  return { x0: b[0], y0: b[1], z0: b[2], x1: b[3], y1: b[4], z1: b[5], tex: [0, 0, 0, 0, 0, 0] };
};
const shape = (b: Box): Shape => ({ x0: b.x0 / 16, y0: b.y0 / 16, z0: b.z0 / 16, x1: b.x1 / 16, y1: b.y1 / 16, z1: b.z1 / 16 });

export function main(mod: ModContext) {
  const { stack } = mod.mc;

  // ---- the network: each tick a source spreads its speed along the shafts lined up with its axis
  const spread = (c: BlockCtx, axis: Axis, speed: number) => {
    const [dx, dy, dz] = DIRS[axis];
    for (const s of [1, -1]) {
      for (let k = 1; k <= 32; k++) {
        const x = c.x + dx * s * k, y = c.y + dy * s * k, z = c.z + dz * s * k;
        const v = c.world.get(x, y, z), id = v & 0xfff;
        const t = c.world.getTile(x, y, z) as unknown as KTile | undefined;
        if (!t) break;
        const stop = id === millstone.id;
        if (id === shaft.id && ((v >>> 12) & 3) !== axis) break;
        if (id !== shaft.id && !stop) break;
        if (stop && axis !== 1) break;
        // the fastest source wins; a node not refreshed for a few ticks stops
        if (t.stamp !== c.game.ticks || speed > t.speed) {
          if (t.speed !== speed) { t.speed = speed; mod.mc.blockCtx(c.game, x, y, z).tileChanged(); }
          t.stamp = c.game.ticks;
        }
        if (stop) break;
      }
    }
  };
  /** Shafts and machines lose their speed a few ticks after nothing drives them. */
  const decay = (c: BlockCtx, t: KTile) => {
    if (t.speed && c.game.ticks - t.stamp > 4) { t.speed = 0; c.tileChanged(); }
  };
  const axisMeta = (face: number) => AXIS_OF_FACE[face] as Axis;

  const shaft = mod.block('shaft', 'Shaft', { render: mod.mc.Render.Model, tex: 'kinetic:shaft', hardness: 1.5, tool: 'pickaxe', sound: 'metal', opaque: false, lightOpacity: 0 }, {
    placementMeta: (c) => axisMeta(c.face),
    // nothing in the chunk mesh (the renderer spins it); the item icon and moving copies get a still one
    model: (meta, nb, faces) => (nb ? [] : [{ ...bar((meta & 3) as Axis), tex: faces.slice(0, 6) }]),
    selection: (meta) => [shape(bar((meta & 3) as Axis))],
    collision: (meta) => [shape(bar((meta & 3) as Axis))],
    tile: { create: () => ({ speed: 0, stamp: 0 }), tick: (c, t: KTile) => decay(c, t) },
  });

  const crank = mod.block('hand_crank', 'Hand Crank', { render: mod.mc.Render.Model, tex: 'oak_planks', hardness: 1, tool: 'axe', sound: 'wood', opaque: false, lightOpacity: 0 }, {
    placementMeta: (c) => axisMeta(c.face),
    model: (meta, nb, faces) => (nb ? [] : [{ x0: 2, y0: 0, z0: 2, x1: 14, y1: 4, z1: 14, tex: faces.slice(0, 6) }, { ...bar(1, 1), y1: 12, tex: faces.slice(0, 6) }]),
    selection: () => [{ x0: 0.125, y0: 0.125, z0: 0.125, x1: 0.875, y1: 0.875, z1: 0.875 }],
    collision: () => [{ x0: 0.25, y0: 0.25, z0: 0.25, x1: 0.75, y1: 0.75, z1: 0.75 }],
    tile: {
      create: () => ({ speed: 0, stamp: 0, turn: 0 }),
      tick: (c, t: KTile) => {
        const on = (t.turn ?? 0) > 0;
        if (on) t.turn!--;
        const sp = on ? CRANK : 0;
        if (t.speed !== sp) { t.speed = sp; c.tileChanged(); }
        if (sp) spread(c, (c.meta & 3) as Axis, sp);
      },
    },
    onUse: (c) => {
      const t = c.tile<KTile>()!;
      t.turn = Math.min(200, (t.turn ?? 0) + 40);
      c.game.audio.play('kinetic:crank', { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 }, 0.7, 0.9 + Math.random() * 0.2);
      return true;
    },
  });

  // a windmill bearing: its front faces the sails; they turn when there's room for them and wind (more up high)
  const windmill = mod.block('windmill_bearing', 'Windmill Bearing', { tex: 'kinetic:bearing_side', front: 'kinetic:bearing_front', hardness: 2, tool: 'axe', sound: 'wood' }, {
    tile: {
      create: () => ({ speed: 0, stamp: 0 }),
      tick: (c, t: KTile) => {
        if (c.game.ticks % 10 === 0) {
          const [fx, fz] = mod.mc.HORIZ[c.meta & 3];
          let room = 0;
          for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
            const x = c.x + fx + (fz ? a : 0), z = c.z + fz + (fx ? a : 0);
            if ((c.world.get(x, c.y + b, z) & 0xfff) === 0) room++;
          }
          const sp = room >= 20 ? (c.y > 80 ? WIND * 1.5 : WIND) : 0;
          if (t.speed !== sp) { t.speed = sp; c.tileChanged(); }
        }
        // its back drives a shaft lined up with it
        if (t.speed) spread(c, ((c.meta & 1) ? 0 : 2) as Axis, t.speed);
      },
    },
  });

  const millstone = mod.block('millstone', 'Millstone', { render: mod.mc.Render.Model, tex: 'kinetic:millstone_side', top: 'kinetic:millstone_top', hardness: 2, tool: 'pickaxe', sound: 'stone', opaque: false, lightOpacity: 0 }, {
    model: (_meta, nb, f) => [{ x0: 0, y0: 0, z0: 0, x1: 16, y1: 8, z1: 16, tex: f.slice(0, 6) }, ...(nb ? [] : [{ x0: 1, y0: 8, z0: 1, x1: 15, y1: 15, z1: 15, tex: f.slice(0, 6) }])],
    collision: () => [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 15 / 16, z1: 1 }],
    selection: () => [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 15 / 16, z1: 1 }],
    tile: {
      create: () => ({ speed: 0, stamp: 0, input: null, progress: 0 }),
      contents: (t: KTile) => [t.input ?? null],
      tick: (c, t: KTile) => {
        decay(c, t);
        if (!t.speed || !t.input) return;
        t.progress = (t.progress ?? 0) + t.speed;
        if (c.game.ticks % 6 === 0) c.game.particles.blockBreak(c.x, c.y, c.z, mod.mc.BLOCKS[t.input.id]?.item ? t.input.id : mod.mc.B.GRAVEL, 0xffffff);
        if (t.progress < 720) return;
        // two turns of the stone grind one item
        t.progress = 0;
        const name = mod.mc.ITEMS.get(t.input.id)?.name ?? '';
        const [out, n] = GRIND[name] ?? GRIND[name.replace(/^\w+_wool$/, 'wool')] ?? ['', 0];
        const outDef = mod.mc.itemByName(out);
        if (outDef) c.game.dropItem(c.x + 0.5, c.y + 1.1, c.z + 0.5, stack(outDef.id, n));
        c.game.audio.play('kinetic:grind', { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 }, 0.8, 0.8 + Math.random() * 0.3);
        t.input.count--;
        if (t.input.count <= 0) t.input = null;
        c.tileChanged();
      },
    },
    onUse: (c) => {
      const t = c.tile<KTile>()!, held = c.held;
      if (held && GRIND[(mod.mc.ITEMS.get(held.id)?.name ?? '').replace(/^\w+_wool$/, 'wool')]) {
        if (t.input && t.input.id !== held.id) return true;
        const room = 64 - (t.input?.count ?? 0), n = Math.min(room, held.count);
        if (n <= 0) return true;
        t.input = { id: held.id, count: (t.input?.count ?? 0) + n };
        if (!c.player.creative) { held.count -= n; if (held.count <= 0) c.player.inventory.main[c.player.inventory.selected] = null; }
        c.tileChanged();
        return true;
      }
      // empty hand: take back what's waiting
      if (!held && t.input) { c.game.dropItem(c.x + 0.5, c.y + 1.1, c.z + 0.5, t.input); t.input = null; c.tileChanged(); return true; }
      return false;
    },
  });

  const flour = mod.item('flour', { display: 'Wheat Flour' });
  mod.recipes.smelting(flour, 'bread', 0.35);
  mod.recipes.shaped(['I', 'S'], { I: 'iron_ingot', S: 'stick' }, shaft, 4);
  mod.recipes.shaped(['PPP', '  S'], { P: '#planks', S: 'stick' }, crank);
  mod.recipes.shaped(['WWW', 'PSP', 'PPP'], { W: '#wool', P: '#planks', S: shaft }, windmill);
  mod.recipes.shaped(['P', 'S', 'C'], { P: '#planks', S: shaft, C: 'stone' }, millstone);

  shared = { shaft, crank, windmill, millstone };
}

let shared: { shaft: { id: number; key: string }; crank: { id: number; key: string }; windmill: { id: number; key: string }; millstone: { id: number; key: string } } | null = null;

export function client(mod: ModContext) {
  const { math: M, pixels: px, synth } = mod.mc;
  const k = shared!;
  const m: Mat4 = M.mat4();
  /** A turn of `deg` around an axis through the block's centre (plus an optional shift first). */
  const spin = (axis: Axis, deg: number, shift: [number, number, number] = [0, 0, 0]) => {
    M.identity(m);
    M.translate(m, m, 0.5 + shift[0], 0.5 + shift[1], 0.5 + shift[2]);
    const r = (deg * Math.PI) / 180;
    if (axis === 0) M.rotateX(m, m, r);
    else if (axis === 1) M.rotateY(m, m, r);
    else M.rotateZ(m, m, r);
    M.translate(m, m, -0.5, -0.5, -0.5);
    return m;
  };
  const angle = (r: RenderContext, t: Record<string, unknown>) => (r.time * Number(t.speed ?? 0)) % 360;
  const tex = (r: RenderContext, name: string) => { const i = r.tex(name); return [i, i, i, i, i, i]; };

  mod.client.tileRenderer(k.shaft.key, (r, t, x, y, z, v) => {
    const axis = ((v >>> 12) & 3) as Axis;
    r.boxes([{ ...bar(axis), tex: tex(r, 'kinetic:shaft') }], x, y, z, spin(axis, angle(r, t)));
  });
  mod.client.tileRenderer(k.crank.key, (r, t, x, y, z, v) => {
    const axis = ((v >>> 12) & 3) as Axis;
    const wood = tex(r, 'oak_planks'), iron = tex(r, 'kinetic:shaft');
    // hub along the axis, an arm out from it and a handle at the end
    const parts: Box[] = axis === 1
      ? [{ ...bar(1, 1.5), y0: 4, y1: 12, tex: iron }, { x0: 7, y0: 10, z0: 2, x1: 9, y1: 12, z1: 9, tex: wood }, { x0: 6.5, y0: 6, z0: 1.5, x1: 9.5, y1: 12, z1: 4.5, tex: wood }]
      : axis === 0
        ? [{ ...bar(0, 1.5), x0: 4, x1: 12, tex: iron }, { x0: 10, y0: 7, z0: 2, x1: 12, y1: 9, z1: 9, tex: wood }, { x0: 6, y0: 6.5, z0: 1.5, x1: 12, y1: 9.5, z1: 4.5, tex: wood }]
        : [{ ...bar(2, 1.5), z0: 4, z1: 12, tex: iron }, { x0: 7, y0: 2, z0: 10, x1: 9, y1: 9, z1: 12, tex: wood }, { x0: 6.5, y0: 1.5, z0: 6, x1: 9.5, y1: 4.5, z1: 12, tex: wood }];
    r.boxes(parts, x, y, z, spin(axis, angle(r, t)));
  });
  mod.client.tileRenderer(k.windmill.key, (r, t, x, y, z, v) => {
    const f = (v >>> 12) & 3, [fx, fz] = mod.mc.HORIZ[f];
    const axis: Axis = f & 1 ? 0 : 2;
    const sail = tex(r, 'white_wool'), spar = tex(r, 'oak_planks');
    // four sails, three blocks long, in front of the bearing, turning around its axis
    const parts: Box[] = [];
    for (let i = 0; i < 4; i++) {
      // authored for the z axis (sails in the x-y plane), turned 90 degrees each
      const a = (i * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
      const at = (u: number, w: number) => [8 + u * c - w * s, 8 + u * s + w * c];
      const [ax, ay] = at(4, -1), [bx, by] = at(46, 1);
      parts.push({ x0: Math.min(ax, bx), y0: Math.min(ay, by), z0: 7, x1: Math.max(ax, bx), y1: Math.max(ay, by), z1: 9, tex: spar });
      const [cx, cy] = at(12, 2), [dx, dy] = at(46, 12);
      parts.push({ x0: Math.min(cx, dx), y0: Math.min(cy, dy), z0: 7.5, x1: Math.max(cx, dx), y1: Math.max(cy, dy), z1: 8.5, tex: sail });
    }
    const placed = axis === 0 ? parts.map((b) => ({ ...b, x0: b.z0, x1: b.z1, z0: 16 - b.x1, z1: 16 - b.x0 })) : parts;
    r.boxes(placed, x, y, z, spin(axis, angle(r, t), [fx * 0.6, 0, fz * 0.6]));
  });
  mod.client.tileRenderer(k.millstone.key, (r, t, x, y, z) => {
    const side = r.tex('kinetic:millstone_side'), top = r.tex('kinetic:millstone_top');
    r.boxes([{ x0: 1, y0: 8, z0: 1, x1: 15, y1: 15, z1: 15, tex: [side, side, top, top, side, side] }], x, y, z, spin(1, angle(r, t)));
    const input = t.input as ItemStack | null | undefined;
    if (input) {
      M.identity(m);
      M.rotateY(m, m, (r.time * 0.05) % (Math.PI * 2));
      M.scale(m, m, 0.4, 0.4, 0.4);
      r.item(input.id, x + 0.5, y + 1.15, z + 0.5, m);
    }
  });

  // HUD: what the machine under the crosshair is doing
  mod.on('hudRender', ({ ctx, client, width, height }) => {
    const hit = client.target, w = client.world;
    if (!hit || !w || client.ui.screen) return;
    const v = w.get(hit.x, hit.y, hit.z), id = v & 0xfff;
    if (![k.shaft.id, k.crank.id, k.windmill.id, k.millstone.id].includes(id)) return;
    const t = w.getTile(hit.x, hit.y, hit.z) as unknown as KTile | undefined;
    const rpm = Math.round(((t?.speed ?? 0) * 20 * 60) / 360);
    const lines = [`§6${mod.mc.BLOCKS[id].display}`, rpm ? `§7Speed: §f${rpm} RPM` : '§7Not turning'];
    if (id === k.millstone.id && t?.input) lines.push(`§7Grinding ${t.input.count} ${mod.mc.ITEMS.get(t.input.id)?.display ?? ''}`);
    if (id === k.windmill.id && !rpm) lines.push('§7Needs open air in front');
    lines.forEach((l, i) => client.gui.text(ctx, l, Math.floor(width / 2) + 12, Math.floor(height / 2) - 14 + 10 * i));
  });

  // sounds
  mod.client.sound('kinetic:grind', (rng) => {
    const n = mod.mc.SAMPLE_RATE * 0.35;
    return synth.normalize(synth.env(synth.lowpass(synth.noise(n, rng), 700), 0.01, 0.3, 2), 0.6);
  });
  mod.client.sound('kinetic:crank', () => synth.normalize(synth.env(synth.tone(mod.mc.SAMPLE_RATE * 0.12, 220, 160, 'saw'), 0.002, 0.1, 2), 0.4));

  // textures
  const P = (...h: string[]) => h.map(px.hex);
  const iron = P('#5b5f63', '#7d8186', '#9da2a7', '#c3c7cb');
  mod.client.texture('kinetic:shaft', (rng) => {
    const img = px.newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px.set(img, x, y, iron[(y % 4 === 0 ? 0 : 1 + ((x + rng.int(2)) % 3 === 0 ? 1 : 0) + (y % 4 === 1 ? 1 : 0))]);
    return img;
  });
  const stoneP = P('#6a6a6a', '#7a7a7a', '#8a8a8a', '#5a5a5a');
  mod.client.texture('kinetic:millstone_side', (rng) => {
    const img = px.newImg();
    px.paletteNoise(img, rng, stoneP.slice(0, 3), { passes: 1, jitter: 0.4 });
    for (let x = 0; x < 16; x++) { px.set(img, x, 7, stoneP[3]); px.set(img, x, 8, stoneP[3]); }
    return img;
  });
  mod.client.texture('kinetic:millstone_top', (rng) => {
    const img = px.newImg();
    px.paletteNoise(img, rng, stoneP.slice(0, 3), { passes: 1, jitter: 0.4 });
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 2) px.set(img, x, y, P('#3a3a3a')[0]);
      else if (Math.abs(d - 5) < 0.5 || (d > 2 && d < 7 && (Math.round(Math.atan2(y - 7.5, x - 7.5) * 3) % 2 === 0) && Math.abs(d - 4) < 0.6)) px.set(img, x, y, stoneP[3]);
    }
    return img;
  });
  const wood = P('#6b4e2e', '#8a6a3a', '#a07a44', '#4a3420');
  mod.client.texture('kinetic:bearing_side', (rng) => {
    const img = px.newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px.set(img, x, y, y % 5 === 0 ? wood[3] : wood[rng.int(3)]);
    for (let i = 0; i < 16; i++) { px.set(img, 0, i, wood[3]); px.set(img, 15, i, wood[3]); }
    return img;
  });
  mod.client.texture('kinetic:bearing_front', (rng) => {
    const img = px.newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px.set(img, x, y, wood[rng.int(3)]);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 3) px.set(img, x, y, iron[d < 1.5 ? 0 : 2]);
      else if (d < 4) px.set(img, x, y, iron[1]);
    }
    return img;
  });
  mod.client.itemSprite('kinetic:flour', () => {
    const img = px.newImg();
    px.art(img, [
      '                ', '                ', '      wwww      ', '     wWWWWw     ', '    wWWWWWWw    ', '    wWWWWWWw    ',
      '   wWWWWWWWWw   ', '   wWWWWWWWWw   ', '   wWWWWWWWWw   ', '    wwwwwwww    ',
    ], { w: px.hex('#c8bfa8'), W: px.hex('#f2ecdc') });
    return img;
  }, '#6a5a40');
}
