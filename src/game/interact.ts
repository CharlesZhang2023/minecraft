// Player interaction with blocks & entities: mining, placing, using items, combat, explosions.
import { advanceNear } from './advancements';
import { createMap } from './maps';
import { buildGolem } from '../entity/overworldmobs';
import { BOATS } from './items';
import { buildWither } from '../entity/wither';
import { Mob } from '../entity/mobs';
import { useOnMob, tieToFence } from '../entity/leash';
import { ArmorStand } from '../entity/armorstand';
import { hardenConcrete } from './blockrules';
import { swingDamage, sweep, shieldBlocks, shieldHand, crossbowLoadTicks, loadCrossbow, fireCrossbow, releaseTrident, ThrownTrident } from './combat';
import { hiveBroken } from '../entity/bees';
import { FISH_BUCKETS, releaseFish, FLOWER_EFFECTS } from '../entity/animals';
import type { Game } from './game';
import { B, B2, BLOCKS, idOf, metaOf, pack, isLog, isStairs, isSlab, isLeaves, HORIZ, FACE_DIRS, isOriented, Render, TEXTURES, tex, OPAQUE, FACE_TO_FACING6, FACING6, isPiston, isRepeater, isRail, isHandOperated, isButton, isDoor, isPillar, isTrapdoor, isFence, isBanner, bannerColor, BANNERS, isCommandBlock } from '../world/blocks';
import { familyPlacement, doubleSlab, partners, toggled } from './families';
import { stationUse, stationItemUse, stationTile, isShulkerBox } from './stations';
import { blockIs } from './tags';
import { angerPiglins } from '../entity/nethermobs';
import { ItemFrame, Painting } from '../entity/hanging';
import { collisionShapes } from '../world/models';
import { getItem, blockDrops, ItemStack, I, I2, I3, I4, I5, I6, I7, stack, ItemDef, POTION_ITEMS, itemId, I9, I11 } from './items';
import { FireworkRocket } from '../entity/firework';
import { ThrownPotion } from '../entity/potion';
import { POTION_BY_KEY } from './potiondata';
import { newBrewingTile } from './brewing';
import { BlockHit, raycastBlocks } from './raycast';
import { Entity } from '../entity/entity';
import { LivingEntity } from '../entity/living';
import { PrimedTnt, Arrow, Snowball, XpOrb, ItemEntity, FallingBlock, Fireball } from '../entity/item';
import { Boat } from '../entity/boat';
import { Minecart, placeOnRail } from '../entity/minecart';
import { layRail } from './tracks';
import { EndCrystal } from '../entity/dragon';
import { FishingHook } from '../entity/fishing';
import { createEntity } from '../entity/registry';
import { aabbIntersects } from '../math';
import { Random } from '../noise';
import { GameMode, Player } from './player';
import { findFrameAt, frameBlocks } from './portal';
import { level } from './enchant';
import { eyeOnFrame, throwEye, teleportEgg, placeCrystal } from './endstuff';
import { Events } from '../mod/events';
import { blockCtx, playerBlockCtx, itemCtx, callBlock } from '../mod/blockctx';
import { guard } from '../mod/state';

export interface Breaking { x: number; y: number; z: number; progress: number; face: number; sound: number }

export class Interaction {
  breaking: Breaking | null = null;
  hitDelay = 0;
  useDelay = 0;
  eating = 0;
  bowTicks = 0;
  usingBow = false;
  /** A vanilla item used with the button held (1.9+): shield, crossbow (loading), trident (winding up). */
  usingItem: '' | 'shield' | 'crossbow' | 'trident' = '';
  useTicks = 0;
  arrowId = I.ARROW;
  private rng = new Random(4321);
  private leftWasDown = false;
  /** Position of the dragon egg last punched while the button is held (so holding doesn't re-teleport it). */
  private eggKey = '';
  private rightWasDown = false;
  /** A mod item being used continuously (ItemBehavior.useTick): which hotbar slot, and for how many ticks. */
  private holding: { slot: number; ticks: number } | null = null;

  constructor(private game: Game) {}

  get world() { return this.game.world!; }
  get player() { return this.game.player!; }

  bowCharge() { return this.usingBow ? this.bowTicks : 0; }

  tick() {
    const g = this.game, p = this.player, inp = g.input;
    const active = inp.locked && !g.ui.screen && !p.dead;
    const left = active && inp.mouseDown.has(0);
    const right = active && inp.mouseDown.has(2);
    const clicks = inp.takeMousePressed();
    if (this.hitDelay > 0) this.hitDelay--;
    if (this.useDelay > 0) this.useDelay--;
    if (!active) {
      this.breaking = null;
      this.stopUsing();
      this.leftWasDown = this.rightWasDown = false;
      return;
    }
    if (clicks.includes(1)) this.pickBlock();
    // ------ left: attack / mine
    // the dragon egg can't be mined in survival: punching it (or sweeping onto it with the button held) teleports it
    const egg = !!g.target && !g.targetEntity && !p.creative && this.world.getId(g.target.x, g.target.y, g.target.z) === B.DRAGON_EGG;
    if (clicks.includes(0)) {
      if (g.targetEntity) this.attack(g.targetEntity);
      else if (!g.target) { p.swing(); p.attackTicks = 0; }
    }
    const eggKey = egg ? `${g.target!.x},${g.target!.y},${g.target!.z}` : '';
    if (egg && (clicks.includes(0) || (left && eggKey !== this.eggKey))) { teleportEgg(g, g.target!.x, g.target!.y, g.target!.z); p.swing(); }
    this.eggKey = left ? eggKey : '';
    if (left && !g.targetEntity && g.target && !egg && !p.spectator && this.eating === 0 && !this.usingBow) this.mine(g.target);
    else this.breaking = null;
    // ------ right: use
    if (right) {
      if (this.eating > 0) this.continueEating();
      else if (this.usingBow) this.bowTicks++;
      else if (this.usingItem) this.continueItemUse();
      else if (this.holdUse()) { /* a hold-to-use mod item (wands) */ }
      else if (clicks.includes(2) || this.useDelay === 0) this.use(clicks.includes(2));
    } else this.stopUsing();
    this.leftWasDown = left;
    this.rightWasDown = right;
  }

  // ------------------------------------------------------------------ mining
  relativeHardness(blockId: number, held: ItemStack | null): number {
    const def = BLOCKS[blockId];
    const p = this.player;
    if (def.hardness < 0) return 0;
    if (def.hardness === 0) return Infinity;
    const tool = held ? getItem(held.id) : undefined;
    const canHarvest = def.harvestLevel < 0 || (tool?.tool && tool.tool.type === def.tool && tool.tool.level >= def.harvestLevel);
    let speed = 1;
    if (tool?.tool) {
      const t = tool.tool;
      if (t.type === def.tool) speed = t.speed;
      else if (t.type === 'sword' && (blockId === B.COBWEB)) speed = 15;
      else if (t.type === 'sword' && (isLeaves(blockId) || def.render === Render.Cross || blockId === B.PUMPKIN || blockId === B.MELON)) speed = 1.5;
      else if (t.type === 'shears' && (isLeaves(blockId) || blockId === B.COBWEB)) speed = 15;
      else if (t.type === 'shears' && def.sound === 'cloth') speed = 5;
      else if (t.type === 'hoe' && isLeaves(blockId)) speed = t.speed;
    }
    const eff = level(held, 'efficiency');
    if (eff > 0 && speed > 1) speed += eff * eff + 1;
    // Haste (and Conduit Power) speed digging up; Mining Fatigue slows it right down (vanilla factors)
    const haste = Math.max(p.effectAmp('haste'), p.effectAmp('conduit_power'));
    if (haste >= 0) speed *= 1 + (haste + 1) * 0.2;
    const fatigue = p.effectAmp('mining_fatigue');
    if (fatigue >= 0) speed *= [0.3, 0.09, 0.0027, 0.00081][Math.min(3, fatigue)];
    const eyeId = this.world.getId(Math.floor(p.x), Math.floor(p.y + p.eyeHeight()), Math.floor(p.z));
    if (eyeId === B.WATER && !level(p.inventory.armor[0], 'aqua_affinity') && !p.effects.has('conduit_power')) speed /= 5;
    if (!p.onGround && !p.flying) speed /= 5;
    return canHarvest ? speed / def.hardness / 30 : speed / def.hardness / 100;
  }

  private mine(t: BlockHit) {
    const g = this.game, p = this.player, w = this.world;
    const v = w.get(t.x, t.y, t.z);
    const id = idOf(v);
    if (id === 0 || BLOCKS[id].fluid) { this.breaking = null; return; }
    if (this.hitDelay > 0) return;
    p.swing();
    if (p.creative) {
      const held = p.inventory.held();
      if (held && getItem(held.id).tool?.type === 'sword') return;
      this.breakBlock(t.x, t.y, t.z);
      this.hitDelay = 5;
      return;
    }
    if (p.gameMode === GameMode.Adventure) return;
    const b = this.breaking;
    if (!b || b.x !== t.x || b.y !== t.y || b.z !== t.z) {
      this.breaking = { x: t.x, y: t.y, z: t.z, progress: 0, face: t.face, sound: 0 };
    }
    const br = this.breaking!;
    const rh = this.relativeHardness(id, p.inventory.held());
    br.progress += rh;
    if (br.sound % 4 === 0) g.playBlockSound(id, t.x, t.y, t.z, 'hit');
    br.sound++;
    g.particles!.blockHit(t.x, t.y, t.z, t.face, id, this.tintAt(t.x, t.y, t.z, id));
    if (br.progress >= 1) {
      this.breakBlock(t.x, t.y, t.z);
      this.breaking = null;
      this.hitDelay = 5;
    }
  }

  tintAt(x: number, y: number, z: number, id: number): number {
    const def = BLOCKS[id];
    if (def.tint === 'none') return 0xffffff;
    const b = this.game.biomeAt(x, z);
    if (def.tint === 'grass') return b.grass;
    if (def.tint === 'foliage') return b.foliage;
    if (def.tint === 'spruce') return 0x619961;
    if (def.tint === 'birch') return 0x80a755;
    void y;
    return 0xffffff;
  }

  /** Player breaks a block: drops, tool wear, particles, sound. */
  breakBlock(x: number, y: number, z: number) {
    const g = this.game, p = this.player, w = this.world;
    const v = w.get(x, y, z);
    const id = idOf(v);
    if (id === 0) return;
    // mods may keep the block
    if (Events.breakBlock.any && Events.breakBlock.fire({ game: g, player: p, x, y, z, v }) === 'fail') return;
    const tile = w.getTile(x, y, z);
    g.achievements.stat('mined:' + BLOCKS[id].name);
    if (id === B2.BEE_NEST && level(p.inventory.held(), 'silk_touch') > 0 && ((tile as { bees?: unknown[] } | undefined)?.bees?.length ?? 0) >= 3) g.achievements.event('silk_nest');
    if (id === B2.BEE_NEST || id === B2.BEEHIVE) hiveBroken(g, x, y, z, p);
    const held = p.inventory.held();
    const tool = held ? getItem(held.id) : undefined;
    g.particles!.blockBreak(x, y, z, id, this.tintAt(x, y, z, id));
    g.playBlockSound(id, x, y, z, 'break');
    // a banner drops as itself with its patterns
    if (isBanner(id)) {
      this.removeBlockAndPartner(x, y, z, v);
      w.setTile(x, y, z, undefined);
      if (!p.creative) g.dropItem(x + 0.5, y + 0.5, z + 0.5, bannerItem(id, tile));
      this.broken(x, y, z, v, p);
      return;
    }
    // a shulker box keeps what's inside: it drops as itself, contents and all (in creative too, when it has any)
    if (isShulkerBox(id)) {
      const items = (tile as { items?: (ItemStack | null)[] } | undefined)?.items;
      const full = !!items?.some((s) => s);
      this.removeBlockAndPartner(x, y, z, v);
      w.setTile(x, y, z, undefined);
      if (!p.creative || full) g.dropItem(x + 0.5, y + 0.5, z + 0.5, { id, count: 1, ...(full ? { box: items!.map((s) => (s ? { ...s } : null)) } : {}) });
      this.broken(x, y, z, v, p);
      return;
    }
    this.removeBlockAndPartner(x, y, z, v);
    if (!p.creative) {
      const silk = level(held, 'silk_touch') > 0;
      const drops = blockDrops(id, metaOf(v), tool, this.rng, silk);
      const fortune = silk ? 0 : level(held, 'fortune');
      if (fortune && [B.COAL_ORE, B.DIAMOND_ORE, B.EMERALD_ORE, B.LAPIS_ORE, B.REDSTONE_ORE, B.NETHER_QUARTZ_ORE].includes(id))
        for (const d of drops) d.count *= Math.max(0, this.rng.int(fortune + 2) - 1) + 1;
      for (const d of drops) g.dropItem(x + 0.5, y + 0.5, z + 0.5, d);
      // the block (and with it its tile entity) is already gone: drop what the tile held
      this.dropTileContents(x, y, z, v, tile);
      // xp from ores
      const xp = id === B.COAL_ORE ? this.rng.int(3) : id === B.DIAMOND_ORE || id === B.EMERALD_ORE ? 3 + this.rng.int(5) : id === B.LAPIS_ORE ? 2 + this.rng.int(4) : id === B.REDSTONE_ORE ? 1 + this.rng.int(5) : 0;
      if (xp && drops.length && !silk) this.spawnXp(x + 0.5, y + 0.5, z + 0.5, xp);
      if (tool?.durability && BLOCKS[id].hardness > 0) this.damageHeld(tool.tool?.type === 'sword' ? 2 : 1);
      p.exhaust(0.005);
      // ice leaves water behind
      if (id === B.ICE && BLOCKS[w.getId(x, y - 1, z)].solid) w.set(x, y, z, B.WATER);
    } else {
      w.setTile(x, y, z, undefined);
    }
    this.broken(x, y, z, v, p);
  }

  /** Mods: a block is gone (broken by a player, or the world when `by` is null). */
  private broken(x: number, y: number, z: number, v: number, by: Player | null) {
    const g = this.game, id = idOf(v), beh = BLOCKS[id].behavior;
    if (by && blockIs('guarded_by_piglins', id)) angerPiglins(g, by, x, y, z);
    if (beh?.onBreak) callBlock(id, 'onBreak', () => beh.onBreak!({ ...blockCtx(g, x, y, z, v), player: by }), undefined);
    if (by && Events.blockBroken.any) Events.blockBroken.fire({ game: g, player: by, x, y, z, v });
  }

  /** Set several blocks atomically: support checks run only after all are in place. */
  setAll(changes: [number, number, number, number][]) {
    const t = this.game.ticker!, w = this.world;
    t.suppress = true;
    const done: [number, number, number, number][] = [];
    for (const c of changes) if (w.set(c[0], c[1], c[2], c[3])) done.push(c);
    t.suppress = false;
    for (const [x, y, z] of done) {
      t.neighborChanged(x, y, z);
      for (const [dx, dy, dz] of FACE_DIRS) t.neighborChanged(x + dx, y + dy, z + dz);
    }
    return done.length > 0;
  }

  /** Removes a block, and the other half of doors/beds. */
  private removeBlockAndPartner(x: number, y: number, z: number, v: number) {
    const w = this.world;
    const id = idOf(v), meta = metaOf(v);
    const changes: [number, number, number, number][] = [[x, y, z, B.AIR]];
    const fam = partners(w, x, y, z, v);
    if (fam.length) for (const [px, py, pz] of fam) changes.push([px, py, pz, B.AIR]);
    else if (isPiston(id) && meta & 8) {
      const [dx, dy, dz] = FACING6[meta & 7];
      if (w.getId(x + dx, y + dy, z + dz) === B.PISTON_HEAD) changes.push([x + dx, y + dy, z + dz, B.AIR]);
    } else if (id === B.PISTON_HEAD) {
      const [dx, dy, dz] = FACING6[meta & 7];
      const bv = w.get(x - dx, y - dy, z - dz);
      if (isPiston(idOf(bv)) && metaOf(bv) & 8) {
        changes.push([x - dx, y - dy, z - dz, B.AIR]);
        if (!this.player.creative) this.game.dropItem(x - dx + 0.5, y - dy + 0.5, z - dz + 0.5, stack(idOf(bv)));
      }
    }
    if (changes.length === 1) w.set(x, y, z, B.AIR);
    else this.setAll(changes);
  }

  dropTileContents(x: number, y: number, z: number, v: number, t = this.world.getTile(x, y, z)) {
    if (!t) return;
    if (isBanner(idOf(v))) { this.game.dropItem(x + 0.5, y + 0.5, z + 0.5, bannerItem(idOf(v), t)); this.world.setTile(x, y, z, undefined); return; }
    // a shulker box blown up or washed away drops as itself, with what's inside
    if (isShulkerBox(idOf(v))) {
      const items = (t as { items?: (ItemStack | null)[] }).items;
      const full = !!items?.some((s) => s);
      this.game.dropItem(x + 0.5, y + 0.5, z + 0.5, { id: idOf(v), count: 1, ...(full ? { box: items!.map((s) => (s ? { ...s } : null)) } : {}) });
      this.world.setTile(x, y, z, undefined);
      return;
    }
    const spec = BLOCKS[idOf(v)].behavior?.tile;
    const items = (spec?.contents ? callBlock(idOf(v), 'tile contents', () => spec.contents!(t), []) : (t.items ?? t.slots ?? (t.disc ? [t.disc] : undefined))) as (ItemStack | null)[] | undefined;
    if (items) for (const s of items) if (s) this.game.dropItem(x + 0.5, y + 0.5, z + 0.5, s, true);
    this.world.setTile(x, y, z, undefined);
    void v;
  }

  /** Block destroyed by the world (support lost, leaf decay, water...). */
  breakBlockNaturally(x: number, y: number, z: number, drops: boolean) {
    const w = this.world;
    const v = w.get(x, y, z);
    const id = idOf(v);
    if (id === 0) return;
    const tile = w.getTile(x, y, z);
    if (id === B2.BEE_NEST || id === B2.BEEHIVE) hiveBroken(this.game, x, y, z, null);
    this.removeBlockAndPartner(x, y, z, v);
    if (drops) { this.dropBlockItems(x, y, z, v); this.dropTileContents(x, y, z, v, tile); }
    this.broken(x, y, z, v, null);
    if (isLeaves(id) || BLOCKS[id].render === Render.Cross) this.game.particles!.blockBreak(x, y, z, id, this.tintAt(x, y, z, id));
  }

  dropBlockItems(x: number, y: number, z: number, v: number) {
    const id = idOf(v);
    const ds = blockDrops(id, metaOf(v), undefined, this.rng);
    for (const d of ds) this.game.dropItem(x + 0.5, y + 0.5, z + 0.5, d);
  }

  damageHeld(n: number) {
    const p = this.player;
    if (p.creative) return;
    const s = p.inventory.held();
    if (!s) return;
    const d = getItem(s.id);
    if (!d.durability) return;
    const ub = level(s, 'unbreaking');
    if (ub && this.rng.int(ub + 1) > 0) return;
    s.damage = (s.damage ?? 0) + n;
    if (s.damage >= d.durability) {
      p.inventory.setHeld(null);
      this.game.audio.play('dig.wood', null, 0.8, 0.8);
      for (let i = 0; i < 5; i++) this.game.particles!.add({ x: p.x, y: p.y + 1.3, z: p.z, vx: (Math.random() - 0.5) * 0.2, vy: 0.15, vz: (Math.random() - 0.5) * 0.2, layer: this.spriteLayer(d.name), u0: 0.3, v0: 0.3, u1: 0.55, v1: 0.55, size: 0.06, life: 15 });
    }
  }

  spriteLayer(name: string): number {
    const i = TEXTURES.indexOf('item/' + name);
    return i >= 0 ? i : 0;
  }

  spawnXp(x: number, y: number, z: number, amount: number) {
    while (amount > 0) {
      const v = amount >= 17 ? 17 : amount >= 7 ? 7 : amount >= 3 ? 3 : 1;
      amount -= v;
      const o = new XpOrb(this.world, this.game, v);
      o.setPos(x, y, z);
      this.game.addEntity(o);
    }
  }

  // ------------------------------------------------------------------ pick block (middle click)
  private pickBlock() {
    const g = this.game, p = this.player;
    const t = g.target;
    if (!t) return;
    const v = this.world.get(t.x, t.y, t.z);
    let id = idOf(v);
    const map: Record<number, number> = { [B.REDSTONE_WIRE]: I.REDSTONE, [B.UNLIT_REDSTONE_TORCH]: B.REDSTONE_TORCH, [B.LIT_REDSTONE_LAMP]: B.REDSTONE_LAMP, [B.WHEAT]: I.WHEAT_SEEDS, [B.OAK_DOOR]: I.OAK_DOOR, [B.BED]: I.RED_BED, [B.SUGAR_CANE]: I.SUGAR_CANE, [B.LIT_FURNACE]: B.FURNACE, [B.FARMLAND]: B.DIRT, [B.DOUBLE_STONE_SLAB]: B.DOUBLE_STONE_SLAB, [B.REPEATER]: I3.REPEATER, [B.POWERED_REPEATER]: I3.REPEATER, [B.COMPARATOR]: I3.COMPARATOR, [B.BREWING_STAND]: I3.BREWING_STAND, [B.NETHER_WART]: I3.NETHER_WART, [B.CARROTS]: I3.CARROT, [B.POTATOES]: I3.POTATO, [B.PISTON_HEAD]: B.PISTON };
    id = map[id] ?? id;
    const inv = p.inventory;
    for (let i = 0; i < 9; i++) if (inv.main[i]?.id === id) { inv.selected = i; return; }
    if (p.creative) {
      let slot = inv.selected;
      if (inv.main[slot]) for (let i = 0; i < 9; i++) if (!inv.main[i]) { slot = i; break; }
      inv.main[slot] = stack(id, 1);
      inv.selected = slot;
    } else {
      for (let i = 9; i < 36; i++)
        if (inv.main[i]?.id === id) {
          const tmp = inv.main[inv.selected];
          inv.main[inv.selected] = inv.main[i];
          inv.main[i] = tmp;
          return;
        }
    }
  }

  // ------------------------------------------------------------------ using / placing
  /** Right-click the targeted mob (feed, shear, saddle, trade, ride...). False if it has nothing to do with it. */
  interactEntity(): boolean {
    const g = this.game, p = this.player;
    if (!g.targetEntity || p.spectator || p.dead) return false;
    const e = g.targetEntity as unknown as { interact?: (game: Game, s: ItemStack | null) => boolean };
    if (g.targetEntity instanceof Mob && useOnMob(g, p, g.targetEntity, p.inventory.held(), (n) => this.consume(n))) { p.swing(); return true; }
    if (!e.interact || !e.interact(g, p.inventory.held())) return false;
    p.swing();
    return true;
  }

  /** One right-click at the acting player's current target (tools acting for a player). */
  useNow() {
    this.use(true);
  }

  private use(fresh: boolean) {
    const g = this.game, p = this.player, w = this.world;
    this.useDelay = 4;
    if (p.spectator) return;
    const held = p.inventory.held();
    const item = held ? getItem(held.id) : undefined;
    // entity interaction
    if (fresh && this.interactEntity()) return;
    const t = g.target;
    if (t) {
      const v = w.get(t.x, t.y, t.z);
      const id = idOf(v);
      // mods: listeners first, then the held item's own use on blocks
      if (Events.useBlock.any) {
        const r = Events.useBlock.fire({ game: g, player: p, x: t.x, y: t.y, z: t.z, v, face: t.face, held });
        if (r === 'success') { p.swing(); return; }
        if (r === 'fail') return;
      }
      const ib = item?.behavior;
      if (held && ib?.useOnBlock && guard(item!.mod, 'useOnBlock', () => ib.useOnBlock!({ ...this.itemCtx(held), x: t.x, y: t.y, z: t.z, face: t.face, v }), false)) { p.swing(); return; }
      // a fence ties the mobs on the player's leads
      if (isFence(id) && tieToFence(g, p, t.x, t.y, t.z)) { p.swing(); return; }
      if (!p.sneaking || !held) {
        if (this.activateBlock(t, id, v)) { p.swing(); this.useDelay = 4; return; }
      }
      if (held && item) {
        if (this.useItemOnBlock(t, held, item)) { p.swing(); return; }
        if (item.block !== undefined && this.placeBlock(t, held, item)) { p.swing(); return; }
      }
    }
    if (held && item && fresh) {
      if (Events.useItem.any) {
        const r = Events.useItem.fire({ game: g, player: p, stack: held });
        if (r === 'success') { p.swing(); return; }
        if (r === 'fail') return;
      }
      const ib = item.behavior;
      if (ib?.use) { if (guard(item.mod, 'use', () => ib.use!(this.itemCtx(held)), false)) p.swing(); return; }
      this.useItemInAir(held, item);
    }
    else if (held && item && (item.food || item.name === 'bow')) this.useItemInAir(held, item);
    // nothing to do with the main hand: a shield in the off hand comes up
    if (fresh && !this.usingItem && !this.usingBow && this.eating === 0 && shieldHand(p) === 'off' && (!item || (item.block === undefined && !item.food && !item.drink))) this.startItemUse('shield');
  }

  /** Context for a mod item's hooks (the held stack). */
  private itemCtx(held: ItemStack) {
    return itemCtx(this.game, this.player, held, (n) => this.consume(n), (n) => this.damageHeld(n));
  }

  private activateBlock(t: BlockHit, id: number, v: number): boolean {
    const g = this.game, w = this.world;
    const meta = metaOf(v);
    const beh = BLOCKS[id].behavior;
    if (beh?.onUse) return callBlock(id, 'onUse', () => beh.onUse!(playerBlockCtx(g, this.player, t.x, t.y, t.z, t.face, this.player.inventory.held())), false);
    if (isHandOperated(id)) {
      this.swing(t.x, t.y, t.z);
      return true;
    }
    if (isButton(id)) { g.redstone.pressButton(t.x, t.y, t.z); return true; }
    if (blockIs('guarded_by_piglins', id) && w.dimension === 'nether' && !OPAQUE[w.getId(t.x, t.y + 1, t.z)]) angerPiglins(g, this.player, t.x, t.y, t.z);
    if ((id >= B2.CRIMSON_NYLIUM || isShulkerBox(id)) && stationUse(this.hands(), t.x, t.y, t.z, v, this.player.inventory.held())) return true;
    switch (id) {
      case B.CRAFTING_TABLE: g.ui.openCrafting(); return true;
      case B.ENCHANTING_TABLE: g.ui.openEnchant(t.x, t.y, t.z); return true;
      case B.LEVER: g.redstone.toggleLever(t.x, t.y, t.z); return true;
      case B.STONE_BUTTON: g.redstone.pressButton(t.x, t.y, t.z); return true;
      case B.FURNACE: case B.LIT_FURNACE: g.ui.openFurnace(t.x, t.y, t.z); return true;
      case B.HOPPER: g.ui.openHopper(t.x, t.y, t.z); return true;
      case B.DISPENSER: case B.DROPPER: g.ui.openDispenser(t.x, t.y, t.z, id === B.DROPPER); return true;
      case B.BREWING_STAND: g.ui.openBrewing(t.x, t.y, t.z); return true;
      case B.ANVIL: g.ui.openAnvil(t.x, t.y, t.z); return true;
      case B.REPEATER: case B.POWERED_REPEATER: case B.COMPARATOR: g.redstone.useDiode(t.x, t.y, t.z); return true;
      case B.CHEST: {
        if (OPAQUE[w.getId(t.x, t.y + 1, t.z)]) return true;
        g.ui.openChest(t.x, t.y, t.z);
        g.audio.play('chestOpen', { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 }, 0.5, 0.9 + Math.random() * 0.1);
        return true;
      }
      case B.ENDER_CHEST: {
        if (OPAQUE[w.getId(t.x, t.y + 1, t.z)]) return true;
        g.ui.openEnderChest(t.x, t.y, t.z);
        g.audio.play('chestOpen', { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 }, 0.5, 0.7);
        return true;
      }
      case B.DRAGON_EGG: teleportEgg(g, t.x, t.y, t.z); return true;
      case B.OAK_DOOR: {
        const lowerY = meta & 8 ? t.y - 1 : t.y;
        const lower = w.get(t.x, lowerY, t.z);
        const nm = metaOf(lower) ^ 4;
        this.setAll([[t.x, lowerY, t.z, pack(B.OAK_DOOR, nm)], [t.x, lowerY + 1, t.z, pack(B.OAK_DOOR, (nm & 7) | 8)]]);
        g.audio.play('door', { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 }, 1, 0.9 + Math.random() * 0.1);
        return true;
      }
      case B.BED: return this.sleep(t.x, t.y, t.z);
      case B.TNT: {
        const held = this.player.inventory.held();
        if (held && held.id === I.FLINT_AND_STEEL) {
          w.set(t.x, t.y, t.z, B.AIR);
          this.primeTnt(t.x, t.y, t.z);
          this.damageHeld(1);
          return true;
        }
        return false;
      }
    }
    return false;
  }

  /** This player's hands, for the block and item rules outside this class (stations.ts). */
  hands() {
    return { game: this.game, world: this.world, player: this.player, consume: (n: number) => this.consume(n), damageHeld: (n: number) => this.damageHeld(n) };
  }

  /** Open or close a door, trapdoor or fence gate (both halves of a door). */
  swing(x: number, y: number, z: number, open?: boolean) {
    const w = this.world, g = this.game;
    const v = w.get(x, y, z), id = idOf(v);
    if (isDoor(id)) {
      const lowerY = metaOf(v) & 8 ? y - 1 : y;
      const lower = w.get(x, lowerY, z);
      if (open !== undefined && ((metaOf(lower) & 4) !== 0) === open) return;
      const nm = metaOf(lower) ^ 4;
      this.setAll([[x, lowerY, z, pack(id, nm)], [x, lowerY + 1, z, pack(id, (nm & 7) | 8)]]);
    } else {
      const nv = open !== undefined ? this.openState(v, open) : toggled(v, this.playerFacing());
      if (nv === null || nv === v) return;
      w.set(x, y, z, nv);
    }
    const iron = BLOCKS[id].material === 'iron';
    g.audio.play('door', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 1, (iron ? 0.7 : 0.9) + Math.random() * 0.1);
  }
  /** A trapdoor or gate set open or shut (redstone). */
  private openState(v: number, open: boolean): number | null {
    const id = idOf(v), m = metaOf(v);
    const flag = isTrapdoor(id) ? 8 : 4;
    return pack(id, open ? m | flag : m & ~flag);
  }

  private sleep(x: number, y: number, z: number): boolean {
    const g = this.game, p = this.player;
    if (this.world.dimension !== 'overworld') {
      // beds explode outside the overworld
      this.removeBlockAndPartner(x, y, z, this.world.get(x, y, z));
      this.explode(x + 0.5, y + 0.5, z + 0.5, 5, true, null);
      return true;
    }
    // a bed is your own respawn point (the world spawn stays where new players start)
    p.spawnX = x; p.spawnY = y + 1; p.spawnZ = z; p.spawnKind = 'bed';
    if (g.isDaytime()) { g.ui.hud.actionBar('You can only sleep at night'); g.ui.chat.add('Respawn point set'); return true; }
    const monsters = g.entities.some((e) => (e as unknown as { hostile?: boolean }).hostile && !(e as LivingEntity).dead && Math.abs(e.x - x) < 8 && Math.abs(e.y - y) < 5 && Math.abs(e.z - z) < 8);
    if (monsters) { g.ui.hud.actionBar('You may not rest now; there are monsters nearby'); return true; }
    g.ui.openSleep();
    return true;
  }

  private useItemOnBlock(t: BlockHit, held: ItemStack, item: ItemDef): boolean {
    const g = this.game, w = this.world, p = this.player;
    const v = w.get(t.x, t.y, t.z);
    const id = idOf(v);
    const [nx, ny, nz] = FACE_DIRS[t.face];
    const ax = t.x + nx, ay = t.y + ny, az = t.z + nz;
    if (stationItemUse(this.hands(), t.x, t.y, t.z, t.face, held, item)) return true;
    if (held.id === I7.ARMOR_STAND && t.face === 3) {
      if (w.getId(ax, ay, az) !== B.AIR || w.getId(ax, ay + 1, az) !== B.AIR) return false;
      const s = new ArmorStand(w, g);
      s.setPos(ax + 0.5, ay, az + 0.5);
      s.yaw = s.pyaw = Math.round((p.yaw + 180) / 45) * 45;
      g.addEntity(s);
      g.playBlockSound(B.OAK_PLANKS, ax, ay, az, 'place');
      this.consume(1);
      return true;
    }
    if ((held.id === I7.ITEM_FRAME || held.id === I7.PAINTING) && t.face !== 2 && t.face !== 3) {
      // hung on the clicked wall, in the cell in front of it
      const wallDir = ({ 0: 1, 1: 3, 4: 2, 5: 0 } as Record<number, number>)[t.face];
      if (w.getId(ax, ay, az) !== B.AIR) return false;
      const h = held.id === I7.ITEM_FRAME ? new ItemFrame(w, g) : new Painting(w, g);
      if (h instanceof Painting) { if (!h.place(ax, ay, az, wallDir, () => this.rng.next())) return false; }
      else h.hang(ax, ay, az, wallDir);
      g.addEntity(h);
      g.playBlockSound(B.OAK_PLANKS, ax, ay, az, 'place');
      this.consume(1);
      return true;
    }
    if (item.tool?.type === 'hoe') {
      if ((id === B.GRASS || id === B.DIRT || id === B.COARSE_DIRT) && t.face !== 2 && w.getId(t.x, t.y + 1, t.z) === B.AIR) {
        w.set(t.x, t.y, t.z, id === B.COARSE_DIRT ? B.DIRT : B.FARMLAND);
        g.playBlockSound(B.GRAVEL, t.x, t.y, t.z, 'place');
        this.damageHeld(1);
        return true;
      }
      return false;
    }
    if (item.egg) {
      if (id === B.SPAWNER) {
        const tile = (w.getTile(t.x, t.y, t.z) as { type: string; mob: string; delay: number } | undefined) ?? { type: 'spawner', mob: item.egg, delay: 200 };
        tile.mob = item.egg;
        w.setTile(t.x, t.y, t.z, tile as never);
        this.consume(1);
        return true;
      }
      const up = t.face === 3 && (id === B.OAK_FENCE || id === B.NETHER_BRICK_FENCE) ? 0.5 : 0;
      const m = this.spawnMob(item.egg, ax + 0.5, ay + up, az + 0.5);
      if (m) {
        m.yaw = this.rng.next() * 360;
        if (held.name) (m as unknown as { customName: string }).customName = held.name;
        this.consume(1);
      }
      return true;
    }
    if (held.id === I2.ENDER_EYE && id === B.END_PORTAL_FRAME) {
      if (!eyeOnFrame(g, t.x, t.y, t.z)) return false;
      this.consume(1);
      return true;
    }
    if (held.id === I4.END_CRYSTAL) {
      if (t.face !== 3 || !placeCrystal(g, t.x, t.y, t.z)) return false;
      this.consume(1);
      return true;
    }
    if (held.id === I6.FIREWORK_ROCKET) {
      // launched from the point that was clicked
      const r = new FireworkRocket(w, g, held);
      r.setPos(t.hx + nx * 0.01, t.hy + ny * 0.01, t.hz + nz * 0.01);
      g.addEntity(r);
      this.consume(1);
      return true;
    }
    const cartKind = held.id === I5.MINECART ? 'minecart' : held.id === I7.CHEST_MINECART ? 'chest' : held.id === I7.FURNACE_MINECART ? 'furnace' : held.id === I7.HOPPER_MINECART ? 'hopper' : held.id === I7.TNT_MINECART ? 'tnt' : null;
    if (cartKind) {
      const at = placeOnRail(w, t.x, t.y, t.z);
      if (!at) return false;
      const c = new Minecart(w, g);
      c.setKind(cartKind);
      c.setPos(t.x + 0.5, at.y, t.z + 0.5);
      c.yaw = c.pyaw = at.yaw;
      g.addEntity(c);
      g.playBlockSound(B.IRON_BLOCK, t.x, t.y, t.z, 'place');
      this.consume(1);
      return true;
    }
    switch (held.id) {
      case I.BONE_MEAL:
        if (g.ticker!.fertilize(t.x, t.y, t.z)) {
          for (let i = 0; i < 15; i++) g.particles!.add({ x: t.x + Math.random(), y: t.y + Math.random() + 0.5, z: t.z + Math.random(), vy: 0.02, layer: tex('particle_heart'), size: 0.05, life: 20, col: 0x55ff55, gravity: 0, collide: false });
          this.consume(1);
          return true;
        }
        return false;
      case I.FLINT_AND_STEEL:
        if (w.getId(ax, ay, az) === B.AIR) {
          const frame = findFrameAt(w, ax, ay, az);
          if (frame) {
            this.setAll(frameBlocks(frame));
            g.audio.play('portalTrigger', { x: ax + 0.5, y: ay + 0.5, z: az + 0.5 }, 1, 1);
            this.damageHeld(1);
            return true;
          }
          w.set(ax, ay, az, B.FIRE);
          g.ticker!.schedule(ax, ay, az, 30);
          g.audio.play('fire', { x: ax + 0.5, y: ay + 0.5, z: az + 0.5 }, 1, 1);
          this.damageHeld(1);
          return true;
        }
        return false;
      case I7.COD_BUCKET: case I7.SALMON_BUCKET: case I7.PUFFERFISH_BUCKET: case I7.TROPICAL_FISH_BUCKET:
      case I.WATER_BUCKET:
      case I.LAVA_BUCKET: {
        const fluid = held.id === I.LAVA_BUCKET ? B.LAVA : B.WATER;
        let px = ax, py = ay, pz = az;
        if (BLOCKS[id].replaceable && !BLOCKS[id].fluid) { px = t.x; py = t.y; pz = t.z; }
        const cur = w.getId(px, py, pz);
        if (!BLOCKS[cur].replaceable && cur !== B.AIR) return false;
        if (fluid === B.WATER && w.dimension === 'nether') {
          // water evaporates in the Nether
          g.audio.play('fizz', { x: px + 0.5, y: py + 0.5, z: pz + 0.5 }, 0.5, 2.6);
          for (let i = 0; i < 8; i++) g.particles!.smoke(px + Math.random(), py + Math.random(), pz + Math.random(), true);
          if (!p.creative) p.inventory.setHeld(stack(I.BUCKET));
          return true;
        }
        if (cur !== B.AIR && !BLOCKS[cur].fluid) g.interact!.dropBlockItems(px, py, pz, w.get(px, py, pz));
        w.set(px, py, pz, fluid);
        g.ticker!.schedule(px, py, pz, fluid === B.WATER ? 5 : 30);
        g.audio.play(fluid === B.WATER ? 'splash' : 'fizz', { x: px + 0.5, y: py + 0.5, z: pz + 0.5 }, 0.5, 1);
        if (FISH_BUCKETS[held.id]) releaseFish(g, held, px, py, pz);
        if (!p.creative) p.inventory.setHeld(stack(I.BUCKET));
        return true;
      }
    }
    if (item.armor) return false;
    return false;
  }

  private useItemInAir(held: ItemStack, item: ItemDef) {
    const g = this.game, p = this.player, w = this.world;
    if (item.food) {
      if (p.food < 20 || held.id === I.GOLDEN_APPLE || p.creative) { this.eating = 1; }
      return;
    }
    if (item.drink) { this.eating = 1; return; }
    if (item.splash) {
      const e = new ThrownPotion(w, g, p, { ...held, count: 1 });
      const eye = g.eyePos(1);
      const d = g.lookVec(p.yaw, p.pitch - 20);
      e.setPos(eye.x + d.x * 0.3, eye.y - 0.1, eye.z + d.z * 0.3);
      e.vx = d.x * 0.5 + p.vx; e.vy = d.y * 0.5; e.vz = d.z * 0.5 + p.vz;
      g.addEntity(e);
      g.audio.play('bow', p, 0.5, 0.4 / (Math.random() * 0.4 + 0.8));
      this.consume(1);
      p.swing();
      return;
    }
    if (held.id === I3.GLASS_BOTTLE) {
      const eye = g.eyePos(1);
      const d = g.lookVec(p.yaw, p.pitch);
      const hit = raycastBlocks(w, eye.x, eye.y, eye.z, d.x, d.y, d.z, g.reach(), true);
      if (hit && w.getId(hit.x, hit.y, hit.z) === B.WATER) {
        const filled = stack(POTION_ITEMS.water);
        g.audio.play('swim', hit, 0.6, 1.2);
        if (held.count === 1 && !p.creative) p.inventory.setHeld(filled);
        else { if (!p.creative) held.count--; if (p.inventory.add(filled) > 0) g.dropItem(p.x, p.y + 1, p.z, filled); }
        p.swing();
      }
      return;
    }
    if (item.armor) {
      const slot = item.armor.slot;
      const cur = p.inventory.armor[slot];
      p.inventory.armor[slot] = held;
      p.inventory.setHeld(cur);
      g.audio.play('dig.metal', null, 0.5, 1.2);
      return;
    }
    if (held.id === I.BOW) {
      if (p.creative || p.inventory.count(I.ARROW) > 0) { this.usingBow = true; this.bowTicks = 0; p.using = 'bow'; }
      return;
    }
    if (held.id === I7.SHIELD) { this.startItemUse('shield'); return; }
    if (held.id === I7.TRIDENT) { if ((held.damage ?? 0) < (item.durability ?? 250) - 1) this.startItemUse('trident'); return; }
    if (held.id === I7.CROSSBOW) {
      // loaded: fire; otherwise start loading (if there's anything to load)
      if (held.charged) { fireCrossbow(g, p, held, g.eyePos(1), (yaw, pitch) => g.lookVec(yaw, pitch)); this.damageHeld(held.charged === undefined ? 1 : 0); this.useDelay = 10; return; }
      if (p.creative || p.inventory.offhand?.id === I6.FIREWORK_ROCKET || p.inventory.main.some((s) => s && (s.id === I.ARROW || s.id === I7.SPECTRAL_ARROW || getItem(s.id).name.startsWith('tipped_arrow')))) this.startItemUse('crossbow');
      return;
    }
    if (held.id === I6.FIREWORK_ROCKET) {
      // a glider's boost: the rocket rides along, and the glider's own client does the pulling for as long as it burns
      if (!(p instanceof Player) || !p.gliding) return;
      const r = new FireworkRocket(w, g, held);
      r.setPos(p.x, p.y, p.z);
      r.attached = p;
      g.addEntity(r);
      g.playerOf(p)?.event(['boost', r.lifetime]);
      this.consume(1);
      p.swing();
      return;
    }
    if (held.id === I7.WRITABLE_BOOK || held.id === I11.WRITTEN_BOOK) {
      (g.ui as unknown as { openBook?(slot: number): void }).openBook?.(p.inventory.selected);
      return;
    }
    if (held.id === I7.MAP && g.meta && 'spawnXpAt' in g) {
      // an empty map fills in around whoever opens it (scale 0, this dimension)
      const d = createMap(g.meta, Math.floor(p.x), Math.floor(p.z), 0, w.dimension);
      const filled: ItemStack = { id: I7.FILLED_MAP, count: 1, tag: { map: d.id } };
      if (held.count <= 1 && !p.creative) p.inventory.main[p.inventory.selected] = filled;
      else { if (!p.creative) this.consume(1); if (p.inventory.add(filled) > 0) g.dropItem(p.x, p.y + 1, p.z, filled); }
      g.audio.play('dig.cloth', { x: p.x, y: p.y, z: p.z }, 0.5, 1.8);
      p.swing();
      return;
    }
    if (held.id === I2.ENDER_EYE) {
      throwEye(g);
      this.consume(1);
      p.swing();
      return;
    }
    if (held.id === I.SNOWBALL || held.id === I.EGG || held.id === I.ENDER_PEARL) {
      const kind = held.id === I.SNOWBALL ? 'snowball' : held.id === I.EGG ? 'egg' : 'ender_pearl';
      const e = new Snowball(w, g, p, kind);
      const eye = g.eyePos(1);
      const d = g.lookVec(p.yaw, p.pitch);
      e.setPos(eye.x + d.x * 0.3, eye.y - 0.1, eye.z + d.z * 0.3);
      e.vx = d.x * 1.5 + p.vx; e.vy = d.y * 1.5; e.vz = d.z * 1.5 + p.vz;
      g.addEntity(e);
      g.audio.play('bow', p, 0.5, 0.4 / (Math.random() * 0.4 + 0.8));
      this.consume(1);
      p.swing();
      return;
    }
    if (held.id === I.BUCKET) {
      const eye = g.eyePos(1);
      const d = g.lookVec(p.yaw, p.pitch);
      const hit = raycastBlocks(w, eye.x, eye.y, eye.z, d.x, d.y, d.z, g.reach(), true);
      if (hit) {
        const v = w.get(hit.x, hit.y, hit.z);
        if ((idOf(v) === B.WATER || idOf(v) === B.LAVA) && metaOf(v) === 0) {
          w.set(hit.x, hit.y, hit.z, B.AIR);
          g.audio.play(idOf(v) === B.WATER ? 'splash' : 'fizz', hit, 0.4, 1);
          const filled = stack(idOf(v) === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET);
          if (idOf(v) === B.LAVA) g.achievements.unlock('onFire');
          if (p.creative) { p.inventory.add(filled); return; }
          if (held.count === 1) p.inventory.setHeld(filled);
          else { held.count--; if (p.inventory.add(filled) > 0) g.dropItem(p.x, p.y + 1, p.z, filled); }
          p.swing();
        }
      }
      return;
    }
    if (held.id === I2.FISHING_ROD) {
      if (p.fishHook) {
        const d = p.fishHook.reel();
        if (d) this.damageHeld(d);
        g.audio.play('bow', p, 0.5, 0.4 / (this.rng.next() * 0.4 + 0.8));
      } else {
        const h = new FishingHook(w, g, p);
        h.cast();
        p.fishHook = h;
        g.addEntity(h);
        g.audio.play('bow', p, 0.5, 0.4 / (this.rng.next() * 0.4 + 0.8));
      }
      p.swing();
      return;
    }
    const boatWood = held.id === I2.BOAT ? 'oak' : Object.entries(BOATS).find(([, id]) => id === held.id)?.[0];
    if (boatWood) {
      const eye = g.eyePos(1);
      const d = g.lookVec(p.yaw, p.pitch);
      const hit = raycastBlocks(w, eye.x, eye.y, eye.z, d.x, d.y, d.z, g.reach(), true);
      if (hit && hit.face === 3) {
        const b = new Boat(w, g);
        b.wood = boatWood;
        const onWater = w.getId(hit.x, hit.y, hit.z) === B.WATER;
        // on water: straight at the waterline it floats at
        b.setPos(hit.hx, hit.y + (onWater ? 0.52 : 1), hit.hz);
        b.yaw = b.pyaw = p.yaw;
        g.addEntity(b);
        this.consume(1);
        p.swing();
      }
      return;
    }

    if (item.block === B.LILY_PAD) {
      const eye = g.eyePos(1);
      const d = g.lookVec(p.yaw, p.pitch);
      const hit = raycastBlocks(w, eye.x, eye.y, eye.z, d.x, d.y, d.z, g.reach(), true);
      if (hit && w.getId(hit.x, hit.y, hit.z) === B.WATER && w.getId(hit.x, hit.y + 1, hit.z) === B.AIR) {
        w.set(hit.x, hit.y + 1, hit.z, pack(B.LILY_PAD, this.rng.int(4)));
        g.playBlockSound(B.LILY_PAD, hit.x, hit.y + 1, hit.z, 'place');
        this.consume(1);
      }
    }
  }

  private continueEating() {
    const g = this.game, p = this.player;
    const held = p.inventory.held();
    const item = held ? getItem(held.id) : undefined;
    if (!held || !(item?.food || item?.drink)) { this.eating = 0; return; }
    this.eating++;
    p.eatingTicks = this.eating;
    if (item.drink) {
      if (this.eating % 4 === 0 && this.eating > 7) g.audio.play('drink', p, 0.5, this.rng.next() * 0.1 + 0.9);
      if (this.eating >= 32) {
        this.finishDrinking(held, item);
        this.eating = 0;
        p.eatingTicks = 0;
      }
      return;
    }
    if (this.eating % 4 === 0 && this.eating > 7) {
      g.audio.play('eat', p, 0.5 + 0.5 * this.rng.int(2), (this.rng.next() - this.rng.next()) * 0.2 + 1);
      const eye = g.eyePos(1);
      const d = g.lookVec(p.yaw, p.pitch);
      g.particles!.crumbs(eye.x + d.x * 0.5, eye.y - 0.2, eye.z + d.z * 0.5, d.x, d.z, this.spriteLayer(item.name));
    }
    if (this.eating >= 32 && item.food) {
      p.eat(item.food.hunger, item.food.saturation);
      g.achievements.event('eat', { ate: item.name });
      g.audio.play('burp', p, 0.5, this.rng.next() * 0.1 + 0.9);
      if (held.id === I.GOLDEN_APPLE) { p.addEffect('regeneration', 100, 1); p.addEffect('absorption', 2400, 0); }
      if (held.id === I.ROTTEN_FLESH && this.rng.next() < 0.8) p.addEffect('hunger', 600, 0);
      if (held.id === I.CHICKEN && this.rng.next() < 0.3) p.addEffect('hunger', 600, 0);
      if (held.id === I.SPIDER_EYE) p.addEffect('poison', 100, 0);
      if (held.id === I3.PUFFERFISH) { p.addEffect('poison', 1200, 3); p.addEffect('hunger', 300, 2); }
      // 1.9+ foods: the enchanted golden apple, chorus fruit's random hop, suspicious stew's flower effect
      if (held.id === I7.ENCHANTED_GOLDEN_APPLE) { p.addEffect('regeneration', 400, 1); p.addEffect('absorption', 2400, 3); p.addEffect('resistance', 6000, 0); p.addEffect('fire_resistance', 6000, 0); }
      if (held.id === itemId('chorus_fruit')) chorusHop(g, p, this.rng);
      const stew = (held as ItemStack & { stewEffect?: number }).stewEffect;
      if (stew && FLOWER_EFFECTS[stew]) { const [eff, sec] = FLOWER_EFFECTS[stew]; p.addEffect(eff, Math.max(1, Math.round(sec * 20)), 0); }
      if (!p.creative) {
        if (item.food.stew) p.inventory.setHeld(stack(I.BOWL));
        else this.consume(1);
      }
      this.eating = 0;
      p.eatingTicks = 0;
    }
  }

  private finishDrinking(held: ItemStack, item: ItemDef) {
    const p = this.player;
    // honey: food that cures poison, and leaves the bottle
    if (held.id === I7.HONEY_BOTTLE) {
      p.eat(6, 1.2);
      p.removeEffect('poison');
      if (!p.creative) { held.count--; if (held.count <= 0) p.inventory.setHeld(stack(I3.GLASS_BOTTLE)); else if (p.inventory.add(stack(I3.GLASS_BOTTLE)) > 0) this.game.dropItem(p.x, p.y + 1, p.z, stack(I3.GLASS_BOTTLE)); }
      return;
    }
    if (held.id === I.MILK_BUCKET) {
      p.clearEffects();
      if (!p.creative) p.inventory.setHeld(stack(I.BUCKET));
      return;
    }
    const type = POTION_BY_KEY.get(item.potion ?? 'water');
    for (const [id, dur, amp] of type?.effects ?? []) p.addEffect(id, dur, amp);
    if (!p.creative) {
      if (held.count > 1) { held.count--; if (p.inventory.add(stack(I3.GLASS_BOTTLE)) > 0) this.game.dropItem(p.x, p.y + 1, p.z, stack(I3.GLASS_BOTTLE)); }
      else p.inventory.setHeld(stack(I3.GLASS_BOTTLE));
    }
  }

  /** Mod items used for as long as the button is held: their useTick runs instead of any right-click use. */
  private holdUse(): boolean {
    const p = this.player, held = p.inventory.held();
    const item = held ? getItem(held.id) : undefined;
    const ib = item?.behavior;
    if (!held || !ib?.useTick || p.spectator) { this.endHold(); return false; }
    if (this.holding && this.holding.slot !== p.inventory.selected) this.endHold();
    const h = (this.holding ??= { slot: p.inventory.selected, ticks: 0 });
    guard(item!.mod, 'useTick', () => ib.useTick!({ ...this.itemCtx(held), ticks: h.ticks }), undefined);
    h.ticks++;
    return true;
  }

  private endHold() {
    const h = this.holding;
    if (!h) return;
    this.holding = null;
    const p = this.game.player, held = p?.inventory.main[h.slot];
    const item = held ? getItem(held.id) : undefined;
    if (p && held && item?.behavior?.useStop) guard(item.mod, 'useStop', () => item.behavior!.useStop!({ ...this.itemCtx(held), ticks: h.ticks }), undefined);
  }

  private startItemUse(kind: 'shield' | 'crossbow' | 'trident') {
    this.usingItem = kind;
    this.useTicks = 0;
    const p = this.player;
    p.using = kind;
    p.useTicks = 0;
    if (kind === 'crossbow') this.game.audio.play('crossbow.loading', p, 0.5, 1);
  }
  /** Holding the button: the shield comes up after 5 ticks; a crossbow loads when charged. */
  private continueItemUse() {
    const p = this.player, held = p.inventory.held();
    this.useTicks++;
    p.useTicks = this.useTicks;
    if (this.usingItem === 'shield') {
      if (!shieldHand(p)) { this.stopUsing(); return; }
      p.blocking = this.useTicks >= 5 && p.shieldCooldown === 0;
    } else if (this.usingItem === 'crossbow') {
      if (held?.id !== I7.CROSSBOW) { this.stopUsing(); return; }
      if (!held.charged && this.useTicks >= crossbowLoadTicks(held)) { loadCrossbow(this.game, p, held); this.usingItem = ''; p.using = ''; this.useDelay = 5; }
    } else if (this.usingItem === 'trident' && held?.id !== I7.TRIDENT) this.stopUsing();
  }
  private releaseItemUse() {
    const g = this.game, p = this.player, held = p.inventory.held();
    if (this.usingItem === 'trident' && held?.id === I7.TRIDENT) releaseTrident(g, p, held, this.useTicks, g.eyePos(1), g.lookVec(p.yaw, p.pitch), () => p.inventory.setHeld(null), (n) => this.damageHeld(n));
    this.usingItem = '';
    this.useTicks = 0;
    p.blocking = false;
    p.using = '';
    p.useTicks = 0;
  }

  private stopUsing() {
    const p = this.game.player;
    this.endHold();
    if (this.usingItem && p) this.releaseItemUse();
    if (p && p.using === 'bow') p.using = '';
    if (this.usingBow && p) this.releaseBow();
    this.eating = 0;
    if (p) p.eatingTicks = 0;
    this.usingBow = false;
  }

  private releaseBow() {
    const g = this.game, p = this.player;
    this.usingBow = false;
    let f = this.bowTicks / 20;
    f = (f * f + f * 2) / 3;
    if (f < 0.1) return;
    if (f > 1) f = 1;
    const bowStack = p.inventory.held();
    const infinity = level(bowStack, 'infinity') > 0;
    if (!p.creative && !infinity && !p.inventory.remove(I.ARROW, 1)) return;
    if (infinity && !p.creative && p.inventory.count(I.ARROW) < 1) return;
    const a = new Arrow(this.world, g, p);
    const pw = level(bowStack, 'power');
    if (pw) a.damageBase += pw * 0.5 + 0.5;
    if (level(bowStack, 'flame')) a.fireTicks = 100;
    (a as unknown as { punch: number }).punch = level(bowStack, 'punch');
    const eye = g.eyePos(1);
    const d = g.lookVec(p.yaw, p.pitch);
    a.setPos(eye.x, eye.y - 0.1, eye.z);
    a.shoot(d.x, d.y, d.z, f * 3, 1);
    a.pickup = !p.creative && !infinity;
    if (f >= 1) (a as unknown as { crit: boolean }).crit = true;
    g.addEntity(a);
    g.audio.play('bow', p, 1, 1 / (this.rng.next() * 0.4 + 1.2) + f * 0.5);
    this.damageHeld(1);
    this.bowTicks = 0;
  }

  consume(n: number) {
    const p = this.player;
    if (p.creative) return;
    const s = p.inventory.held();
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) p.inventory.setHeld(null);
  }

  /** Vanilla getFacingFromEntity: FACING6 pointing from the block toward the placer. */
  private facingFromEntity(x: number, y: number, z: number): number {
    const p = this.player;
    if (Math.abs(p.x - (x + 0.5)) < 2 && Math.abs(p.z - (z + 0.5)) < 2) {
      const eye = p.y + p.eyeHeight();
      if (eye - y > 2) return 1;
      if (y - eye > 0) return 0;
    }
    return [3, 4, 2, 5][this.playerFacing()];
  }

  private playerFacing(): number {
    const mc = Math.floor((this.player.yaw * 4) / 360 + 0.5) & 3; // 0 south, 1 west, 2 north, 3 east
    return (mc + 2) & 3; // -> 0 north, 1 east, 2 south, 3 west
  }

  placeBlock(t: BlockHit, held: ItemStack, item: ItemDef): boolean {
    const g = this.game, w = this.world, p = this.player;
    if (p.gameMode === GameMode.Adventure) return false;
    let blockId = item.block!;
    const tv = w.get(t.x, t.y, t.z);
    const tid = idOf(tv);
    let x = t.x, y = t.y, z = t.z, face = t.face;
    const fracY = t.hy - Math.floor(t.hy);
    // slab merging
    if (isSlab(blockId) && tid === blockId) {
      const m = metaOf(tv) & 7;
      if ((face === 3 && m === 0) || (face === 2 && m === 1)) return this.setPlaced(x, y, z, doubleSlab(blockId, tv), blockId);
    }
    // scaffolding used on the top of scaffolding goes on top of the tower
    if (blockId === B2.SCAFFOLDING && tid === B2.SCAFFOLDING && face === 3) {
      while (y < 255 && w.getId(x, y + 1, z) === B2.SCAFFOLDING) y++;
    }
    if (BLOCKS[tid].replaceable && tid !== B.WATER && tid !== B.LAVA || tid === B.SNOW) {
      face = 3;
    } else {
      const [dx, dy, dz] = FACE_DIRS[face];
      x += dx; y += dy; z += dz;
      const cv = w.get(x, y, z);
      if (isSlab(blockId) && idOf(cv) === blockId && (metaOf(cv) & 7) !== 2) return this.setPlaced(x, y, z, doubleSlab(blockId, cv), blockId);
    }
    if (y < 0 || y >= 256) return false;
    const cur = w.getId(x, y, z);
    if (!BLOCKS[cur].replaceable && cur !== B.AIR) return false;
    if (cur === blockId && blockId !== B.SNOW && blockId !== B2.VINE) return false;
    let meta = 0;
    const facing = this.playerFacing();
    const pdef = BLOCKS[blockId];
    if (!pdef.mod) {
      const fam = familyPlacement(blockId, { world: w, x, y, z, face, facing, yaw: p.yaw, hitY: fracY, replaced: w.get(x, y, z) });
      if (fam !== undefined) {
        if (!fam) return false;
        for (const [bx, by, bz, bv] of fam) {
          if (!g.ticker!.canStay(bx, by, bz, bv) && !(fam.length > 1)) return false;
          if (!this.noEntities(bx, by, bz, bv)) return false;
        }
        if (fam.length === 1) {
          const [fx, fy, fz, fv] = fam[0];
          if (!this.setPlaced(fx, fy, fz, fv, blockId)) return false;
          // a banner keeps its patterns (the ominous banner comes with the illagers' design)
          if (isBanner(idOf(fv))) w.setTile(fx, fy, fz, { type: 'banner', patterns: (held.banner ?? (held.id === I9.OMINOUS_BANNER ? OMINOUS : [])).map((l) => ({ ...l })) } as never);
          return true;
        }
        if (!this.setAll(fam)) return false;
        for (const [bx, by, bz, bv] of fam) this.initTile(bx, by, bz, bv);
        if (!g.ticker!.canStay(x, y, z, fam[0][3])) { for (const [bx, by, bz] of fam) w.set(bx, by, bz, B.AIR); return false; }
        g.playBlockSound(blockId, x, y, z, 'place');
        this.consume(1);
        return true;
      }
    }
    if (pdef.behavior?.placementMeta) {
      const m = callBlock(blockId, 'placementMeta', () => pdef.behavior!.placementMeta!({ game: g, world: w, player: p, x, y, z, face, facing, facing6: this.facingFromEntity(x, y, z), hitY: fracY, held }), null);
      if (m === null) return false;
      meta = m & 15;
    } else if (pdef.mod) {
      // a mod cube with a front face turns it toward the player
      if (pdef.faces.length > 6) meta = (facing + 2) & 3;
    } else if (isPillar(blockId)) meta = face === 0 || face === 1 ? 1 : face === 4 || face === 5 ? 2 : 0;
    else if (isOriented(blockId)) meta = (facing + 2) & 3;
    else if (isStairs(blockId)) meta = facing | (face === 2 || (face !== 3 && fracY > 0.5) ? 4 : 0);
    else if (isSlab(blockId)) meta = face === 2 || (face !== 3 && fracY > 0.5) ? 1 : 0;
    else if (isLeaves(blockId)) meta = 1;
    else if (blockId === B.TORCH || blockId === B.LADDER || blockId === B.REDSTONE_TORCH || blockId === B.LEVER || blockId === B.STONE_BUTTON || blockId === B2.SOUL_TORCH) {
      const wallDir: Record<number, number> = { 0: 1, 1: 3, 4: 2, 5: 0 };
      const wallMounted = blockId !== B.LADDER;
      if (face === 3 && wallMounted) meta = 0;
      else if (face in wallDir) meta = wallMounted ? wallDir[face] + 1 : wallDir[face];
      else return false;
      if (!g.ticker!.canStay(x, y, z, pack(blockId, meta))) return false;
    } else if (blockId === B.LILY_PAD) return false;
    else if (blockId === B.WHEAT || blockId === B.PUMPKIN_STEM) meta = 0;
    else if (isRepeater(blockId) || blockId === B.COMPARATOR) meta = facing;
    else if (blockId === B.ANVIL) meta = (facing + 1) & 3;
    else if (isPiston(blockId) || blockId === B.DISPENSER || blockId === B.DROPPER) meta = this.facingFromEntity(x, y, z);
    else if (blockId === B.OBSERVER || isCommandBlock(blockId)) meta = this.facingFromEntity(x, y, z) ^ 1;
    else if (blockId === B.HOPPER) { meta = FACE_TO_FACING6[face] ^ 1; if (meta === 1) meta = 0; }
    else if (isRail(blockId)) meta = facing & 1 ? 1 : 0;
    const v = pack(blockId, meta);
    if (blockId === B.OAK_DOOR) {
      if (!BLOCKS[w.getId(x, y + 1, z)].replaceable || !BLOCKS[w.getId(x, y - 1, z)].solid) return false;
      if (!this.noEntities(x, y, z, pack(B.OAK_DOOR, facing)) || !this.noEntities(x, y + 1, z, pack(B.OAK_DOOR, facing | 8))) return false;
      this.setAll([[x, y, z, pack(B.OAK_DOOR, facing)], [x, y + 1, z, pack(B.OAK_DOOR, facing | 8)]]);
      g.playBlockSound(B.OAK_DOOR, x, y, z, 'place');
      this.consume(1);
      return true;
    }
    if (blockId === B.BED) {
      const [dx, dz] = HORIZ[facing];
      const hx = x + dx, hz = z + dz;
      if (!BLOCKS[w.getId(hx, y, hz)].replaceable || !BLOCKS[w.getId(x, y - 1, z)].solid || !BLOCKS[w.getId(hx, y - 1, hz)].solid) return false;
      this.setAll([[x, y, z, pack(B.BED, facing)], [hx, y, hz, pack(B.BED, facing | 8)]]);
      g.playBlockSound(B.BED, x, y, z, 'place');
      this.consume(1);
      return true;
    }
    if (BLOCKS[blockId].needsSupport || BLOCKS[blockId].behavior?.canStay || blockId === B.WHEAT || blockId === B.SUGAR_CANE || blockId === B.CACTUS) {
      if (!g.ticker!.canStay(x, y, z, v)) return false;
    }
    if (!this.noEntities(x, y, z, v)) return false;
    // tile entities
    if (blockId === B.CHEST) w.setTile(x, y, z, undefined);
    const placed = this.setPlaced(x, y, z, v, blockId);
    if (placed && SEEDED.includes(BLOCKS[blockId].name)) g.achievements.event('plant');
    // a shulker box item brings its contents back
    if (placed && held.box && isShulkerBox(blockId)) w.setTile(x, y, z, { type: 'chest', items: held.box.map((s) => (s ? { ...s } : null)) } as never);
    return placed;
  }

  private setPlaced(x: number, y: number, z: number, v: number, soundBlock: number): boolean {
    const g = this.game, w = this.world;
    if (!w.set(x, y, z, v)) return false;
    g.achievements.stat('used:' + (BLOCKS[soundBlock]?.name ?? ''));
    this.initTile(x, y, z, v);
    const def = BLOCKS[idOf(v)];
    if (def.mod && def.behavior?.onPlaced) callBlock(idOf(v), 'onPlaced', () => def.behavior!.onPlaced!({ ...blockCtx(g, x, y, z, v), player: this.player }), undefined);
    hardenConcrete(w, x, y, z);
    // a placed sign asks for its words
    if (/_sign$/.test(def.name)) (g.ui as unknown as { openSign?(x: number, y: number, z: number): void }).openSign?.(x, y, z);
    // a pumpkin on iron or snow blocks brings a golem to life
    if (idOf(v) === B2.CARVED_PUMPKIN || idOf(v) === B.JACK_O_LANTERN) { const m = buildGolem(g, x, y, z); if (m) advanceNear(g, m, 'golem', {}, 8); }
    // three wither skeleton skulls on a T of soul sand: the Wither
    if ((idOf(v) === B2.WITHER_SKELETON_SKULL || idOf(v) === B2.WITHER_SKELETON_WALL_SKULL) && w.dimension !== undefined) { const wi = buildWither(g, x, y, z); if (wi) advanceNear(g, wi, 'wither', {}, 50); }
    if (Events.blockPlaced.any) Events.blockPlaced.fire({ game: g, player: this.player, x, y, z, v });
    g.playBlockSound(soundBlock, x, y, z, 'place');
    this.consume(1);
    return true;
  }

  /** A block was just put at (x, y, z): give it its tile entity (chests, furnaces...) and let it settle. */
  initTile(x: number, y: number, z: number, v: number) {
    const g = this.game, w = this.world;
    const id = idOf(v);
    if (id === B.CHEST) w.setTile(x, y, z, { type: 'chest', items: new Array(27).fill(null) });
    if (id >= B2.CRIMSON_NYLIUM || isShulkerBox(id)) stationTile(w, x, y, z, id);
    if (id === B.FURNACE) w.setTile(x, y, z, { type: 'furnace', slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 });
    if (id === B.HOPPER) w.setTile(x, y, z, { type: 'hopper', items: [null, null, null, null, null], cooldown: 0 });
    if (id === B.DISPENSER || id === B.DROPPER) w.setTile(x, y, z, { type: id === B.DISPENSER ? 'dispenser' : 'dropper', items: new Array(9).fill(null) });
    if (id === B.BREWING_STAND) w.setTile(x, y, z, newBrewingTile() as never);
    if (id === B.COMPARATOR) { w.setTile(x, y, z, { type: 'comparator', out: 0 }); g.ticker!.schedule(x, y, z, 2); }
    if (id === B.ANVIL) g.ticker!.schedule(x, y, z, 2);
    if (isPiston(id) || id === B.DISPENSER || id === B.DROPPER || id === B.HOPPER) g.redstone.update(x, y, z);
    if (isRail(id)) { layRail(w, x, y, z, g.redstone.isPowered(x, y, z)); g.redstone.update(x, y, z); }
    if (id === B.SAND || id === B.GRAVEL) g.ticker!.schedule(x, y, z, 2);
    const def = BLOCKS[id];
    if (def.mod) {
      const beh = def.behavior;
      if (beh?.tile) w.setTile(x, y, z, { ...callBlock(id, 'tile create', () => beh.tile!.create(blockCtx(g, x, y, z, v)), {}), type: def.name } as never);
      if (beh?.redstone) g.redstone.update(x, y, z);
    }
  }

  private noEntities(x: number, y: number, z: number, v: number): boolean {
    const shapes = collisionShapes(v);
    if (!shapes.length) return true;
    const ents: Entity[] = this.game.entities.filter((e) => e instanceof LivingEntity && !e.dead && !(e instanceof Player && e.spectator));
    for (const s of shapes) {
      const b = { x0: x + s.x0, y0: y + s.y0, z0: z + s.z0, x1: x + s.x1, y1: y + s.y1, z1: z + s.z1 };
      for (const e of ents) {
        if (aabbIntersects(b, e.box)) return false;
      }
    }
    return true;
  }

  // ------------------------------------------------------------------ combat
  attack(e: Entity) {
    const g = this.game, p = this.player;
    p.swing();
    if (Events.attackEntity.any && Events.attackEntity.fire({ game: g, player: p, target: e }) !== undefined) return;
    const inHand = p.inventory.held(), hd = inHand ? getItem(inHand.id) : undefined;
    if (inHand && hd?.behavior?.hitEntity) guard(hd.mod, 'hitEntity', () => hd.behavior!.hitEntity!({ ...this.itemCtx(inHand), target: e }), undefined);
    if (e instanceof Fireball) {
      const d = g.lookVec(p.yaw, p.pitch);
      e.deflect(d.x, d.y, d.z);
      return;
    }
    // vehicles and hanging things take hits their own way
    if (typeof (e as unknown as { attacked?: unknown }).attacked === 'function') {
      (e as unknown as { attacked(creative: boolean): void }).attacked(p.creative);
      return;
    }
    if (p.spectator || !(e instanceof LivingEntity)) return;
    if (e instanceof EndCrystal) { e.damage(1, 'player', p); return; }
    // the part under the crosshair is only meaningful for this hit; damage() consumes it
    e.hitPart = e === g.targetEntity ? g.targetPart : null;
    const held = p.inventory.held();
    const item = held ? getItem(held.id) : undefined;
    // 1.9: the swing's charge scales the damage; a full-charge sword swing on the ground sweeps
    const sw = swingDamage(p, e, Math.max(0, (item?.attack ?? 1) + p.attackBonus()));
    p.attackTicks = 0;
    const { dmg, crit } = sw;
    if (e.arthropod) {
      const bane = level(held, 'bane_of_arthropods');
      if (bane) e.addEffect('slowness', 20 + this.rng.int(10 * bane), 3);
    }
    const hit = e.damage(dmg, 'player', p);
    if (hit) {
      g.achievements.stat('damage_dealt', Math.round(dmg * 10));
      if (crit) g.particles!.crit(e.x, e.y + e.height * 0.6, e.z);
      if (sw.sweep) sweep(g, p, e, dmg);
      g.audio.play(crit ? 'attack.crit' : sw.sweep ? 'attack.sweep' : sw.strength > 0.9 ? 'attack.strong' : 'attack.weak', p, 1, 1);
      const kb = level(held, 'knockback'), fa = level(held, 'fire_aspect');
      if (kb) { const r = (p.yaw * Math.PI) / 180; e.vx -= Math.sin(r) * 0.5 * kb; e.vz += Math.cos(r) * 0.5 * kb; e.vy += 0.1; }
      if (fa) e.fireTicks = Math.max(e.fireTicks, 80 * fa);
      if (held?.ench) for (let k = 0; k < 6; k++) g.particles!.spell(e.x + (Math.random() - 0.5), e.y + e.height * 0.6, e.z + (Math.random() - 0.5), 0x8040ff);
      if (p.sprinting && sw.strength > 0.9) {
        const r = (p.yaw * Math.PI) / 180;
        e.vx -= Math.sin(r) * 0.5;
        e.vz += Math.cos(r) * 0.5;
        e.vy += 0.1;
        p.vx *= 0.6; p.vz *= 0.6;
        p.sprinting = false;
      }
      p.exhaust(0.3);
      if (item?.durability) this.damageHeld(item.tool?.type === 'sword' ? 1 : 2);
    }
  }

  arrowHitEntity(a: Arrow, nx: number, ny: number, nz: number): boolean {
    const g = this.game;
    for (const e of g.entities) {
      if (!(e instanceof LivingEntity) || e.dead || e === a.shooter && a.age < 5) continue;
      if (e instanceof Player && e.spectator) continue;
      if (a.pierced.includes(e)) continue;
      const hb = e.hitBoxes().find((b) => nx > b.x0 - 0.3 && nx < b.x1 + 0.3 && ny > b.y0 - 0.3 && ny < b.y1 + 0.3 && nz > b.z0 - 0.3 && nz < b.z1 + 0.3);
      if (hb) {
        e.hitPart = hb.part ?? null;
        // a blocking shield stops arrows (and tridents) from the front
        if (e instanceof Player && shieldBlocks(g, e, 2, 'arrow', a)) { a.vx *= -0.1; a.vy *= -0.1; a.vz *= -0.1; a.pierce = 0; return true; }
        if (a instanceof ThrownTrident) { if (!a.dealtDamage) a.onHitEntity(e); return true; }
        const speed = Math.hypot(a.vx, a.vy, a.vz);
        let dmg = Math.ceil(speed * a.damageBase);
        if ((a as unknown as { crit?: boolean }).crit) dmg += this.rng.int(Math.floor(dmg / 2) + 2);
        if (e.damage(dmg, 'arrow', a.shooter ?? a)) {
          if (a.shooter instanceof Player) g.playerOf(a.shooter)?.achievements.event('arrow_hit');
          const h = Math.hypot(a.vx, a.vz) || 1;
          const punch = (a as unknown as { punch?: number }).punch ?? 0;
          e.vx += (a.vx / h) * 0.6 * (0.6 + punch * 0.6);
          e.vz += (a.vz / h) * 0.6 * (0.6 + punch * 0.6);
          if (a.fireTicks > 0) e.fireTicks = Math.max(e.fireTicks, 100);
          if (a.effect) e.addEffect(a.effect[0], a.effect[1], a.effect[2]);
          // tipped arrows: the potion's effects at an eighth of their time
          if (a.tipped) for (const [id, dur, amp] of POTION_BY_KEY.get(a.tipped)?.effects ?? []) e.addEffect(id, dur <= 1 ? 1 : Math.max(1, Math.floor(dur / 8)), amp);
          e.vy += 0.1;
          g.audio.play('arrowHit', a, 1, 1.2);
          if (a.pierce > 0) { a.pierce--; a.pierced.push(e); return false; }
          a.removed = true;
        } else {
          a.vx *= -0.1; a.vy *= -0.1; a.vz *= -0.1;
        }
        return true;
      }
    }
    return false;
  }

  projectileHitEntity(s: Snowball, nx: number, ny: number, nz: number): Entity | null {
    const g = this.game;
    for (const e of g.entities) {
      if (!(e instanceof LivingEntity) || e.dead || e === s.shooter || (e instanceof Player && e.spectator)) continue;
      const hb = e.hitBoxes().find((b) => nx > b.x0 - 0.2 && nx < b.x1 + 0.2 && ny > b.y0 - 0.2 && ny < b.y1 + 0.2 && nz > b.z0 - 0.2 && nz < b.z1 + 0.2);
      if (hb) {
        e.hitPart = hb.part ?? null;
        // snowballs hurt blazes (snow golems' one real weapon)
        const blaze = s.kind === 'snowball' && (e as unknown as { typeName?: string }).typeName === 'Blaze';
        e.damage(blaze ? 3 : 0.01, 'generic', s.shooter);
        return e;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ TNT / explosions
  primeTnt(x: number, y: number, z: number, short = false) {
    const g = this.game;
    const t = new PrimedTnt(this.world, g);
    t.setPos(x + 0.5, y, z + 0.5);
    if (short) t.fuse = 10 + this.rng.int(20);
    g.addEntity(t);
    g.audio.play('fuse', t, 1, 1);
  }

  explode(x: number, y: number, z: number, power: number, fire: boolean, source: Entity | null) {
    const g = this.game, w = this.world;
    const affected = new Set<string>();
    const inWater = BLOCKS[w.getId(Math.floor(x), Math.floor(y), Math.floor(z))].fluid;
    if (!inWater) {
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 16; j++)
          for (let k = 0; k < 16; k++) {
            if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
            let dx = (i / 15) * 2 - 1, dy = (j / 15) * 2 - 1, dz = (k / 15) * 2 - 1;
            const l = Math.hypot(dx, dy, dz);
            dx /= l; dy /= l; dz /= l;
            let intensity = power * (0.7 + this.rng.next() * 0.6);
            let px = x, py = y, pz = z;
            for (; intensity > 0; intensity -= 0.3 * 0.75) {
              const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
              const id = w.getId(bx, by, bz);
              if (id !== 0) intensity -= (BLOCKS[id].blastResistance / 5 + 0.3) * 0.3;
              if (intensity > 0 && id !== 0) affected.add(bx + ',' + by + ',' + bz);
              px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
            }
          }
    }
    // entities
    const r2 = power * 2;
    for (const e of g.entities) {
      if (e === source || e.removed || (e instanceof Player && e.spectator)) continue;
      const d = e.distanceTo({ x, y, z }) / r2;
      if (d > 1) continue;
      let ex = e.x - x, ey = e.y + (e instanceof LivingEntity ? e.eyeHeight() : 0) - y, ez = e.z - z;
      const dl = Math.hypot(ex, ey, ez);
      if (dl === 0) continue;
      ex /= dl; ey /= dl; ez /= dl;
      const exposure = this.exposure(x, y, z, e);
      const impact = (1 - d) * exposure;
      const shooter = (source as unknown as { shooter?: Entity } | null)?.shooter;
      const attacker = source instanceof LivingEntity ? source : shooter instanceof LivingEntity ? shooter : null;
      if (e instanceof LivingEntity && e !== attacker) e.damage(Math.floor(((impact * impact + impact) / 2) * 7 * r2 + 1), 'explosion', attacker);
      if (e instanceof ItemEntity && impact > 0.3) { e.removed = true; continue; }
      e.vx += ex * impact; e.vy += ey * impact; e.vz += ez * impact;
    }
    // sound & particles
    g.audio.play('explode', { x, y, z }, 4, (1 + (this.rng.next() - this.rng.next()) * 0.2) * 0.7);
    g.particles!.explosion(x, y, z);
    for (let i = 0; i < 16; i++) g.particles!.explosion(x + (this.rng.next() - 0.5) * power * 1.5, y + (this.rng.next() - 0.5) * power * 1.5, z + (this.rng.next() - 0.5) * power * 1.5);
    // destroy blocks
    this.destroyBlocks([...affected].map((k) => k.split(',').map(Number) as [number, number, number]), { drops: 1 / power, fire, fx: 'smoke' });
  }

  /**
   * Destroy blocks the way an explosion does: TNT primes, containers spill, neighbours update once at the end, mod
   * blocks hear about it. Each block drops its items (as if mined with the right tool) with probability `drops`;
   * `fire` sets some of the gaps alight; `fx` is the puff each block leaves. Returns how many blocks went.
   */
  destroyBlocks(list: Iterable<readonly [number, number, number]>, opts: { drops?: number; fire?: boolean; fx?: 'smoke' | 'break' | 'none' } = {}): number {
    const g = this.game, w = this.world, t = g.ticker!;
    const drops = opts.drops ?? 1, fx = opts.fx ?? 'break';
    t.suppress = true;
    const changed: [number, number, number, number][] = [];
    try {
      for (const [bx, by, bz] of list) {
        const v = w.get(bx, by, bz);
        const id = idOf(v);
        if (id === 0) continue;
        if (id === B.TNT) { w.set(bx, by, bz, B.AIR); this.primeTnt(bx, by, bz, true); continue; }
        if (drops > 0 && this.rng.next() < drops) {
          const def = BLOCKS[id];
          // harvested as if with the correct tool
          const tool: ItemDef | undefined = def.harvestLevel >= 0 && def.tool ? { id: -1, name: 'explosion', display: '', maxStack: 1, tool: { type: def.tool, level: 3, speed: 1, damage: 0 } } : undefined;
          for (const d of blockDrops(id, metaOf(v), tool, this.rng)) g.dropItem(bx + 0.5, by + 0.5, bz + 0.5, d);
        }
        if (fx === 'smoke' && this.rng.int(4) === 0) g.particles!.smoke(bx + this.rng.next(), by + this.rng.next(), bz + this.rng.next(), true);
        else if (fx === 'break' && changed.length < 24) g.particles!.blockBreak(bx, by, bz, id, this.tintAt(bx, by, bz, id));
        this.dropTileContents(bx, by, bz, v);
        w.set(bx, by, bz, B.AIR);
        changed.push([bx, by, bz, v]);
      }
    } finally {
      t.suppress = false;
    }
    for (const [bx, by, bz, v] of changed) {
      for (const [dx, dy, dz] of FACE_DIRS) t.neighborChanged(bx + dx, by + dy, bz + dz);
      if (BLOCKS[idOf(v)].behavior?.onBreak) this.broken(bx, by, bz, v, null);
      if (opts.fire && this.rng.int(3) === 0 && w.getId(bx, by, bz) === B.AIR && OPAQUE[w.getId(bx, by - 1, bz)]) w.set(bx, by, bz, B.FIRE);
    }
    return changed.length;
  }

  private exposure(x: number, y: number, z: number, e: Entity): number {
    const b = e.box;
    let hit = 0, total = 0;
    for (let i = 0; i <= 1; i += 0.5)
      for (let j = 0; j <= 1; j += 0.5)
        for (let k = 0; k <= 1; k += 0.5) {
          const px = b.x0 + (b.x1 - b.x0) * i, py = b.y0 + (b.y1 - b.y0) * j, pz = b.z0 + (b.z1 - b.z0) * k;
          const d = Math.hypot(px - x, py - y, pz - z);
          const r = raycastBlocks(this.world, x, y, z, (px - x) / d, (py - y) / d, (pz - z) / d, d);
          if (!r || !OPAQUE[this.world.getId(r.x, r.y, r.z)] && !BLOCKS[this.world.getId(r.x, r.y, r.z)].solid) hit++;
          total++;
        }
    return hit / total;
  }

  spawnMob(type: string, x: number, y: number, z: number, baby = false) {
    const e = createEntity(type, this.world, this.game);
    if (!e) return null;
    e.setPos(x, y, z);
    if (baby) (e as unknown as { baby: boolean }).baby = true;
    this.game.addEntity(e);
    return e;
  }

  // ------------------------------------------------------------------ dropping
  dropHeld(all: boolean) {
    const g = this.game, p = this.player;
    const s = p.inventory.held();
    if (!s || p.dead) return;
    const n = all ? s.count : 1;
    const drop = { ...s, count: n };
    s.count -= n;
    if (s.count <= 0) p.inventory.setHeld(null);
    this.throwStack(drop);
    p.swing();
  }

  throwStack(s: ItemStack) {
    this.game.achievements.stat('dropped:' + getItem(s.id).name, s.count);
    const g = this.game, p = this.player;
    const eye = g.eyePos(1);
    const e = g.dropItem(p.x, eye.y - 0.3, p.z, s, false, 40);
    if (!e) return;
    const f = 0.3;
    const yaw = (p.yaw * Math.PI) / 180, pitch = (p.pitch * Math.PI) / 180;
    e.vx = -Math.sin(yaw) * Math.cos(pitch) * f;
    e.vz = Math.cos(yaw) * Math.cos(pitch) * f;
    e.vy = -Math.sin(pitch) * f + 0.1;
    const a = this.rng.next() * Math.PI * 2, ff = 0.02 * this.rng.next();
    e.vx += Math.cos(a) * ff;
    e.vy += (this.rng.next() - this.rng.next()) * 0.1;
    e.vz += Math.sin(a) * ff;
  }

  /** F: swap what's in the main hand with the off hand. */
  swapOffhand() {
    const p = this.player, inv = p.inventory;
    if (p.spectator) return;
    if (this.usingItem) this.releaseItemUse();
    const main = inv.held();
    inv.setHeld(inv.offhand);
    inv.offhand = main;
  }

  fallingBlock(x: number, y: number, z: number, id: number) {
    const e = new FallingBlock(this.world, this.game, id);
    e.setPos(x + 0.5, y, z + 0.5);
    this.game.addEntity(e);
  }
}

/** Chorus fruit: a hop to a random safe spot within 8 blocks (vanilla tries 16 times). */
function chorusHop(g: Game, p: Player, r: Random) {
  const w = g.world!;
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(p.x + (r.next() - 0.5) * 16), z = Math.floor(p.z + (r.next() - 0.5) * 16);
    let y = Math.min(255, Math.floor(p.y + r.int(16) - 8));
    while (y > 1 && !BLOCKS[w.getId(x, y - 1, z)].solid) y--;
    if (BLOCKS[w.getId(x, y, z)].solid || BLOCKS[w.getId(x, y + 1, z)].solid || BLOCKS[w.getId(x, y, z)].fluid) continue;
    g.audio.play('enderman.teleport', p, 1, 1);
    p.setPos(x + 0.5, y, z + 0.5);
    p.fallDistance = 0;
    (g.playerOf(p) as unknown as { teleported?(): void } | null)?.teleported?.();
    return;
  }
}

/** A banner block (standing or on a wall) as its item, with the patterns from its tile. */
function bannerItem(id: number, tile: unknown): ItemStack {
  const pats = (tile as { patterns?: { p: string; c: number }[] } | undefined)?.patterns ?? [];
  const color = bannerColor(id);
  return { id: BANNERS[color], count: 1, ...(pats.length ? { banner: pats.map((l) => ({ ...l })) } : {}) };
}
/** The illagers' banner: on white, a cyan lozenge, grey stripes and bordure, a black fess (vanilla's eight layers). */
const OMINOUS = [{ p: 'mr', c: 9 }, { p: 'bs', c: 8 }, { p: 'cs', c: 7 }, { p: 'bo', c: 8 }, { p: 'ms', c: 15 }, { p: 'hh', c: 8 }, { p: 'mc', c: 8 }, { p: 'bo', c: 15 }];
/** Crops planted from seeds ("A Seedy Place"). */
const SEEDED = ['wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem', 'nether_wart', 'sweet_berry_bush', 'cocoa'];
