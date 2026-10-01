// A thrown Eye of Ender: it floats toward the nearest stronghold, then drops (usually as an item) or shatters.
import { Entity } from './entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { nearestSite, layoutStronghold } from '../world/stronghold';
import { I2, stack } from '../game/items';

export class EyeOfEnder extends Entity {
  typeName = 'Eye of Ender';
  persist = false;
  private tx = 0; private ty = 0; private tz = 0;
  /** four in five eyes survive the trip */
  private survives = Math.random() < 0.8;

  constructor(world: World, public game: Game, seed: number) {
    super(world);
    this.width = this.height = 0.25;
    this.aim(seed);
  }

  /** Pick the point to float toward: at most 12 blocks along the line to the nearest stronghold. */
  private aim(seed: number) {
    const site = nearestSite(seed, this.x, this.z);
    const dx = site.x - this.x, dz = site.z - this.z, d = Math.hypot(dx, dz);
    if (d > 12) {
      this.tx = this.x + (dx / d) * 12;
      this.tz = this.z + (dz / d) * 12;
      this.ty = this.y + 8;
    } else {
      this.tx = site.x; this.tz = site.z; this.ty = layoutStronghold(seed, site).y;
    }
  }
  /** Called once the entity has been positioned. */
  retarget() { this.aim(this.game.meta?.seed ?? 0); }

  override tick() {
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    const f = Math.hypot(this.vx, this.vz);
    const dx = this.tx - this.x, dz = this.tz - this.z;
    const f1 = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
    let d0 = f + (f1 - f) * 0.0025 + 0.012;
    if (f1 < 1) { d0 *= 0.8; this.vy *= 0.8; }
    this.vx = Math.cos(a) * d0; this.vz = Math.sin(a) * d0;
    if (this.y < this.ty) this.vy += (1 - this.vy) * 0.015;
    else this.vy += (-1 - this.vy) * 0.015;
    const p = this.game.particles;
    if (p) {
      p.spell(this.x - this.vx * 0.25, this.y - this.vy * 0.25 - 0.3, this.z - this.vz * 0.25, 0xa070ff);
      if (this.age % 2 === 0) p.spell(this.x + (Math.random() - 0.5) * 0.3, this.y - 0.2 + (Math.random() - 0.5) * 0.3, this.z + (Math.random() - 0.5) * 0.3, 0x60e0a0);
    }
    if (this.age > 80) {
      this.removed = true;
      if (this.survives) this.game.dropItem(this.x, this.y, this.z, stack(I2.ENDER_EYE));
      else {
        for (let i = 0; i < 12; i++) p?.spell(this.x + (Math.random() - 0.5) * 0.6, this.y + (Math.random() - 0.5) * 0.6, this.z + (Math.random() - 0.5) * 0.6, 0x50d890);
        this.game.audio.play('dig.glass', this, 0.6, 1.2);
      }
    }
  }
}
