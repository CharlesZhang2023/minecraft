// Jigsaw blocks (1.14): connectors in saved structures. Each names itself, the name it joins to (its target), the
// pool of structures to pick from and what it turns into once joined. Generating from a jigsaw in the world (its
// screen's Generate) picks structures from its pool, turns one so a jigsaw named its target faces it, sets it in
// place if it doesn't overlap what's already placed, then does the same from the new piece's jigsaws, `levels`
// deep. A pool is every saved structure named the pool or under it (`village/houses` holds
// `village/houses/small` ...); `minecraft:empty` is none. Data structure blocks in the pieces are markers: an entity
// type spawns that entity, `chest <loot table>` leaves a filled chest; both become air.
import type { Game } from './game';
import { JIGSAW, JIGSAW_ORIENTS, STRUCTURE_BLOCK, FACING6, B, idOf, metaOf, pack } from '../world/blocks';
import { parseBlock } from '../agent/blockspec';
import { bbox, overlaps, type BBox } from '../world/structure';
import { Random } from '../noise';
import { chestLoot } from './loot';
import { getTemplate, templateNames, normName, cellTransform, blockTransform, placeTemplate, type Template, type StructureTile } from './structureblocks';
import type { World } from '../world/world';

export interface JigsawTile { type: 'jigsaw'; name: string; target: string; pool: string; final: string; joint: 'rollable' | 'aligned' }
export const jigsawTile = (w: World, x: number, y: number, z: number): JigsawTile => {
  const t = w.getTile(x, y, z) as unknown as JigsawTile | undefined;
  if (t?.type === 'jigsaw') return t;
  const n: JigsawTile = { type: 'jigsaw', name: 'minecraft:empty', target: 'minecraft:empty', pool: 'minecraft:empty', final: 'minecraft:air', joint: 'rollable' };
  w.setTile(x, y, z, n as never);
  return n;
};
const asTile = (t: unknown): JigsawTile => ({ type: 'jigsaw', name: 'minecraft:empty', target: 'minecraft:empty', pool: 'minecraft:empty', final: 'minecraft:air', joint: 'rollable', ...(t as object) });
const opposite = (f: number) => f ^ 1;

/** The saved structures a pool picks from. */
export function poolTemplates(g: Game, pool: string): string[] {
  const p = normName(pool);
  if (!p || p === 'minecraft:empty') return [];
  return templateNames(g).filter((n) => n === p || n.startsWith(p + '/')).sort();
}

interface Conn { x: number; y: number; z: number; front: number; top: number; tile: JigsawTile; depth: number }
/** A template's jigsaws: cell, orientation and tile. */
function jigsawsOf(t: Template) {
  const [sx, , sz] = t.size, out: { x: number; y: number; z: number; meta: number; tile: JigsawTile }[] = [];
  for (let i = 0; i < t.blocks.length; i++) {
    const v = t.blocks[i];
    if (v < 0 || idOf(v) !== JIGSAW) continue;
    out.push({ x: i % sx, z: Math.floor(i / sx) % sz, y: Math.floor(i / (sx * sz)), meta: metaOf(v), tile: asTile(t.tiles.get(i)) });
  }
  return out;
}
function shuffle<T>(r: Random, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = r.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const finalState = (s: string) => { try { return parseBlock(s.replace(/^minecraft:/, '') || 'air'); } catch { return 0; } };

/** Generate from the jigsaw at (x, y, z). Returns the message for the player. */
export function generateJigsaw(g: Game, x: number, y: number, z: number, levels: number, keepJigsaws: boolean): string {
  const w = g.world!, v = w.get(x, y, z);
  if (idOf(v) !== JIGSAW) throw new Error('Not a jigsaw block');
  const [front, top] = JIGSAW_ORIENTS[metaOf(v)] ?? JIGSAW_ORIENTS[10];
  const r = new Random((Date.now() ^ Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ y) >>> 0);
  const boxes: BBox[] = [bbox(x, y, z, x, y, z)];
  const queue: Conn[] = [{ x, y, z, front, top, tile: jigsawTile(w, x, y, z), depth: 0 }];
  const finals: [number, number, number, number][] = [];
  const markers: [number, number, number, string][] = [];
  let pieces = 0;
  while (queue.length) {
    const c = queue.shift()!;
    if (c.depth >= levels) continue;
    const [fx, fy, fz] = FACING6[c.front];
    const tx = c.x + fx, ty = c.y + fy, tz = c.z + fz;
    let done = false;
    for (const name of shuffle(r, poolTemplates(g, c.tile.pool))) {
      const tpl = getTemplate(g, name);
      if (!tpl) continue;
      const jigs = jigsawsOf(tpl);
      for (const q of shuffle(r, [0, 1, 2, 3])) {
        for (const j of shuffle(r, jigs.slice())) {
          if (normName(j.tile.name) !== normName(c.tile.target)) continue;
          const [jf, jt] = JIGSAW_ORIENTS[metaOf(blockTransform(pack(JIGSAW, j.meta), 0, q))] ?? JIGSAW_ORIENTS[10];
          if (jf !== opposite(c.front)) continue;
          // vertical joints: "aligned" ones need the tops to agree, "rollable" ones may turn
          if (FACING6[c.front][1] !== 0 && c.tile.joint === 'aligned' && jt !== c.top) continue;
          const [dx, dz] = cellTransform(j.x, j.z, 0, q);
          const ox = tx - dx, oy = ty - j.y, oz = tz - dz;
          const [sx, sy, sz] = tpl.size;
          const a = cellTransform(0, 0, 0, q), b = cellTransform(sx - 1, sz - 1, 0, q);
          const box = bbox(ox + a[0], oy, oz + a[1], ox + b[0], oy + sy - 1, oz + b[1]);
          if (boxes.some((o) => overlaps(o, box))) continue;
          boxes.push(box);
          placeTemplate(g, tpl, ox, oy, oz, {
            rotation: q, entities: true,
            onBlock: (bv, wx, wy, wz, tile) => {
              if (idOf(bv) !== STRUCTURE_BLOCK) return bv;
              // structure blocks don't go in; data ones leave their marker
              if ((metaOf(bv) & 3) !== 3) return null;
              markers.push([wx, wy, wz, (tile as StructureTile | undefined)?.data ?? '']);
              return 0;
            },
          });
          pieces++;
          for (const k of jigs) {
            const [kx, kz] = cellTransform(k.x, k.z, 0, q);
            const wx = ox + kx, wy = oy + k.y, wz = oz + kz;
            finals.push([wx, wy, wz, finalState(k.tile.final)]);
            if (k === j) continue;
            const [kf, kt] = JIGSAW_ORIENTS[metaOf(blockTransform(pack(JIGSAW, k.meta), 0, q))] ?? JIGSAW_ORIENTS[10];
            queue.push({ x: wx, y: wy, z: wz, front: kf, top: kt, tile: k.tile, depth: c.depth + 1 });
          }
          done = true;
          break;
        }
        if (done) break;
      }
      if (done) break;
    }
  }
  if (!keepJigsaws) for (const [fx, fy, fz, fv] of finals) if (w.getId(fx, fy, fz) === JIGSAW) w.set(fx, fy, fz, fv);
  for (const [mx, my, mz, text] of markers) dataMarker(g, mx, my, mz, text);
  if (!pieces) throw new Error(poolTemplates(g, jigsawTile(w, x, y, z).pool).length ? 'No piece fits here' : `The pool '${normName(jigsawTile(w, x, y, z).pool)}' has no structures`);
  return `Generated ${pieces} piece${pieces === 1 ? '' : 's'}`;
}

/** A data marker in a generated piece: an entity, or a chest of loot. */
function dataMarker(g: Game, x: number, y: number, z: number, text: string) {
  const w = g.world!, [word, arg] = text.trim().toLowerCase().replace(/minecraft:/g, '').split(/\s+/);
  if (word === 'chest' && arg) {
    w.set(x, y, z, B.CHEST);
    w.setTile(x, y, z, { type: 'chest', items: chestLoot(arg, new Random((x * 31 + z * 17 + y) >>> 0), 27) } as never);
  } else if (word) g.interact!.spawnMob(word, x + 0.5, y, z + 0.5);
}
