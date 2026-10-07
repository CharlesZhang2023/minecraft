// What the 1.9 - 1.16 blocks do when used, and their tile entities: workstations open their screens, composters
// take plant matter, cauldrons hold water, note blocks and jukeboxes play, cakes get eaten, flower pots hold
// plants, campfires cook, daylight detectors watch the sky, bells ring; and the item-on-block uses that came with
// them (stripping logs, carving pumpkins, paths, waterlogging with buckets).
import type { Game } from './game';
import type { World } from '../world/world';
import type { Player } from './player';
import { commandTile } from './commandblocks';
import { B, B2, BLOCKS, OPAQUE, WOOD, SHULKER_BOXES, BANNERS, isCommandBlock, idOf, metaOf, pack, WATERLOGGED, waterloggable, blockByName, isLog } from '../world/blocks';
import { I, I3, I7, I11, ItemStack, ItemDef, getItem, stack, POTION_ITEMS, DISCS, isDyeable, DYES } from './items';
import { SMELTING } from './recipes';
import { POT_PLANTS } from '../world/models';
import { Random } from '../noise';
import { tickHive, harvestHive, type HiveTile } from '../entity/bees';
import { tickBeacon, tickConduit, type BeaconTile, type ConduitTile } from './beacon';

/** The interaction (one player's hands) as stations see it. */
export interface Hands {
  game: Game;
  world: World;
  player: Player;
  consume(n: number): void;
  damageHeld(n: number): void;
}
const rng = new Random(0x57a7);
const at = (x: number, y: number, z: number) => ({ x: x + 0.5, y: y + 0.5, z: z + 0.5 });

/** Composter chances by item (vanilla 1.16). */
const COMPOST: Map<number, number> = new Map();
export function compostChance(id: number): number {
  if (!COMPOST.size) {
    const add = (p: number, ids: number[]) => { for (const i of ids) COMPOST.set(i, p); };
    const leaves = BLOCKS.filter((b) => b.shape === 14).map((b) => b.id);
    const saplings = Object.values(WOOD).map((w) => w.sapling);
    add(0.3, [I.WHEAT_SEEDS, I.PUMPKIN_SEEDS, I7.MELON_SEEDS, I7.BEETROOT_SEEDS, B.TALL_GRASS, B2.SEAGRASS, B2.KELP, I7.SWEET_BERRIES, I7.DRIED_KELP, ...leaves, ...saplings]);
    add(0.5, [B.CACTUS, I.SUGAR_CANE, B2.VINE, I.MELON_SLICE, B2.TALL_GRASS2, B2.NETHER_SPROUTS, B2.WEEPING_VINES, B2.TWISTING_VINES, B2.DRIED_KELP_BLOCK]);
    add(0.65, [B.DANDELION, B.POPPY, B2.BLUE_ORCHID, B.ALLIUM, B2.AZURE_BLUET, B2.RED_TULIP, B2.ORANGE_TULIP, B2.WHITE_TULIP, B2.PINK_TULIP, B.OXEYE_DAISY, B.CORNFLOWER, B2.LILY_OF_THE_VALLEY, B2.WITHER_ROSE,
      B2.SUNFLOWER, B2.LILAC, B2.ROSE_BUSH, B2.PEONY, B2.LARGE_FERN, B.FERN, I3.CARROT, I3.POTATO, I.WHEAT, I.APPLE, I7.BEETROOT, B.PUMPKIN, B.MELON, B.LILY_PAD, I3.NETHER_WART, B.BROWN_MUSHROOM, B.RED_MUSHROOM,
      B2.CRIMSON_ROOTS, B2.WARPED_ROOTS, WOOD.crimson.sapling, WOOD.warped.sapling, B2.SEA_PICKLE, I.COCOA]);
    add(0.85, [I.BREAD, I3.BAKED_POTATO, I.COOKIE, B2.BROWN_MUSHROOM_BLOCK, B2.RED_MUSHROOM_BLOCK, B2.MUSHROOM_STEM, B.HAY_BLOCK, WOOD.crimson.leaves, WOOD.warped.leaves, B2.SHROOMLIGHT]);
    add(1, [I7.CAKE, I7.PUMPKIN_PIE]);
  }
  return COMPOST.get(id) ?? 0;
}

/** Right-click on one of the new blocks. Returns true if it did something. */
export const isShulkerBox = (id: number) => id === B2.SHULKER_BOX || SHULKER_BOXES.includes(id);
export function stationUse(h: Hands, x: number, y: number, z: number, v: number, held: ItemStack | null): boolean {
  const g = h.game, w = h.world, p = h.player;
  const id = idOf(v), m = metaOf(v);
  // the dyed shulker boxes open like the plain one
  if (SHULKER_BOXES.includes(id)) return stationUse(h, x, y, z, pack(B2.SHULKER_BOX, m), held) && (w.getId(x, y, z) === id || true);
  // a dye on a sign colours its words (1.14)
  if (held && DYES.includes(held.id) && /_sign$/.test(BLOCKS[id]?.name ?? '')) {
    const t = (w.getTile(x, y, z) as unknown as { type: string; lines?: string[]; color?: number } | undefined) ?? { type: 'sign', lines: ['', '', '', ''] };
    const c = DYES.indexOf(held.id);
    if (t.color === c) return false;
    w.setTile(x, y, z, { ...t, color: c } as never);
    h.consume(1);
    g.audio.play('dig.cloth', at(x, y, z), 0.4, 1.4);
    return true;
  }
  // command blocks: only someone in creative may edit them
  if (isCommandBlock(id)) { if (!p.creative) return false; commandTile(w, x, y, z); (g.ui as unknown as Record<string, ((...a: unknown[]) => void) | undefined>).openCommandBlock?.(x, y, z); return true; }
  const ui = g.ui as unknown as Record<string, ((...a: unknown[]) => void) | undefined>;
  switch (id) {
    case B2.SMOKER: case B2.BLAST_FURNACE: g.ui.openFurnace(x, y, z); return true;
    case B2.SHULKER_BOX:
      // a shulker box opens upward: something solid on top keeps it shut
      if (OPAQUE[w.getId(x, y + 1, z)]) return true;
      g.ui.openChest(x, y, z);
      g.audio.play('shulker.open', at(x, y, z), 0.5, 1);
      return true;
    case B2.RESPAWN_ANCHOR: {
      // glowstone charges it (four charges); used in the Nether it sets the spawn point, anywhere else it explodes
      if (held?.id === B.GLOWSTONE && m < 4) {
        w.set(x, y, z, pack(id, m + 1));
        g.achievements.event('anchor', { charges: m + 1 });
        h.consume(1);
        g.audio.play('anchor.charge', at(x, y, z), 1, 1);
        return true;
      }
      if (m === 0) return false;
      if (w.dimension !== 'nether') {
        w.set(x, y, z, 0);
        g.interact!.explode(x + 0.5, y + 0.5, z + 0.5, 5, true, null);
        return true;
      }
      if (p.spawnKind !== 'anchor' || p.spawnX !== x || p.spawnY !== y || p.spawnZ !== z) {
        p.spawnX = x; p.spawnY = y; p.spawnZ = z; p.spawnKind = 'anchor';
        g.ui.chat.add('Respawn point set');
        g.audio.play('anchor.set', at(x, y, z), 1, 1);
      }
      return true;
    }
    case B2.LODESTONE: {
      // a compass used on a lodestone points to it from then on (in this dimension)
      if (held?.id !== I.COMPASS) return false;
      const lc = { ...stack(I.COMPASS), lodestone: { x, y, z, dim: w.dimension }, name: 'Lodestone Compass', ench: {} } as ItemStack;
      if (held.count > 1) { held.count--; if (p.inventory.add(lc) > 0) g.dropItem(p.x, p.y + 1, p.z, lc); }
      else p.inventory.setHeld(lc);
      g.audio.play('lodestone.lock', at(x, y, z), 1, 1);
      g.achievements.event('lodestone');
      return true;
    }
    case B2.BEE_NEST: case B2.BEEHIVE:
      return harvestHive(g, p, x, y, z, held, (n) => h.consume(n), (s) => { if (p.inventory.add(s) > 0) g.dropItem(p.x, p.y + 1, p.z, s); });
    case B2.BARREL: g.ui.openChest(x, y, z); g.audio.play('chestOpen', at(x, y, z), 0.5, 1.1); return true;
    case B2.TRAPPED_CHEST:
      if (OPAQUE[w.getId(x, y + 1, z)]) return true;
      g.ui.openChest(x, y, z);
      g.audio.play('chestOpen', at(x, y, z), 0.5, 0.9);
      return true;
    case B2.SMITHING_TABLE: ui.openSmithing?.(x, y, z); return true;
    case B2.STONECUTTER: ui.openStonecutter?.(x, y, z); return true;
    case B2.BEACON: if (!w.getTile(x, y, z)) w.setTile(x, y, z, { type: 'beacon', levels: 0, primary: '', secondary: '', beam: 0 } as never); ui.openBeacon?.(x, y, z); return true;
    case B2.GRINDSTONE: ui.openGrindstone?.(x, y, z); return true;
    case B2.LOOM: ui.openLoom?.(x, y, z); return true;
    case B2.LECTERN: {
      // a lectern takes a book (and quill or written); with one on it, it opens at its page for anyone
      const t = w.getTile(x, y, z) as unknown as LecternTile | undefined;
      if (t?.items[0]) { ui.openLectern?.(x, y, z); return true; }
      if (held && (held.id === I7.WRITABLE_BOOK || held.id === I11.WRITTEN_BOOK)) {
        w.set(x, y, z, pack(id, m | 4));
        w.setTile(x, y, z, { type: 'lectern', items: [{ ...held, count: 1 }], page: 0 } as never);
        h.consume(1);
        g.audio.play('dig.cloth', at(x, y, z), 0.6, 1.2);
        return true;
      }
      return false;
    }
    case B2.CARTOGRAPHY_TABLE: ui.openCartography?.(x, y, z); return true;
    case B2.COMPOSTER: {
      if (m >= 8) {
        // ready: out comes bone meal
        w.set(x, y, z, pack(id, 0));
        g.dropItem(x + 0.5, y + 1.1, z + 0.5, stack(I.BONE_MEAL));
        g.audio.play('dig.gravel', at(x, y, z), 0.6, 1);
        return true;
      }
      if (!held || m >= 7) return false;
      const c = compostChance(held.id);
      if (!c) return false;
      h.consume(1);
      if (rng.next() < c) {
        const nm = m + 1;
        w.set(x, y, z, pack(id, nm));
        if (nm === 7) g.ticker!.schedule(x, y, z, 20);
      }
      g.audio.play('dig.grass', at(x, y, z), 0.6, 1.2);
      return true;
    }
    case B2.CAULDRON: {
      const lvl = m & 3;
      if (!held) return false;
      if (held.id === I.WATER_BUCKET) { w.set(x, y, z, pack(id, 3)); if (!p.creative) p.inventory.setHeld(stack(I.BUCKET)); g.audio.play('splash', at(x, y, z), 0.4, 1); return true; }
      if (held.id === I.BUCKET && lvl === 3) { w.set(x, y, z, pack(id, 0)); if (!p.creative) p.inventory.setHeld(stack(I.WATER_BUCKET)); g.audio.play('splash', at(x, y, z), 0.4, 1.2); return true; }
      if (held.id === I3.GLASS_BOTTLE && lvl > 0) {
        w.set(x, y, z, pack(id, lvl - 1));
        h.consume(1);
        if (!p.creative) p.inventory.add(stack(POTION_ITEMS.water));
        g.audio.play('splash', at(x, y, z), 0.3, 1.4);
        return true;
      }
      if (lvl > 0 && isDyeable(held.id) && held.tag?.color !== undefined) {
        const tag = { ...held.tag }; delete tag.color;
        p.inventory.setHeld({ ...held, tag });
        w.set(x, y, z, pack(id, lvl - 1));
        g.audio.play('splash', at(x, y, z), 0.3, 1.2);
        return true;
      }
      if (lvl > 0 && held.banner?.length && BANNERS.includes(held.id)) {
        const one: ItemStack = { ...held, count: 1, banner: held.banner.slice(0, -1) };
        if (!one.banner!.length) delete one.banner;
        if (held.count > 1) { held.count--; if (p.inventory.add(one) > 0) g.dropItem(p.x, p.y + 1, p.z, one); } else p.inventory.setHeld(one);
        w.set(x, y, z, pack(id, lvl - 1));
        g.audio.play('splash', at(x, y, z), 0.3, 1.2);
        return true;
      }
      if (held.id === POTION_ITEMS.water && lvl < 3) {
        w.set(x, y, z, pack(id, lvl + 1));
        if (!p.creative) p.inventory.setHeld(stack(I3.GLASS_BOTTLE));
        return true;
      }
      return false;
    }
    case B2.NOTE_BLOCK: {
      const nm = (m + 1) % 16;
      w.set(x, y, z, pack(id, nm));
      playNote(g, w, x, y, z, nm);
      return true;
    }
    case B2.JUKEBOX: {
      const t = w.getTile(x, y, z) as { type: 'jukebox'; disc: ItemStack | null } | undefined;
      if (t?.disc) {
        g.dropItem(x + 0.5, y + 1.1, z + 0.5, t.disc);
        w.setTile(x, y, z, { type: 'jukebox', disc: null } as never);
        g.audio.play('disc.stop', at(x, y, z), 1, 1);
        return true;
      }
      if (held && getItem(held.id).disc) {
        w.setTile(x, y, z, { type: 'jukebox', disc: { ...held, count: 1 } } as never);
        h.consume(1);
        g.audio.play('disc.' + getItem(held.id).disc, at(x, y, z), 1, 1);
        g.ui.hud.actionBar('Now Playing: C418 - ' + getItem(held.id).disc);
        return true;
      }
      return false;
    }
    case B2.CAKE: {
      if (!p.creative && p.food >= 20) return false;
      p.eat(2, 0.4);
      g.achievements.event('eat', { ate: 'cake' });
      if (m >= 6) w.set(x, y, z, B.AIR);
      else w.set(x, y, z, pack(id, m + 1));
      g.audio.play('eat', p, 0.5, 1);
      return true;
    }
    case B2.FLOWER_POT: {
      if (m) {
        if (held) return false;
        p.inventory.setHeld(stack(POT_PLANTS[m]));
        w.set(x, y, z, pack(id, 0));
        return true;
      }
      const k = held ? POT_PLANTS.indexOf(held.id) : -1;
      if (k <= 0) return false;
      w.set(x, y, z, pack(id, k));
      h.consume(1);
      return true;
    }
    case B2.CAMPFIRE: case B2.SOUL_CAMPFIRE: {
      if (!held) return false;
      const lit = (m & 4) === 0;
      if (getItem(held.id).tool?.type === 'shovel' && lit) {
        setKeep(w, x, y, z, pack(id, m | 4));
        g.audio.play('fizz', at(x, y, z), 0.5, 1);
        h.damageHeld(1);
        return true;
      }
      if (held.id === I.FLINT_AND_STEEL && !lit) { setKeep(w, x, y, z, pack(id, m & 3)); h.damageHeld(1); return true; }
      const r = SMELTING[held.id];
      if (!r?.food) return false;
      const t = campfireTile(w, x, y, z);
      const slot = t.items.findIndex((s) => !s);
      if (slot < 0) return false;
      t.items[slot] = { ...held, count: 1 };
      t.cook[slot] = 0;
      h.consume(1);
      w.setTile(x, y, z, t as never);
      return true;
    }
    case B2.DAYLIGHT_DETECTOR:
      setKeep(w, x, y, z, pack(id, m ^ 8));
      g.redstone.update(x, y, z);
      return true;
    case B2.BELL:
      ringBell(g, x, y, z);
      return true;
    case B2.SWEET_BERRY_BUSH:
      if (m < 2) return false;
      g.dropItem(x + 0.5, y + 0.5, z + 0.5, stack(I7.SWEET_BERRIES, m === 3 ? 2 + rng.int(2) : 1 + rng.int(2)));
      w.set(x, y, z, pack(id, 1));
      g.audio.play('dig.grass', at(x, y, z), 0.6, 1.3);
      return true;
  }
  return false;
}

/** Change a block's value keeping its tile entity (world.set drops tiles). */
function setKeep(w: World, x: number, y: number, z: number, v: number) {
  const t = w.getTile(x, y, z);
  w.set(x, y, z, v);
  if (t) w.setTile(x, y, z, t);
}

/** A lectern's book (one slot, so breaking it drops the book) and the page it's open at. */
export interface LecternTile { type: 'lectern'; items: (ItemStack | null)[]; page: number }
export interface CampfireTile { type: 'campfire'; items: (ItemStack | null)[]; cook: number[] }
function campfireTile(w: World, x: number, y: number, z: number): CampfireTile {
  let t = w.getTile(x, y, z) as CampfireTile | undefined;
  if (!t || t.type !== 'campfire') { t = { type: 'campfire', items: [null, null, null, null], cook: [0, 0, 0, 0] }; w.setTile(x, y, z, t as never); }
  return t;
}

/** Note block instruments by the block beneath (vanilla 1.16). */
export function instrumentUnder(id: number): string {
  const d = BLOCKS[id];
  if (!d) return 'harp';
  if (d.name.includes('wool')) return 'guitar';
  if (id === B.CLAY) return 'flute';
  if (id === B.GOLD_BLOCK) return 'bell';
  if (id === B.ICE || id === B2.PACKED_ICE || id === B2.BLUE_ICE) return 'chime';
  if (id === B2.BONE_BLOCK) return 'xylophone';
  if (id === B.IRON_BLOCK) return 'iron_xylophone';
  if (id === B.SOUL_SAND) return 'cow_bell';
  if (id === B.PUMPKIN) return 'didgeridoo';
  if (id === B2.EMERALD_BLOCK) return 'bit';
  if (id === B.HAY_BLOCK) return 'banjo';
  if (id === B.GLOWSTONE) return 'pling';
  if (d.sound === 'wood') return 'bass';
  if (d.sound === 'sand' || d.sound === 'gravel') return 'snare';
  if (d.sound === 'glass') return 'hat';
  if (d.tool === 'pickaxe' || d.sound === 'stone') return 'basedrum';
  return 'harp';
}
export function playNote(g: Game, w: World, x: number, y: number, z: number, note: number) {
  if (w.getId(x, y + 1, z) !== B.AIR) return;
  const inst = instrumentUnder(w.getId(x, y - 1, z));
  g.audio.play('note.' + inst, at(x, y, z), 1, Math.pow(2, (note - 12) / 12) * 2);
  g.particles?.add({ x: x + 0.5, y: y + 1.2, z: z + 0.5, vy: 0.05, layer: 0, size: 0.1, life: 10, col: [0x00ff00, 0xffff00, 0xff8000, 0xff0000, 0xff00ff, 0x0000ff, 0x00ffff][note % 7], gravity: 0, collide: false } as never);
}

/** Tile entities the new blocks get when placed. */
export function stationTile(w: World, x: number, y: number, z: number, id: number) {
  if (id === B2.SMOKER || id === B2.BLAST_FURNACE) w.setTile(x, y, z, { type: 'furnace', kind: id === B2.SMOKER ? 'smoker' : 'blast', slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 } as never);
  else if (id === B2.BARREL || id === B2.TRAPPED_CHEST || isShulkerBox(id)) w.setTile(x, y, z, { type: 'chest', items: new Array(27).fill(null) } as never);
  else if (id === B2.JUKEBOX) w.setTile(x, y, z, { type: 'jukebox', disc: null } as never);
  else if (id === B2.CAMPFIRE || id === B2.SOUL_CAMPFIRE) campfireTile(w, x, y, z);
  else if (id === B2.DAYLIGHT_DETECTOR) w.setTile(x, y, z, { type: 'daylight', power: 0 } as never);
  else if (id === B2.TARGET) w.setTile(x, y, z, { type: 'target', power: 0, ticks: 0 } as never);
  else if (id === B2.BEACON) w.setTile(x, y, z, { type: 'beacon', levels: -1, primary: '', secondary: '', beam: 0 } as never);
  else if (id === B2.CONDUIT) w.setTile(x, y, z, { type: 'conduit', frame: 0, active: false, target: 0 } as never);
  else if (id === B2.BEE_NEST || id === B2.BEEHIVE) w.setTile(x, y, z, { type: 'beehive', bees: [], honey: 0 } as never);
}

/** Items used on blocks: axes strip logs, shears carve pumpkins, shovels make paths, buckets fill and empty waterlogged blocks. */
export function stationItemUse(h: Hands, x: number, y: number, z: number, face: number, held: ItemStack, item: ItemDef): boolean {
  const g = h.game, w = h.world, p = h.player;
  const v = w.get(x, y, z), id = idOf(v), m = metaOf(v);
  const def = BLOCKS[id];
  const tool = item.tool?.type;
  if (tool === 'axe' && def.stripped) {
    const s = blockByName(def.stripped);
    if (!s) return false;
    w.set(x, y, z, pack(s.id, m));
    g.playBlockSound(id, x, y, z, 'place');
    h.damageHeld(1);
    return true;
  }
  if (tool === 'shovel' && (id === B.GRASS) && face !== 2 && w.getId(x, y + 1, z) === B.AIR) {
    w.set(x, y, z, B2.GRASS_PATH);
    g.playBlockSound(B.GRASS, x, y, z, 'place');
    h.damageHeld(1);
    return true;
  }
  if (tool === 'shears' && id === B.PUMPKIN && face >= 0) {
    // carved on the clicked side; seeds fall out
    const facing = [3, 1, 0, 0, 0, 2][face] ?? 0;
    w.set(x, y, z, pack(B2.CARVED_PUMPKIN, face === 2 || face === 3 ? m & 3 : facing));
    g.dropItem(x + 0.5, y + 0.8, z + 0.5, stack(I.PUMPKIN_SEEDS, 4));
    h.damageHeld(1);
    return true;
  }
  // buckets and waterlogged blocks
  if (held.id === I.BUCKET && WATERLOGGED[v] && waterloggable(id)) {
    w.set(x, y, z, pack(id, m & 7));
    if (!p.creative) p.inventory.setHeld(stack(I.WATER_BUCKET));
    g.audio.play('splash', at(x, y, z), 0.4, 1.2);
    return true;
  }
  if (held.id === I.WATER_BUCKET && waterloggable(id) && !WATERLOGGED[v] && !(def.shape === 2 && (m & 7) === 2) && w.dimension !== 'nether') {
    w.set(x, y, z, pack(id, m | 8));
    g.ticker!.schedule(x, y, z, 5);
    if (!p.creative) p.inventory.setHeld(stack(I.BUCKET));
    g.audio.play('splash', at(x, y, z), 0.4, 1);
    return true;
  }
  void isLog; void DISCS;
  return false;
}

/** Every 2 ticks: campfires cook what lies on them and drop it done. */
export function tickStations(g: Game) {
  const w = g.world!;
  for (const c of w.chunks.values()) {
    if (!c.ready || !c.tiles.size) continue;
    for (const [i, tile] of c.tiles) {
      if (tile.type === 'daylight' || tile.type === 'target') { sensorTick(g, w, c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15), tile as unknown as Sensor); continue; }
      if (tile.type === 'beehive') { tickHive(g, c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15), tile as unknown as HiveTile); continue; }
      if (tile.type === 'beacon') { tickBeacon(g, c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15), tile as unknown as BeaconTile); continue; }
      if (tile.type === 'conduit') { tickConduit(g, c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15), tile as unknown as ConduitTile); continue; }
      if (tile.type !== 'campfire') continue;
      const t = tile as unknown as CampfireTile;
      const x = c.cx * 16 + (i & 15), z = c.cz * 16 + ((i >> 4) & 15), y = i >> 8;
      const v = w.get(x, y, z);
      if (metaOf(v) & 4) continue;
      for (let k = 0; k < 4; k++) {
        const s = t.items[k];
        if (!s) continue;
        t.cook[k] += 2;
        if (t.cook[k] >= 600) {
          const r = SMELTING[s.id];
          t.items[k] = null;
          t.cook[k] = 0;
          if (r) g.dropItem(x + 0.5, y + 1, z + 0.5, stack(r.out));
          c.modified = true;
          w.setTile(x, y, z, t as never);
        }
      }
      if (g.ticks % 20 === 0 && rng.int(3) === 0) g.particles?.smoke(x + 0.3 + rng.next() * 0.4, y + 0.8, z + 0.3 + rng.next() * 0.4, true);
    }
  }
}

interface Sensor { type: 'daylight' | 'target'; power: number; ticks?: number }
/** Daylight detectors follow the sun once a second; targets let their signal go after a moment. */
function sensorTick(g: Game, w: World, x: number, y: number, z: number, t: Sensor) {
  let p = t.power;
  if (t.type === 'target') {
    if (!t.ticks) return;
    t.ticks -= 2;
    if (t.ticks <= 0) { t.ticks = 0; p = 0; }
  } else {
    if (g.ticks % 20) return;
    const v = w.get(x, y, z);
    if (idOf(v) !== B2.DAYLIGHT_DETECTOR) return;
    const sky = w.getLight(x, y + 1, z)[0];
    // vanilla: sky light dimmed by the sun's height (time 0 sunrise, 6000 noon, 12000 sunset): none at night
    const day = Math.sin(((g.time % 24000) / 24000) * Math.PI * 2) * 1.2 + 0.2;
    p = Math.max(0, Math.min(15, Math.round(sky * Math.max(0, Math.min(1, day)))));
    if (metaOf(v) & 8) p = 15 - p;
  }
  if (p !== t.power) {
    t.power = p;
    w.setTile(x, y, z, t as never);
    g.redstone.update(x, y, z);
  }
}

/** An arrow (or other projectile) hit a target block: a signal stronger the nearer the middle it hit. */
export function hitTarget(g: Game, x: number, y: number, z: number, hx: number, hy: number, hz: number, arrow: boolean) {
  const w = g.world!;
  if (w.getId(x, y, z) !== B2.TARGET) return;
  const t = (w.getTile(x, y, z) as unknown as Sensor | undefined) ?? { type: 'target', power: 0, ticks: 0 };
  // distance from the middle of the face that was hit, in the face's own plane
  const dx = Math.abs(hx - (x + 0.5)), dy = Math.abs(hy - (y + 0.5)), dz = Math.abs(hz - (z + 0.5));
  const axis = Math.max(dx, dy, dz);
  const off = axis === dx ? Math.max(dy, dz) : axis === dy ? Math.max(dx, dz) : Math.max(dx, dy);
  t.power = Math.max(1, Math.ceil(15 * Math.max(0, Math.min(1, (0.5 - off) / 0.5))));
  t.ticks = arrow ? 20 : 8;
  w.setTile(x, y, z, t as never);
  g.redstone.update(x, y, z);
}

/** Composter: a full one becomes ready a second later (scheduled tick). */
export function stationScheduled(w: World, x: number, y: number, z: number): boolean {
  const v = w.get(x, y, z);
  if (idOf(v) === B2.COMPOSTER && metaOf(v) === 7) { w.set(x, y, z, pack(B2.COMPOSTER, 8)); return true; }
  return false;
}

/** A bell rung (1.14): raiders within 48 blocks glow for a while, villagers within 32 hurry to their beds. */
export function ringBell(g: Game, x: number, y: number, z: number) {
  g.audio.play('bell', at(x, y, z), 1.5, 1);
  for (const e of g.entities) {
    const m = e as unknown as { typeName?: string; addEffect?(id: string, t: number, a: number): void; home?: { x: number; y: number; z: number } | null; setPathTo?(x: number, y: number, z: number, s: number): void; panicTicks?: number; baby?: boolean };
    const d = Math.hypot(e.x - x - 0.5, e.y - y, e.z - z - 0.5);
    if (d < 48 && ['Pillager', 'Vindicator', 'Evoker', 'Ravager', 'Witch', 'Illusioner'].includes(m.typeName ?? '')) m.addEffect?.('glowing', 60, 0);
    if (d < 32 && m.typeName === 'Villager') {
      if (m.home) m.setPathTo?.(m.home.x, m.home.y, m.home.z, 0.06);
      else m.panicTicks = 100;
    }
  }
}
