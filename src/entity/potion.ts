// Thrown splash potions: arc like snowballs, shatter on impact and apply their effects in a 4 block radius.
import { Entity } from './entity';
import { LivingEntity } from './living';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { ItemStack, getItem } from '../game/items';
import { BLOCKS } from '../world/blocks';
import { POTION_BY_KEY, potionColor } from '../game/potiondata';
import type { Snowball } from './item';

export class ThrownPotion extends Entity {
  typeName = 'ThrownPotion';
  persist = false;
  constructor(world: World, public game: Game, public shooter: Entity | null, public item: ItemStack) {
    super(world);
    this.width = this.height = 0.25;
  }

  override tick() {
    const nx = this.x + this.vx, ny = this.y + this.vy, nz = this.z + this.vz;
    const ent = this.game.interact!.projectileHitEntity(this as unknown as Snowball, nx, ny, nz);
    const p = this.game.player!;
    const hitPlayer = this.shooter !== p && this.age > 2 && !p.dead && !p.spectator && Math.abs(nx - p.x) < 0.5 && ny > p.y && ny < p.y + 1.8 && Math.abs(nz - p.z) < 0.5;
    const id = this.world.getId(Math.floor(nx), Math.floor(ny), Math.floor(nz));
    if (ent || hitPlayer || BLOCKS[id].solid) {
      this.shatter(ent ?? (hitPlayer ? p : null));
      return;
    }
    this.x = nx; this.y = ny; this.z = nz;
    this.updateFluidState();
    const drag = this.inWater ? 0.8 : 0.99;
    this.vx *= drag; this.vy *= drag; this.vz *= drag;
    this.vy -= 0.05;
    if (this.age > 600) this.removed = true;
  }

  private shatter(direct: Entity | null) {
    const g = this.game;
    this.removed = true;
    const d = getItem(this.item.id);
    const type = POTION_BY_KEY.get(d.potion ?? 'water')!;
    const col = potionColor(type.effects);
    const targets: LivingEntity[] = [g.player!, ...(g.entities.filter((e) => e instanceof LivingEntity) as LivingEntity[])];
    for (const e of targets) {
      if (e.dead || e.removed || (e === g.player && g.player!.spectator)) continue;
      const dist = Math.hypot(e.x - this.x, e.y + e.height / 2 - this.y, e.z - this.z);
      if (dist > 4 && e !== direct) continue;
      const scale = e === direct ? 1 : 1 - dist / 4;
      for (const [id, dur, amp] of type.effects) {
        const t = Math.floor(dur * scale + 0.5);
        if (dur <= 1) e.addEffect(id, 1, amp, scale);
        else if (t > 20) e.addEffect(id, t, amp);
      }
    }
    // shattering glass and a burst of coloured swirls
    g.audio.play('glass.break', this, 1, 0.9 + Math.random() * 0.1);
    const layer = g.interact!.spriteLayer(d.sprite ?? 'glass_bottle');
    for (let i = 0; i < 8; i++)
      g.particles!.add({ x: this.x, y: this.y, z: this.z, vx: (Math.random() - 0.5) * 0.2, vy: Math.random() * 0.2, vz: (Math.random() - 0.5) * 0.2, layer, u0: 0.3, v0: 0.3, u1: 0.55, v1: 0.55, size: 0.06, life: 15 });
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, sp = Math.random() * 0.25 + 0.05;
      g.particles!.swirl(this.x, this.y + 0.2, this.z, Math.cos(a) * sp, 0.03 + Math.random() * 0.05, Math.sin(a) * sp, col);
    }
  }
}
