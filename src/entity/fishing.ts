// Fishing bobber with vanilla-style wait / approach / bite timing.
import { Entity } from './entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import type { Player } from '../game/player';
import { B, BLOCKS, idOf, metaOf } from '../world/blocks';
import { I, I2, TOOLS, stack, ItemStack } from '../game/items';
import { Random } from '../noise';

const rng = new Random(Date.now() & 0xfff);

export class FishingHook extends Entity {
  typeName = 'Fishing Bobber';
  persist = false;
  inWaterNow = false;
  private wait = 0;
  private approach = 0;
  bite = 0;
  inGround = false;
  constructor(world: World, public game: Game, public angler: Player) {
    super(world);
    this.width = this.height = 0.25;
    this.wait = 100 + rng.int(500);
  }

  cast() {
    const p = this.angler;
    const eye = this.game.eyePos(1);
    const d = this.game.lookVec(p.yaw, p.pitch);
    this.setPos(eye.x + d.x * 0.3, eye.y - 0.1, eye.z + d.z * 0.3);
    const f = 0.4 * 1.5;
    this.vx = d.x * f * 2.5 + (rng.next() - 0.5) * 0.03;
    this.vy = d.y * f * 2.5 + 0.1;
    this.vz = d.z * f * 2.5 + (rng.next() - 0.5) * 0.03;
  }

  private waterLevel(): number {
    const x = Math.floor(this.x), y = Math.floor(this.y), z = Math.floor(this.z);
    const v = this.world.get(x, y, z);
    if (idOf(v) !== B.WATER) return -1;
    let l = metaOf(v);
    if (l >= 8) l = 0;
    return y + 1 - (l + 1) / 9;
  }

  override tick() {
    const p = this.angler;
    const held = p.inventory.held();
    if (p.dead || !held || held.id !== I2.FISHING_ROD || this.distanceTo(p) > 32) { this.discard(); return; }
    if (this.inGround) { if (!BLOCKS[this.world.getId(Math.floor(this.x), Math.floor(this.y - 0.05), Math.floor(this.z))].solid) this.inGround = false; else return; }
    const surface = this.waterLevel();
    this.inWaterNow = surface >= 0;
    if (this.inWaterNow) {
      // float at the surface
      const depth = surface - (this.y + 0.1);
      this.vy += Math.max(-0.02, Math.min(0.04, depth * 0.2));
      this.vx *= 0.9; this.vz *= 0.9; this.vy *= 0.85;
      this.fishTick(surface);
    } else {
      this.vy -= 0.03;
      this.vx *= 0.92; this.vy *= 0.92; this.vz *= 0.92;
    }
    this.move(this.vx, this.vy, this.vz);
    if (this.onGround && !this.inWaterNow) { this.inGround = true; this.vx = this.vy = this.vz = 0; }
    if (this.age > 2400) this.discard();
  }

  private fishTick(surface: number) {
    const pt = this.game.particles;
    if (this.bite > 0) {
      this.bite--;
      if (this.bite === 0) this.wait = 100 + rng.int(500);
      return;
    }
    if (this.approach > 0) {
      this.approach--;
      // wake of bubbles heading toward the bobber
      const a = (this.approach / 40) * 2;
      pt?.bubble(this.x + Math.cos(a) * this.approach * 0.1, surface - 0.1, this.z + Math.sin(a) * this.approach * 0.1);
      if (this.approach === 0) {
        this.bite = 20 + rng.int(20);
        this.vy -= 0.2;
        this.game.audio.play('splash', this, 0.25, 1 + (rng.next() - rng.next()) * 0.4);
        for (let i = 0; i < 12; i++) pt?.splash(this.x + (rng.next() - 0.5) * 0.5, surface, this.z + (rng.next() - 0.5) * 0.5);
      }
      return;
    }
    if (--this.wait <= 0) this.approach = 20 + rng.int(60);
  }

  /** Reel in: returns rod damage to apply. */
  reel(): number {
    const g = this.game, p = this.angler;
    let dmg = 0;
    if (this.bite > 0) {
      const loot = this.loot();
      const e = g.dropItem(this.x, this.y + 0.2, this.z, loot, false, 0);
      if (e) {
        const dx = p.x - this.x, dy = p.y - this.y, dz = p.z - this.z;
        const d = Math.hypot(dx, dy, dz);
        e.vx = dx * 0.1; e.vy = dy * 0.1 + Math.sqrt(d) * 0.08; e.vz = dz * 0.1;
      }
      g.spawnXpAt(p.x, p.y + 0.5, p.z + 0.5, 1 + rng.int(6));
      dmg = 1;
    } else if (this.inGround) dmg = 2;
    this.discard();
    return dmg;
  }

  private loot(): ItemStack {
    const r = rng.int(100);
    if (r < 85) return stack(rng.int(100) < 70 ? I2.COD : I2.SALMON);
    if (r < 95) {
      const junk = [ [I.STICK, 1], [I.STRING, 1], [I.BONE, 1], [I.BOWL, 1], [I.ROTTEN_FLESH, 1], [B.LILY_PAD, 1], [I2.INK_SAC, 5], [I.LEATHER, 1] ];
      const [id, n] = junk[rng.int(junk.length)];
      return stack(id, n);
    }
    const treasure = [I.BOW, I2.FISHING_ROD, I.EMERALD, I.GOLDEN_APPLE, TOOLS.iron_sword];
    return stack(treasure[rng.int(treasure.length)]);
  }

  discard() {
    this.removed = true;
    if (this.angler.fishHook === this) this.angler.fishHook = null;
  }
}
