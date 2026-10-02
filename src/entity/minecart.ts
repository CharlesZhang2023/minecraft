// Minecart, with vanilla's track physics (EntityMinecart.moveAlongTrack): it's held to the rail's centre line,
// speeds up down slopes, gets a kick on powered rails and is stopped by unpowered ones.
import { Entity } from './entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { B, BLOCKS, idOf, metaOf } from '../world/blocks';
import { I5, type ItemStack } from '../game/items';
import type { Player } from '../game/player';
import { RAIL_ENDS, railShape, isRail, isAscending, NS, EW, ASC_E, ASC_W, ASC_N, ASC_S } from '../world/rails';
import { carryRider, dismountSpot, type Mount } from './mount';

const MAX_SPEED = 0.4;
/** Feet of a seated rider, relative to the cart. */
export const CART_SEAT = -0.55;

export class Minecart extends Entity implements Mount {
  typeName = 'Minecart';
  persist = true;
  rider: Player | null = null;
  lookLimit = 180;
  damageTaken = 0;
  hurtTime = 0;
  hurtDir = 1;
  /** Facing along the track (degrees, flips 180 when the cart reverses so the model doesn't spin). */
  private reverse = false;
  onRail = false;
  constructor(world: World, public game: Game) {
    super(world);
    this.width = 0.98;
    this.height = 0.7;
    this.stepHeight = 0;
  }

  /** Point on the rail's centre line nearest (x, z), or null off the track (vanilla func_70489_a). */
  railPoint(x: number, y: number, z: number): [number, number, number] | null {
    const i = Math.floor(x), k = Math.floor(z);
    let j = Math.floor(y);
    if (isRail(this.world.getId(i, j - 1, k))) j--;
    const v = this.world.get(i, j, k);
    if (!isRail(idOf(v))) return null;
    const [a, b] = RAIL_ENDS[railShape(v)];
    const x0 = i + 0.5 + a[0] * 0.5, y0 = j + 0.0625 + a[1] * 0.5, z0 = k + 0.5 + a[2] * 0.5;
    const x1 = i + 0.5 + b[0] * 0.5, y1 = j + 0.0625 + b[1] * 0.5, z1 = k + 0.5 + b[2] * 0.5;
    const dx = x1 - x0, dy = (y1 - y0) * 2, dz = z1 - z0;
    let t: number;
    if (dx === 0) { x = i + 0.5; t = z - k; }
    else if (dz === 0) { z = k + 0.5; t = x - i; }
    else t = ((x - x0) * dx + (z - z0) * dz) * 2;
    x = x0 + dx * t; y = y0 + dy * t; z = z0 + dz * t;
    if (dy < 0) y += 1;
    if (dy > 0) y += 0.5;
    return [x, y, z];
  }

  override tick() {
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.damageTaken > 0) this.damageTaken--;
    if (this.y < -64) { this.removed = true; return; }
    this.vy -= 0.04;
    const i = Math.floor(this.x), k = Math.floor(this.z);
    let j = Math.floor(this.y);
    if (isRail(this.world.getId(i, j - 1, k))) j--;
    const v = this.world.get(i, j, k);
    this.onRail = isRail(idOf(v));
    if (this.onRail) {
      this.alongTrack(i, j, k, v);
      if (idOf(v) === B.ACTIVATOR_RAIL && metaOf(v) & 8 && this.rider) this.dismount();
      if (idOf(v) === B.DETECTOR_RAIL) this.game.redstone.pressDetector(i, j, k);
    } else this.offTrack();
    // face the way it's rolling, without spinning round when it reverses
    this.pitch = 0;
    const dx = this.px - this.x, dz = this.pz - this.z;
    if (dx * dx + dz * dz > 0.001) {
      const wrap = (a: number) => ((a % 360) + 540) % 360 - 180;
      let d = wrap((Math.atan2(dz, dx) * 180) / Math.PI + (this.reverse ? 180 : 0) - this.yaw);
      if (d < -170 || d >= 170) { this.reverse = !this.reverse; d = wrap(d + 180); }
      this.yaw += d;
    }
    // tilt on slopes
    if (this.onRail && isAscending(railShape(v))) {
      const a = this.railPoint(this.x + Math.cos((this.yaw * Math.PI) / 180) * 0.3, this.y, this.z + Math.sin((this.yaw * Math.PI) / 180) * 0.3);
      const b = this.railPoint(this.x - Math.cos((this.yaw * Math.PI) / 180) * 0.3, this.y, this.z - Math.sin((this.yaw * Math.PI) / 180) * 0.3);
      if (a && b) this.pitch = (Math.atan2(a[1] - b[1], Math.hypot(a[0] - b[0], a[2] - b[2])) * 180) / Math.PI;
    }
    this.pushOthers();
    if (this.rider) carryRider(this, this.rider, CART_SEAT);
  }

  private alongTrack(i: number, j: number, k: number, v: number) {
    this.fallDistance = 0;
    const before = this.railPoint(this.x, this.y, this.z);
    this.y = j;
    const id = idOf(v);
    let boost = false, brake = false;
    if (id === B.POWERED_RAIL) { boost = (metaOf(v) & 8) !== 0; brake = !boost; }
    const shape = railShape(v);
    const slope = 0.0078125;
    switch (shape) {
      case ASC_E: this.vx -= slope; this.y++; break;
      case ASC_W: this.vx += slope; this.y++; break;
      case ASC_N: this.vz += slope; this.y++; break;
      case ASC_S: this.vz -= slope; this.y++; break;
    }
    const [a, b] = RAIL_ENDS[shape];
    let ex = b[0] - a[0], ez = b[2] - a[2];
    const len = Math.hypot(ex, ez);
    if (this.vx * ex + this.vz * ez < 0) { ex = -ex; ez = -ez; }
    let sp = Math.min(2, Math.hypot(this.vx, this.vz));
    this.vx = (sp * ex) / len;
    this.vz = (sp * ez) / len;
    // a rider pushes a stopped cart the way they're looking
    const r = this.rider;
    if (r && r.forward > 0 && this.vx * this.vx + this.vz * this.vz < 0.01) {
      const yaw = (r.yaw * Math.PI) / 180;
      this.vx += -Math.sin(yaw) * 0.1;
      this.vz += Math.cos(yaw) * 0.1;
      brake = false;
    }
    if (brake) {
      if (Math.hypot(this.vx, this.vz) < 0.03) { this.vx = this.vy = this.vz = 0; }
      else { this.vx *= 0.5; this.vy = 0; this.vz *= 0.5; }
    }
    // snap onto the centre line
    const x0 = i + 0.5 + a[0] * 0.5, z0 = k + 0.5 + a[2] * 0.5;
    const x1 = i + 0.5 + b[0] * 0.5, z1 = k + 0.5 + b[2] * 0.5;
    const dx = x1 - x0, dz = z1 - z0;
    let t: number;
    if (dx === 0) { this.x = i + 0.5; t = this.z - k; }
    else if (dz === 0) { this.z = k + 0.5; t = this.x - i; }
    else t = ((this.x - x0) * dx + (this.z - z0) * dz) * 2;
    this.x = x0 + dx * t;
    this.z = z0 + dz * t;
    let mx = this.vx, mz = this.vz;
    if (r) { mx *= 0.75; mz *= 0.75; }
    mx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, mx));
    mz = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, mz));
    this.move(mx, 0, mz);
    // stepping onto the next block of a slope
    if (a[1] !== 0 && Math.floor(this.x) - i === a[0] && Math.floor(this.z) - k === a[2]) this.y += a[1];
    else if (b[1] !== 0 && Math.floor(this.x) - i === b[0] && Math.floor(this.z) - k === b[2]) this.y += b[1];
    // drag
    if (r) { this.vx *= 0.997; this.vy = 0; this.vz *= 0.997; }
    else { this.vx *= 0.96; this.vy = 0; this.vz *= 0.96; }
    // energy: rolling downhill speeds the cart up, uphill slows it
    const after = this.railPoint(this.x, this.y, this.z);
    if (after && before) {
      const dh = (before[1] - after[1]) * 0.05;
      sp = Math.hypot(this.vx, this.vz);
      if (sp > 0) { this.vx = (this.vx / sp) * (sp + dh); this.vz = (this.vz / sp) * (sp + dh); }
      this.y = after[1];
    }
    // moved onto another block: head straight along the step it took
    const ni = Math.floor(this.x), nk = Math.floor(this.z);
    if (ni !== i || nk !== k) {
      sp = Math.hypot(this.vx, this.vz);
      this.vx = sp * (ni - i);
      this.vz = sp * (nk - k);
    }
    if (boost) {
      sp = Math.hypot(this.vx, this.vz);
      if (sp > 0.01) { this.vx += (this.vx / sp) * 0.06; this.vz += (this.vz / sp) * 0.06; }
      else if (shape === EW) {
        // launched off a block at one end of the rail
        if (BLOCKS[this.world.getId(i - 1, j, k)].opaque) this.vx = 0.02;
        else if (BLOCKS[this.world.getId(i + 1, j, k)].opaque) this.vx = -0.02;
      } else if (shape === NS) {
        if (BLOCKS[this.world.getId(i, j, k - 1)].opaque) this.vz = 0.02;
        else if (BLOCKS[this.world.getId(i, j, k + 1)].opaque) this.vz = -0.02;
      }
    }
  }

  private offTrack() {
    this.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, this.vx));
    this.vz = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, this.vz));
    if (this.onGround) { this.vx *= 0.5; this.vy *= 0.5; this.vz *= 0.5; }
    this.move(this.vx, this.vy, this.vz);
    if (!this.onGround) { this.vx *= 0.95; this.vy *= 0.95; this.vz *= 0.95; }
  }

  /** Bump into the player and other carts (vanilla applyEntityCollision). */
  private pushOthers() {
    const g = this.game, p = g.player;
    const b = this.box;
    for (const e of [p, ...g.entities]) {
      if (!e || e === this || e === this.rider || e.removed || (e as Player).spectator) continue;
      if (e !== p && !(e instanceof Minecart)) continue;
      const o = e.box;
      if (o.x1 < b.x0 - 0.2 || o.x0 > b.x1 + 0.2 || o.z1 < b.z0 - 0.2 || o.z0 > b.z1 + 0.2 || o.y1 < b.y0 || o.y0 > b.y1) continue;
      let dx = e.x - this.x, dz = e.z - this.z;
      let d = dx * dx + dz * dz;
      if (d < 1e-4) continue;
      d = Math.sqrt(d);
      dx /= d; dz /= d;
      let f = 1 / d;
      if (f > 1) f = 1;
      dx *= f * 0.1; dz *= f * 0.1;
      if (e instanceof Minecart) {
        // carts shove each other along the line
        this.vx -= dx * 0.5; this.vz -= dz * 0.5;
        e.vx += dx * 0.5; e.vz += dz * 0.5;
      } else {
        // walking into a cart pushes it; it doesn't push the player much
        this.vx -= dx; this.vz -= dz;
        e.vx += dx * 0.25; e.vz += dz * 0.25;
      }
    }
  }

  interact(game: Game): boolean {
    const p = game.player!;
    if (this.rider || p.sneaking || p.riding) return false;
    this.rider = p;
    p.riding = this;
    p.sprinting = false;
    carryRider(this, p, CART_SEAT);
    return true;
  }

  dismount() {
    const r = this.rider;
    if (!r) return;
    r.riding = null;
    this.rider = null;
    const [x, y, z] = dismountSpot(this, r);
    r.setPos(x, y, z);
  }

  attacked(creative: boolean) {
    this.hurtTime = 10;
    this.hurtDir = -this.hurtDir;
    this.damageTaken += 10;
    if (creative || this.damageTaken > 40) {
      this.dismount();
      this.removed = true;
      if (!creative) this.game.dropItem(this.x, this.y + 0.5, this.z, { id: I5.MINECART, count: 1 } as ItemStack);
      this.game.playBlockSound(B.IRON_BLOCK, Math.floor(this.x), Math.floor(this.y), Math.floor(this.z), 'break');
    }
  }

  toJSON() {
    return { type: 'minecart', x: this.x, y: this.y, z: this.z, yaw: this.yaw, vx: this.vx, vz: this.vz };
  }
  load(d: { x: number; y: number; z: number; yaw: number; vx?: number; vz?: number }) {
    this.setPos(d.x, d.y, d.z);
    this.yaw = this.pyaw = d.yaw;
    this.vx = d.vx ?? 0; this.vz = d.vz ?? 0;
  }
}

/** Where a minecart placed on the rail at (x, y, z) sits, facing along it. */
export function placeOnRail(w: World, x: number, y: number, z: number): { y: number; yaw: number } | null {
  const v = w.get(x, y, z);
  if (!isRail(idOf(v))) return null;
  const s = railShape(v);
  return { y: y + 0.0625 + (isAscending(s) ? 0.5 : 0), yaw: s === NS || s === ASC_N || s === ASC_S ? 90 : 0 };
}
