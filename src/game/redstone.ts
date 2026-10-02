// Redstone modelled on vanilla's weak/strong power rules:
//  - every component emits a weak and a strong power level (0-15) toward each of its six sides;
//  - a conductor (opaque full block) is powered by the strong power of its neighbours and passes it on weakly;
//  - dust networks are solved with a bucket queue (15 -> 1), ignoring dust-through-block paths like vanilla.
// Devices: torches (inverters), repeaters (delay + locking), comparators (compare/subtract, container reading),
// observers (2-tick pulses on block updates), lamps, doors, TNT, pistons, dispensers, droppers and hoppers.
import type { Game } from './game';
import type { World } from '../world/world';
import {
  B, OPAQUE, idOf, metaOf, pack, HORIZ, FACING6, isRedstoneTorch, isRedstoneComponent, isRepeater, isDiode,
} from '../world/blocks';
import { repeaterLocked } from '../world/models';
import { containerLevel } from './devices';
import { railPowered, switchRail } from './tracks';

// D6 order: +x, -x, +y, -y, +z, -z
const D6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
const OPP = [1, 0, 3, 2, 5, 4];
const UP = 2, DOWN = 3;
/** HORIZ index -> D6 index */
const H_D6 = [5, 0, 4, 1];
/** FACING6 index -> D6 index */
export const F6_D6 = [3, 2, 5, 4, 1, 0];
const key = (x: number, y: number, z: number) => x + ',' + y + ',' + z;

/** Conductors: opaque full blocks, except power sources that are opaque themselves. */
export const isConductor = (id: number) => OPAQUE[id] === 1 && id !== B.REDSTONE_BLOCK && id !== B.OBSERVER && id !== B.GLOWSTONE;

export class Redstone {
  private busy = false;
  private pending: [number, number, number][] = [];
  private wiresProvide = true;
  constructor(private game: Game) {}
  get w(): World { return this.game.world!; }

  // ---------------------------------------------------------------- emission
  /** D6 direction from a lever/button/torch toward the block it is attached to. */
  private attachD6(v: number): number {
    const id = idOf(v), m = metaOf(v);
    const at = isRedstoneTorch(id) ? m : m & 7;
    if (at === 0) return DOWN;
    return H_D6[(at - 1) & 3];
  }

  /** Power emitted by the block at (x,y,z) toward its neighbour in D6 direction d. */
  emit(x: number, y: number, z: number, d: number, strong: boolean): number {
    const v = this.w.get(x, y, z);
    const id = idOf(v), m = metaOf(v);
    switch (id) {
      case B.REDSTONE_BLOCK: return strong ? 0 : 15;
      case B.LEVER: case B.STONE_BUTTON:
        if (!(m & 8)) return 0;
        return !strong || this.attachD6(v) === d ? 15 : 0;
      case B.STONE_PRESSURE_PLATE:
        if (!m) return 0;
        return !strong || d === DOWN ? 15 : 0;
      case B.DETECTOR_RAIL:
        if (!(m & 8)) return 0;
        return !strong || d === DOWN ? 15 : 0;
      case B.REDSTONE_TORCH:
        if (strong) return d === UP ? 15 : 0;
        return d === this.attachD6(v) ? 0 : 15;
      case B.REDSTONE_WIRE:
        if (!this.wiresProvide || !m || d === UP) return 0;
        if (d === DOWN) return m;
        return this.wirePointsTo(x, y, z, d) ? m : 0;
      case B.POWERED_REPEATER: return d === H_D6[m & 3] ? 15 : 0;
      case B.COMPARATOR: return d === H_D6[m & 3] ? this.comparatorOut(x, y, z) : 0;
      case B.OBSERVER: return m & 8 && d === OPP[F6_D6[m & 7]] ? 15 : 0;
    }
    return 0;
  }

  /** Strong power a conductor at (x,y,z) receives from its neighbours. */
  strongInto(x: number, y: number, z: number): number {
    let p = 0;
    for (let d = 0; d < 6 && p < 15; d++) p = Math.max(p, this.emit(x + D6[d][0], y + D6[d][1], z + D6[d][2], OPP[d], true));
    return p;
  }

  /** Vanilla getRedstonePower: the power a receiver gets from block n, which lies in direction `toward` from n to the receiver. */
  powerFrom(nx: number, ny: number, nz: number, toward: number): number {
    const id = this.w.getId(nx, ny, nz);
    if (isConductor(id)) return this.strongInto(nx, ny, nz);
    return this.emit(nx, ny, nz, toward, false);
  }

  /** Vanilla isBlockIndirectlyGettingPowered, as a level. */
  inputAt(x: number, y: number, z: number, skip = -1): number {
    let p = 0;
    for (let d = 0; d < 6 && p < 15; d++) {
      if (d === skip) continue;
      p = Math.max(p, this.powerFrom(x + D6[d][0], y + D6[d][1], z + D6[d][2], OPP[d]));
    }
    return p;
  }
  isPowered(x: number, y: number, z: number) { return this.inputAt(x, y, z) > 0; }
  /** Powered directly or quasi-connected through the block above (pistons, dispensers, droppers). */
  qcPowered(x: number, y: number, z: number, skip = -1): boolean {
    if (this.inputAt(x, y, z, skip) > 0) return true;
    return this.inputAt(x, y + 1, z, DOWN) > 0;
  }

  // ---------------------------------------------------------------- dust
  private connectsToWire(x: number, y: number, z: number, h: number): boolean {
    const v = this.w.get(x, y, z);
    const id = idOf(v), m = metaOf(v);
    if (id === B.REDSTONE_WIRE || id === B.LEVER || id === B.STONE_BUTTON || id === B.STONE_PRESSURE_PLATE || isRedstoneTorch(id) || id === B.REDSTONE_BLOCK || id === B.COMPARATOR || id === B.DETECTOR_RAIL) return true;
    if (isRepeater(id)) return ((m & 3) & 1) === (h & 1);
    if (id === B.OBSERVER) { const [dx, dz] = HORIZ[h]; const [fx, fy, fz] = FACING6[m & 7]; return fy === 0 && fx === dx && fz === dz; }
    return false;
  }
  /** Horizontal connections (N,E,S,W) of the wire at (x,y,z). */
  wireConn(x: number, y: number, z: number): boolean[] {
    const w = this.w;
    const aboveOpaque = OPAQUE[w.getId(x, y + 1, z)] === 1;
    return HORIZ.map(([dx, dz], h) => this.connectsToWire(x + dx, y, z + dz, h) || (!aboveOpaque && w.getId(x + dx, y + 1, z + dz) === B.REDSTONE_WIRE) || (!OPAQUE[w.getId(x + dx, y, z + dz)] && w.getId(x + dx, y - 1, z + dz) === B.REDSTONE_WIRE));
  }
  private wirePointsTo(x: number, y: number, z: number, d: number): boolean {
    const h = H_D6.indexOf(d);
    const c = this.wireConn(x, y, z);
    if (!c[0] && !c[1] && !c[2] && !c[3]) return true;
    return c[(h + 2) & 3] && !c[(h + 1) & 3] && !c[(h + 3) & 3];
  }

  /** Wires reachable from a wire, including up/down steps. */
  private wireNeighbors(x: number, y: number, z: number): [number, number, number][] {
    const w = this.w, out: [number, number, number][] = [];
    const aboveOpaque = OPAQUE[w.getId(x, y + 1, z)] === 1;
    for (const [dx, dz] of HORIZ) {
      if (w.getId(x + dx, y, z + dz) === B.REDSTONE_WIRE) out.push([x + dx, y, z + dz]);
      if (!aboveOpaque && w.getId(x + dx, y + 1, z + dz) === B.REDSTONE_WIRE) out.push([x + dx, y + 1, z + dz]);
      if (!OPAQUE[w.getId(x + dx, y, z + dz)] && w.getId(x + dx, y - 1, z + dz) === B.REDSTONE_WIRE) out.push([x + dx, y - 1, z + dz]);
    }
    return out;
  }

  private wireInput(x: number, y: number, z: number): number {
    this.wiresProvide = false;
    const p = this.inputAt(x, y, z);
    this.wiresProvide = true;
    return p;
  }

  // ---------------------------------------------------------------- diodes
  private diodeRear(x: number, y: number, z: number, v: number): number {
    const f = metaOf(v) & 3;
    const [dx, dz] = HORIZ[f];
    const bx = x - dx, bz = z - dz;
    const bv = this.w.get(bx, y, bz);
    let p = this.powerFrom(bx, y, bz, H_D6[f]);
    if (idOf(bv) === B.REDSTONE_WIRE) p = Math.max(p, metaOf(bv));
    if (idOf(v) === B.COMPARATOR && p < 15) {
      // comparators read containers directly behind them, or behind a conductor
      let lvl = containerLevel(this.w, bx, y, bz);
      if (lvl < 0 && isConductor(idOf(bv))) lvl = containerLevel(this.w, bx - dx, y, bz - dz);
      if (lvl >= 0) p = Math.max(p, lvl);
    }
    return p;
  }
  private diodeSide(x: number, y: number, z: number, v: number): number {
    const f = metaOf(v) & 3;
    let p = 0;
    for (const s of [(f + 1) & 3, (f + 3) & 3]) {
      const [dx, dz] = HORIZ[s];
      const nv = this.w.get(x + dx, y, z + dz);
      const id = idOf(nv);
      if (id === B.REDSTONE_WIRE) p = Math.max(p, metaOf(nv));
      else if (id === B.REDSTONE_BLOCK) p = 15;
      else if (isDiode(id)) p = Math.max(p, this.emit(x + dx, y, z + dz, H_D6[(s + 2) & 3], true));
    }
    return p;
  }
  private comparatorCompute(x: number, y: number, z: number, v: number): number {
    const rear = this.diodeRear(x, y, z, v), side = this.diodeSide(x, y, z, v);
    if (metaOf(v) & 4) return Math.max(0, rear - side);
    return rear >= side ? rear : 0;
  }
  comparatorOut(x: number, y: number, z: number): number {
    const t = this.w.getTile(x, y, z) as { out?: number } | undefined;
    return t?.out ?? 0;
  }

  // ---------------------------------------------------------------- update
  onChange(x: number, y: number, z: number, oid: number, nid: number) {
    this.observe(x, y, z);
    if (!isRedstoneComponent(oid) && !isRedstoneComponent(nid)) {
      // a plain block next to redstone can change connectivity / powering
      let near = false;
      for (let dx = -2; dx <= 2 && !near; dx++)
        for (let dy = -2; dy <= 2 && !near; dy++)
          for (let dz = -2; dz <= 2; dz++) {
            if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
            if (isRedstoneComponent(this.w.getId(x + dx, y + dy, z + dz))) { near = true; break; }
          }
      if (!near) return;
    }
    this.update(x, y, z);
  }

  /** Observers facing (x,y,z) fire a pulse. */
  observe(x: number, y: number, z: number) {
    const w = this.w;
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACING6[f];
      const ox = x - dx, oy = y - dy, oz = z - dz;
      const v = w.get(ox, oy, oz);
      if (idOf(v) === B.OBSERVER && (metaOf(v) & 7) === f && !(metaOf(v) & 8)) this.game.ticker!.schedule(ox, oy, oz, 2);
    }
  }

  update(x: number, y: number, z: number) {
    if (this.busy) { this.pending.push([x, y, z]); return; }
    this.busy = true;
    try {
      this.recompute(x, y, z);
      let guard = 0;
      while (this.pending.length && guard++ < 256) {
        const [px, py, pz] = this.pending.shift()!;
        this.recompute(px, py, pz);
      }
      this.pending.length = 0;
    } finally {
      this.busy = false;
    }
  }

  private recompute(x: number, y: number, z: number) {
    const w = this.w;
    // 1. gather the dust network touching the change
    const wires = new Map<string, [number, number, number]>();
    const stack: [number, number, number][] = [];
    const seed = (px: number, py: number, pz: number) => { if (w.getId(px, py, pz) === B.REDSTONE_WIRE) stack.push([px, py, pz]); };
    seed(x, y, z);
    for (const [dx, dy, dz] of D6) {
      seed(x + dx, y + dy, z + dz);
      for (const [ex, ey, ez] of D6) seed(x + dx + ex, y + dy + ey, z + dz + ez);
    }
    while (stack.length && wires.size < 4000) {
      const [px, py, pz] = stack.pop()!;
      const k = key(px, py, pz);
      if (wires.has(k)) continue;
      wires.set(k, [px, py, pz]);
      for (const n of this.wireNeighbors(px, py, pz)) if (!wires.has(key(n[0], n[1], n[2]))) stack.push(n);
    }
    // 2. propagate power with a bucket queue (15 -> 1)
    const power = new Map<string, number>();
    const buckets: [number, number, number][][] = Array.from({ length: 16 }, () => []);
    for (const [k, p] of wires) {
      const inp = this.wireInput(p[0], p[1], p[2]);
      power.set(k, inp);
      if (inp > 0) buckets[inp].push(p);
    }
    for (let lvl = 15; lvl > 1; lvl--)
      for (const p of buckets[lvl]) {
        if ((power.get(key(p[0], p[1], p[2])) ?? 0) !== lvl) continue;
        for (const n of this.wireNeighbors(p[0], p[1], p[2])) {
          const nk = key(n[0], n[1], n[2]);
          if (!wires.has(nk)) continue;
          if ((power.get(nk) ?? 0) < lvl - 1) { power.set(nk, lvl - 1); buckets[lvl - 1].push(n); }
        }
      }
    // 3. write wire states
    const t = this.game.ticker!;
    const changed: [number, number, number][] = [];
    t.suppress = true;
    for (const [k, p] of wires) {
      const pw = power.get(k) ?? 0;
      const v = w.get(p[0], p[1], p[2]);
      if (metaOf(v) !== pw) { w.set(p[0], p[1], p[2], pack(B.REDSTONE_WIRE, pw)); changed.push(p); }
    }
    t.suppress = false;
    for (const p of changed) this.observe(p[0], p[1], p[2]);
    // 4. update mechanisms around the change and around changed wires
    const cand = new Map<string, [number, number, number]>();
    const addAround = (px: number, py: number, pz: number, r: number) => {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > r) continue;
        cand.set(key(px + dx, py + dy, pz + dz), [px + dx, py + dy, pz + dz]);
      }
    };
    addAround(x, y, z, 3);
    for (const p of changed) addAround(p[0], p[1], p[2], 2);
    for (const p of cand.values()) this.updateMechanism(p[0], p[1], p[2]);
  }

  private updateMechanism(x: number, y: number, z: number) {
    const w = this.w, g = this.game;
    const v = w.get(x, y, z);
    const id = idOf(v), m = metaOf(v);
    if (!isRedstoneComponent(id)) return;
    switch (id) {
      case B.REDSTONE_LAMP: case B.LIT_REDSTONE_LAMP: {
        const p = this.isPowered(x, y, z);
        if (p && id === B.REDSTONE_LAMP) w.set(x, y, z, B.LIT_REDSTONE_LAMP);
        else if (!p && id === B.LIT_REDSTONE_LAMP) g.ticker!.schedule(x, y, z, 4);
        return;
      }
      case B.TNT:
        if (this.isPowered(x, y, z)) { w.set(x, y, z, B.AIR); g.interact!.primeTnt(x, y, z); }
        return;
      case B.OAK_DOOR: {
        const ly = m & 8 ? y - 1 : y;
        const lower = w.get(x, ly, z);
        if (idOf(lower) !== B.OAK_DOOR) return;
        const p = this.isPowered(x, ly, z) || this.isPowered(x, ly + 1, z);
        const open = (metaOf(lower) & 4) !== 0;
        if (p !== open) {
          const nm = metaOf(lower) ^ 4;
          g.interact!.setAll([[x, ly, z, pack(B.OAK_DOOR, nm)], [x, ly + 1, z, pack(B.OAK_DOOR, (nm & 7) | 8)]]);
          g.audio.play('door', { x: x + 0.5, y: ly + 0.5, z: z + 0.5 }, 1, 0.9 + Math.random() * 0.1);
        }
        return;
      }
      case B.REPEATER: case B.POWERED_REPEATER: {
        if (repeaterLocked(m, (dx, dy, dz) => w.get(x + dx, y + dy, z + dz))) return;
        const should = this.diodeRear(x, y, z, v) > 0;
        if (should !== (id === B.POWERED_REPEATER)) g.ticker!.schedule(x, y, z, (((m >> 2) & 3) + 1) * 2);
        return;
      }
      case B.COMPARATOR:
        if (this.comparatorCompute(x, y, z, v) !== this.comparatorOut(x, y, z)) g.ticker!.schedule(x, y, z, 2);
        return;
      case B.PISTON: case B.STICKY_PISTON: {
        const should = this.qcPowered(x, y, z, F6_D6[m & 7]);
        if (should !== ((m & 8) !== 0)) g.pistons.request(x, y, z);
        return;
      }
      case B.DISPENSER: case B.DROPPER: {
        const p = this.qcPowered(x, y, z);
        const trig = (m & 8) !== 0;
        if (p && !trig) { this.setMetaKeepTile(x, y, z, pack(id, m | 8)); g.ticker!.schedule(x, y, z, 4); }
        else if (!p && trig) this.setMetaKeepTile(x, y, z, pack(id, m & 7));
        return;
      }
      case B.HOPPER: {
        const p = this.isPowered(x, y, z);
        if (p !== ((m & 8) !== 0)) this.setMetaKeepTile(x, y, z, pack(id, p ? m | 8 : m & 7));
        return;
      }
      case B.POWERED_RAIL: case B.ACTIVATOR_RAIL: {
        const p = railPowered(w, (a, b, c) => this.isPowered(a, b, c), x, y, z);
        if (p !== ((m & 8) !== 0)) w.set(x, y, z, pack(id, p ? m | 8 : m & 7));
        return;
      }
      case B.RAIL:
        switchRail(w, x, y, z, this.isPowered(x, y, z));
        return;
    }
    if (isRedstoneTorch(id)) {
      const a = this.attachD6(v);
      const should = this.powerFrom(x + D6[a][0], y + D6[a][1], z + D6[a][2], OPP[a]) === 0;
      if (should !== (id === B.REDSTONE_TORCH)) g.ticker!.schedule(x, y, z, 2);
    }
  }

  setMetaKeepTile(x: number, y: number, z: number, v: number) {
    const t = this.w.getTile(x, y, z);
    this.w.set(x, y, z, v);
    if (t) this.w.setTile(x, y, z, t);
  }

  /** Delayed state changes. Returns true if the block was handled. */
  scheduled(x: number, y: number, z: number): boolean {
    const w = this.w, g = this.game;
    const v = w.get(x, y, z);
    const id = idOf(v), m = metaOf(v);
    const at = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
    if (isRedstoneTorch(id)) {
      const a = this.attachD6(v);
      const should = this.powerFrom(x + D6[a][0], y + D6[a][1], z + D6[a][2], OPP[a]) === 0;
      if (should !== (id === B.REDSTONE_TORCH)) {
        if (should && this.burnedOut(x, y, z)) { g.ticker!.schedule(x, y, z, 160); return true; }
        w.set(x, y, z, pack(should ? B.REDSTONE_TORCH : B.UNLIT_REDSTONE_TORCH, m));
        if (!should) g.audio.play('fizz', at, 0.3, 2.5);
      }
      return true;
    }
    switch (id) {
      case B.LIT_REDSTONE_LAMP:
        if (!this.isPowered(x, y, z)) w.set(x, y, z, B.REDSTONE_LAMP);
        return true;
      case B.STONE_BUTTON:
        if (m & 8) { w.set(x, y, z, pack(id, m & 7)); g.audio.play('click', at, 0.4, 0.5); }
        return true;
      case B.STONE_PRESSURE_PLATE:
        if (!m) return true;
        if (!this.occupied(x, y, z)) { w.set(x, y, z, B.STONE_PRESSURE_PLATE); g.audio.play('click', at, 0.3, 0.5); }
        else g.ticker!.schedule(x, y, z, 20);
        return true;
      case B.REPEATER: case B.POWERED_REPEATER: {
        if (repeaterLocked(m, (dx, dy, dz) => w.get(x + dx, y + dy, z + dz))) return true;
        const should = this.diodeRear(x, y, z, v) > 0;
        const on = id === B.POWERED_REPEATER;
        if (on && !should) w.set(x, y, z, pack(B.REPEATER, m));
        else if (!on) {
          w.set(x, y, z, pack(B.POWERED_REPEATER, m));
          if (!should) g.ticker!.schedule(x, y, z, (((m >> 2) & 3) + 1) * 2);
        }
        return true;
      }
      case B.COMPARATOR: {
        const out = this.comparatorCompute(x, y, z, v);
        const t = (w.getTile(x, y, z) as { type: 'comparator'; out: number } | undefined) ?? { type: 'comparator' as const, out: 0 };
        if (t.out === out) return true;
        t.out = out;
        const nm = out > 0 ? m | 8 : m & 7;
        if (nm !== m) this.setMetaKeepTile(x, y, z, pack(id, nm));
        w.setTile(x, y, z, t);
        this.update(x, y, z);
        return true;
      }
      case B.OBSERVER:
        if (m & 8) this.setMetaKeepTile(x, y, z, pack(id, m & 7));
        else { this.setMetaKeepTile(x, y, z, pack(id, m | 8)); g.ticker!.schedule(x, y, z, 2); }
        return true;
      case B.DISPENSER: case B.DROPPER:
        g.devices.dispense(x, y, z);
        return true;
      case B.DETECTOR_RAIL:
        // stays pressed while a minecart is on it, checked every 20 ticks like vanilla
        if (!(m & 8)) return true;
        if (!g.minecartOn(x, y, z)) w.set(x, y, z, pack(id, m & 7));
        else g.ticker!.schedule(x, y, z, 20);
        return true;
    }
    return false;
  }

  private torchToggles = new Map<string, number[]>();
  /** Vanilla burnout: a torch that turned on 8 times within 60 ticks stays off for a while. */
  private burnedOut(x: number, y: number, z: number): boolean {
    const k = key(x, y, z), now = this.game.ticker!.now;
    const list = (this.torchToggles.get(k) ?? []).filter((t) => now - t < 60);
    list.push(now);
    this.torchToggles.set(k, list);
    if (list.length > 8) {
      this.game.audio.play('fizz', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0.5, 2.6);
      for (let i = 0; i < 5; i++) this.game.particles!.smoke(x + 0.3 + Math.random() * 0.4, y + 0.8, z + 0.3 + Math.random() * 0.4, false);
      return true;
    }
    return false;
  }

  private occupied(x: number, y: number, z: number) {
    const g = this.game;
    const ents = [g.player!, ...g.entities];
    return ents.some((e) => !e.removed && Math.floor(e.x) === x && Math.floor(e.z) === z && e.y >= y && e.y < y + 0.5);
  }

  /** Per tick: pressure plates, comparators watching containers. */
  tick() {
    const g = this.game, w = this.w;
    const ents = [g.player!, ...g.entities];
    for (const e of ents) {
      if (e.removed || (e === g.player && g.player!.spectator)) continue;
      const x = Math.floor(e.x), y = Math.floor(e.y + 0.01), z = Math.floor(e.z);
      const v = w.get(x, y, z);
      if (idOf(v) === B.STONE_PRESSURE_PLATE && !metaOf(v)) {
        w.set(x, y, z, pack(B.STONE_PRESSURE_PLATE, 1));
        g.audio.play('click', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0.3, 0.6);
        g.ticker!.schedule(x, y, z, 20);
      }
    }
    if (g.ticker!.now % 2 === 0) {
      for (const c of w.chunks.values()) {
        if (!c.ready || !c.tiles.size) continue;
        for (const [i, t] of c.tiles) {
          if (t.type !== 'comparator') continue;
          const x = c.cx * 16 + (i & 15), z = c.cz * 16 + ((i >> 4) & 15), y = i >> 8;
          const v = w.get(x, y, z);
          if (idOf(v) !== B.COMPARATOR) continue;
          if (this.comparatorCompute(x, y, z, v) !== (t.out as number)) g.ticker!.schedule(x, y, z, 2);
        }
      }
    }
  }

  /** A minecart rolled onto a detector rail. */
  pressDetector(x: number, y: number, z: number) {
    const v = this.w.get(x, y, z);
    if (idOf(v) !== B.DETECTOR_RAIL || metaOf(v) & 8) return;
    this.w.set(x, y, z, pack(B.DETECTOR_RAIL, metaOf(v) | 8));
    this.game.ticker!.schedule(x, y, z, 20);
  }

  toggleLever(x: number, y: number, z: number) {
    const v = this.w.get(x, y, z);
    this.w.set(x, y, z, pack(B.LEVER, metaOf(v) ^ 8));
    this.game.audio.play('click', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0.4, metaOf(v) & 8 ? 0.5 : 0.6);
  }
  pressButton(x: number, y: number, z: number) {
    const v = this.w.get(x, y, z);
    if (metaOf(v) & 8) return;
    this.w.set(x, y, z, pack(B.STONE_BUTTON, metaOf(v) | 8));
    this.game.audio.play('click', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0.4, 0.6);
    this.game.ticker!.schedule(x, y, z, 20);
  }
  /** Right-click on a repeater (cycle delay) or comparator (toggle subtract mode). */
  useDiode(x: number, y: number, z: number) {
    const v = this.w.get(x, y, z);
    const id = idOf(v), m = metaOf(v);
    const at = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
    if (isRepeater(id)) this.w.set(x, y, z, pack(id, (m & 3) | ((((m >> 2) + 1) & 3) << 2)));
    else {
      this.setMetaKeepTile(x, y, z, pack(id, m ^ 4));
      this.game.audio.play('click', at, 0.3, m & 4 ? 0.5 : 0.55);
      this.game.ticker!.schedule(x, y, z, 2);
    }
  }
}
