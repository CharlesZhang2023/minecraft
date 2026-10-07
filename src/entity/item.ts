import { enterGateway } from '../game/gateways';
import { mend } from '../game/mending';
import { hardenConcrete } from '../game/blockrules';
import { Player } from '../game/player';
import { Entity } from './entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { ItemStack, sameItem, getItem } from '../game/items';
import { BLOCKS, B, B2 } from '../world/blocks';
import { hitTarget } from '../game/stations';

export class ItemEntity extends Entity {
  typeName = 'Item';
  pickupDelay = 10;
  bobOffset = Math.random() * Math.PI * 2;
  persist = true;
  lifespan = 6000;
  constructor(world: World, public game: Game, public item: ItemStack) {
    super(world);
    this.width = 0.25;
    this.height = 0.25;
  }

  override tick() {
    if (this.pickupDelay > 0 && this.pickupDelay < 32767) this.pickupDelay--;
    this.updateFluidState();
    if (this.inWater) {
      // float to the surface
      this.vy += this.vy < 0.06 ? 0.005 : 0;
      this.vx *= 0.99; this.vz *= 0.99;
    } else this.vy -= 0.04;
    // netherite (and nether stars) don't burn: they bob up through lava
    if (this.inLava && getItem(this.item.id).fireproof) { this.vy = Math.min(0.1, this.vy + 0.02); this.vx *= 0.9; this.vz *= 0.9; this.move(this.vx, this.vy, this.vz); this.tryPickup(); return; }
    if (this.inLava) {
      this.vy = 0.2;
      this.vx = (Math.random() - 0.5) * 0.2;
      this.vz = (Math.random() - 0.5) * 0.2;
      this.game.audio.play('fizz', this, 0.4, 2);
      this.removed = true;
      return;
    }
    // push out of blocks
    if (this.isInsideOpaque()) this.vy = 0.1;
    this.move(this.vx, this.vy, this.vz);
    let f = 0.98;
    if (this.onGround) {
      const below = this.world.getId(Math.floor(this.x), Math.floor(this.y - 1), Math.floor(this.z));
      f = (below ? BLOCKS[below].slipperiness : 0.6) * 0.98;
    }
    this.vx *= f;
    this.vy *= 0.98;
    this.vz *= f;
    if (this.onGround) this.vy *= -0.5;
    if (this.age >= this.lifespan) this.removed = true;
    // merge with neighbours every few ticks
    if (this.age % 25 === 0) {
      for (const e of this.game.entities) {
        if (e === this || !(e instanceof ItemEntity) || e.removed) continue;
        if (!sameItem(e.item, this.item)) continue;
        if (Math.abs(e.x - this.x) > 0.5 || Math.abs(e.y - this.y) > 0.25 || Math.abs(e.z - this.z) > 0.5) continue;
        const max = getItem(this.item.id).maxStack;
        if (e.item.count + this.item.count > max) continue;
        e.item.count += this.item.count;
        e.pickupDelay = Math.max(e.pickupDelay, this.pickupDelay);
        e.age = Math.min(e.age, this.age);
        this.removed = true;
        return;
      }
    }
    this.tryPickup();
  }

  /** Any player standing on it picks it up (as much as fits). */
  tryPickup() {
    if (this.pickupDelay > 0) return;
    for (const p of this.game.playerEntities()) {
      if (p.dead || p.spectator) continue;
      const pb = p.box;
      const b = this.box;
      if (b.x1 < pb.x0 - 1 || b.x0 > pb.x1 + 1 || b.y1 < pb.y0 - 0.5 || b.y0 > pb.y1 + 0.5 || b.z1 < pb.z0 - 1 || b.z0 > pb.z1 + 1) continue;
      const before = this.item.count;
      const left = p.inventory.add(this.item);
      if (left < before) {
        this.game.playerOf(p)?.achievements.onPickup(this.item.id, this.item.count);
        this.game.audio.play('pop', this, 0.2, ((Math.random() - Math.random()) * 0.7 + 1) * 2);
        this.game.pickedUp(this, p, this.item.id);
      }
      if (left <= 0) { this.removed = true; return; }
      this.item.count = left;
    }
  }

  toJSON() {
    return { type: 'item', x: this.x, y: this.y, z: this.z, item: this.item, age: this.age };
  }
  load(d: { x: number; y: number; z: number; item: ItemStack; age: number }) {
    this.setPos(d.x, d.y, d.z);
    this.item = d.item;
    this.age = d.age ?? 0;
    this.pickupDelay = 0;
  }
}

export class XpOrb extends Entity {
  typeName = 'Experience Orb';
  value: number;
  persist = false;
  constructor(world: World, public game: Game, value: number) {
    super(world);
    this.value = value;
    this.width = this.height = 0.5;
    this.vx = (Math.random() * 0.2 - 0.1) * 2;
    this.vy = Math.random() * 0.2 * 2;
    this.vz = (Math.random() * 0.2 - 0.1) * 2;
  }
  override tick() {
    this.vy -= 0.03;
    const p = this.game.nearestPlayer(this, 8, true);
    if (p) {
      const dx = p.x - this.x, dy = p.y + p.eyeHeight() / 2 - this.y, dz = p.z - this.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / 8;
      if (d < 1) {
        const f = (1 - d) * (1 - d);
        this.vx += (dx / d / 8) * f * 0.1;
        this.vy += (dy / d / 8) * f * 0.1;
        this.vz += (dz / d / 8) * f * 0.1;
      }
      if (this.age > 10 && Math.abs(dx) < 1 && Math.abs(dy) < 1.3 && Math.abs(dz) < 1) {
        const lvl = p.xpLevel;
        const left = mend(p, this.value);
        if (left > 0) p.addXp(left);
        this.game.audio.play('orb', this, 0.1, 0.5 * ((Math.random() - Math.random()) * 0.7 + 1.8));
        if (p.xpLevel > lvl && p.xpLevel % 5 === 0) this.game.audio.play('levelup', null, 0.75, 1);
        this.removed = true;
      }
    }
    this.move(this.vx, this.vy, this.vz);
    const f = this.onGround ? 0.588 : 0.98;
    this.vx *= f; this.vy *= 0.98; this.vz *= f;
    if (this.onGround) this.vy *= -0.9;
    if (this.age > 6000) this.removed = true;
  }
}

export class FallingBlock extends Entity {
  typeName = 'Falling Block';
  persist = false;
  private startY = NaN;
  /** block: packed block state (id | meta << 12) */
  constructor(world: World, public game: Game, public block: number) {
    super(world);
    this.width = this.height = 0.98;
  }
  override tick() {
    if (isNaN(this.startY)) this.startY = this.y;
    this.vy -= 0.04;
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    const id = this.block & 0xfff;
    if (id === B.ANVIL && this.vy < 0) {
      // falling anvils hurt whatever they land on: 2 per block fallen, up to 40
      const fell = this.startY - this.y;
      for (const e of this.game.entities) {
        const le = e as unknown as { damage?: (n: number, s: string) => boolean; dead?: boolean };
        if (e === this || !le.damage || le.dead) continue;
        if (Math.abs(e.x - this.x) < 0.8 && Math.abs(e.z - this.z) < 0.8 && e.y + e.height > this.y && e.y <= this.y) le.damage(Math.min(40, Math.max(0, Math.ceil((fell - 1) * 2))), 'anvil');
      }
    }
    if (this.onGround) {
      const x = Math.floor(this.x), y = Math.floor(this.y + 0.01), z = Math.floor(this.z);
      const cur = this.world.getId(x, y, z);
      let v = this.block;
      if (id === B.ANVIL) {
        this.game.audio.play('anvil.land', this, 0.6, 0.9 + Math.random() * 0.1);
        const fell = this.startY - this.y;
        if (fell > 1 && Math.random() < 0.05 + fell * 0.05) {
          const dmg = ((v >>> 12) >> 2) + 1;
          v = dmg > 2 ? 0 : (v & 0x3fff) | (dmg << 14);
          if (!v) { this.removed = true; return; }
        }
      }
      if (BLOCKS[cur].replaceable) {
        this.world.set(x, y, z, v);
        hardenConcrete(this.world, x, y, z);
      } else {
        this.game.dropItem(this.x, this.y + 0.5, this.z, { id, count: 1 });
      }
      this.removed = true;
    } else if (this.age > 600 || this.y < -10) {
      this.removed = true;
    }
  }
}

export class PrimedTnt extends Entity {
  typeName = 'Primed TNT';
  fuse = 80;
  persist = false;
  constructor(world: World, public game: Game) {
    super(world);
    this.width = this.height = 0.98;
    const a = Math.random() * Math.PI * 2;
    this.vx = -Math.sin(a) * 0.02;
    this.vy = 0.2;
    this.vz = -Math.cos(a) * 0.02;
  }
  override tick() {
    this.vy -= 0.04;
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    if (this.onGround) { this.vx *= 0.7; this.vz *= 0.7; this.vy *= -0.5; }
    this.game.particles?.smoke(this.x, this.y + 1.1, this.z);
    if (--this.fuse <= 0) {
      this.removed = true;
      this.game.interact!.explode(this.x, this.y + 0.49, this.z, 4, false, this);
    }
  }
}

export class Arrow extends Entity {
  typeName = 'Arrow';
  inGround = false;
  groundTicks = 0;
  damageBase = 2;
  persist = false;
  pickup = true;
  shake = 0;
  /** A tipped arrow's effect (id, ticks, amplifier), given to what it hits; or a potion key (tipped arrows). */
  effect: [string, number, number] | null = null;
  tipped = '';
  /** The item it's drawn as (an arrow, or a trident), and how many more entities it can pass through (piercing). */
  itemId = 1;
  pierce = 0;
  /** Entities it has already gone through (piercing arrows don't hit the same one twice). */
  pierced: Entity[] = [];
  constructor(world: World, public game: Game, public shooter: Entity | null) {
    super(world);
    this.width = this.height = 0.5;
    this.itemId = game.interact?.arrowId ?? 1;
  }
  shoot(dx: number, dy: number, dz: number, speed: number, spread: number) {
    const l = Math.hypot(dx, dy, dz);
    dx = dx / l + (Math.random() - 0.5) * 0.015 * spread;
    dy = dy / l + (Math.random() - 0.5) * 0.015 * spread;
    dz = dz / l + (Math.random() - 0.5) * 0.015 * spread;
    this.vx = dx * speed; this.vy = dy * speed; this.vz = dz * speed;
    this.yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
    this.pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
    this.pyaw = this.yaw;
    this.ppitch = this.pitch;
  }
  override tick() {
    if (this.shake > 0) this.shake--;
    if (this.inGround) {
      this.groundTicks++;
      if (this.groundTicks > 1200) this.removed = true;
      // falls if the block is removed
      const id = this.world.getId(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
      if (!BLOCKS[id].solid) { this.inGround = false; this.vx = this.vy = this.vz = 0; }
      // players can pick up arrows players shot
      if (this.pickup && this.shooter instanceof Player) for (const p of this.game.playerEntities()) {
        if (p.distanceTo(this) >= 1.5 || p.dead || p.spectator) continue;
        if (p.inventory.add({ id: this.game.interact!.arrowId, count: 1 }) === 0) {
          this.game.audio.play('pop', this, 0.2, 2);
          this.removed = true;
          break;
        }
      }
      return;
    }
    // hit test entities along the path
    const steps = 4;
    for (let s = 0; s < steps; s++) {
      const nx = this.x + this.vx / steps, ny = this.y + this.vy / steps, nz = this.z + this.vz / steps;
      const hitEnt = this.game.interact!.arrowHitEntity(this, nx, ny, nz);
      if (hitEnt) return;
      const bx = Math.floor(nx), by = Math.floor(ny), bz = Math.floor(nz);
      const id = this.world.getId(bx, by, bz);
      if (BLOCKS[id].solid && BLOCKS[id].render === 1) {
        this.inGround = true;
        this.x = nx; this.y = ny; this.z = nz;
        this.shake = 7;
        this.game.audio.play('arrowHit', this, 1, 1.2 / (Math.random() * 0.2 + 0.9));
        if (id === B.TNT) {
          this.world.set(bx, by, bz, 0);
          this.game.interact!.primeTnt(bx, by, bz);
        }
        if (id === B2.TARGET) hitTarget(this.game, bx, by, bz, this.x - this.vx / steps * 0.5, this.y - this.vy / steps * 0.5, this.z - this.vz / steps * 0.5, true);
        return;
      }
      this.x = nx; this.y = ny; this.z = nz;
    }
    const sp = Math.hypot(this.vx, this.vz);
    this.yaw = (Math.atan2(this.vx, this.vz) * 180) / Math.PI;
    this.pitch = (Math.atan2(this.vy, sp) * 180) / Math.PI;
    let drag = 0.99;
    this.updateFluidState();
    if (this.inWater) { drag = 0.8; this.game.particles?.bubble(this.x, this.y, this.z); }
    this.vx *= drag; this.vy *= drag; this.vz *= drag;
    this.vy -= 0.05;
    if (this.age > 1200) this.removed = true;
  }
}

export class Snowball extends Entity {
  typeName = 'Snowball';
  persist = false;
  constructor(world: World, public game: Game, public shooter: Entity | null, public kind: 'snowball' | 'egg' | 'ender_pearl' = 'snowball') {
    super(world);
    this.width = this.height = 0.25;
  }
  override tick() {
    const nx = this.x + this.vx, ny = this.y + this.vy, nz = this.z + this.vz;
    const ent = this.game.interact!.projectileHitEntity(this, nx, ny, nz);
    const id = this.world.getId(Math.floor(nx), Math.floor(ny), Math.floor(nz));
    const thrower = this.game.playerOf(this.shooter);
    if (id === B.END_GATEWAY && this.kind === 'ender_pearl' && thrower) {
      // a pearl thrown through an End gateway takes its thrower along
      this.game.asActor(thrower, () => enterGateway(this.game, Math.floor(nx), Math.floor(ny), Math.floor(nz)));
      this.removed = true;
      return;
    }
    if (ent || BLOCKS[id].solid) {
      for (let i = 0; i < 8; i++) this.game.particles?.add({ x: this.x, y: this.y, z: this.z, vx: (Math.random() - 0.5) * 0.15, vy: Math.random() * 0.15, vz: (Math.random() - 0.5) * 0.15, layer: this.game.interact!.spriteLayer(this.kind), u0: 0.3, v0: 0.3, u1: 0.55, v1: 0.55, size: 0.06, life: 10 });
      if (this.kind === 'egg' && Math.random() < 0.125) this.game.interact!.spawnMob('chicken', this.x, this.y, this.z, true);
      if (this.kind === 'ender_pearl' && thrower && thrower.entity.world === this.world) {
        const p = thrower.entity;
        // now and then an endermite comes through with you (vanilla: 5%)
        if (Math.random() < 0.05) this.game.interact!.spawnMob('endermite', p.x, p.y, p.z);
        p.setPos(this.x, this.y, this.z);
        p.damage(5, 'fall');
      }
      this.removed = true;
      return;
    }
    this.x = nx; this.y = ny; this.z = nz;
    this.updateFluidState();
    const drag = this.inWater ? 0.8 : 0.99;
    this.vx *= drag; this.vy *= drag; this.vz *= drag;
    this.vy -= 0.03;
    if (this.age > 400) this.removed = true;
  }
}

export class Fireball extends Entity {
  typeName = 'Fireball';
  persist = false;
  small = false; // blaze / fire charge: sets fire instead of exploding
  ax = 0; ay = 0; az = 0;
  constructor(world: World, public game: Game, public shooter: Entity | null, dx: number, dy: number, dz: number) {
    super(world);
    this.width = this.height = 1;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.ax = (dx / l) * 0.1; this.ay = (dy / l) * 0.1; this.az = (dz / l) * 0.1;
  }
  override tick() {
    if (this.age > 400) { this.removed = true; return; }
    const nx = this.x + this.vx, ny = this.y + this.vy, nz = this.z + this.vz;
    const hitBlock = BLOCKS[this.world.getId(Math.floor(nx), Math.floor(ny + 0.5), Math.floor(nz))].solid;
    // players are entities too, so this finds them as well
    const hitEnt = this.game.interact!.projectileHitEntity(this as unknown as Snowball, nx, ny + 0.5, nz);
    if ((hitBlock || hitEnt) && this.age > 1) {
      this.removed = true;
      if (this.small) {
        if (hitEnt) {
          const e = hitEnt as unknown as { damage?: (n: number, s: string, a: Entity | null) => boolean; fireTicks: number; fireImmune?: boolean };
          if (e.damage && !e.fireImmune && e.damage(5, 'fire', this.shooter)) e.fireTicks = Math.max(e.fireTicks, 100);
        } else {
          // set fire to the block face that was hit
          const bx = Math.floor(this.x), by = Math.floor(this.y + 0.5), bz = Math.floor(this.z);
          if (this.world.getId(bx, by, bz) === 0) {
            this.world.set(bx, by, bz, B.FIRE);
            this.game.ticker?.schedule(bx, by, bz, 30);
          }
        }
        return;
      }
      this.game.interact!.explode(this.x, this.y + 0.5, this.z, 1, true, this);
      return;
    }
    this.x = nx; this.y = ny; this.z = nz;
    this.vx += this.ax; this.vy += this.ay; this.vz += this.az;
    this.vx *= 0.95; this.vy *= 0.95; this.vz *= 0.95;
    if (this.small) { if (this.age % 2 === 0) this.game.particles?.smoke(this.x, this.y + 0.5, this.z); }
    else this.game.particles?.smoke(this.x, this.y + 0.5, this.z);
  }
  /** Punching a fireball sends it back. */
  deflect(dx: number, dy: number, dz: number) {
    const l = Math.hypot(dx, dy, dz) || 1;
    this.vx = (dx / l) * 1.2; this.vy = (dy / l) * 1.2; this.vz = (dz / l) * 1.2;
    this.ax = (dx / l) * 0.1; this.ay = (dy / l) * 0.1; this.az = (dz / l) * 0.1;
    this.shooter = this.game.player;
  }
}
