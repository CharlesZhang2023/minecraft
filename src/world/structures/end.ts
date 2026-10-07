// End cities (vanilla 1.9): grown from a starting house by recursion, like vanilla's EndCityPieces — towers rise
// from houses, bridges branch off the towers and end in further towers, fat towers with treasure rooms, or now and
// then an End ship with the elytra, a dragon head, potions and loot. Pieces that would run into earlier ones are
// left out, so cities sprawl differently every time. Shulkers wait on the walls.
import { Random } from '../../noise';
import { B, B2, STONE2, pack, OPAQUE, STAINED_GLASS, BEDS } from '../blocks';
import { BIOME } from '../biomes';
import { StructureType, Start, Piece, BuildCtx, bbox, BBox, union, fill, overlaps, GenAccess } from '../structure';
import { POTION_ITEMS } from '../../game/items';

const X = STONE2;
const PURPUR = X.PURPUR_BLOCK, PILLAR = X.PURPUR_PILLAR, BRICKS = X.END_STONE_BRICKS;
const GLASS = STAINED_GLASS[2]; // magenta
const pstairs = (f: number, top = false) => pack(X.PURPUR_STAIRS, f | (top ? 4 : 0));
const pslab = (top = false) => pack(X.PURPUR_SLAB, top ? 1 : 0);
const rod = (axis = 0) => pack(B2.END_ROD, axis);

/** Shulkers sit inside walls facing out; here they're spawned against a wall (the mob attaches itself). */
const shulker = (ctx: BuildCtx, x: number, y: number, z: number) => ctx.spawn('shulker', x + 0.5, y, z + 0.5);

// ------------------------------------------------------------------ piece builders
function house(b: BBox, floors: number, r0: number): Piece {
  return {
    box: b,
    build(ctx, r) {
      const fh = Math.floor((b.y1 - b.y0) / floors);
      for (let f = 0; f < floors; f++) {
        const y0 = b.y0 + f * fh, y1 = y0 + fh;
        fill(ctx, bbox(b.x0, y0, b.z0, b.x1, y1, b.z1), (x, y, z) => {
          const corner = (x === b.x0 || x === b.x1) && (z === b.z0 || z === b.z1);
          const wall = x === b.x0 || x === b.x1 || z === b.z0 || z === b.z1;
          if (y === y0) return f === 0 ? BRICKS : PURPUR;
          if (corner) return pack(PILLAR, 0);
          if (wall) return y === y0 + 2 && (x + z) % 3 === 0 ? GLASS : PURPUR;
          return 0;
        });
        // a doorway and a way up
        fill(ctx, bbox((b.x0 + b.x1) >> 1, y0 + 1, b.z0, (b.x0 + b.x1) >> 1, y0 + 2, b.z0), 0);
        if (f < floors - 1) for (let k = 0; k < fh; k++) ctx.set(b.x0 + 1, y0 + 1 + k, b.z0 + 1, pack(B.LADDER, 0));
        if (r.int(2) === 0) shulker(ctx, b.x1 - 1, y0 + 1, b.z1 - 1);
      }
      // the roof: slabs with stairs round the edge, end rods at the corners
      fill(ctx, bbox(b.x0, b.y1, b.z0, b.x1, b.y1, b.z1), (x, _y, z) => (x === b.x0 ? pstairs(1) : x === b.x1 ? pstairs(3) : z === b.z0 ? pstairs(2) : z === b.z1 ? pstairs(0) : PURPUR));
      for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]]) ctx.set(x, b.y1 + 1, z, rod());
      void r0;
    },
  };
}
function towerPiece(b: BBox, top: boolean): Piece {
  return {
    box: b,
    build(ctx, r) {
      fill(ctx, b, (x, y, z) => {
        const corner = (x === b.x0 || x === b.x1) && (z === b.z0 || z === b.z1);
        const wall = x === b.x0 || x === b.x1 || z === b.z0 || z === b.z1;
        if (y === b.y0 && (y - b.y0) % 4 === 0) return PURPUR;
        if (corner) return pack(PILLAR, 0);
        if (wall) return (y - b.y0) % 4 === 2 && (x + z) % 2 === 0 ? GLASS : PURPUR;
        return (y - b.y0) % 4 === 0 ? pslab(true) : 0;
      });
      // a ladder up the inside
      for (let y = b.y0 + 1; y < b.y1; y++) ctx.set(b.x0 + 1, y, b.z0 + 1, pack(B.LADDER, 0));
      if (top) {
        fill(ctx, bbox(b.x0 - 1, b.y1, b.z0 - 1, b.x1 + 1, b.y1, b.z1 + 1), PURPUR);
        fill(ctx, bbox(b.x0, b.y1 + 1, b.z0, b.x1, b.y1 + 1, b.z1), (x, _y, z) => (x === b.x0 || x === b.x1 || z === b.z0 || z === b.z1 ? pslab() : 0));
        for (const [x, z] of [[b.x0 - 1, b.z0 - 1], [b.x1 + 1, b.z0 - 1], [b.x0 - 1, b.z1 + 1], [b.x1 + 1, b.z1 + 1]]) { ctx.set(x, b.y1 + 1, z, rod()); ctx.set(x, b.y1 + 2, z, rod()); }
        shulker(ctx, (b.x0 + b.x1) >> 1, b.y1 + 1, (b.z0 + b.z1) >> 1);
      } else if (r.int(3) === 0) shulker(ctx, b.x1 - 1, b.y0 + 1, b.z1 - 1);
    },
  };
}
function bridge(x0: number, y0: number, z0: number, dir: number, len: number, rise: number): { piece: Piece; end: [number, number, number] } {
  const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][dir];
  const x1 = x0 + dx * len, z1 = z0 + dz * len, y1 = y0 + rise;
  const side = dx === 0 ? 1 : 0;
  const b = bbox(x0 - side * 2 - (1 - side) * 0, Math.min(y0, y1) - 2, z0 - (1 - side) * 2, x1 + side * 2, Math.max(y0, y1) + 3, z1 + (1 - side) * 2);
  const piece: Piece = {
    box: union(b, bbox(x0, y0, z0, x1, y1, z1)),
    build(ctx) {
      for (let k = 0; k <= len; k++) {
        const y = Math.round(y0 + (rise * k) / len);
        const cx = x0 + dx * k, cz = z0 + dz * k;
        for (let w = -1; w <= 1; w++) {
          const px = cx + (dz !== 0 ? w : 0), pz = cz + (dx !== 0 ? w : 0);
          ctx.set(px, y, pz, w === 0 ? PURPUR : pslab(true));
          if (w !== 0) ctx.set(px, y + 1, pz, k % 3 === 0 ? pack(PILLAR, 0) : 0);
        }
        // supports hanging under the bridge
        if (k % 4 === 0) ctx.set(cx, y - 1, cz, rod());
      }
    },
  };
  return { piece, end: [x1, y1, z1] };
}
function fatTower(b: BBox): Piece {
  return {
    box: b,
    build(ctx, r) {
      const segH = 8;
      fill(ctx, b, (x, y, z) => {
        const ly = y - b.y0;
        const corner = (x === b.x0 || x === b.x1) && (z === b.z0 || z === b.z1);
        const wall = x === b.x0 || x === b.x1 || z === b.z0 || z === b.z1;
        if (ly % segH === 0) return wall ? PURPUR : BRICKS;
        if (corner) return pack(PILLAR, 0);
        if (wall) return ly % segH === 4 && (x + z) % 2 === 0 ? GLASS : PURPUR;
        return 0;
      });
      for (let y = b.y0 + 1; y < b.y1; y++) ctx.set(b.x0 + 1, y, b.z0 + 1, pack(B.LADDER, 0));
      // the treasure room at the top: two chests
      const ty = b.y1 - segH + 1;
      ctx.chest(b.x0 + 2, ty, b.z1 - 2, 'end_city_treasure', pack(B.CHEST, 0));
      ctx.chest(b.x1 - 2, ty, b.z1 - 2, 'end_city_treasure', pack(B.CHEST, 0));
      for (let k = 0; k < 2 + r.int(2); k++) shulker(ctx, b.x0 + 2 + r.int(b.x1 - b.x0 - 3), b.y0 + 1 + r.int(b.y1 - b.y0 - 2), b.z0 + 2 + r.int(b.z1 - b.z0 - 3));
      fill(ctx, bbox(b.x0, b.y1 + 1, b.z0, b.x1, b.y1 + 1, b.z1), (x, _y, z) => (x === b.x0 || x === b.x1 || z === b.z0 || z === b.z1 ? pslab() : 0));
      for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]]) for (let k = 1; k <= 3; k++) ctx.set(x, b.y1 + 1 + k, z, rod());
    },
  };
}
/**
 * An End ship: a purpur hull with obsidian keel, a mast, a dragon head on the bow, and in the cabin two chests, a
 * brewing stand with healing potions and the elytra in an item frame.
 */
function ship(x: number, y: number, z: number, dir: number): Piece {
  // authored pointing +x (bow at +x); turned by dir (0 n, 1 e, 2 s, 3 w)
  const L = 21, W = 4;
  const tr = (a: number, c: number): [number, number] => {
    switch (dir) { case 1: return [x + a, z + c]; case 3: return [x - a, z - c]; case 0: return [x + c, z - a]; default: return [x - c, z + a]; }
  };
  const box = (() => { const [a0, c0] = tr(-2, -W - 1), [a1, c1] = tr(L + 2, W + 1); return bbox(a0, y - 4, c0, a1, y + 14, c1); })();
  return {
    box,
    build(ctx, r) {
      const S = (a: number, h: number, c: number, v: number) => { const [px, pz] = tr(a, c); ctx.set(px, y + h, pz, v); };
      for (let a = 0; a <= L; a++) {
        const half = Math.max(1, Math.round(W * Math.sin((Math.PI * Math.min(a, L - 2)) / (L - 1)) ** 0.7));
        for (let c = -half; c <= half; c++) {
          S(a, -2, c, Math.abs(c) === half ? PURPUR : B.OBSIDIAN);
          S(a, -1, c, Math.abs(c) === half ? PURPUR : X.PURPUR_BLOCK);
          S(a, 0, c, Math.abs(c) === half ? pslab(true) : PURPUR); // deck
          if (Math.abs(c) === half) S(a, 1, c, a % 3 === 0 ? pack(PILLAR, 0) : pslab());
        }
        S(a, -3, 0, B.OBSIDIAN);
      }
      // the mast with a sail of magenta glass panes and end rods
      for (let h = 1; h < 12; h++) S(10, h, 0, pack(PILLAR, 0));
      for (let h = 5; h < 11; h++) for (let c = -3; c <= 3; c++) if (c !== 0) S(10, h, c, GLASS);
      S(10, 12, 0, rod());
      // the bow: a dragon head looking ahead
      S(L + 1, 1, 0, pack(B2.DRAGON_HEAD, [8, 12, 0, 4][dir]));
      // the cabin at the stern
      for (let a = 1; a <= 6; a++) for (let c = -2; c <= 2; c++) for (let h = 1; h <= 4; h++) {
        const edge = a === 1 || a === 6 || Math.abs(c) === 2 || h === 4;
        S(a, h, c, edge ? (h === 2 && !(a === 1 || a === 6) && c === 0 ? GLASS : PURPUR) : 0);
      }
      S(6, 1, 0, 0); S(6, 2, 0, 0); // cabin door to the deck
      const [cx1, cz1] = tr(2, -1), [cx2, cz2] = tr(2, 1);
      ctx.chest(cx1, y + 1, cz1, 'end_city_treasure', pack(B.CHEST, (dir + 1) & 3));
      ctx.chest(cx2, y + 1, cz2, 'end_city_treasure', pack(B.CHEST, (dir + 3) & 3));
      const [bx, bz] = tr(4, -1);
      ctx.set(bx, y + 1, bz, pack(B.BREWING_STAND, 0b11));
      ctx.spawn('tile', bx, y + 1, bz, { tile: { type: 'brewing', slots: [{ id: POTION_ITEMS.strong_healing, count: 1 }, { id: POTION_ITEMS.strong_healing, count: 1 }, null, null, null], fuel: 0, brew: 0 } });
      // the elytra in an item frame on the cabin's back wall, facing the door
      const [fx, fz] = tr(2, 0);
      ctx.spawn('item_frame', fx + 0.5, y + 2, fz + 0.5, { item: { id: 'elytra', count: 1 }, facing: (dir + 0) & 3 });
      for (let k = 0; k < 3; k++) { const [sx, sz] = tr(8 + r.int(10), r.int(3) - 1); shulker(ctx, sx, y + 1, sz); }
      void BEDS;
    },
  };
}

// ------------------------------------------------------------------ the city, grown by recursion
function city(g: GenAccess, cx: number, cz: number, r: Random): Start | null {
  const x = cx * 16 + 8, z = cz * 16 + 8;
  if (Math.hypot(x, z) < 1024) return null;
  const biome = g.biome(x, z);
  if (biome !== BIOME.END_HIGHLANDS) return null;
  // all four corners of the base on high ground (vanilla: the lowest corner at least 60)
  const hs = [g.height(x - 6, z - 6), g.height(x + 6, z - 6), g.height(x - 6, z + 6), g.height(x + 6, z + 6)];
  if (Math.min(...hs) < 56) return null;
  const y = Math.min(...hs) + 1;
  const pieces: Piece[] = [];
  const boxes: BBox[] = [];
  const add = (p: Piece, check = true): boolean => {
    if (check && boxes.some((b) => overlaps(b, p.box))) return false;
    boxes.push(p.box);
    pieces.push(p);
    return true;
  };
  let shipPlaced = false;
  // the base house
  const hb = bbox(x - 6, y, z - 6, x + 6, y + 10, z + 6);
  add(house(hb, 2, 0), false);
  add({ box: bbox(x - 7, y - 6, z - 7, x + 7, y - 1, z + 7), build(ctx) { fill(ctx, bbox(x - 7, y - 6, z - 7, x + 7, y - 1, z + 7), (xx, yy, zz) => (OPAQUE[ctx.get(xx, yy, zz) & 0xfff] ? null : BRICKS)); } }, false);
  const growTower = (tx: number, ty: number, tz: number, depth: number) => {
    const h = 8 + r.int(3) * 4;
    const tb = bbox(tx - 2, ty, tz - 2, tx + 2, ty + h, tz + 2);
    if (!add(towerPiece(tb, true))) return;
    if (depth > 6) return;
    // bridges branch from the tower's sides
    for (let dir = 0; dir < 4; dir++) {
      if (r.int(3) !== 0) continue;
      const by = ty + 4 + r.int(Math.max(1, h - 6));
      const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][dir];
      const len = 8 + r.int(8), rise = r.int(3) === 0 ? r.int(7) - 3 : 0;
      const sx = tx + dx * 3, sz = tz + dz * 3;
      const { piece, end } = bridge(sx, by, sz, dir, len, rise);
      if (!add(piece)) continue;
      const [ex, ey, ez] = end;
      const roll = r.int(10);
      if (!shipPlaced && depth >= 1 && roll < 3) {
        // a ship moored off the end of the bridge
        const sp = ship(ex + dx * 5, ey - 2, ez + dz * 5, dir);
        if (add(sp)) { shipPlaced = true; continue; }
      }
      if (roll < 6) {
        const fb = bbox(ex + dx * 5 - 4, ey - 8, ez + dz * 5 - 4, ex + dx * 5 + 4, ey + 16, ez + dz * 5 + 4);
        if (add(fatTower(fb))) continue;
      }
      growTower(ex + dx * 3, ey, ez + dz * 3, depth + 1);
    }
  };
  growTower(x, y + 11, z, 0);
  let box = pieces[0].box;
  for (const p of pieces) box = union(box, p.box);
  return { type: 'end_city', x, y, z, pieces, box };
}

export const END_CITY: StructureType = { name: 'end_city', spacing: 20, separation: 11, salt: 10387313, reach: 8, triangular: true, layout: city };
export const END_STRUCTURES: StructureType[] = [END_CITY];
