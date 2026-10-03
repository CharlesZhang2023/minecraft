import type { World } from '../world/world';
import type { DynMesh } from '../render/gl';
import { BLOCKS, OPAQUE, SOLID, tex } from '../world/blocks';
import { Random } from '../noise';
import type { FireworkExplosion } from './items';

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
  kind: 'block' | 'smoke' | 'flame' | 'bubble' | 'splash' | 'crit' | 'explosion' | 'drip' | 'rain' | 'note' | 'heart' | 'portal' | 'spell' | 'spark' | 'flash';
  frames?: number;
  friction: number;
  /** Firework sparks: the colour they fade to, whether they leave a trail of sparks, and whether they flicker. */
  fade?: number;
  trail?: boolean;
  twinkle?: boolean;
}

/** Drawn with blending in a second pass (soft edges, fading out). */
const BLENDED = new Set<Particle['kind']>(['spark', 'flash']);
/** Outlines of the star- and creeper-shaped bursts (vanilla's), as half-profiles spun around the vertical. */
const STAR_SHAPE = [[0, 1], [0.3455, 0.309], [0.9511, 0.309], [0.3795918367346939, -0.12653061224489795], [0.6122448979591837, -0.8040816326530612], [0, -0.35918367346938773]];
const CREEPER_SHAPE = [[0, 0.2], [0.2, 0.2], [0.2, 0.6], [0.6, 0.6], [0.6, 0.2], [0.2, 0.2], [0.2, 0], [0.4, 0], [0.4, -0.6], [0.2, -0.6], [0.2, -0.4], [0, -0.4]];
const gauss = () => {
  let u = 0, v = 0;
  while (u === 0) u = rng.next();
  while (v === 0) v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

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
  spark: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => tex('particle_spark_' + i)),
  flash: tex('particle_flash'),
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
    if (this.list.length > 8000) this.list.shift();
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

  /** Bits of food flying from a mouth (eating). */
  crumbs(x: number, y: number, z: number, dx: number, dz: number, layer: number) {
    for (let i = 0; i < 5; i++) {
      const u0 = Math.random() * 0.7, v0 = Math.random() * 0.7;
      this.add({ x, y, z, vx: (Math.random() - 0.5) * 0.1 + dx * 0.05, vy: 0.1, vz: (Math.random() - 0.5) * 0.1 + dz * 0.05, layer, u0, v0, u1: u0 + 0.25, v1: v0 + 0.25, size: 0.05, life: 10 + Math.floor(Math.random() * 10) });
    }
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

  // ---------------------------------------------------------------- fireworks (vanilla's ParticleFirework)
  /** One firework spark flying off from (x, y, z). */
  spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, col = 0xffffff, fade?: number, trail = false, twinkle = false) {
    return this.add({
      x, y, z, vx, vy, vz, kind: 'spark', layer: PT.spark[7], size: 0.075 * (rng.next() * 0.5 + 0.5) * 2, life: 48 + rng.int(12),
      gravity: 0.004, friction: 0.91, col, fade, trail, twinkle, fullbright: true, collide: true,
    });
  }

  /** The trail behind a climbing rocket. */
  rocketTrail(x: number, y: number, z: number, vy: number) {
    this.spark(x, y - 0.3, z, gauss() * 0.05, -vy * 0.5, gauss() * 0.05);
  }

  /** A rocket bursting: each star's pattern of sparks in its colours, and a flash. */
  firework(x: number, y: number, z: number, vx: number, vy: number, vz: number, ex: FireworkExplosion[]) {
    if (!ex?.length) {
      for (let i = 0; i < 6; i++) this.smoke(x + (rng.next() - 0.5) * 0.5, y + (rng.next() - 0.5) * 0.5, z + (rng.next() - 0.5) * 0.5, true);
      return;
    }
    this.add({ x, y, z, kind: 'flash', layer: PT.flash, size: 0, life: 4, gravity: 0, collide: false, fullbright: true, alpha: 0.6 });
    for (const e of ex) {
      const colors = e.colors?.length ? e.colors : [0xffffff];
      const one = (dx: number, dy: number, dz: number) => {
        const fade = e.fade?.length ? e.fade[rng.int(e.fade.length)] : undefined;
        this.spark(x, y, z, dx, dy, dz, colors[rng.int(colors.length)], fade, !!e.trail, !!e.twinkle);
      };
      switch (e.shape) {
        case 1: this.ball(0.5, 4, one); break;
        case 2: this.shaped(0.5, STAR_SHAPE, false, one); break;
        case 3: this.shaped(0.5, CREEPER_SHAPE, true, one); break;
        case 4: {
          const ox = gauss() * 0.05, oz = gauss() * 0.05;
          for (let i = 0; i < 70; i++) one(vx * 0.5 + gauss() * 0.15 + ox, vy * 0.5 + rng.next() * 0.5, vz * 0.5 + gauss() * 0.15 + oz);
          break;
        }
        default: this.ball(0.25, 2, one);
      }
    }
  }

  /** A hollow ball of sparks. */
  private ball(speed: number, size: number, one: (dx: number, dy: number, dz: number) => void) {
    for (let i = -size; i <= size; i++)
      for (let j = -size; j <= size; j++)
        for (let k = -size; k <= size; k++) {
          const dx = j + (rng.next() - rng.next()) * 0.5, dy = i + (rng.next() - rng.next()) * 0.5, dz = k + (rng.next() - rng.next()) * 0.5;
          const d = Math.hypot(dx, dy, dz) / speed + gauss() * 0.05;
          one(dx / d, dy / d, dz / d);
          if (i !== -size && i !== size && j !== -size && j !== size) k += size * 2 - 1;
        }
  }

  /** A flat outline spun to three angles around the vertical (a star, or a creeper's face). */
  private shaped(speed: number, shape: number[][], creeper: boolean, one: (dx: number, dy: number, dz: number) => void) {
    one(shape[0][0] * speed, shape[0][1] * speed, 0);
    const a0 = rng.next() * Math.PI, step = creeper ? 0.034 : 0.34;
    for (let i = 0; i < 3; i++) {
      const a = a0 + i * Math.PI * step;
      let px = shape[0][0], py = shape[0][1];
      for (let j = 1; j < shape.length; j++) {
        const [nx, ny] = shape[j];
        for (let f = 0.25; f <= 1; f += 0.25) {
          const r = (px + (nx - px) * f) * speed, h = (py + (ny - py) * f) * speed;
          for (const side of [-1, 1]) one(r * Math.cos(a) * side, h, r * Math.sin(a) * side);
        }
        px = nx; py = ny;
      }
    }
  }

  /** Coloured potion swirl with an explicit velocity. */
  swirl(x: number, y: number, z: number, vx: number, vy: number, vz: number, col: number) {
    this.add({ x, y, z, vx, vy, vz, kind: 'spell', layer: PT.spell, size: 0.06 + rng.next() * 0.03, life: 16 + rng.int(14), gravity: -0.002, col, collide: false, friction: 0.92 });
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
      if (p.kind === 'spark') this.sparkTick(p);
    }
  }

  /** Sparks shrink as they burn, fade (to their fade colour) in their second half, and may drop a trail. */
  private sparkTick(p: Particle) {
    const half = p.life >> 1;
    p.layer = PT.spark[Math.max(0, 7 - Math.floor((p.age * 8) / p.life))];
    if (p.age > half) {
      p.alpha = 1 - (p.age - half) / p.life;
      if (p.fade !== undefined) {
        const c = p.col, f = p.fade;
        const ch = (sh: number) => { const a = (c >> sh) & 255; return Math.round(a + (((f >> sh) & 255) - a) * 0.2) << sh; };
        p.col = ch(16) | ch(8) | ch(0);
      }
    }
    if (p.trail && p.age < half && (p.age + p.life) % 2 === 0) {
      const q = this.spark(p.x, p.y, p.z, 0, 0, 0, p.col, p.fade, false, p.twinkle);
      q.life = p.life;
      q.age = half;
      q.alpha = p.alpha;
      q.px = p.x; q.py = p.y; q.pz = p.z;
    }
  }

  /** Build camera-facing quads. Positions are camera-relative. */
  build(mesh: DynMesh, cx: number, cy: number, cz: number, t: number, yaw: number, pitch: number, blended = false) {
    const ry = (yaw * Math.PI) / 180, rp = (pitch * Math.PI) / 180;
    // camera right & up vectors
    const rx = -Math.cos(ry), rz = -Math.sin(ry);
    const ux = -Math.sin(ry) * Math.sin(rp), uy = Math.cos(rp), uz = Math.cos(ry) * Math.sin(rp);
    for (const p of this.list) {
      if (BLENDED.has(p.kind) !== blended) continue;
      // twinkling sparks blink out every few ticks once they're a third of the way through
      if (p.twinkle && p.age >= p.life / 3 && Math.floor((p.age + p.life) / 3) % 2 !== 0) continue;
      const x = p.px + (p.x - p.px) * t - cx, y = p.py + (p.y - p.py) * t - cy, z = p.pz + (p.z - p.pz) * t - cz;
      let s = p.size;
      let alpha = p.alpha;
      if (p.kind === 'flash') {
        const f = p.age + t - 1;
        s = 7.1 * Math.sin(Math.max(0, f) * 0.25 * Math.PI);
        alpha = Math.max(0, 0.6 - f * 0.25 * 0.5);
      }
      if (p.kind === 'smoke' || p.kind === 'flame') s *= Math.min(1, ((p.age + t) / p.life) * 32 * 0.5 + 0.5) * (p.kind === 'flame' ? 1 - ((p.age + t) / p.life) * 0.5 : 1);
      let sky = 15, blk = 15;
      if (!p.fullbright) [sky, blk] = this.world.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      const a = p.kind === 'smoke' ? 1 : alpha;
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
