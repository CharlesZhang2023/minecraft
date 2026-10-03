// Firework rockets. Launched from a block they climb, speeding up, and burst into their stars' patterns; used while
// gliding on elytra they ride along with the glider, pulling it (the glider's client does the pulling, told by the
// server how long the rocket burns), and burst where it is when they burn out.
import { Entity } from './entity';
import { LivingEntity } from './living';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import type { ItemStack, FireworkExplosion } from '../game/items';
import { raycastBlocks } from '../game/raycast';

const gauss = () => {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
};

export class FireworkRocket extends Entity {
  typeName = 'Firework Rocket';
  persist = false;
  /** Ticks until it bursts: longer with more gunpowder. */
  lifetime = 0;
  /** The stars it bursts into (none: it just fizzles out). */
  ex: FireworkExplosion[] = [];
  /** The glider it's pulling (null: flying free). */
  attached: Entity | null = null;

  constructor(world: World, public game: Game, item: ItemStack | null) {
    super(world);
    this.width = this.height = 0.25;
    if (!item) return;
    this.ex = item.fw?.ex ?? [];
    const flight = 1 + (item.fw?.flight ?? 1);
    this.lifetime = 10 * flight + Math.floor(Math.random() * 6) + Math.floor(Math.random() * 7);
    this.vx = gauss() * 0.001;
    this.vz = gauss() * 0.001;
    this.vy = 0.05;
  }

  override tick() {
    if (this.age === 1) this.game.audio.play('fireworkLaunch', this, 3, 1);
    const a = this.attached;
    if (a) {
      // riding along with the glider
      this.x = a.x; this.y = a.y; this.z = a.z;
      this.vx = a.vx; this.vy = a.vy; this.vz = a.vz;
      if (a.removed || (a instanceof LivingEntity && a.dead)) this.attached = null;
    } else {
      this.vx *= 1.15;
      this.vz *= 1.15;
      this.vy += 0.04;
      this.move(this.vx, this.vy, this.vz);
      // hitting something sets it off early
      if (this.collidedH || this.collidedV) { this.explode(); return; }
    }
    if (this.age > this.lifetime) this.explode();
  }

  /** Burst: sparks and a bang for everyone near, and the blast hurts what's close (the glider it pulled, too). */
  explode() {
    const g = this.game;
    this.removed = true;
    g.particles.firework(this.x, this.y, this.z, this.vx, this.vy, this.vz, this.ex);
    if (!this.ex.length) return;
    const pitch = 0.95 + Math.random() * 0.1;
    g.audio.play(this.ex.some((e) => e.shape === 1) ? 'fireworkLargeBlast' : 'fireworkBlast', this, 4, pitch);
    if (this.ex.some((e) => e.twinkle)) g.audio.play('fireworkTwinkle', this, 4, pitch);
    const dmg = 5 + this.ex.length * 2;
    if (this.attached instanceof LivingEntity) this.attached.damage(dmg, 'firework');
    for (const e of g.entities) {
      if (!(e instanceof LivingEntity) || e === this.attached || e.dead) continue;
      const cy = e.y + e.height / 2, d = Math.hypot(e.x - this.x, cy - this.y, e.z - this.z);
      if (d > 5) continue;
      // only what the blast can reach
      const hit = d > 0.01 ? raycastBlocks(this.world, this.x, this.y, this.z, (e.x - this.x) / d, (cy - this.y) / d, (e.z - this.z) / d, d) : null;
      if (hit) continue;
      e.damage(dmg * Math.sqrt((5 - d) / 5), 'firework');
    }
  }
}
