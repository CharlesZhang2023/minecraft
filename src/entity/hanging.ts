// Things hung on walls: item frames (show an item, turn it in eighths; the End ship keeps its elytra in one) and
// paintings (art of a few sizes, picked to fit the wall). Both fall off when their wall goes.
import { Entity } from './entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { B, HORIZ, OPAQUE, PAINTINGS } from '../world/blocks';
import { I7, ItemStack, itemByName, stack } from '../game/items';
import type { Player } from '../game/player';

export abstract class Hanging extends Entity {
  /** The direction of the wall it hangs on (HORIZ index: 0 north, 1 east, 2 south, 3 west). */
  facing = 0;
  /** The block cell it occupies (in front of the wall). */
  bx = 0; by = 0; bz = 0;
  persist = true;
  constructor(world: World, public game: Game) {
    super(world);
    this.width = 0.75; this.height = 0.75;
  }
  /** Hang it in cell (x, y, z) against the wall in direction `facing`. */
  hang(x: number, y: number, z: number, facing: number) {
    this.bx = x; this.by = y; this.bz = z; this.facing = facing & 3;
    const [dx, dz] = HORIZ[this.facing];
    this.setPos(x + 0.5 + dx * 0.46, y + 0.5 - this.height / 2, z + 0.5 + dz * 0.46);
    this.yaw = this.pyaw = [180, 270, 0, 90][this.facing];
  }
  /** Still against something solid? */
  supported(): boolean {
    const [dx, dz] = HORIZ[this.facing];
    return OPAQUE[this.world.getId(this.bx + dx, this.by, this.bz + dz)] === 1;
  }
  override tick() {
    if (this.age % 20 === 0 && !this.supported()) this.breakOff(true);
    this.age++;
  }
  abstract breakOff(drop: boolean): void;
}

export class ItemFrame extends Hanging {
  typeName = 'Item Frame';
  item: ItemStack | null = null;
  /** In eighths of a turn. */
  rotation = 0;
  /** Placed by the world (End ships): what spawn hints call with. */
  set facingHint(f: number) { this.facing = f; }
  /** Placed by a structure: find the wall and turn the item's name into an item. */
  fromHint() { this.settle(); }
  /** Find the wall next to where it was put (hints place it in the cell, facing a wall). */
  settle() {
    const x = Math.floor(this.x), y = Math.floor(this.y), z = Math.floor(this.z);
    let f = this.facing;
    if (!OPAQUE[this.world.getId(x + HORIZ[f][0], y, z + HORIZ[f][1])]) f = [0, 1, 2, 3].find((d) => OPAQUE[this.world.getId(x + HORIZ[d][0], y, z + HORIZ[d][1])] === 1) ?? f;
    this.hang(x, y, z, f);
    const it = this.item as unknown as { id: number | string; count: number } | null;
    if (it && typeof it.id === 'string') this.item = stack(itemByName(it.id)?.id ?? 0, it.count ?? 1);
  }
  /** Right-click: put the held item in, or turn the one inside. */
  interact(game: Game, held: ItemStack | null): boolean {
    if (!this.item) {
      if (!held) return false;
      this.item = { ...held, count: 1 };
      game.interact!.consume(1);
      game.audio.play('itemframe.add', this, 1, 1);
      return true;
    }
    this.rotation = (this.rotation + 1) & 7;
    game.audio.play('itemframe.rotate', this, 1, 1);
    return true;
  }
  useLabel(_p: Player, held: ItemStack | null) { return this.item ? 'Rotate' : held ? 'Place' : null; }
  /** Hit: the item pops out first, then the frame comes down. */
  attacked(creative: boolean) {
    if (this.item) {
      if (!creative) this.game.dropItem(this.x, this.y + 0.2, this.z, this.item);
      this.item = null;
      this.game.audio.play('itemframe.remove', this, 1, 1);
      return;
    }
    this.breakOff(!creative);
  }
  breakOff(drop: boolean) {
    if (this.removed) return;
    this.removed = true;
    if (drop) {
      this.game.dropItem(this.x, this.y + 0.2, this.z, stack(I7.ITEM_FRAME));
      if (this.item) this.game.dropItem(this.x, this.y + 0.2, this.z, this.item);
    }
    this.game.playBlockSound(B.OAK_PLANKS, Math.floor(this.x), Math.floor(this.y), Math.floor(this.z), 'break');
  }
  toJSON() { return { type: 'item_frame', x: this.x, y: this.y, z: this.z, bx: this.bx, by: this.by, bz: this.bz, facing: this.facing, item: this.item, rotation: this.rotation }; }
  load(d: { bx: number; by: number; bz: number; facing: number; item: ItemStack | null; rotation: number }) {
    this.item = d.item ?? null;
    this.rotation = d.rotation ?? 0;
    this.hang(d.bx, d.by, d.bz, d.facing);
  }
}

/** Paintings: sizes in blocks (vanilla's 26 motifs, painted procedurally: textures2.ts). */
export { PAINTINGS };
export class Painting extends Hanging {
  typeName = 'Painting';
  motif = 0;
  get size(): [number, number] { const m = PAINTINGS[this.motif]; return [m[1], m[2]]; }
  /** Pick the biggest motifs that fit the wall around (x, y, z) at random, and hang it centred. */
  place(x: number, y: number, z: number, facing: number, pick: () => number): boolean {
    const fits = PAINTINGS.map((_, i) => i).filter((i) => this.fits(x, y, z, facing, PAINTINGS[i][1], PAINTINGS[i][2]));
    if (!fits.length) return false;
    const best = Math.max(...fits.map((i) => PAINTINGS[i][1] * PAINTINGS[i][2]));
    const list = fits.filter((i) => PAINTINGS[i][1] * PAINTINGS[i][2] === best);
    this.motif = list[Math.floor(pick() * list.length)];
    this.hang(x, y, z, facing);
    const [w, h] = this.size;
    // centred on the clicked cell (rounding toward the low corner for even sizes)
    const [rx, rz] = HORIZ[(facing + 1) & 3];
    const along = -Math.floor((w - 1) / 2) + (w - 1) / 2, up = -Math.floor((h - 1) / 2);
    this.width = Math.max(w, 1); this.height = h;
    this.setPos(this.x + rx * along, y + up, this.z + rz * along);
    return true;
  }
  private fits(x: number, y: number, z: number, facing: number, w: number, h: number) {
    const [dx, dz] = HORIZ[facing];
    // along the wall: to the right of the facing (clockwise)
    const [rx, rz] = HORIZ[(facing + 1) & 3];
    const x0 = -Math.floor((w - 1) / 2), y0 = -Math.floor((h - 1) / 2);
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
      const cx = x + rx * (x0 + i), cy = y + y0 + j, cz = z + rz * (x0 + i);
      if (this.world.getId(cx, cy, cz) !== B.AIR) return false;
      if (!OPAQUE[this.world.getId(cx + dx, cy, cz + dz)]) return false;
    }
    return true;
  }
  attacked(creative: boolean) { this.breakOff(!creative); }
  breakOff(drop: boolean) {
    if (this.removed) return;
    this.removed = true;
    if (drop) this.game.dropItem(this.x, this.y + 0.2, this.z, stack(I7.PAINTING));
    this.game.playBlockSound(B.OAK_PLANKS, Math.floor(this.x), Math.floor(this.y), Math.floor(this.z), 'break');
  }
  toJSON() { return { type: 'painting', x: this.x, y: this.y, z: this.z, bx: this.bx, by: this.by, bz: this.bz, facing: this.facing, motif: this.motif }; }
  load(d: { bx: number; by: number; bz: number; facing: number; motif: number; x: number; y: number; z: number }) {
    this.motif = d.motif ?? 0;
    this.hang(d.bx, d.by, d.bz, d.facing);
    const [w, h] = this.size;
    this.width = w; this.height = h;
    this.setPos(d.x, d.y, d.z);
  }
}
