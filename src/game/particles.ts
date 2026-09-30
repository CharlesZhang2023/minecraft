import type { World } from '../world/world';
import type { DynMesh } from '../render/gl';
import { BLOCKS, OPAQUE, SOLID, tex } from '../world/blocks';
import { Random } from '../noise';

export interface Particle {
  x: number; y: number; z: number;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  age: number; life: number;
  size: number;
  layer: number;
  u0: number; v0: number; u1: number; v1: number;
  col: number;
  alpha: number;
  gravity: number;
  collide: boolean;
  onGround: boolean;
  fullbright: boolean;
  kind: 'block' | 'smoke' | 'flame' | 'bubble' | 'splash' | 'crit' | 'explosion' | 'drip' | 'rain' | 'note' | 'heart' | 'portal' | 'spell';
  frames?: number;
  friction: number;
}

const rng = new Random(9);
export const PT = {
  smoke: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => tex('particle_smoke_' + i)),
  flame: tex('particle_flame'),
  bubble: tex('particle_bubble'),
  splash: [0, 1, 2, 3].map((i) => tex('particle_splash_' + i)),
  crit: tex('particle_crit'),
  explosion: [...Array(16).keys()].map((i) => tex('particle_explosion_' + i)),
  heart: tex('particle_heart'),
  drip: tex('particle_drip'),
  rain: tex('particle_rain'),
  spell: tex('particle_spell'),
};

export class Particles {
  list: Particle[] = [];
  constructor(private world: World) {}

  add(p: Partial<Particle> & { x: number; y: number; z: number }): Particle {
    const q: Particle = {
      px: p.x, py: p.y, pz: p.z, vx: 0, vy: 0, vz: 0, age: 0, life: 20, size: 0.1, layer: 0,
      u0: 0, v0: 0, u1: 1, v1: 1, col: 0xffffff, alpha: 1, gravity: 0.04, collide: true, onGround: false,
      fullbright: false, kind: 'block', friction: 0.98, ...p,
    };
    if (this.list.length > 4000) this.list.shift();
    this.list.push(q);
    return q;
  }

  blockBreak(x: number, y: number, z: number, blockId: number, tint = 0xffffff) {
    const def = BLOCKS[blockId];
    if (!def || blockId === 0) return;
    const layer = def.faces[0];
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        for (let k = 0; k < 4; k++) {
          const px = x + (i + 0.5) / 4, py = y + (j + 0.5) / 4, pz = z + (k + 0.5) / 4;
          this.debris(px, py, pz, px - x - 0.5, py - y - 0.5, pz - z - 0.5, layer, tint);
        }
  }

  blockHit(x: number, y: number, z: number, face: number, blockId: number, tint = 0xffffff) {
    const def = BLOCKS[blockId];
    const layer = def.faces[face] ?? def.faces[0];
    const e = 0.1;
    let px = x + rng.next() * (1 - e * 2) + e, py = y + rng.next() * (1 - e * 2) + e, pz = z + rng.next() * (1 - e * 2) + e;
    if (face === 0) px = x - e; if (face === 1) px = x + 1 + e;
    if (face === 2) py = y - e; if (face === 3) py = y + 1 + e;
    if (face === 4) pz = z - e; if (face === 5) pz = z + 1 + e;
    const p = this.debris(px, py, pz, 0, 0, 0, layer, tint);
    p.vx *= 0.2; p.vy = (p.vy - 0.1) * 0.2 + 0.1; p.vz *= 0.2;
    p.size *= 0.6;
  }

  private debris(x: number, y: number, z: number, dx: number, dy: number, dz: number, layer: number, tint: number): Particle {
    const u = rng.next() * 0.75, v = rng.next() * 0.75;
    const p = this.add({
      x, y, z, layer, u0: u, v0: v, u1: u + 0.25, v1: v + 0.25, col: tint,
      size: 0.1 * (rng.next() * 0.5 + 0.5) * 2 * 0.5,
      life: Math.floor(4 / (rng.next() * 0.9 + 0.1)), gravity: 0.04,
      kind: 'block',
    });
    let vx = dx + (rng.next() * 2 - 1) * 0.4, vy = dy + (rng.next() * 2 - 1) * 0.4, vz = dz + (rng.next() * 2 - 1) * 0.4;
    const l = Math.hypot(vx, vy, vz) || 1;
    const sp = (rng.next() + rng.next() + 1) * 0.15 * 0.4;
    p.vx = (vx / l) * sp; p.vy = (vy / l) * sp + 0.1; p.vz = (vz / l) * sp;
    return p;
  }

  smoke(x: number, y: number, z: number, big = false) {
    this.add({
      x, y, z, vx: (rng.next() - 0.5) * 0.02, vy: 0.02 + rng.next() * 0.02, vz: (rng.next() - 0.5) * 0.02, kind: 'smoke',
      layer: PT.smoke[0], size: (big ? 0.3 : 0.12) * (0.75 + rng.next() * 0.5), life: Math.floor(8 / (rng.next() * 0.8 + 0.2)) * (big ? 2 : 1),
      gravity: -0.004, collide: false, col: big ? 0xffffff : grayCol(rng.next() * 0.3 + 0.3), friction: 0.96, frames: 8,
    });
  }
  flame(x: number, y: number, z: number) {
    this.add({ x, y, z, vx: 0, vy: 0.002, vz: 0, kind: 'flame', layer: PT.flame, size: 0.06, life: 8 + rng.int(8), gravity: 0, collide: false, fullbright: true, friction: 0.96 });
  }
  bubble(x: number, y: number, z: number) {
    this.add({ x, y, z, vx: (rng.next() - 0.5) * 0.04, vy: 0.04 + rng.next() * 0.04, vz: (rng.next() - 0.5) * 0.04, kind: 'bubble', layer: PT.bubble, size: 0.04 + rng.next() * 0.03, life: 8 + rng.int(20), gravity: -0.002, collide: false, friction: 0.85 });
  }
  splash(x: number, y: number, z: number) {
    this.add({ x, y, z, vx: (rng.next() - 0.5) * 0.3, vy: 0.1 + rng.next() * 0.2, vz: (rng.next() - 0.5) * 0.3, kind: 'splash', layer: PT.splash[rng.int(4)], size: 0.05, life: 8 + rng.int(10), gravity: 0.06, col: 0x6699ff });
  }
  crit(x: number, y: number, z: number) {
    for (let i = 0; i < 12; i++) {
      const vx = rng.next() * 2 - 1, vy = rng.next() * 2 - 1, vz = rng.next() * 2 - 1;
      this.add({ x, y, z, vx: vx * 0.4, vy: vy * 0.4 + 0.2, vz: vz * 0.4, kind: 'crit', layer: PT.crit, size: 0.06, life: 10 + rng.int(8), gravity: 0.03, col: 0xe8e8ff, friction: 0.7, collide: false });
    }
  }
  explosion(x: number, y: number, z: number) {
    this.add({ x, y, z, kind: 'explosion', layer: PT.explosion[0], size: 1.8 + rng.next() * 0.8, life: 6 + rng.int(4), gravity: 0, collide: false, fullbright: true, frames: 16, col: grayCol(rng.next() * 0.4 + 0.6) });
  }
  heart(x: number, y: number, z: number) {
    this.add({ x, y, z, vy: 0.05, kind: 'heart', layer: PT.heart, size: 0.1, life: 16, gravity: -0.002, collide: false, friction: 0.86 });
  }
  drip(x: number, y: number, z: number, lava: boolean) {
    this.add({ x, y, z, kind: 'drip', layer: PT.drip, size: 0.03, life: 40, gravity: 0.03, col: lava ? 0xff6600 : 0x3355ff, fullbright: lava });
  }
  rain(x: number, y: number, z: number) {
    this.add({ x, y, z, vy: -0.1, kind: 'rain', layer: PT.splash[rng.int(4)], size: 0.03, life: 6, gravity: 0.06, col: 0x6699ff });
  }
  spell(x: number, y: number, z: number, col: number) {
    this.add({ x, y, z, vx: (rng.next() - 0.5) * 0.05, vy: 0.05, vz: (rng.next() - 0.5) * 0.05, kind: 'spell', layer: PT.spell, size: 0.07, life: 16 + rng.int(10), gravity: -0.003, col, collide: false });
  }

  tick() {
    const w = this.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.age++;
      if (p.age >= p.life) { this.list.splice(i, 1); continue; }
      p.vy -= p.gravity;
      if (p.collide) {
        // simple per-axis collision against full blocks
        let nx = p.x + p.vx, ny = p.y + p.vy, nz = p.z + p.vz;
        const solid = (x: number, y: number, z: number) => {
          const id = w.getId(Math.floor(x), Math.floor(y), Math.floor(z));
          return OPAQUE[id] === 1 || (SOLID[id] === 1 && BLOCKS[id].render === 1);
        };
        if (solid(p.x, ny - p.size, p.z)) { if (p.vy < 0) p.onGround = true; ny = p.y; p.vy = 0; }
        else p.onGround = false;
        if (solid(nx, p.y, p.z)) { nx = p.x; p.vx = 0; }
        if (solid(p.x, p.y, nz)) { nz = p.z; p.vz = 0; }
        p.x = nx; p.y = ny; p.z = nz;
        if (p.kind === 'bubble' && w.getId(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) !== 12) p.age = p.life;
        if (p.kind === 'rain' && p.onGround) p.age = p.life;
      } else {
        p.x += p.vx; p.y += p.vy; p.z += p.vz;
      }
      p.vx *= p.friction; p.vy *= p.friction; p.vz *= p.friction;
      if (p.onGround) { p.vx *= 0.7; p.vz *= 0.7; }
      if (p.frames) p.layer = (p.kind === 'smoke' ? PT.smoke : PT.explosion)[Math.min(p.frames - 1, Math.floor((p.age / p.life) * p.frames))];
    }
  }

  /** Build camera-facing quads. Positions are camera-relative. */
  build(mesh: DynMesh, cx: number, cy: number, cz: number, t: number, yaw: number, pitch: number) {
    const ry = (yaw * Math.PI) / 180, rp = (pitch * Math.PI) / 180;
    // camera right & up vectors
    const rx = -Math.cos(ry), rz = -Math.sin(ry);
    const ux = -Math.sin(ry) * Math.sin(rp), uy = Math.cos(rp), uz = Math.cos(ry) * Math.sin(rp);
    for (const p of this.list) {
      const x = p.px + (p.x - p.px) * t - cx, y = p.py + (p.y - p.py) * t - cy, z = p.pz + (p.z - p.pz) * t - cz;
      let s = p.size;
      if (p.kind === 'smoke' || p.kind === 'flame') s *= Math.min(1, ((p.age + t) / p.life) * 32 * 0.5 + 0.5) * (p.kind === 'flame' ? 1 - ((p.age + t) / p.life) * 0.5 : 1);
      let sky = 15, blk = 15;
      if (!p.fullbright) [sky, blk] = this.world.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      const a = p.kind === 'smoke' ? 1 : p.alpha;
      const ax = rx * s, az = rz * s, bx = ux * s, by = uy * s, bz = uz * s;
      mesh.v(x - ax - bx, y - by, z - az - bz, p.u0, p.v1, p.layer, p.col, a, sky, blk);
      mesh.v(x + ax - bx, y - by, z + az - bz, p.u1, p.v1, p.layer, p.col, a, sky, blk);
      mesh.v(x + ax + bx, y + by, z + az + bz, p.u1, p.v0, p.layer, p.col, a, sky, blk);
      mesh.v(x - ax + bx, y + by, z - az + bz, p.u0, p.v0, p.layer, p.col, a, sky, blk);
    }
  }
}

function grayCol(f: number) {
  const v = Math.round(f * 255);
  return (v << 16) | (v << 8) | v;
}
