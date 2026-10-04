// The client half of spells: every projectile the server announces is flown here too (same motion code), drawn
// as light (added onto the scene, so overlapping sparks glow brighter), with trails, impacts, explosions and
// lightning. Bombs and rocks are drawn solid. Damage numbers float up from what your spells hit.
import type { Client, RenderContext, Entity, Mc } from '../sdk';
import { spellAt, type SpellDef, type Visual, type Path, type Steer, type Orbit } from './spells';
import { displacement, steer, bounce, rayBlocks, orbitAt, type Body } from './motion';
import type { FxEvent } from './server';

interface VP extends Body {
  id: number;
  spell: SpellDef;
  visual: Visual;
  color: number;
  size: number;
  rainbow: boolean;
  px: number; py: number; pz: number;
  /** Ran into something here; waiting for the server to say what happened. */
  stopped: boolean;
  dig: boolean;
  ox: number; oy: number; oz: number;
  caster: number;
  invisible: boolean;
  orbit?: Orbit;
  /** Where a beam's light starts (its origin, or its last bounce). */
  ax: number; ay: number; az: number;
  /** Where it's been (worms draw their body along it). */
  hist: number[];
}
/** A point of light (trails, sparks, debris). */
interface Glow { x: number; y: number; z: number; px: number; py: number; pz: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; col: number; grav: number; drag: number; tex: number; fade: number }
interface Flash { x: number; y: number; z: number; age: number; life: number; size: number; col: number; ring: boolean }
interface Bolt { pts: number[]; age: number; life: number; col: number; w: number }
export interface DmgNum { x: number; y: number; z: number; a: number; crit: boolean; age: number; dx: number }

const rnd = (a = 1) => (Math.random() * 2 - 1) * a;
const hsv = (h: number) => {
  const f = (n: number) => { const k = (n + h * 6) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); };
  return (f(5) << 16) | (f(3) << 8) | f(1);
};
const mixCol = (a: number, b: number, t: number) => {
  const m = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
};

export class SpellFx {
  projs = new Map<number, VP>();
  glows: Glow[] = [];
  flashes: Flash[] = [];
  bolts: Bolt[] = [];
  nums: DmgNum[] = [];
  /** Effects quality: 1 full, 0.5 fewer particles. */
  quality = 1;
  /** Texture layers (set once the atlas exists). */
  T = { glow: 0, core: 0, star: 0, ring: 0, bomb: 0, dyn: 0, holy: 0, rock: 0, void: 0, cloud: 0, storm: 0, flesh: 0 };
  /** Spell card art as texture layers, by spell id ('icon' projectiles are drawn with it). */
  private icons = new Map<string, number>();
  ticks = 0;
  /** Projectiles and hits seen so far (tests, the console). */
  seen = { spawned: 0, hits: 0 };

  constructor(private blocks: readonly { solid: boolean }[]) {}

  private cap() { return this.quality >= 1 ? 4000 : 1500; }

  reset() {
    this.projs.clear();
    this.glows.length = this.flashes.length = this.bolts.length = this.nums.length = 0;
  }

  // ------------------------------------------------------------------ messages
  handle(e: FxEvent, client: Client) {
    switch (e.k) {
      case 's': {
        const spell = spellAt(e.s);
        if (!spell) return;
        const vp: VP = {
          id: e.i, spell, visual: spell.proj?.visual ?? 'spark', color: e.c, size: e.z, rainbow: !!e.rb,
          x: e.p[0], y: e.p[1], z: e.p[2], px: e.p[0], py: e.p[1], pz: e.p[2], vx: e.v[0], vy: e.v[1], vz: e.v[2],
          age: 0, life: e.l, bounces: e.b, gravity: e.g, drag: e.dr, bounceKeep: e.bk, homing: e.h, path: e.pa as Path,
          speed0: Math.hypot(e.v[0], e.v[1], e.v[2]), seed: e.sd, ghost: !!e.gh, fuse: !!e.fu, stopped: false, dig: !!e.dg,
          ox: e.p[0], oy: e.p[1], oz: e.p[2], caster: e.o[0] ?? -1, steer: (e.st ?? []) as Steer[], invisible: !!e.iv,
          ax: e.p[0], ay: e.p[1], az: e.p[2], hist: [],
        };
        if (e.ob) {
          vp.orbit = { around: e.ob[0] === 0 ? 'origin' : e.ob[0] === 1 ? 'caster' : 'parent', r: e.ob[1], w: e.ob[2], phase: e.ob[3], parent: e.ob[4] };
          vp.ox = e.ob[5] ?? vp.ox; vp.oy = e.ob[6] ?? vp.oy; vp.oz = e.ob[7] ?? vp.oz;
        }
        this.projs.set(e.i, vp);
        this.seen.spawned++;
        // a little flash at the wand
        if (vp.speed0 > 0 && !vp.invisible && !vp.orbit && !['tentacle', 'beam', 'worm', 'mist', 'note'].includes(vp.visual)) this.flash(vp.x, vp.y, vp.z, 0.25, vp.color, 3);
        if (vp.visual === 'blast') this.flash(vp.x, vp.y, vp.z, 0.8, vp.color, 4);
        break;
      }
      case 'y': {
        const vp = this.projs.get(e.i);
        if (!vp) return;
        vp.x = e.p[0]; vp.y = e.p[1]; vp.z = e.p[2];
        vp.vx = e.v[0]; vp.vy = e.v[1]; vp.vz = e.v[2];
        vp.stopped = false;
        if (vp.visual === 'beam') { vp.ax = vp.x; vp.ay = vp.y; vp.az = vp.z; }
        break;
      }
      case 'e': {
        const vp = this.projs.get(e.i);
        if (!vp) return;
        this.projs.delete(e.i);
        if (e.r !== 'gone') this.impact(vp, e.p[0], e.p[1], e.p[2], e.r);
        break;
      }
      case 'x': this.explosion(e.p[0], e.p[1], e.p[2], e.r, e.c); break;
      case 'f': this.named(e.n, e.p[0], e.p[1], e.p[2], e.d, client); break;
      case 'd': this.seen.hits++; this.nums.push({ x: e.p[0], y: e.p[1], z: e.p[2], a: e.a, crit: !!e.c, age: 0, dx: rnd(0.25) }); if (this.nums.length > 60) this.nums.shift(); break;
    }
  }

  // ------------------------------------------------------------------ emitters
  glow(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, col: number, life: number, o: { grav?: number; drag?: number; tex?: number; fade?: number } = {}) {
    if (this.glows.length >= this.cap()) this.glows.splice(0, 200);
    this.glows.push({ x, y, z, px: x, py: y, pz: z, vx, vy, vz, age: 0, life, size, col, grav: o.grav ?? 0, drag: o.drag ?? 0.92, tex: o.tex ?? this.T.glow, fade: o.fade ?? 1 });
  }
  flash(x: number, y: number, z: number, size: number, col: number, life: number, ring = false) {
    this.flashes.push({ x, y, z, age: 0, life, size, col, ring });
  }
  burst(x: number, y: number, z: number, n: number, col: number, speed: number, size: number, life: number, grav = 0.004) {
    n = Math.ceil(n * this.quality);
    for (let i = 0; i < n; i++) {
      const s = speed * (0.3 + Math.random() * 0.7);
      this.glow(x, y, z, rnd(s), rnd(s) + speed * 0.2, rnd(s), size * (0.6 + Math.random() * 0.8), Math.random() < 0.3 ? 0xffffff : col, life * (0.6 + Math.random() * 0.8), { grav, tex: Math.random() < 0.3 ? this.T.star : this.T.glow });
    }
  }
  /** A jagged bolt from one point to another. */
  zap(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: number, life: number, w = 0.2, jag = 0.6) {
    const n = Math.max(3, Math.round(Math.hypot(x1 - x0, y1 - y0, z1 - z0) * 1.2));
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, j = i === 0 || i === n ? 0 : jag;
      pts.push(x0 + (x1 - x0) * t + rnd(j), y0 + (y1 - y0) * t + rnd(j * 0.4), z0 + (z1 - z0) * t + rnd(j));
    }
    this.bolts.push({ pts, age: 0, life, col, w });
  }

  private impact(vp: VP, x: number, y: number, z: number, reason: string) {
    const col = this.colorOf(vp);
    vp.x = x; vp.y = y; vp.z = z;
    if (vp.invisible) return;
    switch (vp.visual) {
      case 'blast': case 'field': case 'cloud': case 'none': case 'mist': case 'note': return;
      case 'portal': case 'whitehole': this.flash(x, y, z, 1.2, col, 6, true); return;
      case 'heal': this.burst(x, y, z, 10, col, 0.08, 0.09, 14, -0.004); break;
      case 'tp': this.burst(x, y, z, 16, col, 0.12, 0.1, 14); this.flash(x, y, z, 0.8, col, 5, true); break;
      case 'dig': case 'saw': this.burst(x, y, z, 6, col, 0.1, 0.05, 8, 0.02); break;
      case 'lightning': this.flash(x, y, z, 1.2, 0xffffff, 4); this.burst(x, y, z, 14, col, 0.25, 0.08, 10); break;
      case 'liquid': case 'sand': case 'snow': this.burst(x, y, z, 6, col, 0.08, 0.06, 10, 0.03); break;
      case 'rock': this.burst(x, y, z, 8, 0x8a8a8a, 0.12, 0.06, 10, 0.03); break;
      default:
        if (reason === 'expire') { this.burst(x, y, z, 4, col, 0.04, vp.size * 0.8, 8); break; }
        this.burst(x, y, z, 8 + vp.size * 20, col, 0.1 + vp.size * 0.2, Math.max(0.05, vp.size * 0.5), 10);
        this.flash(x, y, z, 0.3 + vp.size * 1.5, col, 4);
    }
  }

  private explosion(x: number, y: number, z: number, r: number, col: number) {
    this.flash(x, y, z, r * 1.6, mixCol(col, 0xffd080, 0.5), 7);
    this.flash(x, y, z, r * 0.9, 0xffffff, 4);
    this.flash(x, y, z, r * 2.2, col, 9, true);
    this.burst(x, y, z, 30 + r * 14, col, 0.18 + r * 0.06, 0.12 + r * 0.02, 16, 0.006);
    this.burst(x, y, z, 12 + r * 6, 0xffc060, 0.1 + r * 0.05, 0.1, 12, 0.01);
  }

  private named(n: string, x: number, y: number, z: number, d: number[] | undefined, client: Client) {
    if (n === 'strike') {
      const top = d?.[0] ?? y + 12;
      this.zap(x, top, z, x, y, z, 0xd8e8ff, 7, 0.3, 1.1);
      this.zap(x, top, z, x + rnd(1.5), y + (top - y) * 0.4, z + rnd(1.5), 0xb0c8ff, 5, 0.15, 0.8);
      this.flash(x, y + 0.3, z, 2.2, 0xd0e0ff, 6);
      this.burst(x, y + 0.2, z, 20, 0xd0e0ff, 0.25, 0.08, 10);
    } else if (n === 'zap') {
      for (let i = 0; i < 5; i++) this.zap(x, y, z, x + rnd(2.2), y + rnd(1.2), z + rnd(2.2), 0xffff90, 4, 0.08, 0.35);
    } else if (n === 'heal') {
      for (let i = 0; i < 6; i++) this.glow(x + rnd(0.4), y + rnd(0.5), z + rnd(0.4), 0, 0.04, 0, 0.12, 0x60ff80, 18, { tex: this.T.star, drag: 0.95 });
    } else if (n === 'arc' && d) {
      this.zap(x, y, z, d[0], d[1], d[2], d[3] ?? 0xffff80, 4, 0.1, 0.4);
    } else if (n === 'st' && d) {
      // drips of a condition's colour
      const w2 = (d[1] ?? 0.6) / 2;
      for (let i = 0; i < 2; i++) this.glow(x + rnd(w2), y + rnd(0.3), z + rnd(w2), 0, -0.02, 0, 0.07, d[0], 14, { grav: 0.006, drag: 0.98 });
    } else if (n === 'quake') {
      for (let i = 0; i < 8; i++) this.glow(x + rnd(6), y - 0.8, z + rnd(6), rnd(0.03), 0.06, rnd(0.03), 0.18, 0x907050, 14, { grav: 0.008 });
    } else if (n === 'tp') {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        this.glow(x + Math.cos(a) * 0.6, y - 1 + (i % 6) * 0.35, z + Math.sin(a) * 0.6, -Math.sin(a) * 0.08, 0.02, Math.cos(a) * 0.08, 0.1, 0x9090ff, 14);
      }
    }
    void client;
  }

  private colorOf(vp: VP) { return vp.rainbow ? hsv(((this.ticks + vp.id * 7) % 60) / 60) : vp.color; }

  // ------------------------------------------------------------------ simulation (every client tick)
  tick(client: Client) {
    this.ticks++;
    const w = client.world;
    if (!w) return;
    const blocks = this.blocks;
    const solid = (x: number, y: number, z: number) => !!blocks[w.getId(x, y, z)]?.solid;
    const q = this.quality;
    for (const vp of this.projs.values()) {
      vp.px = vp.x; vp.py = vp.y; vp.pz = vp.z;
      vp.age++;
      // fallback: the server's end message got lost
      if (vp.age > vp.life + 40) { this.projs.delete(vp.id); continue; }
      if (vp.visual === 'cloud' && vp.age === 1) { vp.y += 4; vp.py = vp.y; }
      if (vp.visual === 'worm' && vp.age % 2 === 0) { vp.hist.push(vp.x, vp.y, vp.z); if (vp.hist.length > 30) vp.hist.splice(0, 3); }
      if (!vp.invisible) this.trail(vp, client, q);
      if (vp.orbit) {
        // circling: the centre is where it was cast, its caster, or another projectile
        const o = vp.orbit;
        let c: [number, number, number] | null = null;
        if (o.around === 'origin') c = [vp.ox, vp.oy, vp.oz];
        else if (o.around === 'caster') { const e = client.entities.find((x) => x.id === vp.caster); if (e) c = [e.x, e.y + 1.1, e.z]; }
        else { const par = this.projs.get(o.parent ?? -1); if (par) c = [par.x, par.y, par.z]; }
        if (c) { const [nx, ny, nz] = orbitAt(o, vp.age, c[0], c[1], c[2]); vp.vx = nx - vp.x; vp.vy = ny - vp.y; vp.vz = nz - vp.z; vp.x = nx; vp.y = ny; vp.z = nz; }
        continue;
      }
      if (vp.stopped || (vp.speed0 === 0 && vp.gravity === 0)) continue;
      steer(vp, vp.homing > 0 ? this.homingTarget(client, vp) : null);
      const [dx, dy, dz] = displacement(vp);
      const hit = vp.ghost || vp.dig ? null : rayBlocks(vp.x, vp.y, vp.z, dx, dy, dz, solid);
      if (hit) {
        if (vp.bounces > 0) { bounce(vp, hit); vp.ax = vp.x; vp.ay = vp.y; vp.az = vp.z; continue; }
        vp.x = hit.x; vp.y = hit.y; vp.z = hit.z;
        if (vp.fuse) { vp.vx = vp.vy = vp.vz = 0; vp.gravity = 0; continue; }
        vp.stopped = true;
        continue;
      }
      vp.x += dx; vp.y += dy; vp.z += dz;
    }
    for (let i = this.glows.length - 1; i >= 0; i--) {
      const g = this.glows[i];
      g.px = g.x; g.py = g.y; g.pz = g.z;
      g.x += g.vx; g.y += g.vy; g.z += g.vz;
      g.vy -= g.grav;
      g.vx *= g.drag; g.vy *= g.drag; g.vz *= g.drag;
      if (++g.age >= g.life) this.glows.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) if (++this.flashes[i].age >= this.flashes[i].life) this.flashes.splice(i, 1);
    for (let i = this.bolts.length - 1; i >= 0; i--) if (++this.bolts[i].age >= this.bolts[i].life) this.bolts.splice(i, 1);
    for (let i = this.nums.length - 1; i >= 0; i--) if (++this.nums[i].age >= 28) this.nums.splice(i, 1);
  }

  private homingTarget(client: Client, vp: VP) {
    let best: Entity | null = null, bd = 16 * 16;
    for (const e of client.entities) {
      if (!(e as unknown as { hostile?: boolean }).hostile || (e as unknown as { dead?: boolean }).dead || e.id === vp.caster) continue;
      const d = (e.x - vp.x) ** 2 + (e.y - vp.y) ** 2 + (e.z - vp.z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { x: best.x, y: best.y + best.height / 2, z: best.z } : null;
  }

  /** What a projectile leaves behind each tick. */
  private trail(vp: VP, client: Client, q: number) {
    const col = this.colorOf(vp), x = vp.x, y = vp.y, z = vp.z, s = vp.size;
    const chance = (p: number) => Math.random() < p * q;
    switch (vp.visual) {
      case 'spark': case 'spit': case 'burst': case 'bubble': case 'dig': case 'ray':
        if (chance(0.9)) this.glow(x, y, z, rnd(0.02), rnd(0.02), rnd(0.02), s * 0.9, col, 7);
        break;
      case 'arrow': case 'bolt': case 'drill': case 'lance':
        if (chance(1)) this.glow(x, y, z, rnd(0.01), rnd(0.01), rnd(0.01), s * 0.9, col, 6);
        if (chance(0.5)) this.glow(x, y, z, rnd(0.04), rnd(0.04), rnd(0.04), s * 0.5, 0xffffff, 5, { tex: this.T.star });
        break;
      case 'orb':
        if (chance(1)) this.glow(x + rnd(s), y + rnd(s), z + rnd(s), rnd(0.02), rnd(0.02), rnd(0.02), s * 0.7, col, 10);
        break;
      case 'fire':
        if (chance(1)) this.glow(x, y, z, rnd(0.03), 0.02, rnd(0.03), s * 1.4, Math.random() < 0.5 ? col : 0xffc040, 8);
        // the game's own flames and smoke, once it's clear of the caster's face
        if (vp.age > 2 && chance(0.6)) client.particles?.flame(x + rnd(s * 0.5), y + rnd(s * 0.5), z + rnd(s * 0.5));
        if (vp.age > 4 && chance(0.3)) client.particles?.smoke(x, y, z);
        break;
      case 'bomb': case 'dynamite': case 'holy':
        if (chance(0.8)) this.glow(x, y + s * 1.1, z, rnd(0.05), 0.04, rnd(0.05), 0.07, 0xffc040, 6, { tex: this.T.star, grav: 0.004 });
        if (vp.visual === 'holy' && chance(0.5)) this.glow(x + rnd(0.6), y + rnd(0.6), z + rnd(0.6), 0, 0.02, 0, 0.1, 0xffe080, 12, { tex: this.T.star });
        break;
      case 'hole':
        for (let i = 0; i < 3; i++) {
          if (!chance(1)) continue;
          const a = Math.random() * Math.PI * 2, r = 1.2 + Math.random(), h = rnd(0.8);
          this.glow(x + Math.cos(a) * r, y + h, z + Math.sin(a) * r, -Math.cos(a) * 0.12 - Math.sin(a) * 0.1, -h * 0.1, -Math.sin(a) * 0.12 + Math.cos(a) * 0.1, 0.08, Math.random() < 0.5 ? col : 0x501080, 10, { drag: 0.98 });
        }
        break;
      case 'saw':
        for (let i = 0; i < 2; i++) if (chance(1)) this.glow(x, y, z, rnd(0.15), rnd(0.15), rnd(0.15), 0.04, 0xffffc0, 4, { tex: this.T.star, grav: 0.01 });
        break;
      case 'lightning':
        if (chance(1)) this.glow(x, y, z, 0, 0, 0, s * 1.5, col, 4);
        if (chance(0.3)) this.zap(x, y, z, x + rnd(1), y + rnd(1), z + rnd(1), col, 3, 0.06, 0.3);
        break;
      case 'heal':
        if (chance(0.7)) this.glow(x, y, z, rnd(0.02), 0.02, rnd(0.02), s * 0.8, col, 10, { tex: this.T.star });
        break;
      case 'tp':
        if (chance(1)) { const a = vp.age * 0.8; this.glow(x + Math.cos(a) * 0.25, y + Math.sin(a) * 0.25, z, 0, 0, 0, s * 0.7, col, 8); }
        break;
      case 'cross': case 'tentacle':
        if (chance(0.6)) this.glow(x, y, z, rnd(0.03), rnd(0.03), rnd(0.03), s * 0.4, col, 8);
        break;
      case 'field': {
        const r = vp.size;
        if (chance(1)) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r; this.glow(x + Math.cos(a) * d, y - 0.4, z + Math.sin(a) * d, 0, 0.03, 0, 0.09, col, 16, { tex: Math.random() < 0.5 ? this.T.star : this.T.glow, drag: 0.98 }); }
        if (vp.spell.id === 'circle_of_fire' && chance(0.5)) { const a = Math.random() * Math.PI * 2; client.particles?.flame(x + Math.cos(a) * r, y - 0.3, z + Math.sin(a) * r); }
        break;
      }
      case 'cloud': {
        const r = vp.size;
        const thunder = vp.spell.id === 'thundercloud';
        for (let i = 0; i < 3; i++) if (chance(thunder ? 0.4 : 1)) this.glow(x + rnd(r), y - 0.4, z + rnd(r), 0, -0.45, 0, 0.05, 0x6080ff, 14, { drag: 1, fade: 0.7 });
        if (thunder && chance(0.06)) this.zap(x + rnd(r), y, z + rnd(r), x + rnd(r), y - 0.3, z + rnd(r), 0xc0d0ff, 3, 0.05, 0.3);
        break;
      }
      case 'icon':
        if (chance(0.25)) this.glow(x + rnd(s), y + rnd(s), z + rnd(s), rnd(0.02), 0.01, rnd(0.02), 0.06, col, 8, { tex: this.T.star });
        if ((vp.spell.id === 'nuke' || vp.spell.id === 'giga_nuke' || vp.spell.id === 'magic_missile') && chance(0.6)) client.particles?.smoke(x, y, z);
        break;
      case 'portal': case 'whitehole':
        if (chance(1)) { const a = Math.random() * Math.PI * 2, rr = s * 2.5; this.glow(x + Math.cos(a) * rr, y + rnd(rr * 0.5), z + Math.sin(a) * rr, -Math.cos(a) * 0.05, 0, -Math.sin(a) * 0.05, 0.07, col, 10, { tex: this.T.star }); }
        break;
      case 'worm':
        if (chance(0.5)) this.glow(x + rnd(s), y + rnd(s), z + rnd(s), rnd(0.06), 0.05, rnd(0.06), 0.08, 0x806040, 12, { grav: 0.01 });
        break;
      case 'note':
        if (chance(0.3)) this.glow(x, y, z, rnd(0.02), 0.03, rnd(0.02), 0.08, col, 12, { tex: this.T.star });
        break;
      case 'liquid': case 'sand': case 'snow':
        if (chance(0.7)) this.glow(x, y, z, rnd(0.02), 0, rnd(0.02), s * 0.8, col, 6, { grav: 0.02, fade: 0.8 });
        if (vp.visual === 'liquid' && chance(0.2)) client.particles?.drip(x, y, z, vp.color !== 0x3070ff);
        break;
    }
  }

  // ------------------------------------------------------------------ drawing
  private lerp(vp: VP, t: number): [number, number, number] {
    return [vp.px + (vp.x - vp.px) * t, vp.py + (vp.y - vp.py) * t, vp.pz + (vp.z - vp.pz) * t];
  }

  /** A camera-facing ribbon from a to b. */
  private ribbon(r: RenderContext, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, layer: number, col: number, alpha: number) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-4) return;
    dx /= l; dy /= l; dz /= l;
    const cx = (ax + bx) / 2 - r.cam.x, cy = (ay + by) / 2 - r.cam.y, cz = (az + bz) / 2 - r.cam.z;
    let sx = dy * cz - dz * cy, sy = dz * cx - dx * cz, sz = dx * cy - dy * cx;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx = (sx / sl) * w * 0.5; sy = (sy / sl) * w * 0.5; sz = (sz / sl) * w * 0.5;
    r.quad([ax - sx, ay - sy, az - sz, bx - sx, by - sy, bz - sz, bx + sx, by + sy, bz + sz, ax + sx, ay + sy, az + sz], layer, [0, 0, 1, 1], col, alpha, [15, 15]);
  }

  /** The glow pass: projectiles, sparks, flashes, bolts. */
  drawGlow(r: RenderContext) {
    const T = this.T, t = r.partial, L: [number, number] = [15, 15], time = r.time;
    const cam = r.cam;
    // light right in front of the eye would fill the screen: shrink it the closer it gets
    const bb = (x: number, y: number, z: number, size: number, layer: number, col: number, a = 1) => {
      const dd = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
      if (dd < size * 1.5) size = Math.max(0.02, dd / 1.5);
      if (dd < 2) a *= Math.max(0.15, dd / 2);
      r.billboard(x, y, z, size, layer, col, L, a);
    };
    for (const vp of this.projs.values()) {
      if (vp.invisible) continue;
      const [x, y, z] = this.lerp(vp, t);
      const col = this.colorOf(vp), s = vp.size;
      const sp = Math.hypot(vp.vx, vp.vy, vp.vz) || 1;
      const dx = vp.vx / sp, dy = vp.vy / sp, dz = vp.vz / sp;
      const tail = (len: number, w: number, layer: number, c: number, a: number) => this.ribbon(r, x - dx * len, y - dy * len, z - dz * len, x, y, z, w, layer, c, a);
      switch (vp.visual) {
        case 'spark': case 'spit': case 'burst': case 'dig':
          bb(x, y, z, s * 3.2, T.glow, col, 0.9); bb(x, y, z, s * 1.2, T.core, mixCol(col, 0xffffff, 0.6)); break;
        case 'arrow': tail(0.9, 0.14, T.glow, col, 0.9); bb(x, y, z, s * 2.4, T.glow, col, 0.8); bb(x, y, z, s, T.core, 0xffffff); break;
        case 'wood': tail(0.7, 0.07, T.core, 0x6a4a2a, 0.5); break;
        case 'bolt': tail(0.6, 0.2, T.glow, col, 0.8); bb(x, y, z, s * 4, T.glow, col, 0.8); bb(x, y, z, s * 1.4, T.core, 0xffffff); break;
        case 'orb': { const k = 3.2 + Math.sin(time * 0.6 + vp.id) * 0.4; bb(x, y, z, s * k, T.glow, col, 0.75); bb(x, y, z, s * 1.6, T.core, mixCol(col, 0xffffff, 0.7)); bb(x, y, z, s * 2.4, T.ring, col, 0.5); break; }
        case 'fire': { const k = 4 + Math.sin(time * 1.7 + vp.id) * 0.6; bb(x, y, z, s * k, T.glow, col, 0.85); bb(x, y, z, s * 1.8, T.core, 0xffe080); break; }
        case 'bomb': case 'dynamite': case 'holy': if (Math.floor(time / 3) % 2 === 0) bb(x, y + s * 1.1, z, 0.18, T.star, 0xffd060); if (vp.visual === 'holy') bb(x, y, z, s * 5, T.glow, 0xffe080, 0.35); break;
        case 'rock': break;
        case 'hole': bb(x, y, z, s * 4.5, T.ring, col, 0.8); bb(x, y, z, s * 6, T.glow, 0x6020c0, 0.5); break;
        case 'saw': bb(x, y, z, 0.35, T.star, 0xffffff, 0.9); break;
        case 'drill': tail(1.2, 0.18, T.glow, col, 1); bb(x, y, z, s * 3, T.core, 0xffffff); break;
        case 'lightning': tail(2.5, 0.25, T.glow, col, 1); tail(2.2, 0.08, T.core, 0xffffff, 1); break;
        case 'lance': tail(3, 0.16, T.glow, col, 1); tail(2.8, 0.06, T.core, 0xffffff, 1); break;
        case 'ray': tail(1.6, 0.14, T.glow, col, 1); break;
        case 'bubble': bb(x, y, z, s * 2.4, T.ring, col, 0.9); bb(x, y, z, s * 1.6, T.glow, col, 0.3); break;
        case 'heal': bb(x, y, z, s * 3, T.glow, col, 0.8); bb(x, y, z, s * 1.3, T.star, 0xffffff); break;
        case 'tp': bb(x, y, z, s * 3.5, T.glow, col, 0.8); bb(x, y, z, s * 2.5, T.ring, 0xffffff, 0.6); break;
        case 'cross': {
          // two bars turning about the direction of flight
          let ux = -dz, uz = dx;
          const ul = Math.hypot(ux, uz) || 1;
          ux /= ul; uz /= ul;
          const vx = dy * uz, vy = dz * ux - dx * uz, vz = -dy * ux;
          const a = time * 0.4, L2 = 0.55;
          for (const b of [a, a + Math.PI / 2]) {
            const cx = (ux * Math.cos(b) + vx * Math.sin(b)) * L2, cy = vy * Math.sin(b) * L2, cz = (uz * Math.cos(b) + vz * Math.sin(b)) * L2;
            this.ribbon(r, x - cx, y - cy, z - cz, x + cx, y + cy, z + cz, 0.16, T.glow, col, 1);
          }
          bb(x, y, z, s * 2, T.glow, col, 0.6);
          break;
        }
        case 'tentacle': {
          const n = 6;
          let lx = vp.ox, ly = vp.oy, lz = vp.oz;
          for (let i = 1; i <= n; i++) {
            const f = i / n, wob = Math.sin(f * Math.PI) * 0.25 * Math.sin(time * 0.8 + i);
            const nx = vp.ox + (x - vp.ox) * f + wob, ny = vp.oy + (y - vp.oy) * f + wob * 0.5, nz = vp.oz + (z - vp.oz) * f - wob;
            this.ribbon(r, lx, ly, lz, nx, ny, nz, 0.16 * (1 - f * 0.5), T.glow, col, 0.9);
            lx = nx; ly = ny; lz = nz;
          }
          break;
        }
        case 'field': {
          const R = vp.size, n = 28;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + time * 0.05;
            bb(x + Math.cos(a) * R, y - 0.4 + Math.sin(time * 0.2 + i) * 0.05, z + Math.sin(a) * R, 0.22, T.glow, col, 0.7);
          }
          // the disc on the ground
          const yy = y - 0.45;
          r.quad([x - R, yy, z - R, x + R, yy, z - R, x + R, yy, z + R, x - R, yy, z + R], T.ring, [0, 0, 1, 1], col, 0.35, L);
          break;
        }
        case 'liquid': case 'sand': case 'snow': bb(x, y, z, s * 2.2, T.core, col, 0.85); break;
        case 'beam': {
          // a line of light from where it started (or last bounced) to where it is
          const fade = Math.max(0.3, 1 - vp.age / (vp.life + 2));
          this.ribbon(r, vp.ax, vp.ay, vp.az, x, y, z, s * 3, T.glow, col, fade);
          this.ribbon(r, vp.ax, vp.ay, vp.az, x, y, z, s, T.core, 0xffffff, fade);
          bb(x, y, z, s * 4, T.glow, col, 0.8);
          break;
        }
        case 'mist':
          for (let i = 0; i < 5; i++) { const a = time * 0.05 + i * 1.3 + vp.id; bb(x + Math.cos(a) * s * 0.5, y + Math.sin(a * 1.3) * 0.3, z + Math.sin(a) * s * 0.5, s * 1.6, T.glow, col, 0.28); }
          break;
        case 'portal': {
          const k = 1 + Math.sin(time * 0.3 + vp.id) * 0.1;
          bb(x, y, z, s * 3 * k, T.ring, col, 0.9); bb(x, y, z, s * 2.2, T.glow, col, 0.6); bb(x, y, z, s * 1.4, T.ring, 0xffffff, 0.4);
          break;
        }
        case 'whitehole': bb(x, y, z, s * 5, T.glow, 0xfff8e0, 0.9); bb(x, y, z, s * 3, T.core, 0xffffff, 1); bb(x, y, z, s * 6, T.ring, 0xffe0a0, 0.5); break;
        case 'icon': case 'note': bb(x, y, z, Math.max(0.3, s * 2.5), T.glow, col, vp.visual === 'note' ? 0.4 : 0.25); break;
        case 'worm': bb(x, y, z, s * 2.5, T.glow, col, 0.35); break;
        default: break;
      }
    }
    for (const g of this.glows) {
      const f = (g.age + t) / g.life;
      const x = g.px + (g.x - g.px) * t, y = g.py + (g.y - g.py) * t, z = g.pz + (g.z - g.pz) * t;
      bb(x, y, z, g.size * (1 - f * 0.5), g.tex, g.col, Math.max(0, 1 - f) * g.fade);
    }
    for (const fl of this.flashes) {
      const f = (fl.age + t) / fl.life;
      if (fl.ring) {
        const R = fl.size * (0.3 + f * 0.7), yy = fl.y;
        r.quad([fl.x - R, yy, fl.z - R, fl.x + R, yy, fl.z - R, fl.x + R, yy, fl.z + R, fl.x - R, yy, fl.z + R], T.ring, [0, 0, 1, 1], fl.col, Math.max(0, 1 - f) * 0.8, L);
      } else bb(fl.x, fl.y, fl.z, fl.size * (0.6 + f * 0.6), T.glow, fl.col, Math.max(0, 1 - f));
    }
    for (const b of this.bolts) {
      const a = Math.max(0, 1 - (b.age + t) / b.life);
      for (let i = 0; i + 5 < b.pts.length; i += 3) {
        const p = b.pts;
        this.ribbon(r, p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5], b.w * 2.5, T.glow, b.col, a * 0.8);
        this.ribbon(r, p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5], b.w * 0.6, T.core, 0xffffff, a);
      }
    }
  }

  /** A small voxel cloud: puffs placed by the projectile's id, swelling in and shrinking away. */
  private drawCloud(r: RenderContext, vp: VP) {
    const t = r.partial, age = vp.age + t;
    const k = Math.min(1, age / 10, (vp.life + 2 - age) / 15);
    if (k <= 0) return;
    const layer = vp.spell.id === 'thundercloud' ? this.T.storm : this.T.cloud;
    const tex = [layer, layer, layer, layer, layer, layer];
    let h = vp.id * 2654435761;
    const rand = () => ((h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0) / 4294967296);
    const boxes = [];
    for (let i = 0; i < 9; i++) {
      const R = vp.size * (i === 0 ? 0 : 0.8), a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * R;
      const w = (1 + rand() * 0.9) * 16 * k * (i === 0 ? 1.3 : 1), hh = (0.5 + rand() * 0.5) * 16 * k;
      const cx = 8 + Math.cos(a) * d * 16 + Math.sin(age * 0.05 + i) * 1.5, cz = 8 + Math.sin(a) * d * 16, cy = 8 + (rand() - 0.5) * 6;
      boxes.push({ x0: cx - w / 2, y0: cy - hh / 2, z0: cz - w / 2, x1: cx + w / 2, y1: cy + hh / 2, z1: cz + w / 2, tex });
    }
    r.boxes(boxes, vp.x - 0.5, vp.y - 0.5, vp.z - 0.5, null, [15, 0]);
  }

  /** The solid pass: things that are objects rather than light. */
  drawSolid(r: RenderContext, M: Mc['math']) {
    const t = r.partial, T = this.T;
    for (const vp of this.projs.values()) {
      const v = vp.visual;
      if (vp.invisible) continue;
      if (v === 'cloud') { this.drawCloud(r, vp); continue; }
      if (v === 'icon' || v === 'note') {
        // the spell's own card art, as a sprite
        const id = vp.spell.sprite ?? vp.spell.id;
        let layer = this.icons.get(id);
        if (layer === undefined) { layer = r.tex(`wands:sprite_${id}`); this.icons.set(id, layer); }
        const [x, y, z] = this.lerp(vp, t);
        const bob = v === 'note' ? Math.sin((vp.age + t) * 0.4) * 0.05 : 0;
        r.billboard(x, y + bob, z, Math.max(0.35, vp.size * 2.2), layer, 0xffffff, r.light(Math.floor(x), Math.floor(y), Math.floor(z)));
        continue;
      }
      if (v === 'worm') {
        const [x, y, z] = this.lerp(vp, t), seg = vp.size * 16, tex = [T.flesh, T.flesh, T.flesh, T.flesh, T.flesh, T.flesh];
        const pts = [...vp.hist, x, y, z];
        for (let i = 0; i + 2 < pts.length; i += 3) {
          const k = seg * (0.5 + 0.5 * (i / pts.length));
          r.boxes([{ x0: 8 - k / 2, y0: 8 - k / 2, z0: 8 - k / 2, x1: 8 + k / 2, y1: 8 + k / 2, z1: 8 + k / 2, tex }], pts[i] - 0.5, pts[i + 1] - 0.5, pts[i + 2] - 0.5);
        }
        continue;
      }
      if (v !== 'bomb' && v !== 'dynamite' && v !== 'holy' && v !== 'rock' && v !== 'hole') continue;
      const [x, y, z] = this.lerp(vp, t);
      const s = vp.size * 16;
      const layer = v === 'bomb' ? T.bomb : v === 'dynamite' ? T.dyn : v === 'holy' ? T.holy : v === 'rock' ? T.rock : T.void;
      const tex = [layer, layer, layer, layer, layer, layer];
      const box = v === 'dynamite'
        ? { x0: 8 - s * 0.35, y0: 8 - s * 0.35, z0: 8 - s, x1: 8 + s * 0.35, y1: 8 + s * 0.35, z1: 8 + s, tex }
        : { x0: 8 - s * 0.5, y0: 8 - s * 0.5, z0: 8 - s * 0.5, x1: 8 + s * 0.5, y1: 8 + s * 0.5, z1: 8 + s * 0.5, tex };
      const m = M.mat4();
      M.identity(m);
      M.translate(m, m, 0.5, 0.5, 0.5);
      // rolling along its path
      M.rotateY(m, m, Math.atan2(vp.vx, vp.vz));
      M.rotateX(m, m, (vp.age + t) * Math.hypot(vp.vx, vp.vz) * 2);
      M.translate(m, m, -0.5, -0.5, -0.5);
      r.boxes([box], x - 0.5, y - 0.5, z - 0.5, m, v === 'hole' ? [0, 0] : undefined);
    }
  }
}
