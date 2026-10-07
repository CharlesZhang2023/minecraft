// Structures of the 1.16 Nether: bastion remnants (four layouts built from shared pieces: ramparts, towers, rooms,
// ramps, a treasure core), ruined portals (shared with the overworld) and nether fossils in soul sand valleys.
import { Random } from '../../noise';
import { B, B2, STONE2, WOOD, pack, OPAQUE } from '../blocks';
import { BIOME } from '../biomes';
import { StructureType, Start, Piece, BuildCtx, bbox, union, fill, shell, pillarDown, weighted, GenAccess, BBox } from '../structure';
import { ruinedPortalPieces } from './ruins';
import { fortressesNear } from '../fortress';

const X = STONE2;
/** Bastion stonework: bricks, cracked bricks and gilded blackstone mixed in, some blocks fallen away. */
function brick(r: Random): number {
  const k = r.int(100);
  return k < 70 ? X.POLISHED_BLACKSTONE_BRICKS : k < 88 ? X.CRACKED_POLISHED_BLACKSTONE_BRICKS : k < 97 ? X.BLACKSTONE : X.GILDED_BLACKSTONE;
}
const stairs = (f: number, top = false) => pack(X.POLISHED_BLACKSTONE_BRICK_STAIRS, f | (top ? 4 : 0));

// ------------------------------------------------------------------ shared bastion pieces
/** A thick rampart wall along a box, crenellated on top, with gaps where it has fallen in. */
function rampart(box: BBox): Piece {
  return {
    box,
    build(ctx: BuildCtx, r: Random) {
      fill(ctx, box, (x, y, z) => {
        if (y === box.y1 && (x + z) % 2) return null; // crenellations
        if (y > box.y0 + 3 && r.int(40) === 0) return 0; // ruin gaps
        return brick(r);
      });
      // foundations down to the ground or lava
      for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) pillarDown(ctx, x, box.y0 - 1, z, X.BLACKSTONE, 6);
    },
  };
}
/** A tower: a hollow square with floors every 5 blocks, chains and lanterns, a chest on one floor. */
function tower(x: number, y: number, z: number, size: number, h: number, chest: string | null): Piece {
  const box = bbox(x, y, z, x + size - 1, y + h - 1, z + size - 1);
  return {
    box,
    build(ctx, r) {
      shell(ctx, box, () => brick(r), 0);
      for (let fy = y + 5; fy < y + h - 1; fy += 5) fill(ctx, bbox(x + 1, fy, z + 1, x + size - 2, fy, z + size - 2), (xx, _y, zz) => ((xx + zz) % 3 === 0 ? X.POLISHED_BLACKSTONE : X.POLISHED_BLACKSTONE_SLAB));
      // doorways on two sides
      fill(ctx, bbox(x + (size >> 1), y + 1, z, x + (size >> 1), y + 3, z), 0);
      fill(ctx, bbox(x + (size >> 1), y + 1, z + size - 1, x + (size >> 1), y + 3, z + size - 1), 0);
      // hanging chain with a lantern
      const mx = x + (size >> 1), mz = z + (size >> 1);
      for (let cy = y + h - 2; cy > y + h - 5; cy--) ctx.set(mx, cy, mz, pack(B2.CHAIN, 0));
      ctx.set(mx, y + h - 5, mz, pack(B2.LANTERN, 1));
      if (chest) ctx.chest(x + 1, y + 1, z + 1, chest, pack(B.CHEST, 2));
      for (let xx = x; xx < x + size; xx++) for (let zz = z; zz < z + size; zz++) pillarDown(ctx, xx, y - 1, zz, X.BLACKSTONE, 6);
      void r;
    },
  };
}
/** A walkway/ramp of polished blackstone bricks with slab edges, from (x0,y0,z0) to (x1,y1,z1) along x or z. */
function walkway(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width = 3): Piece {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const box = alongX ? bbox(x0, Math.min(y0, y1) - 3, z0 - 1, x1, Math.max(y0, y1) + 1, z0 + width) : bbox(x0 - 1, Math.min(y0, y1) - 3, z0, x0 + width, Math.max(y0, y1) + 1, z1);
  return {
    box,
    build(ctx, r) {
      for (let k = 0; k <= len; k++) {
        const t = len ? k / len : 0;
        const y = Math.round(y0 + (y1 - y0) * t);
        for (let w = -1; w <= width; w++) {
          const px = alongX ? (x0 < x1 ? x0 + k : x0 - k) : x0 + w;
          const pz = alongX ? z0 + w : (z0 < z1 ? z0 + k : z0 - k);
          const edge = w === -1 || w === width;
          if (r.int(30) === 0) continue; // broken bits
          ctx.set(px, y, pz, edge ? X.POLISHED_BLACKSTONE_BRICK_WALL : X.POLISHED_BLACKSTONE_BRICKS);
          if (!edge && k % 6 === 0) ctx.set(px, y - 1, pz, X.POLISHED_BLACKSTONE_BRICKS);
          if (edge && k % 6 === 0) for (let d = 1; d < 20; d++) { if (OPAQUE[ctx.get(px, y - d, pz) & 0xfff]) break; ctx.set(px, y - d, pz, X.POLISHED_BLACKSTONE_BRICK_WALL); }
        }
      }
    },
  };
}
/** A hoglin pen: a fenced yard of soul sand and crimson nylium with hoglins in it. */
function pen(x: number, y: number, z: number, w: number, d: number): Piece {
  const box = bbox(x, y, z, x + w - 1, y + 3, z + d - 1);
  return {
    box,
    build(ctx, r) {
      fill(ctx, bbox(x, y, z, x + w - 1, y, z + d - 1), () => (r.int(3) ? B2.CRIMSON_NYLIUM : B.SOUL_SAND));
      fill(ctx, bbox(x, y + 1, z, x + w - 1, y + 3, z + d - 1), (xx, yy, zz) => (xx === x || xx === x + w - 1 || zz === z || zz === z + d - 1 ? (yy < y + 3 ? WOOD.crimson.fence : null) : 0));
      for (let k = 0; k < 2; k++) ctx.spawn('hoglin', x + 1.5 + r.int(w - 2), y + 1, z + 1.5 + r.int(d - 2));
      for (let xx = x; xx < x + w; xx++) for (let zz = z; zz < z + d; zz++) pillarDown(ctx, xx, y - 1, zz, X.BLACKSTONE, 6);
    },
  };
}
/** Piglins (and now and then a brute) standing about a spot. */
function guards(x: number, y: number, z: number, n: number, brutes: number): Piece {
  return {
    box: bbox(x - 1, y, z - 1, x + 1, y + 2, z + 1),
    build(ctx, r) {
      for (let k = 0; k < n; k++) ctx.spawn(k < brutes ? 'piglin_brute' : 'piglin', x + 0.5 + r.int(3) - 1, y, z + 0.5 + r.int(3) - 1, { bastion: true });
    },
  };
}
/** The treasure room's core: a basalt-and-lava block in the middle of a hollow, gold and ancient debris, the treasure chest on top. */
function treasureCore(x: number, y: number, z: number): Piece {
  const box = bbox(x - 6, y, z - 6, x + 6, y + 10, z + 6);
  return {
    box,
    build(ctx, r) {
      fill(ctx, bbox(x - 4, y, z - 4, x + 4, y + 5, z + 4), (xx, yy, zz) => {
        const edge = Math.abs(xx - x) === 4 || Math.abs(zz - z) === 4;
        if (edge) return yy === y + 5 ? X.POLISHED_BLACKSTONE_BRICK_SLAB : brick(r);
        if (yy === y + 5) return X.POLISHED_BLACKSTONE_BRICKS;
        return r.int(6) === 0 ? B.GOLD_BLOCK : r.int(10) === 0 ? B2.ANCIENT_DEBRIS : r.int(4) === 0 ? B.MAGMA_BLOCK : STONE2.BASALT;
      });
      // lava falls at the corners
      for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) ctx.set(x + dx, y + 5, z + dz, B.LAVA);
      ctx.chest(x, y + 6, z, 'bastion_treasure', pack(B.CHEST, 2));
      ctx.set(x, y + 6, z + 1, B.GOLD_BLOCK);
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) ctx.set(x + dx, y + 6, z + dz, X.GILDED_BLACKSTONE);
    },
  };
}

type Variant = 'bridge' | 'stables' | 'units' | 'treasure';
function bastion(g: GenAccess, cx: number, cz: number, r: Random): Start | null {
  const x = cx * 16 + 8, z = cz * 16 + 8;
  const biome = g.biome(x, z);
  if (biome === BIOME.BASALT_DELTAS) return null;
  // bastions and fortresses don't share ground
  if (fortressesNear(g.seed, cx, cz).some((f) => Math.abs(f.x - x) < 112 && Math.abs(f.z - z) < 112)) return null;
  const y = 33;
  const v: Variant = weighted(r, [['bridge', 1], ['stables', 1], ['units', 1], ['treasure', 1]]);
  const pieces: Piece[] = [];
  const S = 24 + r.int(8); // half size
  switch (v) {
    case 'treasure': {
      // a great hollow square of walls with a ring walkway and the core in the middle
      const h = 26;
      pieces.push(rampart(bbox(x - S, y, z - S, x + S, y + h, z - S + 2)), rampart(bbox(x - S, y, z + S - 2, x + S, y + h, z + S)));
      pieces.push(rampart(bbox(x - S, y, z - S, x - S + 2, y + h, z + S)), rampart(bbox(x + S - 2, y, z - S, x + S, y + h, z + S)));
      pieces.push(walkway(x - S + 3, y + 12, z - S + 3, x + S - 3, y + 12, z - S + 3, 2), walkway(x - S + 3, y + 12, z + S - 6, x + S - 3, y + 12, z + S - 6, 2));
      pieces.push(walkway(x - 1, y + 12, z - S + 5, x - 1, y + 7, z - 7, 2));
      pieces.push(treasureCore(x, y + 1, z));
      pieces.push(guards(x - S + 5, y + 13, z - S + 4, 3, 1), guards(x + S - 6, y + 13, z + S - 5, 3, 2), guards(x, y + 7, z - 5, 2, 2));
      break;
    }
    case 'bridge': {
      // two gate towers joined by a long bridge over the lava, ramparts at both ends
      const len = S * 2;
      pieces.push(tower(x - S - 4, y, z - 4, 9, 22, 'bastion_bridge'), tower(x + S - 4, y, z - 4, 9, 22, 'bastion_other'));
      pieces.push(walkway(x - S + 5, y + 10, z - 1, x + S - 5, y + 10, z - 1, 3));
      pieces.push(rampart(bbox(x - S - 10, y, z - 12, x - S - 6, y + 14, z + 12)), rampart(bbox(x + S + 6, y, z - 12, x + S + 10, y + 14, z + 12)));
      pieces.push(guards(x - S, y + 11, z, 3, 1), guards(x + S, y + 11, z, 3, 1), guards(x, y + 11, z, 2, 0));
      void len;
      break;
    }
    case 'stables': {
      // a ring of ramparts around ramps up to a central platform, hoglin pens below
      pieces.push(rampart(bbox(x - S, y, z - S, x + S, y + 16, z - S + 2)), rampart(bbox(x - S, y, z + S - 2, x + S, y + 16, z + S)));
      pieces.push(rampart(bbox(x - S, y, z - S, x - S + 2, y + 16, z + S)));
      pieces.push(walkway(x - S + 4, y + 1, z - 2, x, y + 12, z - 2, 4));
      pieces.push(tower(x - 4, y, z + 4, 9, 18, 'bastion_hoglin_stable'));
      pieces.push(pen(x - S + 4, y + 1, z + 4, 9, 8), pen(x + 6, y + 1, z - S + 4, 10, 8), pen(x + 8, y + 1, z + 6, 8, 9));
      pieces.push(guards(x, y + 13, z - 2, 3, 1), guards(x - S + 6, y + 2, z - S + 6, 2, 0));
      break;
    }
    case 'units': {
      // housing: stacked rooms in a block of towers, joined by walkways
      const towers: [number, number][] = [[-S + 2, -S + 2], [S - 12, -S + 2], [-S + 2, S - 12], [S - 12, S - 12], [-5, -5]];
      towers.forEach(([dx, dz], i) => pieces.push(tower(x + dx, y, z + dz, 11, 16 + (i === 4 ? 8 : 0), i % 2 ? 'bastion_other' : 'bastion_bridge')));
      pieces.push(walkway(x - S + 13, y + 10, z - S + 6, x + S - 13, y + 10, z - S + 6, 2), walkway(x - S + 13, y + 10, z + S - 7, x + S - 13, y + 10, z + S - 7, 2));
      pieces.push(walkway(x - S + 6, y + 10, z - S + 13, x - S + 6, y + 10, z + S - 13, 2));
      pieces.push(guards(x - S + 7, y + 1, z - S + 7, 3, 0), guards(x + S - 7, y + 1, z + S - 7, 3, 1), guards(x, y + 6, z, 4, 1));
      break;
    }
  }
  let box = pieces[0].box;
  for (const p of pieces) box = union(box, p.box);
  return { type: 'bastion_remnant', x, y, z, pieces, box };
}

// ------------------------------------------------------------------ nether fossils
const FOSSILS: string[][] = [
  // a spine with ribs, a skull, a curled tail (top view rows, built 1-3 high)
  ['.B.B.B.B.', 'BBBBBBBBB', '.B.B.B.B.'],
  ['..BB..', '.B..B.', 'B....B', 'BBBBBB', 'B....B', '.B..B.'],
  ['BBB....', 'B.B....', 'BBBBBBB', '....B.B', '....BBB'],
];
function fossil(g: GenAccess, cx: number, cz: number, r: Random): Start | null {
  if (r.int(3)) return null;
  const x = cx * 16 + r.int(10), z = cz * 16 + r.int(10);
  if (g.biome(x, z) !== BIOME.SOUL_SAND_VALLEY) return null;
  const shape = FOSSILS[r.int(FOSSILS.length)];
  const y = 32 + r.int(30), layers = 1 + r.int(3);
  const box = bbox(x, y - 2, z, x + shape[0].length, y + layers + 2, z + shape.length);
  const piece: Piece = {
    box,
    build(ctx, pr) {
      // settle onto the first floor below
      let yy = y;
      for (let k = 0; k < 30; k++) { if (OPAQUE[ctx.get(x + 1, yy - 1, z + 1) & 0xfff]) break; yy--; }
      for (let l = 0; l < layers; l++)
        shape.forEach((row, dz) => [...row].forEach((ch, dx) => {
          if (ch !== 'B' || pr.int(8) === 0) return;
          ctx.set(x + dx, yy + l, z + dz, pack(B2.BONE_BLOCK, dz % 2 ? 1 : 2));
        }));
    },
  };
  return { type: 'nether_fossil', x, y, z, pieces: [piece], box };
}

export const BASTION: StructureType = { name: 'bastion_remnant', spacing: 27, separation: 4, salt: 30084232, reach: 3, layout: bastion };
export const RUINED_PORTAL_NETHER: StructureType = {
  name: 'ruined_portal_nether', spacing: 25, separation: 10, salt: 34222645, reach: 1,
  layout: (g, cx, cz, r) => ruinedPortalPieces(g, cx, cz, r, 'nether'),
};
export const NETHER_FOSSIL: StructureType = { name: 'nether_fossil', spacing: 2, separation: 1, salt: 14357921, reach: 1, layout: fossil };
export const NETHER_STRUCTURES: StructureType[] = [BASTION, RUINED_PORTAL_NETHER, NETHER_FOSSIL];
void stairs;
