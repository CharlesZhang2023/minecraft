// A sub-level as an entity: it is saved with the world and replicated to players like any entity, which carries its
// pose to every client. Its blocks are in its plot in the shipyard (shipyard.ts); the entity's position is where
// its pivot is in the world.
import { Entity } from '../entity/entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { type Pose, type Quat, slerp, toWorld, toLocal } from './pose';
import { plotCenter } from './shipyard';

export class SubLevel extends Entity {
  typeName = 'SubLevel';
  persist = true;
  /** plot index in the shipyard */
  plot = -1;
  /** the pivot in local (plot) coordinates */
  lx = 0; ly = 0; lz = 0;
  /** orientation */
  qx = 0; qy = 0; qz = 0; qw = 1;
  /** previous tick's orientation (interpolation; not replicated) */
  pqx = 0; pqy = 0; pqz = 0; pqw = 1;
  /** local block bounds, inclusive: x0 y0 z0 x1 y1 z1 */
  bounds = [0, 0, 0, 0, 0, 0];
  /** shown on the HUD (the ship's name) */
  label = '';
  /** blocks in it, and its mass (kpg: a plain block is 1) */
  blockCount = 0;
  mass = 0;
  /** held still: physics leaves it where it is */
  anchored = false;
  /** linear and angular velocity, world units per second (for the HUD and carrying) */
  lin = [0, 0, 0];
  ang = [0, 0, 0];
  /** who made it (the player's name) */
  owner = '';
  /** mods' own saved data for this sub-level */
  data: Record<string, unknown> = {};

  constructor(world: World, public game: Game) {
    super(world);
    this.width = 1;
    this.height = 1;
  }

  get q(): Quat { return { x: this.qx, y: this.qy, z: this.qz, w: this.qw }; }
  set q(q: Quat) { this.qx = q.x; this.qy = q.y; this.qz = q.z; this.qw = q.w; }
  get pq(): Quat { return { x: this.pqx, y: this.pqy, z: this.pqz, w: this.pqw }; }

  /** Where it is now. */
  pose(): Pose {
    return { tx: this.x, ty: this.y, tz: this.z, q: this.q, lx: this.lx, ly: this.ly, lz: this.lz };
  }
  /** Where it was a tick ago. */
  prevPose(): Pose {
    return { tx: this.px, ty: this.py, tz: this.pz, q: this.pq, lx: this.lx, ly: this.ly, lz: this.lz };
  }
  /** Between the two, for drawing (t = 0..1 of the tick). */
  poseAt(t: number): Pose {
    return { tx: this.lerpX(t), ty: this.lerpY(t), tz: this.lerpZ(t), q: t >= 1 ? this.q : slerp(this.pq, this.q, t), lx: this.lx, ly: this.ly, lz: this.lz };
  }
  toWorld(x: number, y: number, z: number) { return toWorld(this.pose(), x, y, z); }
  toLocal(x: number, y: number, z: number) { return toLocal(this.pose(), x, y, z); }

  /** The local block bounds widened to whole blocks (x1 etc. exclusive). */
  localBox() {
    const b = this.bounds;
    return { x0: b[0], y0: b[1], z0: b[2], x1: b[3] + 1, y1: b[4] + 1, z1: b[5] + 1 };
  }
  /** Half the diagonal of its blocks: everything is within this of the pivot, give or take. */
  radius() {
    const b = this.bounds;
    const dx = Math.max(Math.abs(b[0] - this.lx), Math.abs(b[3] + 1 - this.lx));
    const dy = Math.max(Math.abs(b[1] - this.ly), Math.abs(b[4] + 1 - this.ly));
    const dz = Math.max(Math.abs(b[2] - this.lz), Math.abs(b[5] + 1 - this.lz));
    return Math.hypot(dx, dy, dz);
  }
  /** The plot's chunks in use (with one ring around them). */
  plotChunks() {
    const b = this.bounds;
    return { cx0: (b[0] >> 4) - 1, cz0: (b[2] >> 4) - 1, cx1: (b[3] >> 4) + 1, cz1: (b[5] >> 4) + 1 };
  }
  plotCenter() { return plotCenter(this.plot); }

  override preTick() {
    // on the server the physics step moves it (and keeps last tick's pose); puppets copy it here
    if (this.world.role === 'server') { this.age++; return; }
    super.preTick();
    this.pqx = this.qx; this.pqy = this.qy; this.pqz = this.qz; this.pqw = this.qw;
  }

  /** Physics moves it; nothing else does. */
  override move() {}

  toJSON() {
    return {
      type: 'sublevel', x: this.x, y: this.y, z: this.z, plot: this.plot, l: [this.lx, this.ly, this.lz], q: [this.qx, this.qy, this.qz, this.qw],
      bounds: this.bounds, label: this.label, blocks: this.blockCount, mass: this.mass, anchored: this.anchored, lin: this.lin, ang: this.ang,
      owner: this.owner, data: this.data,
    };
  }
  load(d: Record<string, unknown>) {
    const n = (v: unknown, f = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
    this.setPos(n(d.x), n(d.y), n(d.z));
    this.plot = n(d.plot, -1);
    const l = (d.l as number[]) ?? [];
    this.lx = n(l[0]); this.ly = n(l[1]); this.lz = n(l[2]);
    const q = (d.q as number[]) ?? [];
    this.qx = this.pqx = n(q[0]); this.qy = this.pqy = n(q[1]); this.qz = this.pqz = n(q[2]); this.qw = this.pqw = n(q[3], 1);
    if (Array.isArray(d.bounds) && d.bounds.length === 6) this.bounds = d.bounds.map((v) => n(v));
    this.label = String(d.label ?? '');
    this.blockCount = n(d.blocks);
    this.mass = n(d.mass);
    this.anchored = !!d.anchored;
    if (Array.isArray(d.lin)) this.lin = d.lin.map((v) => n(v));
    if (Array.isArray(d.ang)) this.ang = d.ang.map((v) => n(v));
    this.owner = String(d.owner ?? '');
    if (d.data && typeof d.data === 'object') this.data = d.data as Record<string, unknown>;
  }
}
