// Scheduled & random block updates: fluids, gravity, plants, leaf decay, fire...
import type { Game } from './game';
import type { World, Chunk } from '../world/world';
import { B, BLOCKS, idOf, metaOf, pack, isLeaves, isLog, isSapling, isSoil, OPAQUE, Render, CHUNK_H, HORIZ, isFlower, LIGHT_OPACITY } from '../world/blocks';
import { WorldGen, Setter } from '../world/worldgen';
import { Random } from '../noise';
import { FallingBlock } from '../entity/item';
import { I, stack, TOOLS, ARMOR } from './items';
import { portalCanStay } from './portal';

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

interface Scheduled { x: number; y: number; z: number; at: number; id: number }

export class BlockTicker {
  private queue = new Map<string, Scheduled>();
  private rng = new Random(Date.now() & 0xffff);
  now = 0;
  suppress = false; // true while applying a multi-block change

  constructor(private game: Game, private world: World) {}

  schedule(x: number, y: number, z: number, delay: number) {
    const k = x + ',' + y + ',' + z;
    const ex = this.queue.get(k);
    const at = this.now + delay;
    if (ex && ex.at <= at) return;
    this.queue.set(k, { x, y, z, at, id: this.world.getId(x, y, z) });
  }

  tick() {
    this.now++;
    // scheduled
    const due: Scheduled[] = [];
    for (const [k, s] of this.queue) {
      if (s.at <= this.now) {
        due.push(s);
        this.queue.delete(k);
        if (due.length > 2000) break;
      }
    }
    for (const s of due) this.scheduledTick(s.x, s.y, s.z);
    this.randomTicks();
  }

  /** Called by World.set for every block change. */
  onChange(x: number, y: number, z: number, old: number, v: number) {
    if (this.suppress) return;
    const oid = idOf(old), nid = idOf(v);
    this.neighborChanged(x, y, z);
    for (const [dx, dy, dz] of DIRS6) this.neighborChanged(x + dx, y + dy, z + dz);
    // log/leaves removed: nearby leaves may decay
    if ((isLog(oid) || isLeaves(oid)) && !isLog(nid) && !isLeaves(nid)) {
      for (let dx = -4; dx <= 4; dx++)
        for (let dy = -4; dy <= 4; dy++)
          for (let dz = -4; dz <= 4; dz++) {
            const b = this.world.get(x + dx, y + dy, z + dz);
            if (isLeaves(idOf(b)) && (metaOf(b) & 1) === 0) this.schedule(x + dx, y + dy, z + dz, 10 + this.rng.int(80));
          }
    }
  }

  neighborChanged(x: number, y: number, z: number) {
    const w = this.world;
    const v = w.get(x, y, z);
    const id = idOf(v);
    if (id === 0) return;
    const def = BLOCKS[id];
    if (def.fluid) { this.schedule(x, y, z, id === B.WATER ? 5 : w.dimension === 'nether' ? 10 : 30); if (id === B.LAVA) this.lavaMix(x, y, z); return; }
    if (def.gravity) { this.schedule(x, y, z, 2); return; }
    if (id === B.NETHER_PORTAL) {
      if (!portalCanStay(w, x, y, z)) w.set(x, y, z, B.AIR);
      return;
    }
    if (id === B.FIRE) { this.schedule(x, y, z, 1); return; }
    if (!this.canStay(x, y, z, v)) {
      this.game.interact!.breakBlockNaturally(x, y, z, true);
      return;
    }
    if (id === B.FARMLAND && OPAQUE[w.getId(x, y + 1, z)]) w.set(x, y, z, B.DIRT);
  }

  /** Support rules for blocks that need something to stand on. */
  canStay(x: number, y: number, z: number, v: number): boolean {
    const w = this.world;
    const id = idOf(v), meta = metaOf(v);
    const below = w.getId(x, y - 1, z);
    const def = BLOCKS[id];
    if (id === B.TORCH) {
      if (meta === 0) return BLOCKS[below].solid && (OPAQUE[below] === 1 || below === B.OAK_FENCE || below === B.GLASS);
      const [dx, dz] = HORIZ[(meta - 1) & 3];
      return OPAQUE[w.getId(x + dx, y, z + dz)] === 1;
    }
    if (id === B.LADDER) {
      const [dx, dz] = HORIZ[meta & 3];
      return OPAQUE[w.getId(x + dx, y, z + dz)] === 1;
    }
    if (id === B.OAK_DOOR) {
      const upper = (meta & 8) !== 0;
      if (upper) return w.getId(x, y - 1, z) === B.OAK_DOOR;
      return w.getId(x, y + 1, z) === B.OAK_DOOR && BLOCKS[below].solid;
    }
    if (id === B.BED) {
      const facing = meta & 3, head = (meta & 8) !== 0;
      const [dx, dz] = HORIZ[facing];
      const o = head ? w.get(x - dx, y, z - dz) : w.get(x + dx, y, z + dz);
      return idOf(o) === B.BED;
    }
    if (id === B.WHEAT) return below === B.FARMLAND;
    if (id === B.SUGAR_CANE) {
      if (below === B.SUGAR_CANE) return true;
      if (below !== B.GRASS && below !== B.DIRT && below !== B.SAND && below !== B.PODZOL) return false;
      return DIRS4.some(([dx, dz]) => w.getId(x + dx, y - 1, z + dz) === B.WATER || w.getId(x + dx, y - 1, z + dz) === B.ICE);
    }
    if (id === B.CACTUS) {
      if (below !== B.CACTUS && below !== B.SAND) return false;
      return DIRS4.every(([dx, dz]) => !BLOCKS[w.getId(x + dx, y, z + dz)].solid);
    }
    if (id === B.LILY_PAD) return below === B.WATER || below === B.ICE;
    if (id === B.DEAD_BUSH) return below === B.SAND || below === B.TERRACOTTA || isSoil(below);
    if (id === B.BROWN_MUSHROOM || id === B.RED_MUSHROOM) return OPAQUE[below] === 1;
    if (id === B.SNOW) return OPAQUE[below] === 1 || isLeaves(below);
    if (id === B.PUMPKIN_STEM) return below === B.FARMLAND;
    if (def.render === Render.Cross && def.needsSupport) return isSoil(below);
    return true;
  }

  private scheduledTick(x: number, y: number, z: number) {
    const w = this.world;
    const v = w.get(x, y, z);
    const id = idOf(v);
    if (id === B.WATER || id === B.LAVA) this.fluidTick(x, y, z, v);
    else if (BLOCKS[id].gravity) {
      const below = w.getId(x, y - 1, z);
      if (y > 0 && (below === B.AIR || BLOCKS[below].fluid || below === B.FIRE)) {
        w.set(x, y, z, B.AIR);
        const e = new FallingBlock(w, this.game, id);
        e.setPos(x + 0.5, y, z + 0.5);
        this.game.addEntity(e);
      }
    } else if (isLeaves(id)) this.leafDecay(x, y, z, v);
    else if (id === B.FIRE) this.fireTick(x, y, z, v);
  }

  // ------------------------------------------------------------------ fluids
  private isFluid(id: number, fluid: number) {
    return id === fluid;
  }
  private blocksFlow(id: number) {
    if (id === B.AIR) return false;
    const d = BLOCKS[id];
    if (id === B.OAK_DOOR || id === B.LADDER || id === B.CACTUS || id === B.SUGAR_CANE) return true;
    if (d.render === Render.Cross || d.render === Render.Torch || d.render === Render.Crops || id === B.SNOW) return false;
    return d.solid || d.fluid && false;
  }
  private canFlowInto(x: number, y: number, z: number, fluid: number) {
    const id = this.world.getId(x, y, z);
    if (id === fluid) return false;
    if (id === B.LAVA || id === B.WATER) return false;
    return !this.blocksFlow(id);
  }
  private level(v: number, fluid: number): number {
    if (idOf(v) !== fluid) return -1;
    return metaOf(v);
  }

  private fluidTick(x: number, y: number, z: number, v: number) {
    const w = this.world;
    const fluid = idOf(v);
    const water = fluid === B.WATER;
    const nether = this.world.dimension === 'nether';
    const decay = water || nether ? 1 : 2;
    const rate = water ? 5 : nether ? 10 : 30;
    let level = metaOf(v);
    if (level > 0) {
      let min = -100, sources = 0;
      for (const [dx, dz] of DIRS4) {
        const nv = w.get(x + dx, y, z + dz);
        let l = this.level(nv, fluid);
        if (l < 0) continue;
        if (l === 0) sources++;
        if (l >= 8) l = 0;
        if (min < 0 || l < min) min = l;
      }
      let nl = min + decay;
      if (nl >= 8 || min < 0) nl = -1;
      const above = this.level(w.get(x, y + 1, z), fluid);
      if (above >= 0) nl = above >= 8 ? above : above + 8;
      if (sources >= 2 && water) {
        const below = w.get(x, y - 1, z);
        if (BLOCKS[idOf(below)].solid || (idOf(below) === fluid && metaOf(below) === 0)) nl = 0;
      }
      if (!water && level < 8 && nl < 8 && nl > level && this.rng.int(4) !== 0) nl = level;
      if (nl !== level) {
        level = nl;
        if (nl < 0) w.set(x, y, z, B.AIR);
        else {
          w.set(x, y, z, pack(fluid, nl));
          this.schedule(x, y, z, rate);
        }
      }
    }
    if (level < 0) return;
    // flow down
    const belowId = w.getId(x, y - 1, z);
    if (y > 0 && this.canFlowInto(x, y - 1, z, fluid)) {
      if (!water && belowId === B.WATER) {
        w.set(x, y - 1, z, B.STONE);
        this.game.audio.play('fizz', { x: x + 0.5, y: y - 0.5, z: z + 0.5 }, 0.5, 2.6);
        return;
      }
      this.flowInto(x, y - 1, z, fluid, level >= 8 ? level : level + 8, rate);
    } else if (y > 0 && (level === 0 || this.blocksFlow(belowId) || (belowId === fluid && false))) {
      // spread sideways toward the nearest drop
      const dirs = this.optimalDirections(x, y, z, fluid);
      const nl = level >= 8 ? 1 : level + decay;
      if (nl >= 8) return;
      for (let i = 0; i < 4; i++) if (dirs[i]) this.flowInto(x + DIRS4[i][0], y, z + DIRS4[i][1], fluid, nl, rate);
    } else if (y > 0 && belowId === fluid && level === 0) {
      // standing on its own fluid: spread only if below is a source (lakes stay flat)
    }
  }

  private flowInto(x: number, y: number, z: number, fluid: number, level: number, rate: number) {
    if (!this.canFlowInto(x, y, z, fluid)) return;
    const w = this.world;
    const cur = w.getId(x, y, z);
    if (cur !== B.AIR) {
      if (fluid === B.LAVA) this.game.audio.play('fizz', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0.5, 2.6);
      else this.game.interact!.dropBlockItems(x, y, z, w.get(x, y, z));
    }
    w.set(x, y, z, pack(fluid, level));
    this.schedule(x, y, z, rate);
    if (fluid === B.LAVA) this.lavaMix(x, y, z);
  }

  private optimalDirections(x: number, y: number, z: number, fluid: number): boolean[] {
    const cost = [1000, 1000, 1000, 1000];
    const w = this.world;
    for (let i = 0; i < 4; i++) {
      const nx = x + DIRS4[i][0], nz = z + DIRS4[i][1];
      const nv = w.get(nx, y, nz);
      if (this.blocksFlow(idOf(nv)) || (idOf(nv) === fluid && metaOf(nv) === 0) || (idOf(nv) !== fluid && BLOCKS[idOf(nv)].fluid)) continue;
      if (!this.blocksFlow(w.getId(nx, y - 1, nz))) cost[i] = 0;
      else cost[i] = this.flowCost(nx, y, nz, 1, i, fluid);
    }
    const min = Math.min(...cost);
    return cost.map((c) => c === min);
  }

  private flowCost(x: number, y: number, z: number, depth: number, from: number, fluid: number): number {
    let best = 1000;
    const w = this.world;
    const opposite = [1, 0, 3, 2][from];
    for (let i = 0; i < 4; i++) {
      if (i === opposite) continue;
      const nx = x + DIRS4[i][0], nz = z + DIRS4[i][1];
      const nv = w.get(nx, y, nz);
      if (this.blocksFlow(idOf(nv)) || (idOf(nv) === fluid && metaOf(nv) === 0)) continue;
      if (!this.blocksFlow(w.getId(nx, y - 1, nz))) return depth;
      if (depth < 4) {
        const c = this.flowCost(nx, y, nz, depth + 1, i, fluid);
        if (c < best) best = c;
      }
    }
    return best;
  }

  /** Lava touching water hardens (checked on lava updates). */
  lavaMix(x: number, y: number, z: number) {
    const w = this.world;
    const v = w.get(x, y, z);
    if (idOf(v) !== B.LAVA) return;
    let touching = false;
    for (const [dx, dy, dz] of DIRS6) {
      if (dy === -1) continue;
      if (w.getId(x + dx, y + dy, z + dz) === B.WATER) touching = true;
    }
    if (!touching) return;
    const m = metaOf(v);
    if (m === 0) w.set(x, y, z, B.OBSIDIAN);
    else if (m <= 4) w.set(x, y, z, B.COBBLESTONE);
    else return;
    this.game.audio.play('fizz', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0.5, 2.6);
    for (let i = 0; i < 8; i++) this.game.particles?.smoke(x + Math.random(), y + 1.2, z + Math.random(), true);
  }

  // ------------------------------------------------------------------ leaves
  private leafDecay(x: number, y: number, z: number, v: number) {
    if (metaOf(v) & 1) return;
    const w = this.world;
    // BFS through leaves up to distance 4 looking for a log
    const seen = new Set<string>();
    let frontier: [number, number, number][] = [[x, y, z]];
    for (let d = 0; d <= 4; d++) {
      const next: [number, number, number][] = [];
      for (const [cx, cy, cz] of frontier) {
        for (const [dx, dy, dz] of DIRS6) {
          const nx = cx + dx, ny = cy + dy, nz = cz + dz;
          const k = nx + ',' + ny + ',' + nz;
          if (seen.has(k)) continue;
          seen.add(k);
          const id = w.getId(nx, ny, nz);
          if (isLog(id)) return;
          if (isLeaves(id)) next.push([nx, ny, nz]);
        }
      }
      frontier = next;
    }
    this.game.interact!.breakBlockNaturally(x, y, z, true);
  }

  // ------------------------------------------------------------------ fire
  private fireTick(x: number, y: number, z: number, v: number) {
    const w = this.world;
    const below = w.getId(x, y - 1, z);
    const burnsForever = below === B.OBSIDIAN && false;
    const flam = (xx: number, yy: number, zz: number) => BLOCKS[w.getId(xx, yy, zz)].flammable;
    const anyFlammable = DIRS6.some(([dx, dy, dz]) => flam(x + dx, y + dy, z + dz));
    if (!BLOCKS[below].solid && !anyFlammable) { w.set(x, y, z, B.AIR); return; }
    if (this.game.weather && this.game.weather.rain > 0.2 && this.game.weather.rainAt(x, y, z)) { w.set(x, y, z, B.AIR); return; }
    let age = metaOf(v);
    if (age < 15) { age = Math.min(15, age + this.rng.int(3)); w.set(x, y, z, pack(B.FIRE, age)); }
    if (!burnsForever && !anyFlammable && age > 3 && !flam(x, y - 1, z)) { w.set(x, y, z, B.AIR); return; }
    if (!burnsForever && age === 15 && this.rng.int(4) === 0 && !flam(x, y - 1, z)) { w.set(x, y, z, B.AIR); return; }
    // burn neighbours
    for (const [dx, dy, dz] of DIRS6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (flam(nx, ny, nz) && this.rng.int(dy === 0 ? 5 : 4) === 0) {
        const id = w.getId(nx, ny, nz);
        if (id === B.TNT) { w.set(nx, ny, nz, B.AIR); this.game.interact!.primeTnt(nx, ny, nz); continue; }
        if (this.rng.int(age + 10) < 5) w.set(nx, ny, nz, pack(B.FIRE, Math.min(15, age + this.rng.int(5) / 4)));
        else w.set(nx, ny, nz, B.AIR);
      }
    }
    // spread into air near flammable blocks
    for (let i = 0; i < 2; i++) {
      const nx = x + this.rng.int(3) - 1, ny = y + this.rng.int(5) - 1, nz = z + this.rng.int(3) - 1;
      if (w.getId(nx, ny, nz) !== B.AIR) continue;
      if (DIRS6.some(([dx, dy, dz]) => flam(nx + dx, ny + dy, nz + dz)) && this.rng.int(6) === 0) w.set(nx, ny, nz, pack(B.FIRE, age));
    }
    this.schedule(x, y, z, 30 + this.rng.int(10));
  }

  // ------------------------------------------------------------------ random ticks
  private randomTicks() {
    const w = this.world, p = this.game.player;
    if (!p) return;
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    const R = Math.min(8, w.renderDistance);
    for (let cx = pcx - R; cx <= pcx + R; cx++)
      for (let cz = pcz - R; cz <= pcz + R; cz++) {
        const c = w.getChunk(cx, cz);
        if (!c || !c.ready || !c.heightmap) continue;
        let top = 0;
        for (let i = 0; i < 256; i++) if (c.heightmap[i] > top) top = c.heightmap[i];
        const sections = (top >> 4) + 1;
        for (let s = 0; s < sections; s++)
          for (let k = 0; k < 3; k++) {
            const lx = this.rng.int(16), ly = s * 16 + this.rng.int(16), lz = this.rng.int(16);
            const v = c.blocks[lx | (lz << 4) | (ly << 8)];
            if (v === 0) continue;
            this.randomTick(cx * 16 + lx, ly, cz * 16 + lz, v, c);
          }
      }
  }

  private randomTick(x: number, y: number, z: number, v: number, _c: Chunk) {
    const w = this.world;
    const id = idOf(v);
    const [skyA, blkA] = w.getLight(x, y + 1, z);
    const dark = this.game.isDaytime() ? 0 : 11;
    const lightAbove = Math.max(skyA - dark, blkA);
    switch (id) {
      case B.GRASS: {
        const above = w.getId(x, y + 1, z);
        if (LIGHT_OPACITY[above] > 2 && above !== B.SNOW) { w.set(x, y, z, B.DIRT); return; }
        if (lightAbove >= 9) {
          for (let i = 0; i < 4; i++) {
            const nx = x + this.rng.int(3) - 1, ny = y + this.rng.int(5) - 3, nz = z + this.rng.int(3) - 1;
            if (w.getId(nx, ny, nz) !== B.DIRT || metaOf(w.get(nx, ny, nz)) !== 0) continue;
            const a = w.getId(nx, ny + 1, nz);
            const [s2, b2] = w.getLight(nx, ny + 1, nz);
            if (LIGHT_OPACITY[a] <= 2 && Math.max(s2 - dark, b2) >= 4) w.set(nx, ny, nz, B.GRASS);
          }
        }
        return;
      }
      case B.WHEAT: {
        const m = metaOf(v);
        if (m < 7 && lightAbove >= 9) {
          const moist = metaOf(w.get(x, y - 1, z)) > 0;
          if (this.rng.int(moist ? 6 : 14) === 0) w.set(x, y, z, pack(B.WHEAT, m + 1));
        }
        return;
      }
      case B.FARMLAND: {
        let water = false;
        for (let dx = -4; dx <= 4 && !water; dx++) for (let dz = -4; dz <= 4 && !water; dz++) for (let dy = 0; dy <= 1; dy++) if (w.getId(x + dx, y + dy, z + dz) === B.WATER) { water = true; break; }
        if (this.game.weather && this.game.weather.rain > 0.2 && this.game.weather.rainAt(x, y + 1, z)) water = true;
        const m = metaOf(v);
        if (water && m === 0) w.set(x, y, z, pack(B.FARMLAND, 1));
        else if (!water) {
          if (m > 0) w.set(x, y, z, pack(B.FARMLAND, 0));
          else if (w.getId(x, y + 1, z) !== B.WHEAT && w.getId(x, y + 1, z) !== B.PUMPKIN_STEM) w.set(x, y, z, B.DIRT);
        }
        return;
      }
      case B.SUGAR_CANE:
      case B.CACTUS: {
        if (w.getId(x, y + 1, z) !== B.AIR) return;
        let h = 1;
        while (w.getId(x, y - h, z) === id) h++;
        if (h >= 3) return;
        const m = metaOf(v);
        if (m >= 15) {
          w.set(x, y + 1, z, id);
          w.set(x, y, z, pack(id, 0));
        } else w.set(x, y, z, pack(id, m + 1));
        return;
      }
      case B.ICE:
      case B.SNOW:
        if (blkA > 11 || w.getLight(x, y, z)[1] > 11) w.set(x, y, z, id === B.ICE ? B.WATER : B.AIR);
        return;
      case B.PUMPKIN_STEM: {
        const m = metaOf(v);
        if (lightAbove < 9) return;
        if (m < 7) { if (this.rng.int(5) === 0) w.set(x, y, z, pack(id, m + 1)); return; }
        if (DIRS4.some(([dx, dz]) => w.getId(x + dx, y, z + dz) === B.PUMPKIN)) return;
        const [dx, dz] = DIRS4[this.rng.int(4)];
        const under = w.getId(x + dx, y - 1, z + dz);
        if (w.getId(x + dx, y, z + dz) === B.AIR && (under === B.DIRT || under === B.GRASS || under === B.FARMLAND)) w.set(x + dx, y, z + dz, pack(B.PUMPKIN, this.rng.int(4)));
        return;
      }
      case B.LAVA: {
        const n = this.rng.int(3);
        let xx = x, yy = y, zz = z;
        for (let i = 0; i < n; i++) {
          xx += this.rng.int(3) - 1; yy++; zz += this.rng.int(3) - 1;
          const b = w.getId(xx, yy, zz);
          if (b === B.AIR) {
            if (DIRS6.some(([dx, dy, dz]) => BLOCKS[w.getId(xx + dx, yy + dy, zz + dz)].flammable)) { w.set(xx, yy, zz, B.FIRE); return; }
          } else if (BLOCKS[b].solid) return;
        }
        return;
      }
    }
    if (isSapling(id) && lightAbove >= 9 && this.rng.int(7) === 0) {
      const m = metaOf(v);
      if (m === 0) w.set(x, y, z, pack(id, 1));
      else this.growTree(x, y, z, id);
    }
  }

  growTree(x: number, y: number, z: number, sapling: number): boolean {
    const w = this.world;
    const r = new Random(this.rng.nextU32());
    // check space
    for (let dy = 1; dy < 6; dy++) if (OPAQUE[w.getId(x, y + dy, z)]) return false;
    const writes: [number, number, number, number][] = [];
    const set: Setter = (xx, yy, zz, vv, force) => {
      const cur = w.getId(xx, yy, zz);
      if (force || cur === B.AIR || BLOCKS[cur].replaceable && !BLOCKS[cur].fluid || isLeaves(cur) || isSapling(cur)) writes.push([xx, yy, zz, vv]);
    };
    if (sapling === B.OAK_SAPLING) {
      if (r.int(10) === 0) WorldGen.bigOak(r, x, y, z, set);
      else WorldGen.oakTree(r, x, y, z, set, B.OAK_LOG, B.OAK_LEAVES, 4);
    } else if (sapling === B.BIRCH_SAPLING) WorldGen.oakTree(r, x, y, z, set, B.BIRCH_LOG, B.BIRCH_LEAVES, 5);
    else WorldGen.spruceTree(r, x, y, z, set);
    w.set(x, y, z, B.AIR);
    for (const [xx, yy, zz, vv] of writes) {
      if (yy < 0 || yy >= CHUNK_H) continue;
      const cur = w.getId(xx, yy, zz);
      if (isLog(idOf(vv)) || cur === B.AIR || BLOCKS[cur].replaceable || isLeaves(cur) || isSapling(cur) || idOf(vv) === B.DIRT) w.set(xx, yy, zz, vv);
    }
    return true;
  }

  /** Bone meal. */
  fertilize(x: number, y: number, z: number): boolean {
    const w = this.world;
    const v = w.get(x, y, z);
    const id = idOf(v);
    if (id === B.WHEAT) {
      const m = metaOf(v);
      if (m >= 7) return false;
      w.set(x, y, z, pack(B.WHEAT, Math.min(7, m + 2 + this.rng.int(4))));
      return true;
    }
    if (id === B.PUMPKIN_STEM) { w.set(x, y, z, pack(id, Math.min(7, metaOf(v) + 3))); return true; }
    if (isSapling(id)) {
      if (this.rng.next() < 0.45) this.growTree(x, y, z, id);
      return true;
    }
    if (id === B.GRASS) {
      for (let i = 0; i < 64; i++) {
        let xx = x, yy = y + 1, zz = z;
        let ok = true;
        for (let j = 0; j < i / 16; j++) {
          xx += this.rng.int(3) - 1; yy += ((this.rng.int(3) - 1) * this.rng.int(3)) / 2 | 0; zz += this.rng.int(3) - 1;
          if (w.getId(xx, yy - 1, zz) !== B.GRASS || OPAQUE[w.getId(xx, yy, zz)]) { ok = false; break; }
        }
        if (!ok || w.getId(xx, yy, zz) !== B.AIR) continue;
        w.set(xx, yy, zz, this.rng.int(8) === 0 ? (this.rng.bool() ? B.DANDELION : B.POPPY) : B.TALL_GRASS);
      }
      return true;
    }
    return false;
  }

  /** Populate dungeon chests / spawners of freshly generated chunks. */
  onChunkLoaded(c: Chunk) {
    for (let i = 0; i < c.blocks.length; i++) {
      const id = c.blocks[i] & 0xfff;
      if (id !== B.CHEST && id !== B.SPAWNER) continue;
      if (c.tiles.has(i)) continue;
      if (id === B.CHEST) c.tiles.set(i, { type: 'chest', items: this.dungeonLoot() });
      else c.tiles.set(i, { type: 'spawner' as 'chest', mob: ['zombie', 'zombie', 'skeleton', 'spider'][this.rng.int(4)], delay: 200 });
    }
    void isFlower;
  }

  private dungeonLoot() {
    const items: ({ id: number; count: number } | null)[] = new Array(27).fill(null);
    const table: [number, number, number][] = [
      [I.BREAD, 1, 3], [I.WHEAT, 1, 4], [I.IRON_INGOT, 1, 4], [I.GOLD_INGOT, 1, 4], [I.REDSTONE, 1, 4], [I.GUNPOWDER, 1, 4],
      [I.STRING, 1, 4], [I.BUCKET, 1, 1], [I.GOLDEN_APPLE, 1, 1], [I.COAL, 3, 8], [I.BONE, 2, 6], [I.ROTTEN_FLESH, 2, 6],
      [TOOLS.iron_pickaxe, 1, 1], [ARMOR.iron_chestplate, 1, 1], [I.DIAMOND, 1, 2], [I.APPLE, 1, 3], [I.ENDER_PEARL, 1, 1],
    ];
    const n = 4 + this.rng.int(5);
    for (let k = 0; k < n; k++) {
      const [id, lo, hi] = table[this.rng.int(table.length)];
      items[this.rng.int(27)] = stack(id, lo + this.rng.int(hi - lo + 1));
    }
    return items;
  }
}
