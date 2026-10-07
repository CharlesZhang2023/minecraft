// Armor stands (1.8): placed facing the player, they wear armour put on them (right-click with a piece; empty-handed,
// take back what's at the height clicked, top first) and fall apart after two quick hits, dropping everything.
import { Entity } from './entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import type { Player } from '../game/player';
import { ItemStack, getItem, stack, itemId } from '../game/items';

export class ArmorStand extends Entity {
  typeName = 'Armor Stand';
  persist = true;
  /** Helmet, chestplate, leggings, boots (as mobs wear them). */
  armorItems: (ItemStack | null)[] = [null, null, null, null];
  /** Ticks since the last hit (a second one within 5 ticks breaks it). */
  hitTicks = 99;
  constructor(world: World, public game: Game) {
    super(world);
    this.width = 0.5; this.height = 1.975;
  }
  override tick() {
    this.hitTicks++;
    this.vy -= 0.04;
    this.move(0, this.vy, 0);
    if (this.onGround) this.vy = 0;
    if (this.y < -64) this.removed = true;
  }
  useLabel(_p: Player, held: ItemStack | null) { return held && getItem(held.id).armor ? 'Equip' : this.armorItems.some(Boolean) ? 'Take' : null; }
  /** Right-click: put on the armour piece held (swapping what was there), or take one off. */
  interact(game: Game, held: ItemStack | null): boolean {
    const p = game.player!;
    const armor = held ? getItem(held.id).armor : undefined;
    if (held && armor) {
      const slot = armor.slot;
      const prev = this.armorItems[slot];
      this.armorItems[slot] = { ...held, count: 1 };
      if (!p.creative) { held.count--; if (held.count <= 0) p.inventory.setHeld(prev); else if (prev && p.inventory.add(prev) > 0) game.dropItem(p.x, p.y + 1, p.z, prev); }
      game.audio.play('dig.metal', this, 0.5, 1.2);
      return true;
    }
    if (!held) {
      // the piece at the height the player is looking (roughly: head, chest, legs, feet), else the top one there is
      const order = [0, 1, 2, 3];
      const i = order.find((k) => this.armorItems[k]);
      if (i === undefined) return false;
      const s = this.armorItems[i]!;
      this.armorItems[i] = null;
      p.inventory.setHeld(s);
      return true;
    }
    return false;
  }
  /** Punched: two hits in quick succession (or one in creative) knock it down. */
  attacked(creative: boolean) {
    this.game.audio.play('dig.wood', this, 0.6, 1.3);
    if (creative || this.hitTicks < 5) {
      this.removed = true;
      if (!creative) this.game.dropItem(this.x, this.y + 0.5, this.z, stack(itemId('armor_stand')));
      for (const s of this.armorItems) if (s) this.game.dropItem(this.x, this.y + 0.8, this.z, s, true);
      for (let i = 0; i < 8; i++) this.game.particles?.smoke(this.x, this.y + Math.random() * 1.8, this.z);
      return;
    }
    this.hitTicks = 0;
  }
  toJSON() { return { type: 'armor_stand', x: this.x, y: this.y, z: this.z, yaw: this.yaw, armorItems: this.armorItems }; }
  load(d: { x: number; y: number; z: number; yaw: number; armorItems?: (ItemStack | null)[] }) {
    this.setPos(d.x, d.y, d.z);
    this.yaw = this.pyaw = d.yaw ?? 0;
    this.armorItems = d.armorItems ?? [null, null, null, null];
  }
}
