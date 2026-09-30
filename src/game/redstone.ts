// Simplified but faithful-feeling redstone: dust signal strength with 1-per-block decay,
// strong/weak powering of solid blocks, torches as delayed inverters, lamps, doors and TNT.
import type { Game } from './game';
import type { World } from '../world/world';
import { B, OPAQUE, idOf, metaOf, pack, HORIZ, isRedstoneTorch, isRedstoneComponent } from '../world/blocks';

const D6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
const key = (x: number, y: number, z: number) => x + ',' + y + ',' + z;

export class Redstone {
  private busy = false;
  private pending: [number, number, number][] = [];
  constructor(private game: Game) {}
  get w(): World { return this.game.world!; }

  // ---------------------------------------------------------------- sources
  /** Direction (dx,dy,dz) from a lever/button/torch at (x,y,z) to the block it is attached to. */
  private attachDir(v: number): [number, number, number] {
    const id = idOf(v), m = metaOf(v);
    const at = isRedstoneTorch(id) ? m : m & 7;
    if (at === 0) return [0, -1, 0];
    const [dx, dz] = HORIZ[(at - 1) & 3];
    return [dx, 0, dz];
  }
  private sourceOn(v: number): boolean {
    const id = idOf(v), m = metaOf(v);
    if (id === B.LEVER || id === B.STONE_BUTTON) return (m & 8) !== 0;
    if (id === B.STONE_PRESSURE_PLATE) return m > 0;
    return id === B.REDSTONE_TORCH || id === B.REDSTONE_BLOCK;
  }

  /** Is the solid block at (x,y,z) powered (strongly by an attached source, or by dust on top / pointing in)? */
  blockPowered(x: number, y: number, z: number, exclude?: string): boolean {
    const w = this.w;
    if (!OPAQUE[w.getId(x, y, z)]) return false;
    for (const [dx, dy, dz] of D6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (exclude && key(nx, ny, nz) === exclude) continue;
      const v = w.get(nx, ny, nz);
      const id = idOf(v);
      if (id === B.REDSTONE_WIRE) {
        if (metaOf(v) === 0) continue;
        if (dy === 1) return true; // dust lying on the block
        if (dy === 0) {
          // dust pointing into the block: a straight run ending at it
          const [ax, , az] = [-dx, 0, -dz];
          const conn = this.wireConn(nx, ny, nz);
          const into = HORIZ.findIndex(([hx, hz]) => hx === ax && hz === az);
          const n = conn.filter(Boolean).length;
          if (n === 0 || (n <= 2 && (conn[into] || conn[(into + 2) % 4]))) return true;
        }
        continue;
      }
      if (id === B.LEVER || id === B.STONE_BUTTON) {
        const [ax, ay, az] = this.attachDir(v);
        if (this.sourceOn(v) && nx + ax === x && ny + ay === y && nz + az === z) return true;
      } else if (id === B.STONE_PRESSURE_PLATE && dy === 1 && this.sourceOn(v)) return true;
      else if (id === B.REDSTONE_TORCH && dy === -1) return true; // torch powers the block above it
    }
    return false;
  }

  /** Is a mechanism (lamp, door, tnt) at (x,y,z) powered? */
  mechanismPowered(x: number, y: number, z: number): boolean {
    const w = this.w;
    for (const [dx, dy, dz] of D6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const v = w.get(nx, ny, nz);
      const id = idOf(v);
      if (id === B.REDSTONE_WIRE) { if (metaOf(v) > 0 && dy >= 0) return true; continue; }
      if (this.sourceOn(v)) {
        if (isRedstoneTorch(id)) {
          const [ax, ay, az] = this.attachDir(v);
          if (nx + ax === x && ny + ay === y && nz + az === z) continue; // torch doesn't power its support
        }
        return true;
      }
      if (OPAQUE[id] && this.blockPowered(nx, ny, nz)) return true;
    }
    return false;
  }

  private wireConn(x: number, y: number, z: number): boolean[] {
    const w = this.w;
    const comp = (id: number) => id === B.REDSTONE_WIRE || id === B.LEVER || id === B.STONE_BUTTON || id === B.STONE_PRESSURE_PLATE || isRedstoneTorch(id) || id === B.REDSTONE_BLOCK;
    const aboveOpaque = OPAQUE[w.getId(x, y + 1, z)] === 1;
    return HORIZ.map(([dx, dz]) => comp(w.getId(x + dx, y, z + dz)) || (!aboveOpaque && w.getId(x + dx, y + 1, z + dz) === B.REDSTONE_WIRE) || (!OPAQUE[w.getId(x + dx, y, z + dz)] && w.getId(x + dx, y - 1, z + dz) === B.REDSTONE_WIRE));
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

  /** Power a wire receives from non-wire sources. */
  private wireInput(x: number, y: number, z: number): number {
    const w = this.w;
    for (const [dx, dy, dz] of D6) {
      const v = w.get(x + dx, y + dy, z + dz);
      const id = idOf(v);
      if (id === B.REDSTONE_WIRE) continue;
      if (this.sourceOn(v)) {
        if (isRedstoneTorch(id) && dy === -1) continue; // torch below the dust's block doesn't power it through
        return 15;
      }
      if (OPAQUE[id] && dy !== 1 && this.blockStronglyPowered(x + dx, y + dy, z + dz)) return 15;
    }
    return 0;
  }
  /** Strong power only (levers/buttons attached, torch underneath) — dust can't power dust through blocks. */
  private blockStronglyPowered(x: number, y: number, z: number): boolean {
    const w = this.w;
    for (const [dx, dy, dz] of D6) {
      const v = w.get(x + dx, y + dy, z + dz);
      const id = idOf(v);
      if ((id === B.LEVER || id === B.STONE_BUTTON) && this.sourceOn(v)) {
        const [ax, ay, az] = this.attachDir(v);
        if (x + dx + ax === x && y + dy + ay === y && z + dz + az === z) return true;
      }
      if (id === B.REDSTONE_TORCH && dy === -1) return true;
      if (id === B.STONE_PRESSURE_PLATE && dy === 1 && this.sourceOn(v)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- update
  onChange(x: number, y: number, z: number, oid: number, nid: number) {
    if (!isRedstoneComponent(oid) && !isRedstoneComponent(nid)) {
      // a plain block next to redstone can change connectivity / powering
      let near = false;
      for (const [dx, dy, dz] of D6) if (isRedstoneComponent(this.w.getId(x + dx, y + dy, z + dz))) { near = true; break; }
      if (!near) return;
    }
    this.update(x, y, z);
  }

  update(x: number, y: number, z: number) {
    if (this.busy) { this.pending.push([x, y, z]); return; }
    this.busy = true;
    try {
      this.recompute(x, y, z);
      let guard = 0;
      while (this.pending.length && guard++ < 64) {
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
      // dust on top of / below neighbouring blocks
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
    t.suppress = true;
    for (const [k, p] of wires) {
      const pw = power.get(k) ?? 0;
      const v = w.get(p[0], p[1], p[2]);
      if (metaOf(v) !== pw) w.set(p[0], p[1], p[2], pack(B.REDSTONE_WIRE, pw));
    }
    t.suppress = false;
    // 4. update mechanisms around the network and the change
    const cand = new Map<string, [number, number, number]>();
    const addAround = (px: number, py: number, pz: number, r: number) => {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > r) continue;
        cand.set(key(px + dx, py + dy, pz + dz), [px + dx, py + dy, pz + dz]);
      }
    };
    addAround(x, y, z, 3);
    for (const p of wires.values()) addAround(p[0], p[1], p[2], 2);
    for (const p of cand.values()) this.updateMechanism(p[0], p[1], p[2]);
  }

  private updateMechanism(x: number, y: number, z: number) {
    const w = this.w, g = this.game;
    const v = w.get(x, y, z);
    const id = idOf(v);
    if (id === B.REDSTONE_LAMP || id === B.LIT_REDSTONE_LAMP) {
      const p = this.mechanismPowered(x, y, z);
      if (p && id === B.REDSTONE_LAMP) w.set(x, y, z, B.LIT_REDSTONE_LAMP);
      else if (!p && id === B.LIT_REDSTONE_LAMP) g.ticker!.schedule(x, y, z, 4);
    } else if (id === B.TNT) {
      if (this.mechanismPowered(x, y, z)) { w.set(x, y, z, B.AIR); g.interact!.primeTnt(x, y, z); }
    } else if (id === B.OAK_DOOR) {
      const upper = (metaOf(v) & 8) !== 0;
      const ly = upper ? y - 1 : y;
      const lower = w.get(x, ly, z);
      if (idOf(lower) !== B.OAK_DOOR) return;
      const p = this.mechanismPowered(x, ly, z) || this.mechanismPowered(x, ly + 1, z);
      const open = (metaOf(lower) & 4) !== 0;
      if (p !== open) {
        const nm = metaOf(lower) ^ 4;
        g.interact!.setAll([[x, ly, z, pack(B.OAK_DOOR, nm)], [x, ly + 1, z, pack(B.OAK_DOOR, (nm & 7) | 8)]]);
        g.audio.play('door', { x: x + 0.5, y: ly + 0.5, z: z + 0.5 }, 1, 0.9 + Math.random() * 0.1);
      }
    } else if (isRedstoneTorch(id)) {
      const [ax, ay, az] = this.attachDir(v);
      const should = !this.blockPowered(x + ax, y + ay, z + az, key(x, y, z));
      if (should !== (id === B.REDSTONE_TORCH)) g.ticker!.schedule(x, y, z, 2);
    }
  }

  /** Delayed state changes (torches invert after 2 ticks, lamps turn off after 4, buttons release). */
  scheduled(x: number, y: number, z: number): boolean {
    const w = this.w;
    const v = w.get(x, y, z);
    const id = idOf(v);
    if (isRedstoneTorch(id)) {
      const [ax, ay, az] = this.attachDir(v);
      const should = !this.blockPowered(x + ax, y + ay, z + az, key(x, y, z));
      if (should !== (id === B.REDSTONE_TORCH)) {
        w.set(x, y, z, pack(should ? B.REDSTONE_TORCH : B.UNLIT_REDSTONE_TORCH, metaOf(v)));
        if (!should) this.game.audio.play('fizz', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0.3, 2.5);
      }
      return true;
    }
    if (id === B.LIT_REDSTONE_LAMP) {
      if (!this.mechanismPowered(x, y, z)) w.set(x, y, z, B.REDSTONE_LAMP);
      return true;
    }
    if (id === B.STONE_BUTTON && metaOf(v) & 8) {
      w.set(x, y, z, pack(id, metaOf(v) & 7));
      this.game.audio.play('click', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0.4, 0.5);
      return true;
    }
    if (id === B.STONE_PRESSURE_PLATE && metaOf(v)) {
      if (!this.occupied(x, y, z)) {
        w.set(x, y, z, B.STONE_PRESSURE_PLATE);
        this.game.audio.play('click', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0.3, 0.5);
      } else this.game.ticker!.schedule(x, y, z, 20);
      return true;
    }
    return false;
  }

  private occupied(x: number, y: number, z: number) {
    const g = this.game;
    const ents = [g.player!, ...g.entities];
    return ents.some((e) => !e.removed && Math.floor(e.x) === x && Math.floor(e.z) === z && e.y >= y && e.y < y + 0.5);
  }

  /** Entities stepping on pressure plates. */
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
}
