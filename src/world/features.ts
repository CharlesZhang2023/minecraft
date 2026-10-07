// Trees, huge mushrooms and huge fungi: shared by the terrain generators (writing into a chunk) and by saplings,
// fungi and bone meal in a running world. Each takes a random generator and a setter, so the same seed grows the
// same tree wherever it's asked for.
import { Random } from '../noise';
import { B, B2, WOOD, pack, HORIZ } from './blocks';

export type Setter = (x: number, y: number, z: number, v: number, force?: boolean) => void;
export type Getter = (x: number, y: number, z: number) => number;

const LOG_X = 1, LOG_Z = 2;
/** A blob of leaves: a squashed sphere with ragged corners. */
function leafBlob(r: Random, set: Setter, x: number, y: number, z: number, rad: number, leaves: number, flat = 0.6) {
  for (let dy = -Math.ceil(rad * flat); dy <= Math.ceil(rad * flat); dy++)
    for (let dx = -rad; dx <= rad; dx++)
      for (let dz = -rad; dz <= rad; dz++) {
        const d = (dx * dx + dz * dz) / (rad * rad) + (dy * dy) / Math.max(1, rad * flat * rad * flat);
        if (d > 1.05 || (d > 0.75 && r.next() < 0.35)) continue;
        set(x + dx, y + dy, z + dz, leaves);
      }
}

// ------------------------------------------------------------------ jungle
/** A jungle tree: a tall thin trunk, a leaf cap, vines down its sides and now and then cocoa. */
export function jungleTree(r: Random, x: number, y: number, z: number, set: Setter, vines = true) {
  const w = WOOD.jungle, h = 4 + r.int(7);
  set(x, y - 1, z, B.DIRT, true);
  for (let i = 0; i < h; i++) set(x, y + i, z, w.log, true);
  for (let yy = y + h - 3; yy <= y + h; yy++) {
    const rad = yy >= y + h - 1 ? 1 : 2;
    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) if (Math.abs(dx) + Math.abs(dz) < rad * 2 || r.bool()) set(x + dx, yy, z + dz, w.leaves);
  }
  if (vines) for (let i = 1; i < h - 2; i++) for (let d = 0; d < 4; d++) {
    if (r.int(3)) continue;
    const [dx, dz] = HORIZ[d];
    set(x + dx, y + i, z + dz, pack(B2.VINE, 1 << ((d + 2) & 3)));
    if (r.int(5) === 0 && i < h - 3) set(x + dx, y + i, z + dz, pack(B2.COCOA, (d + 2) & 3 | (r.int(3) << 2)), true);
  }
}
/** A giant jungle tree: a 2x2 trunk up to 30 high, branches with leaf clumps, vines all over. */
export function megaJungleTree(r: Random, x: number, y: number, z: number, set: Setter) {
  const w = WOOD.jungle, h = 15 + r.int(15);
  for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    set(x + ox, y - 1, z + oz, B.DIRT, true);
    for (let i = 0; i < h; i++) set(x + ox, y + i, z + oz, w.log, true);
  }
  leafBlob(r, set, x, y + h, z, 4, w.leaves, 0.4);
  leafBlob(r, set, x + 1, y + h, z + 1, 3, w.leaves, 0.4);
  for (let b = y + h - 4; b > y + 6; b -= 2 + r.int(4)) {
    const a = r.next() * Math.PI * 2, len = 3 + r.int(3);
    let bx = x, bz = z;
    for (let k = 1; k <= len; k++) { bx = x + Math.round(Math.cos(a) * k); bz = z + Math.round(Math.sin(a) * k); set(bx, b + (k >> 1), bz, pack(w.log, Math.abs(Math.cos(a)) > 0.7 ? LOG_X : LOG_Z), true); }
    leafBlob(r, set, bx, b + (len >> 1) + 1, bz, 2, w.leaves, 0.5);
  }
  for (let i = 1; i < h; i++) for (let d = 0; d < 4; d++) {
    if (r.int(2)) continue;
    const [dx, dz] = HORIZ[d];
    const ox = dx > 0 ? 2 : dx < 0 ? -1 : r.int(2), oz = dz > 0 ? 2 : dz < 0 ? -1 : r.int(2);
    set(x + ox, y + i, z + oz, pack(B2.VINE, 1 << ((d + 2) & 3)));
  }
}
/** Jungle floor bushes: a log with a mound of leaves (oak leaves, like vanilla). */
export function jungleBush(r: Random, x: number, y: number, z: number, set: Setter) {
  set(x, y, z, WOOD.jungle.log, true);
  for (let dy = 0; dy <= 2; dy++) {
    const rad = 2 - dy;
    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) if (Math.abs(dx) + Math.abs(dz) <= rad + (r.bool() ? 1 : 0)) set(x + dx, y + dy, z + dz, B.OAK_LEAVES);
  }
}

// ------------------------------------------------------------------ acacia
/** An acacia: a trunk that leans and forks, each fork ending in a flat leaf canopy. */
export function acaciaTree(r: Random, x: number, y: number, z: number, set: Setter) {
  const w = WOOD.acacia, h = 5 + r.int(3) + r.int(3);
  set(x, y - 1, z, B.DIRT, true);
  const [dx, dz] = HORIZ[r.int(4)];
  const bend = h - r.int(4) - 1;
  let bx = x, bz = z, top = y;
  for (let i = 0; i < h; i++) {
    if (i >= bend && i < h - 1) { bx += dx; bz += dz; }
    set(bx, y + i, bz, w.log, true);
    top = y + i;
  }
  const canopy = (cx: number, cy: number, cz: number) => {
    for (let ox = -3; ox <= 3; ox++) for (let oz = -3; oz <= 3; oz++) if (Math.abs(ox) !== 3 || Math.abs(oz) !== 3) set(cx + ox, cy, cz + oz, w.leaves);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) set(cx + ox, cy + 1, cz + oz, w.leaves);
    for (const [ex, ez] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) set(cx + ex, cy + 1, cz + ez, w.leaves);
  };
  canopy(bx, top + 1, bz);
  // a second fork the other way
  if (r.int(2) === 0) {
    const [ex, ez] = HORIZ[(HORIZ.findIndex(([a, b]) => a === dx && b === dz) + 1 + r.int(3)) & 3];
    let fx = x, fz = z, fy = y + bend - 1 - r.int(2);
    for (let i = 0; i < 2 + r.int(2); i++) { fx += ex; fz += ez; fy++; set(fx, fy, fz, w.log, true); }
    canopy(fx, fy + 1, fz);
  }
}

// ------------------------------------------------------------------ dark oak
/** A dark oak: a 2x2 trunk with a wide, dense crown. */
export function darkOakTree(r: Random, x: number, y: number, z: number, set: Setter) {
  const w = WOOD.dark_oak, h = 6 + r.int(3) + r.int(2);
  for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    set(x + ox, y - 1, z + oz, B.DIRT, true);
    for (let i = 0; i < h; i++) set(x + ox, y + i, z + oz, w.log, true);
  }
  // roots and stubby branches
  for (let k = 0; k < 2 + r.int(3); k++) {
    const [dx, dz] = HORIZ[r.int(4)];
    const bx = x + (dx > 0 ? 2 : dx < 0 ? -1 : r.int(2)), bz = z + (dz > 0 ? 2 : dz < 0 ? -1 : r.int(2));
    const by = y + h - 2 - r.int(3);
    set(bx, by, bz, w.log, true);
  }
  for (let dy = -1; dy <= 1; dy++) {
    const rad = dy === 1 ? 2 : 3;
    for (let ox = -rad; ox <= rad + 1; ox++) for (let oz = -rad; oz <= rad + 1; oz++) {
      const cx = ox < 0 ? -ox : ox > 1 ? ox - 1 : 0, cz = oz < 0 ? -oz : oz > 1 ? oz - 1 : 0;
      if (cx === rad && cz === rad) continue;
      if (cx + cz > rad + 1 && r.bool()) continue;
      set(x + ox, y + h + dy, z + oz, w.leaves);
    }
  }
}

// ------------------------------------------------------------------ giant spruce (giant tree taiga)
export function megaSpruceTree(r: Random, x: number, y: number, z: number, set: Setter) {
  const h = 13 + r.int(15), crown = 6 + r.int(8);
  for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    set(x + ox, y - 1, z + oz, B.PODZOL, true);
    for (let i = 0; i < h; i++) set(x + ox, y + i, z + oz, B.SPRUCE_LOG, true);
  }
  for (let i = 0; i <= crown; i++) {
    const yy = y + h - i, rad = Math.floor((i / crown) * 3.5) + (i % 3 === 0 ? 0 : 0);
    for (let ox = -rad; ox <= rad + 1; ox++) for (let oz = -rad; oz <= rad + 1; oz++) {
      const cx = ox < 0 ? -ox : ox > 1 ? ox - 1 : 0, cz = oz < 0 ? -oz : oz > 1 ? oz - 1 : 0;
      if (cx * cx + cz * cz > rad * rad + 1) continue;
      set(x + ox, yy, z + oz, B.SPRUCE_LEAVES);
    }
  }
  set(x, y + h + 1, z, B.SPRUCE_LEAVES);
}

// ------------------------------------------------------------------ huge mushrooms
export function hugeMushroom(r: Random, x: number, y: number, z: number, set: Setter, red: boolean) {
  const h = 4 + r.int(3) + (r.int(12) === 0 ? 3 : 0);
  for (let i = 0; i < h; i++) set(x, y + i, z, B2.MUSHROOM_STEM, true);
  const cap = red ? B2.RED_MUSHROOM_BLOCK : B2.BROWN_MUSHROOM_BLOCK;
  if (red) {
    for (let dy = -3; dy <= 0; dy++) {
      const rad = dy === 0 ? 1 : 2;
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        const edge = Math.abs(dx) === rad || Math.abs(dz) === rad || dy === 0;
        if (!edge) continue;
        if (dy < 0 && Math.abs(dx) === rad && Math.abs(dz) === rad) continue;
        set(x + dx, y + h + dy, z + dz, cap);
      }
    }
  } else {
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (Math.abs(dx) !== 3 || Math.abs(dz) !== 3) set(x + dx, y + h, z + dz, cap);
  }
}

// ------------------------------------------------------------------ the Nether's huge fungi
/**
 * A huge crimson or warped fungus (vanilla HugeFungusFeature): a stem 4-13 high (now and then a 3x3 "huge" one), a
 * hat of wart blocks with shroomlights tucked inside, and (crimson) weeping vines hanging under the rim.
 */
export function hugeFungus(r: Random, x: number, y: number, z: number, set: Setter, warped: boolean, planted = false) {
  const w = warped ? WOOD.warped : WOOD.crimson;
  let h = 4 + r.int(10);
  if (!planted && r.int(12) === 0) h *= 2;
  const thick = !planted && r.int(12) === 0 ? 1 : 0;
  for (let i = 0; i < h; i++)
    for (let ox = -thick; ox <= thick; ox++) for (let oz = -thick; oz <= thick; oz++) {
      if (thick && Math.abs(ox) + Math.abs(oz) === 2 && r.int(3)) continue;
      set(x + ox, y + i, z + oz, w.log, true);
    }
  const hatH = Math.min(h - 2, 3 + r.int(Math.max(1, Math.floor(h / 3))));
  const top = y + h;
  for (let dy = 0; dy <= hatH; dy++) {
    const yy = top - dy;
    const rad = Math.min(3 + thick, 1 + Math.floor((dy / Math.max(1, hatH)) * 3) + thick);
    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
      const edge = Math.abs(dx) === rad || Math.abs(dz) === rad;
      const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
      if (corner && r.int(4)) continue;
      if (dy === 0 || edge) {
        set(x + dx, yy, z + dz, r.int(dy === 0 ? 20 : 12) === 0 ? B2.SHROOMLIGHT : w.leaves);
        // weeping vines hang from the crimson hat's rim
        if (!warped && edge && dy === hatH && r.int(4) === 0) {
          const len = 1 + r.int(4);
          for (let k = 1; k <= len; k++) set(x + dx, yy - k, z + dz, k === len ? B2.WEEPING_VINES : B2.WEEPING_VINES_PLANT);
        }
      } else if (r.int(9) === 0) set(x + dx, yy, z + dz, B2.SHROOMLIGHT);
    }
  }
}

/** Grow what a sapling or fungus becomes (sapling id -> tree). `big` asks for the 2x2 kinds. */
export function growFromSapling(kind: string, r: Random, x: number, y: number, z: number, set: Setter, big: boolean, bigTree: (r: Random, x: number, y: number, z: number, set: Setter) => void, oak: (log: number, leaves: number, minH: number) => void, spruce: () => void) {
  switch (kind) {
    case 'oak': if (r.int(10) === 0) bigTree(r, x, y, z, set); else oak(B.OAK_LOG, B.OAK_LEAVES, 4); return;
    case 'birch': oak(B.BIRCH_LOG, B.BIRCH_LEAVES, 5); return;
    case 'spruce': if (big) megaSpruceTree(r, x, y, z, set); else spruce(); return;
    case 'jungle': if (big) megaJungleTree(r, x, y, z, set); else jungleTree(r, x, y, z, set, false); return;
    case 'acacia': acaciaTree(r, x, y, z, set); return;
    case 'dark_oak': darkOakTree(r, x, y, z, set); return;
    case 'crimson_fungus': hugeFungus(r, x, y, z, set, false, true); return;
    case 'warped_fungus': hugeFungus(r, x, y, z, set, true, true); return;
  }
}
