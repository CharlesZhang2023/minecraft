// Rideable boat (Minecraft 1.8-style physics).
import { Entity } from './entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { B, BLOCKS, idOf, metaOf } from '../world/blocks';
import { I2, ItemStack } from '../game/items';
import type { Player } from '../game/player';

export class Boat extends Entity {
  typeName = 'Boat';
  persist = true;
  rider: Player | null = null;
  damageTaken = 0;
  hurtTime = 0;
  hurtDir = 1;
  paddle = 0;
  constructor(world: World, public game: Game) {
    super(world);
    this.width = 1.5;
    this.height = 0.6;
    this.stepHeight = 0;
  }

  /** Fraction of the hull below the water surface. */
  private submerged(): number {
    const b = this.box;
    let frac = 0;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const y0 = b.y0 + ((b.y1 - b.y0) * i) / n - 0.125, y1 = b.y0 + ((b.y1 - b.y0) * (i + 1)) / n - 0.125;
      let wet = false;
      for (let x = Math.floor(b.x0); x <= Math.floor(b.x1) && !wet; x++)
        for (let z = Math.floor(b.z0); z <= Math.floor(b.z1) && !wet; z++)
          for (let y = Math.floor(y0); y <= Math.floor(y1) && !wet; y++) {
            const v = this.world.get(x, y, z);
            if (idOf(v) !== B.WATER) continue;
            let l = metaOf(v);
            if (l >= 8) l = 0;
            const top = y + 1 - (l + 1) / 9;
            if (y1 >= y && y0 < top) wet = true;
          }
      if (wet) frac += 1 / n;
    }
    return frac;
  }

  override tick() {
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.damageTaken > 0) this.damageTaken--;
    const sub = this.submerged();
    const speed = Math.hypot(this.vx, this.vz);
    if (sub < 1) this.vy += 0.04 * (sub * 2 - 1);
    else {
      if (this.vy < 0) this.vy /= 2;
      this.vy += 0.007;
    }
    const r = this.rider;
    if (r) {
      const yaw = (r.yaw * Math.PI) / 180;
      const f = r.forward, s = r.strafe;
      if (f || s) {
        this.vx += (-Math.sin(yaw) * f + Math.cos(yaw) * s) * 0.04;
        this.vz += (Math.cos(yaw) * f + Math.sin(yaw) * s) * 0.04;
        this.paddle += 0.4;
      }
    }
    let sp = Math.hypot(this.vx, this.vz);
    const max = 0.35;
    if (sp > max) { this.vx *= max / sp; this.vz *= max / sp; sp = max; }
    if (this.onGround) { this.vx *= 0.5; this.vy *= 0.5; this.vz *= 0.5; }
    this.move(this.vx, this.vy, this.vz);
    if (this.collidedH && speed > 0.25) {
      // crash: the boat breaks
      this.breakBoat(true);
      return;
    }
    this.vx *= 0.99; this.vy *= 0.95; this.vz *= 0.99;
    // turn toward the direction of travel
    if (sp > 0.01) {
      const target = (Math.atan2(this.vz, this.vx) * 180) / Math.PI - 90;
      let d = target - this.yaw;
      while (d >= 180) d -= 360;
      while (d < -180) d += 360;
      this.yaw += Math.max(-20, Math.min(20, d));
    }
    if (r) {
      r.setPos(this.x, this.y - 0.35, this.z);
      r.onGround = true;
      r.fallDistance = 0;
    }
    // bubbles / splash
    if (sub > 0 && sp > 0.2 && this.game.particles) for (let i = 0; i < 2; i++) this.game.particles.splash(this.x + (Math.random() - 0.5) * 1.2, this.y + 0.4, this.z + (Math.random() - 0.5) * 1.2);
    if (this.y < -64) this.removed = true;
  }

  interact(game: Game): boolean {
    const p = game.player!;
    if (this.rider || p.sneaking) return false;
    this.rider = p;
    p.riding = this;
    return true;
  }

  dismount() {
    const r = this.rider;
    if (!r) return;
    r.riding = null;
    this.rider = null;
    r.setPos(this.x, this.y + 1.1, this.z);
  }

  attacked(creative: boolean) {
    this.hurtTime = 10;
    this.hurtDir = -this.hurtDir;
    this.damageTaken += 10;
    if (creative || this.damageTaken > 40) this.breakBoat(!creative);
  }

  private breakBoat(drop: boolean) {
    this.dismount();
    this.removed = true;
    if (drop) this.game.dropItem(this.x, this.y + 0.5, this.z, { id: I2.BOAT, count: 1 } as ItemStack);
    this.game.playBlockSound(B.OAK_PLANKS, Math.floor(this.x), Math.floor(this.y), Math.floor(this.z), 'break');
  }

  toJSON() {
    return { type: 'boat', x: this.x, y: this.y, z: this.z, yaw: this.yaw };
  }
  load(d: { x: number; y: number; z: number; yaw: number }) {
    this.setPos(d.x, d.y, d.z);
    this.yaw = this.pyaw = d.yaw;
  }
}
void BLOCKS;
