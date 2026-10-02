// Pistons and sticky pistons (vanilla 1.8 BlockPistonStructureHelper rules): push up to 12 blocks,
// slime blocks drag their neighbours along, fragile blocks are destroyed, tile entities are immovable.
// Moving blocks live for 2 ticks as MOVING_PISTON tiles and are rendered sliding between positions.
import type { Game } from './game';
import type { World } from '../world/world';
import { B, BLOCKS, FACING6, idOf, metaOf, pack, isPiston, isLeaves, Render } from '../world/blocks';
import { F6_D6 } from './redstone';

type V3 = [number, number, number];
const key = (p: V3) => p[0] + ',' + p[1] + ',' + p[2];
const add = (p: V3, d: readonly number[], k = 1): V3 => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const eq = (a: V3, b: V3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const MAX_PUSH = 12;

export interface MovingTile { type: 'moving'; block: number; dir: number; progress: number; prev?: number }
interface Anim { x: number; y: number; z: number; block: number; dir: number; progress: number; prev: number }

/** 0 = normal, 1 = destroyed when pushed, 2 = immovable */
export function mobility(w: World, x: number, y: number, z: number): number {
  const v = w.get(x, y, z);
  const id = idOf(v);
  if (y < 0 || y > 255) return 2;
  if (id === B.AIR) return 0;
  const def = BLOCKS[id];
  if (id === B.OBSERVER || id === B.SLIME_BLOCK || id === B.ANVIL) return 0;
  if (isPiston(id)) return metaOf(v) & 8 ? 2 : 0;
  if (def.hardness < 0 || id === B.OBSIDIAN || id === B.PISTON_HEAD || id === B.MOVING_PISTON || id === B.NETHER_PORTAL) return 2;
  if (w.getTile(x, y, z) || id === B.CHEST || id === B.FURNACE || id === B.LIT_FURNACE || id === B.ENCHANTING_TABLE || id === B.SPAWNER ||
    id === B.HOPPER || id === B.DISPENSER || id === B.DROPPER || id === B.BREWING_STAND) return 2;
  if (def.fluid || def.replaceable || def.needsSupport || isLeaves(id) || id === B.PUMPKIN || id === B.JACK_O_LANTERN || id === B.MELON ||
    id === B.COBWEB || id === B.OAK_DOOR || id === B.BED || id === B.FIRE || id === B.CACTUS || def.render === Render.Cross) return 1;
  return 0;
}

class Structure {
  move: V3[] = [];
  destroy: V3[] = [];
  constructor(private w: World, private piston: V3, private start: V3, private dir: readonly number[], private extending: boolean) {}

  private canPush(p: V3, allowDestroy: boolean): boolean {
    const m = mobility(this.w, p[0], p[1], p[2]);
    if (m === 2) return false;
    if (m === 1) return allowDestroy;
    // a piston can't push its own head
    return true;
  }
  private isAir(p: V3) { return this.w.getId(p[0], p[1], p[2]) === B.AIR; }
  private isSlime(p: V3) { return this.w.getId(p[0], p[1], p[2]) === B.SLIME_BLOCK; }
  private idx(p: V3) { return this.move.findIndex((q) => eq(q, p)); }

  resolve(): boolean {
    const s = this.start;
    if (this.isAir(s)) return true;
    const m = mobility(this.w, s[0], s[1], s[2]);
    if (m === 2) return false;
    if (m === 1) {
      if (!this.extending) return true; // sticky pistons don't pull fragile blocks
      this.destroy.push(s);
      return true;
    }
    if (!this.addLine(s)) return false;
    for (let i = 0; i < this.move.length; i++) if (this.isSlime(this.move[i]) && !this.addBranches(this.move[i])) return false;
    return true;
  }

  private addLine(origin: V3): boolean {
    if (this.isAir(origin)) return true;
    if (mobility(this.w, origin[0], origin[1], origin[2]) !== 0) return true;
    if (eq(origin, this.piston) || this.idx(origin) >= 0) return true;
    let i = 1;
    if (i + this.move.length > MAX_PUSH) return false;
    // slime blocks pull the blocks behind them along
    let cur = origin;
    while (this.isSlime(cur)) {
      const back = add(origin, this.dir, -i);
      if (this.isAir(back) || mobility(this.w, back[0], back[1], back[2]) !== 0 || eq(back, this.piston)) break;
      cur = back;
      i++;
      if (i + this.move.length > MAX_PUSH) return false;
    }
    let j = 0;
    for (let k = i - 1; k >= 0; k--) { this.move.push(add(origin, this.dir, -k)); j++; }
    for (let l = 1; ; l++) {
      const next = add(origin, this.dir, l);
      const at = this.idx(next);
      if (at >= 0) {
        this.reorder(j, at);
        for (let q = 0; q <= at + j; q++) if (this.isSlime(this.move[q]) && !this.addBranches(this.move[q])) return false;
        return true;
      }
      if (this.isAir(next)) return true;
      if (eq(next, this.piston) || !this.canPush(next, true)) return false;
      if (mobility(this.w, next[0], next[1], next[2]) === 1) { this.destroy.push(next); return true; }
      if (this.move.length >= MAX_PUSH) return false;
      this.move.push(next);
      j++;
    }
  }

  private reorder(a: number, b: number) {
    const l1 = this.move.slice(0, b);
    const l2 = this.move.slice(this.move.length - a);
    const l3 = this.move.slice(b, this.move.length - a);
    this.move = [...l1, ...l2, ...l3];
  }

  private addBranches(p: V3): boolean {
    for (const d of FACING6) {
      if ((d[0] !== 0 && this.dir[0] !== 0) || (d[1] !== 0 && this.dir[1] !== 0) || (d[2] !== 0 && this.dir[2] !== 0)) continue;
      if (!this.addLine(add(p, d))) return false;
    }
    return true;
  }
}

export class Pistons {
  private queue: V3[] = [];
  /** moving-block tiles currently in the world (for rendering and ticking) */
  moving = new Map<string, V3>();
  /** transient animations (retracting heads) */
  anims: Anim[] = [];
  constructor(private game: Game) {}
  get w(): World { return this.game.world!; }

  reset() { this.queue = []; this.moving.clear(); this.anims = []; }

  request(x: number, y: number, z: number) {
    if (!this.queue.some((q) => q[0] === x && q[1] === y && q[2] === z)) this.queue.push([x, y, z]);
  }

  /** Register moving tiles found in freshly loaded chunks. */
  scanChunk(cx: number, cz: number) {
    const c = this.w.getChunk(cx, cz);
    if (!c) return;
    for (const [i, t] of c.tiles) if (t.type === 'moving') this.moving.set(key([cx * 16 + (i & 15), i >> 8, cz * 16 + ((i >> 4) & 15)]), [cx * 16 + (i & 15), i >> 8, cz * 16 + ((i >> 4) & 15)]);
  }

  tick() {
    const w = this.w;
    // advance moving blocks (vanilla: 0.5 per tick, finalised when complete)
    const done: [V3, MovingTile][] = [];
    for (const [k, p] of this.moving) {
      const t = w.getTile(p[0], p[1], p[2]) as MovingTile | undefined;
      if (!t || t.type !== 'moving' || w.getId(p[0], p[1], p[2]) !== B.MOVING_PISTON) { this.moving.delete(k); continue; }
      t.prev = t.progress;
      if (t.progress >= 1) { done.push([p, t]); this.moving.delete(k); continue; }
      t.progress = Math.min(1, t.progress + 0.5);
      this.pushEntities(p, t);
    }
    if (done.length) {
      const changes: [number, number, number, number][] = done.map(([p, t]) => [p[0], p[1], p[2], t.block]);
      this.apply(changes);
    }
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.prev = a.progress;
      if (a.progress >= 1) this.anims.splice(i, 1);
      else a.progress = Math.min(1, a.progress + 0.5);
    }
    // piston events
    const q = this.queue;
    this.queue = [];
    for (const [x, y, z] of q) this.process(x, y, z);
  }

  private process(x: number, y: number, z: number) {
    const w = this.w, g = this.game;
    const v = w.get(x, y, z);
    const id = idOf(v), m = metaOf(v);
    if (!isPiston(id)) return;
    const f = m & 7;
    const should = g.redstone.qcPowered(x, y, z, F6_D6[f]);
    if (should && !(m & 8)) this.extend(x, y, z, id, f);
    else if (!should && m & 8) this.retract(x, y, z, id, f);
  }

  /** Apply block changes atomically, then replay block-change notifications. */
  private apply(changes: [number, number, number, number][], tiles: [V3, MovingTile][] = []) {
    const w = this.w, t = this.game.ticker!;
    const olds: number[] = [];
    t.suppress = true;
    for (const [x, y, z, v] of changes) { olds.push(w.get(x, y, z)); w.set(x, y, z, v); }
    for (const [p, tile] of tiles) { w.setTile(p[0], p[1], p[2], tile as never); this.moving.set(key(p), p); }
    t.suppress = false;
    changes.forEach(([x, y, z, v], i) => { if (olds[i] !== v) t.onChange(x, y, z, olds[i], v); });
  }

  private extend(x: number, y: number, z: number, id: number, f: number): boolean {
    const w = this.w, g = this.game;
    const d = FACING6[f];
    const P: V3 = [x, y, z];
    const s = new Structure(w, P, add(P, d), d, true);
    if (!s.resolve()) return false;
    for (const p of s.destroy) g.interact!.breakBlockNaturally(p[0], p[1], p[2], true);
    const blocks = s.move.map((p) => w.get(p[0], p[1], p[2]));
    const changes: [number, number, number, number][] = [];
    const tiles: [V3, MovingTile][] = [];
    const dest = new Set(s.move.map((p) => key(add(p, d))));
    const head = add(P, d);
    dest.add(key(head));
    for (const p of s.move) if (!dest.has(key(p))) changes.push([p[0], p[1], p[2], B.AIR]);
    s.move.forEach((p, i) => {
      const q = add(p, d);
      changes.push([q[0], q[1], q[2], B.MOVING_PISTON]);
      tiles.push([q, { type: 'moving', block: blocks[i], dir: f, progress: 0 }]);
    });
    changes.push([head[0], head[1], head[2], B.MOVING_PISTON]);
    tiles.push([head, { type: 'moving', block: pack(B.PISTON_HEAD, f | (id === B.STICKY_PISTON ? 8 : 0)), dir: f, progress: 0 }]);
    changes.push([x, y, z, pack(id, f | 8)]);
    this.apply(changes, tiles);
    g.audio.play('piston.out', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0.5, Math.random() * 0.25 + 0.6);
    return true;
  }

  private retract(x: number, y: number, z: number, id: number, f: number) {
    const w = this.w, g = this.game;
    const d = FACING6[f];
    const back = f ^ 1;
    const P: V3 = [x, y, z];
    const head = add(P, d);
    const changes: [number, number, number, number][] = [[x, y, z, pack(id, f)]];
    const tiles: [V3, MovingTile][] = [];
    // a moving block still in flight in front is finished first (vanilla "0-tick" behaviour)
    const ht = w.getTile(head[0], head[1], head[2]) as MovingTile | undefined;
    if (w.getId(head[0], head[1], head[2]) === B.MOVING_PISTON && ht?.type === 'moving') w.set(head[0], head[1], head[2], ht.block);
    const headWas = w.get(head[0], head[1], head[2]);
    if (idOf(headWas) === B.PISTON_HEAD) {
      changes.push([head[0], head[1], head[2], B.AIR]);
      this.anims.push({ x: x, y: y, z: z, block: headWas, dir: back, progress: 0, prev: 0 });
    }
    if (id === B.STICKY_PISTON) {
      const from = add(P, d, 2);
      const fv = w.get(from[0], from[1], from[2]);
      const mob = mobility(w, from[0], from[1], from[2]);
      if (idOf(fv) !== B.AIR && mob === 0) {
        // the head is gone before the pulled structure is computed (vanilla order)
        const t = g.ticker!;
        t.suppress = true;
        w.set(head[0], head[1], head[2], B.AIR);
        const s = new Structure(w, P, from, FACING6[back], false);
        const ok = s.resolve();
        w.set(head[0], head[1], head[2], headWas);
        t.suppress = false;
        if (ok) {
          for (const p of s.destroy) g.interact!.breakBlockNaturally(p[0], p[1], p[2], true);
          const blocks = s.move.map((p) => w.get(p[0], p[1], p[2]));
          const dest = new Set(s.move.map((p) => key(add(p, FACING6[back]))));
          for (const p of s.move) if (!dest.has(key(p))) changes.push([p[0], p[1], p[2], B.AIR]);
          s.move.forEach((p, i) => {
            const q = add(p, FACING6[back]);
            const at = changes.findIndex((c) => c[0] === q[0] && c[1] === q[1] && c[2] === q[2]);
            if (at >= 0) changes.splice(at, 1);
            changes.push([q[0], q[1], q[2], B.MOVING_PISTON]);
            tiles.push([q, { type: 'moving', block: blocks[i], dir: back, progress: 0 }]);
          });
        }
      }
    }
    this.apply(changes, tiles);
    g.audio.play('piston.in', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0.5, Math.random() * 0.15 + 0.6);
  }

  /** Entities in the way of a moving block get shoved along (slime blocks launch them). */
  private pushEntities(p: V3, t: MovingTile) {
    const g = this.game;
    if (idOf(t.block) === B.AIR) return;
    const d = FACING6[t.dir];
    const off = 1 - t.progress;
    const bx = p[0] - d[0] * off, by = p[1] - d[1] * off, bz = p[2] - d[2] * off;
    const step = t.progress - (t.prev ?? 0);
    const slime = idOf(t.block) === B.SLIME_BLOCK;
    for (const e of g.entities) {
      if (e.removed || (e as { spectator?: boolean }).spectator) continue;
      const b = e.box;
      if (b.x1 <= bx || b.x0 >= bx + 1 || b.y1 <= by || b.y0 >= by + 1 || b.z1 <= bz || b.z0 >= bz + 1) continue;
      e.move(d[0] * step, d[1] * step, d[2] * step);
      if (slime) {
        if (d[0]) e.vx = d[0];
        if (d[1]) e.vy = d[1];
        if (d[2]) e.vz = d[2];
      }
      if (d[1] > 0) { e.vy = Math.max(e.vy, 0); e.fallDistance = 0; }
    }
  }

  /** What's moving this tick, for clients to draw: [packed block, x, y, z, dir, prev, progress, kind (0 block, 1 head)]. */
  snapshot(): number[][] {
    const w = this.game.world;
    const out: number[][] = [];
    if (!w) return out;
    for (const p of this.moving.values()) {
      const tile = w.getTile(p[0], p[1], p[2]) as MovingTile | undefined;
      if (!tile || tile.type !== 'moving') continue;
      out.push([tile.block, p[0], p[1], p[2], tile.dir, tile.prev ?? tile.progress, tile.progress, 0]);
    }
    for (const a of this.anims) out.push([a.block, a.x, a.y, a.z, a.dir, a.prev, a.progress, 1]);
    return out;
  }

  /** Blocks to draw this frame: [packed block, x, y, z] with interpolated offsets. */
  renderList(t: number): [number, number, number, number][] {
    const w = this.w;
    const out: [number, number, number, number][] = [];
    for (const p of this.moving.values()) {
      const tile = w.getTile(p[0], p[1], p[2]) as MovingTile | undefined;
      if (!tile || tile.type !== 'moving') continue;
      const d = FACING6[tile.dir];
      const prog = (tile.prev ?? tile.progress) + (tile.progress - (tile.prev ?? tile.progress)) * t;
      const off = 1 - prog;
      out.push([tile.block, p[0] - d[0] * off, p[1] - d[1] * off, p[2] - d[2] * off]);
    }
    for (const a of this.anims) {
      const d = FACING6[a.dir];
      const hf = FACING6[a.dir ^ 1];
      const prog = a.prev + (a.progress - a.prev) * t;
      // head starts one block in front of the base and slides back into it
      out.push([a.block, a.x + hf[0] * (1 - prog) + d[0] * 0, a.y + hf[1] * (1 - prog), a.z + hf[2] * (1 - prog)]);
    }
    return out;
  }
}

/** Client side: where to draw what a server's piston snapshot says is moving (same maths as renderList). */
export function pistonDrawList(list: number[][], t: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const [block, x, y, z, dir, prev, progress, kind] of list) {
    const prog = prev + (progress - prev) * t;
    if (kind === 0) {
      const d = FACING6[dir], off = 1 - prog;
      out.push([block, x - d[0] * off, y - d[1] * off, z - d[2] * off]);
    } else {
      const hf = FACING6[dir ^ 1];
      out.push([block, x + hf[0] * (1 - prog), y + hf[1] * (1 - prog), z + hf[2] * (1 - prog)]);
    }
  }
  return out;
}
