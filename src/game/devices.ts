// Item-moving redstone devices: hoppers, dispensers and droppers, plus generic container access
// (used by hoppers, droppers and comparators).
import type { Game } from './game';
import type { World } from '../world/world';
import { B, B2, BLOCKS, FACING6, SHULKER_BOXES, idOf, metaOf, pack } from '../world/blocks';
import { ItemStack, getItem, sameItem, I, I2, I3, I6, stack, DISCS } from './items';
import { Arrow, Snowball, PrimedTnt, ItemEntity, Fireball } from '../entity/item';
import { Boat } from '../entity/boat';
import { ThrownPotion } from '../entity/potion';
import { FireworkRocket } from '../entity/firework';
import { Random } from '../noise';

export type Slots = (ItemStack | null)[];

/** A container view: which slots can be inserted into / extracted from a given side. */
export interface Container {
  slots: Slots;
  insertSlots(face: number): number[]; // face = FACING6 index of the side the item enters from
  extractSlots(face: number): number[];
  accepts?(slot: number, s: ItemStack): boolean;
  changed(): void;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Container at a block position (chest, furnace, hopper, dispenser, dropper, brewing stand). */
export function containerAt(w: World, x: number, y: number, z: number): Container | null {
  const id = w.getId(x, y, z);
  const t = w.getTile(x, y, z) as { type: string; items?: Slots; slots?: Slots } | undefined;
  const mark = () => { const c = w.chunkAt(x, z); if (c) c.modified = true; };
  if (id === B.CHEST) {
    let tile = t as { type: 'chest'; items: Slots } | undefined;
    if (!tile) { tile = { type: 'chest', items: new Array(27).fill(null) }; w.setTile(x, y, z, tile); }
    return { slots: tile.items, insertSlots: () => range(27), extractSlots: () => range(27), changed: mark };
  }
  if ((id === B.FURNACE || id === B.LIT_FURNACE) && t?.slots) {
    return {
      slots: t.slots,
      insertSlots: (face) => (face === 1 ? [0] : face === 0 ? [] : [1]),
      extractSlots: (face) => (face === 0 ? [2] : face === 1 ? [] : [1]),
      accepts: (slot, s) => slot !== 1 || !!getItem(s.id).fuel,
      changed: mark,
    };
  }
  if ((id === B.HOPPER || id === B.DISPENSER || id === B.DROPPER) && t?.items) {
    const n = t.items.length;
    return { slots: t.items, insertSlots: () => range(n), extractSlots: () => range(n), changed: mark };
  }
  if (id === B.BREWING_STAND && t?.items) {
    return {
      slots: t.items,
      insertSlots: (face) => (face === 1 ? [3] : [0, 1, 2, 4]),
      extractSlots: () => [0, 1, 2],
      accepts: (slot, s) => {
        const d = getItem(s.id);
        if (slot === 4) return s.id === I2.BLAZE_POWDER;
        if (slot < 3) return !!d.potion || s.id === I3.GLASS_BOTTLE;
        return true;
      },
      changed: mark,
    };
  }
  return null;
}

/** Comparator reading of a container: -1 if not a container. */
export function containerLevel(w: World, x: number, y: number, z: number): number {
  const id = w.getId(x, y, z);
  const special = blockLevel(w, x, y, z, id);
  if (special !== null) return special;
  if (id !== B.CHEST && id !== B.FURNACE && id !== B.LIT_FURNACE && id !== B.HOPPER && id !== B.DISPENSER && id !== B.DROPPER && id !== B.BREWING_STAND
    && id !== B2.BARREL && id !== B2.TRAPPED_CHEST && id !== B2.SMOKER && id !== B2.BLAST_FURNACE && id !== B2.SHULKER_BOX && !SHULKER_BOXES.includes(id)) return -1;
  const t = w.getTile(x, y, z) as { items?: Slots; slots?: Slots } | undefined;
  const slots = t?.items ?? t?.slots;
  if (!slots) return 0;
  let f = 0, any = false;
  for (const s of slots) if (s) { f += s.count / getItem(s.id).maxStack; any = true; }
  return any ? Math.floor(1 + (f / slots.length) * 14) : 0;
}

/**
 * What comparators read from blocks that aren't plain containers (vanilla): a cauldron's water, a cake's slices, a
 * composter's fill, a filled end portal frame, a jukebox's disc, a lectern's page, a hive's honey, an anchor's charges.
 */
function blockLevel(w: World, x: number, y: number, z: number, id: number): number | null {
  const m = metaOf(w.get(x, y, z));
  const t = w.getTile(x, y, z) as Record<string, unknown> | undefined;
  switch (id) {
    case B2.CAULDRON: return m & 3;
    case B2.CAKE: return (7 - Math.min(6, m)) * 2;
    case B2.COMPOSTER: return Math.min(8, m);
    case B.END_PORTAL_FRAME: return m & 4 ? 15 : 0;
    case B2.RESPAWN_ANCHOR: return Math.floor((Math.min(4, m) * 15) / 4);
    case B2.BEEHIVE: case B2.BEE_NEST: return Math.min(5, (t?.honey as number) ?? 0);
    case B2.JUKEBOX: {
      const d = t?.disc as ItemStack | null | undefined;
      return d ? Math.max(1, DISCS.indexOf(d.id) + 1) : 0;
    }
    case B2.LECTERN: {
      const book = (t?.items as (ItemStack | null)[] | undefined)?.[0];
      if (!book) return 0;
      const n = Math.max(1, ((book.tag?.pages as string[] | undefined) ?? []).length);
      const page = (t?.page as number) ?? 0;
      return n <= 1 ? 15 : Math.floor((page / (n - 1)) * 14) + 1;
    }
  }
  return null;
}

/** Insert up to s.count items; returns the number left over. */
export function insertInto(c: Container, s: ItemStack, face: number, max = s.count): number {
  let left = Math.min(max, s.count);
  const total = left;
  const lim = getItem(s.id).maxStack;
  for (const i of c.insertSlots(face)) {
    if (!left) break;
    if (c.accepts && !c.accepts(i, s)) continue;
    const t = c.slots[i];
    if (!t) { c.slots[i] = { ...s, count: Math.min(left, lim) }; left -= Math.min(left, lim); }
    else if (sameItem(t, s) && t.count < lim) { const k = Math.min(lim - t.count, left); t.count += k; left -= k; }
  }
  if (left !== total) c.changed();
  return s.count - (total - left);
}

export class Devices {
  private rng = new Random(9173);
  constructor(private game: Game) {}
  get w(): World { return this.game.world!; }

  // ---------------------------------------------------------------- dispensers & droppers
  dispense(x: number, y: number, z: number) {
    const g = this.game, w = this.w;
    const v = w.get(x, y, z);
    const id = idOf(v), f = metaOf(v) & 7;
    const t = w.getTile(x, y, z) as { items?: Slots } | undefined;
    const at = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
    const full = (t?.items ?? []).map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    if (!t?.items || !full.length) { g.audio.play('click', at, 1, 1.2); return; }
    const slot = full[this.rng.int(full.length)];
    const s = t.items[slot]!;
    const [dx, dy, dz] = FACING6[f];
    const fx = x + dx, fy = y + dy, fz = z + dz;
    const ox = x + 0.5 + dx * 0.7, oy = y + 0.5 + dy * 0.7 - (dy === 0 ? 0.15 : 0), oz = z + 0.5 + dz * 0.7;
    const take = (n = 1) => { s.count -= n; if (s.count <= 0) t.items![slot] = null; this.changed(x, y, z); };
    const smoke = () => { for (let i = 0; i < 6; i++) g.particles!.smoke(ox + dx * 0.2 + (this.rng.next() - 0.5) * 0.3, oy + (this.rng.next() - 0.5) * 0.3, oz + dz * 0.2 + (this.rng.next() - 0.5) * 0.3, false); };
    if (id === B.DROPPER) {
      const target = containerAt(w, fx, fy, fz);
      if (target) {
        const left = insertInto(target, s, f ^ 1, 1);
        if (left < s.count) { take(1); g.audio.play('click', at, 1, 1); }
        else g.audio.play('click', at, 1, 1.2);
        return;
      }
      this.shootItem({ ...s, count: 1 }, ox, oy, oz, dx, dy, dz);
      take(1);
      g.audio.play('click', at, 1, 1); smoke();
      return;
    }
    // dispenser behaviours
    const d = getItem(s.id);
    const done = () => { g.audio.play('click', at, 1, 1); smoke(); };
    if (s.id === I.ARROW) {
      const a = new Arrow(w, g, null);
      a.setPos(ox, oy, oz);
      a.shoot(dx, dy + 0.1, dz, 1.1, 6);
      g.addEntity(a); take(); g.audio.play('bow', at, 1, 1.2); return;
    }
    if (s.id === I.SNOWBALL || s.id === I.EGG) {
      const e = new Snowball(w, g, null, s.id === I.SNOWBALL ? 'snowball' : 'egg');
      e.setPos(ox, oy, oz);
      e.vx = dx * 1.1 + (this.rng.next() - 0.5) * 0.05; e.vy = dy * 1.1 + 0.1; e.vz = dz * 1.1 + (this.rng.next() - 0.5) * 0.05;
      g.addEntity(e); take(); g.audio.play('bow', at, 0.5, 1.2); return;
    }
    if (s.id === I6.FIREWORK_ROCKET) {
      // straight up from in front of it (1.12)
      const r = new FireworkRocket(w, g, { ...s, count: 1 });
      r.setPos(fx + 0.5, y + 0.2, fz + 0.5);
      g.addEntity(r); take(); return;
    }
    if (s.id === I.FIRE_CHARGE) {
      const fb = new Fireball(w, g, null, dx + (this.rng.next() - 0.5) * 0.1, dy + (this.rng.next() - 0.5) * 0.1, dz + (this.rng.next() - 0.5) * 0.1);
      fb.small = true;
      fb.setPos(ox, oy - 0.5, oz);
      g.addEntity(fb); take(); g.audio.play('fireball', at, 1, 1); return;
    }
    if (d.splash) {
      const p = new ThrownPotion(w, g, null, { ...s, count: 1 });
      p.setPos(ox, oy, oz);
      p.vx = dx * 1.1; p.vy = dy * 1.1 + 0.1; p.vz = dz * 1.1;
      g.addEntity(p); take(); g.audio.play('bow', at, 0.5, 1.2); return;
    }
    if (d.egg) {
      const m = g.interact!.spawnMob(d.egg, fx + 0.5, fy + (dy < 0 ? 0 : 0), fz + 0.5);
      if (m) { take(); done(); } else g.audio.play('click', at, 1, 1.2);
      return;
    }
    if (s.id === I.BONE_MEAL) {
      if (g.ticker!.fertilize(fx, fy, fz)) { take(); done(); } else g.audio.play('click', at, 1, 1.2);
      return;
    }
    if (s.id === I.WATER_BUCKET || s.id === I.LAVA_BUCKET) {
      const cur = w.getId(fx, fy, fz);
      if (BLOCKS[cur].replaceable && !(cur !== B.AIR && BLOCKS[cur].fluid && metaOf(w.get(fx, fy, fz)) === 0)) {
        const fluid = s.id === I.WATER_BUCKET ? B.WATER : B.LAVA;
        w.set(fx, fy, fz, fluid);
        g.ticker!.schedule(fx, fy, fz, fluid === B.WATER ? 5 : 30);
        t.items[slot] = stack(I.BUCKET);
        this.changed(x, y, z);
        g.audio.play(fluid === B.WATER ? 'splash' : 'fizz', at, 0.5, 1);
      } else this.dropFallback(s, slot, t.items, ox, oy, oz, dx, dy, dz, x, y, z);
      return;
    }
    if (s.id === I.BUCKET) {
      const fv = w.get(fx, fy, fz);
      if ((idOf(fv) === B.WATER || idOf(fv) === B.LAVA) && metaOf(fv) === 0) {
        w.set(fx, fy, fz, B.AIR);
        const filled = stack(idOf(fv) === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET);
        take();
        const c = containerAt(w, x, y, z)!;
        if (insertInto(c, filled, 1) > 0) this.shootItem(filled, ox, oy, oz, dx, dy, dz);
        g.audio.play('splash', at, 0.4, 1);
      } else this.dropFallback(s, slot, t.items, ox, oy, oz, dx, dy, dz, x, y, z);
      return;
    }
    if (s.id === I.FLINT_AND_STEEL) {
      const cur = w.getId(fx, fy, fz);
      if (cur === B.TNT) { w.set(fx, fy, fz, B.AIR); g.interact!.primeTnt(fx, fy, fz); }
      else if (cur === B.AIR) { w.set(fx, fy, fz, B.FIRE); g.ticker!.schedule(fx, fy, fz, 30); }
      else { g.audio.play('click', at, 1, 1.2); return; }
      s.damage = (s.damage ?? 0) + 1;
      if (s.damage >= (d.durability ?? 64)) t.items[slot] = null;
      this.changed(x, y, z);
      g.audio.play('fire', at, 1, 1);
      return;
    }
    if (s.id === B.TNT) {
      const e = new PrimedTnt(w, g);
      e.setPos(fx + 0.5, fy, fz + 0.5);
      g.addEntity(e); take(); g.audio.play('fuse', at, 1, 1); return;
    }
    if (s.id === I2.BOAT) {
      const water = w.getId(fx, fy, fz) === B.WATER;
      const below = w.getId(fx, fy - 1, fz) === B.WATER;
      if (water || below) {
        const b = new Boat(w, g);
        b.setPos(fx + 0.5, water ? fy + 0.52 : fy, fz + 0.5);
        b.yaw = b.pyaw = [0, 0, 180, 0, 90, 270][f];
        g.addEntity(b); take(); done(); return;
      }
    }
    this.dropFallback(s, slot, t.items, ox, oy, oz, dx, dy, dz, x, y, z);
  }

  private dropFallback(s: ItemStack, slot: number, items: Slots, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x: number, y: number, z: number) {
    this.shootItem({ ...s, count: 1 }, ox, oy, oz, dx, dy, dz);
    s.count--;
    if (s.count <= 0) items[slot] = null;
    this.changed(x, y, z);
    this.game.audio.play('click', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 1, 1);
  }

  /** Vanilla BehaviorDefaultDispenseItem.doDispense. */
  private shootItem(s: ItemStack, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
    const g = this.game;
    const e = new ItemEntity(this.w, g, s);
    e.setPos(ox, oy - (dy === 0 ? 0.125 : 0.15625), oz);
    const sp = this.rng.next() * 0.1 + 0.2;
    e.vx = dx * sp + (this.rng.next() - 0.5) * 0.015 * 6;
    e.vy = 0.2 + (this.rng.next() - 0.5) * 0.015 * 6;
    e.vz = dz * sp + (this.rng.next() - 0.5) * 0.015 * 6;
    if (dy) e.vy = dy * sp;
    e.pickupDelay = 10;
    g.addEntity(e);
  }

  private changed(x: number, y: number, z: number) {
    const c = this.w.chunkAt(x, z);
    if (c) c.modified = true;
    this.game.ui.containerChanged(x, y, z);
  }

  // ---------------------------------------------------------------- hoppers
  /** Tick every hopper in loaded chunks (vanilla: 8 tick transfer cooldown). */
  tick() {
    const w = this.w, g = this.game;
    for (const c of w.chunks.values()) {
      if (!c.ready || !c.tiles.size) continue;
      for (const [i, tile] of c.tiles) {
        if (tile.type !== 'hopper') continue;
        const t = tile as unknown as { type: 'hopper'; items: Slots; cooldown: number };
        const x = c.cx * 16 + (i & 15), z = c.cz * 16 + ((i >> 4) & 15), y = i >> 8;
        const v = w.get(x, y, z);
        if (idOf(v) !== B.HOPPER) continue;
        // collect item entities lying in / above the hopper
        this.collectItems(t, x, y, z);
        if (--t.cooldown > 0) continue;
        t.cooldown = 0;
        if (metaOf(v) & 8) continue; // locked by redstone
        let moved = false;
        // push one item
        const f = metaOf(v) & 7;
        const [dx, dy, dz] = FACING6[f === 1 ? 0 : f];
        const target = containerAt(w, x + dx, y + dy, z + dz);
        if (target) {
          for (let k = 0; k < t.items.length && !moved; k++) {
            const s = t.items[k];
            if (!s) continue;
            if (insertInto(target, s, (f === 1 ? 0 : f) ^ 1, 1) < s.count) {
              s.count--;
              if (s.count <= 0) t.items[k] = null;
              moved = true;
            }
          }
        }
        // pull one item from above
        const src = containerAt(w, x, y + 1, z);
        if (src) {
          const own: Container = { slots: t.items, insertSlots: () => [0, 1, 2, 3, 4], extractSlots: () => [], changed: () => {} };
          for (const k of src.extractSlots(0)) {
            const s = src.slots[k];
            if (!s) continue;
            if (insertInto(own, s, 1, 1) < s.count) {
              s.count--;
              if (s.count <= 0) src.slots[k] = null;
              src.changed();
              g.ui.containerChanged(x, y + 1, z);
              moved = true;
              break;
            }
          }
        }
        if (moved) {
          t.cooldown = 8;
          c.modified = true;
          g.ui.containerChanged(x, y, z);
        }
      }
    }
  }

  private collectItems(t: { items: Slots }, x: number, y: number, z: number) {
    const g = this.game;
    for (const e of g.entities) {
      if (!(e instanceof ItemEntity) || e.removed) continue;
      if (e.x < x || e.x > x + 1 || e.z < z || e.z > z + 1 || e.y < y + 0.6 || e.y > y + 2) continue;
      const own: Container = { slots: t.items, insertSlots: () => [0, 1, 2, 3, 4], extractSlots: () => [], changed: () => {} };
      const left = insertInto(own, e.item, 1);
      if (left < e.item.count) {
        e.item.count = left;
        if (left <= 0) e.removed = true;
        g.ui.containerChanged(x, y, z);
      }
    }
  }
}
