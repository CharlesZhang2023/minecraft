// Track laying, after vanilla's BlockRailBase.Rail: a new rail turns toward the rails next to it (sloping up to
// rails a block higher), and rails with a free end bend round to meet it. A normal rail at a T-junction swaps
// its curve when it's powered.
import type { World } from '../world/world';
import { B, OPAQUE, idOf, metaOf, pack } from '../world/blocks';
import { RAIL_ENDS, railShape, canCurve, isRail, NS, EW, ASC_E, ASC_W, ASC_N, ASC_S, SE, SW, NW, NE } from '../world/rails';

type P = [number, number, number];

class Rail {
  conns: P[] = [];
  readonly curves: boolean;
  shape: number;
  constructor(private w: World, public pos: P) {
    const v = w.get(pos[0], pos[1], pos[2]);
    this.curves = canCurve(idOf(v));
    this.shape = railShape(v);
    this.setConns(this.shape);
  }

  private setConns(shape: number) {
    const [a, b] = RAIL_ENDS[shape];
    const [x, y, z] = this.pos;
    this.conns = [a, b].map(([dx, , dz]) => [x + dx, y + this.upAt(shape, dx, dz), z + dz] as P);
  }

  /** The high end of an ascending rail connects to the block above its neighbour. */
  private upAt(shape: number, dx: number, dz: number) {
    if (shape === ASC_E && dx === 1) return 1;
    if (shape === ASC_W && dx === -1) return 1;
    if (shape === ASC_N && dz === -1) return 1;
    if (shape === ASC_S && dz === 1) return 1;
    return 0;
  }

  static at(w: World, p: P): Rail | null {
    for (const dy of [0, 1, -1]) {
      const q: P = [p[0], p[1] + dy, p[2]];
      if (isRail(w.getId(q[0], q[1], q[2]))) return new Rail(w, q);
    }
    return null;
  }

  private hasRailAt(p: P) {
    return isRail(this.w.getId(p[0], p[1], p[2])) || isRail(this.w.getId(p[0], p[1] + 1, p[2])) || isRail(this.w.getId(p[0], p[1] - 1, p[2]));
  }

  /** Drop connections the other rail doesn't return. */
  removeSoft() {
    this.conns = this.conns.filter((c) => {
      const r = Rail.at(this.w, c);
      return r !== null && r.connectedTo(this);
    });
  }

  connectedTo(r: Rail) {
    return this.conns.some((c) => c[0] === r.pos[0] && c[2] === r.pos[2]);
  }

  canConnectTo(r: Rail) {
    return this.connectedTo(r) || this.conns.length !== 2;
  }

  adjacentRails() {
    let n = 0;
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) if (this.hasRailAt([this.pos[0] + dx, this.pos[1], this.pos[2] + dz])) n++;
    return n;
  }

  /** Bend this rail to join r. */
  private connect(r: Rail) {
    this.conns.push(r.pos);
    const [x, y, z] = this.pos;
    const has = (dx: number, dz: number) => this.conns.some((c) => c[0] === x + dx && c[2] === z + dz);
    const n = has(0, -1), s = has(0, 1), w = has(-1, 0), e = has(1, 0);
    let shape = -1;
    if (n || s) shape = NS;
    if (w || e) shape = EW;
    if (this.curves) {
      if (s && e && !n && !w) shape = SE;
      if (s && w && !n && !e) shape = SW;
      if (n && w && !s && !e) shape = NW;
      if (n && e && !s && !w) shape = NE;
    }
    shape = this.slope(shape);
    if (shape < 0) shape = NS;
    this.write(shape);
  }

  private slope(shape: number) {
    const [x, y, z] = this.pos;
    const rail = (dx: number, dz: number) => isRail(this.w.getId(x + dx, y + 1, z + dz));
    if (shape === NS) { if (rail(0, -1)) return ASC_N; if (rail(0, 1)) return ASC_S; }
    if (shape === EW) { if (rail(1, 0)) return ASC_E; if (rail(-1, 0)) return ASC_W; }
    return shape;
  }

  private write(shape: number) {
    const [x, y, z] = this.pos;
    const v = this.w.get(x, y, z);
    const id = idOf(v);
    const nv = id === B.RAIL ? pack(id, shape) : pack(id, (metaOf(v) & 8) | shape);
    this.shape = shape;
    this.setConns(shape);
    if (nv !== v) this.w.set(x, y, z, nv);
  }

  /** Can the rail at p take a connection from this one? */
  private wants(p: P) {
    const r = Rail.at(this.w, p);
    if (!r) return false;
    r.removeSoft();
    return r.canConnectTo(this);
  }

  /** Pick this rail's shape from its neighbours, then bend them to meet it. */
  place(powered: boolean, initial: boolean) {
    const [x, y, z] = this.pos;
    const n = this.wants([x, y, z - 1]), s = this.wants([x, y, z + 1]), w = this.wants([x - 1, y, z]), e = this.wants([x + 1, y, z]);
    let shape = -1;
    if ((n || s) && !w && !e) shape = NS;
    if ((w || e) && !n && !s) shape = EW;
    if (this.curves) {
      if (s && e && !n && !w) shape = SE;
      if (s && w && !n && !e) shape = SW;
      if (n && w && !s && !e) shape = NW;
      if (n && e && !s && !w) shape = NE;
    }
    if (shape < 0) {
      if (n || s) shape = NS;
      if (w || e) shape = EW;
      if (this.curves) {
        // a T-junction: which way it turns depends on redstone power
        if (powered) {
          if (s && e) shape = SE;
          if (w && s) shape = SW;
          if (e && n) shape = NE;
          if (n && w) shape = NW;
        } else {
          if (n && w) shape = NW;
          if (e && n) shape = NE;
          if (w && s) shape = SW;
          if (s && e) shape = SE;
        }
      }
    }
    shape = this.slope(shape);
    if (shape < 0) shape = this.shape;
    const before = this.shape;
    this.write(shape);
    if (initial || before !== shape) {
      for (const c of this.conns) {
        const r = Rail.at(this.w, c);
        if (!r) continue;
        r.removeSoft();
        if (r.canConnectTo(this)) r.connect(this);
      }
    }
  }
}

/** A rail was just placed: shape it and its neighbours. */
export function layRail(w: World, x: number, y: number, z: number, powered: boolean) {
  if (!isRail(w.getId(x, y, z))) return;
  new Rail(w, [x, y, z]).place(powered, true);
}

/** Redstone changed next to a normal rail: a powered T-junction swaps its curve. */
export function switchRail(w: World, x: number, y: number, z: number, powered: boolean) {
  if (w.getId(x, y, z) !== B.RAIL) return;
  const r = new Rail(w, [x, y, z]);
  if (r.adjacentRails() === 3) r.place(powered, false);
}

/** Does the rail still have something under it (and, if it slopes, something to lean on)? */
export function railCanStay(w: World, x: number, y: number, z: number, v: number): boolean {
  if (OPAQUE[w.getId(x, y - 1, z)] !== 1) return false;
  const shape = railShape(v);
  const lean: Record<number, [number, number]> = { [ASC_E]: [1, 0], [ASC_W]: [-1, 0], [ASC_N]: [0, -1], [ASC_S]: [0, 1] };
  const l = lean[shape];
  return !l || OPAQUE[w.getId(x + l[0], y, z + l[1])] === 1;
}


/**
 * Powered/activator rails: on when redstone reaches them, or when one of the next 8 rails of the same kind
 * along the line is on and powered from further along (vanilla's BlockRailPowered search).
 */
export function railPowered(w: World, isPowered: (x: number, y: number, z: number) => boolean, x: number, y: number, z: number): boolean {
  if (isPowered(x, y, z)) return true;
  const v = w.get(x, y, z);
  return chain(w, isPowered, x, y, z, v, true, 0) || chain(w, isPowered, x, y, z, v, false, 0);
}

function chain(w: World, isPowered: (x: number, y: number, z: number) => boolean, x: number, y: number, z: number, v: number, fwd: boolean, dist: number): boolean {
  if (dist >= 8) return false;
  let shape = railShape(v), down = true;
  switch (shape) {
    case NS: z += fwd ? 1 : -1; break;
    case EW: x += fwd ? -1 : 1; break;
    case ASC_E: if (fwd) x--; else { x++; y++; down = false; } shape = EW; break;
    case ASC_W: if (fwd) { x--; y++; down = false; } else x++; shape = EW; break;
    case ASC_N: if (fwd) z++; else { z--; y++; down = false; } shape = NS; break;
    case ASC_S: if (fwd) { z++; y++; down = false; } else z--; shape = NS; break;
  }
  const id = idOf(v);
  const step = (sy: number) => {
    const nv = w.get(x, sy, z);
    if (idOf(nv) !== id) return false;
    const d = railShape(nv);
    if (shape === EW && (d === NS || d === ASC_N || d === ASC_S)) return false;
    if (shape === NS && (d === EW || d === ASC_E || d === ASC_W)) return false;
    if (!(metaOf(nv) & 8)) return false;
    return isPowered(x, sy, z) || chain(w, isPowered, x, sy, z, nv, fwd, dist + 1);
  };
  return step(y) || (down && step(y - 1));
}
