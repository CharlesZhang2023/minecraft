// Player interaction with blocks & entities: mining, placing, using items, combat, explosions.
import type { Game } from './game';
import { B, BLOCKS, idOf, metaOf, pack, isLog, isStairs, isSlab, isLeaves, HORIZ, FACE_DIRS, isOriented, Render, TEXTURES, tex, OPAQUE } from '../world/blocks';
import { collisionShapes } from '../world/models';
import { getItem, blockDrops, ItemStack, I, I2, stack, ItemDef } from './items';
import { BlockHit, raycastBlocks } from './raycast';
import { Entity } from '../entity/entity';
import { LivingEntity } from '../entity/living';
import { PrimedTnt, Arrow, Snowball, XpOrb, ItemEntity, FallingBlock, Fireball } from '../entity/item';
import { Boat } from '../entity/boat';
import { createEntity } from '../entity/registry';
import { aabbIntersects } from '../math';
import { Random } from '../noise';
import { GameMode } from './player';
import { findFrameAt, frameBlocks } from './portal';

export interface Breaking { x: number; y: number; z: number; progress: number; face: number; sound: number }

export class Interaction {
  breaking: Breaking | null = null;
  hitDelay = 0;
  useDelay = 0;
  eating = 0;
  bowTicks = 0;
  usingBow = false;
  arrowId = I.ARROW;
  private rng = new Random(4321);
  private leftWasDown = false;
  private rightWasDown = false;

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
    if (clicks.includes(0)) {
      if (g.targetEntity) this.attack(g.targetEntity);
      else if (!g.target) p.swing();
    }
    if (left && !g.targetEntity && g.target && !p.spectator && this.eating === 0 && !this.usingBow) this.mine(g.target);
    else this.breaking = null;
    // ------ right: use
    if (right) {
      if (this.eating > 0) this.continueEating();
      else if (this.usingBow) this.bowTicks++;
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
    const eyeId = this.world.getId(Math.floor(p.x), Math.floor(p.y + p.eyeHeight()), Math.floor(p.z));
    if (eyeId === B.WATER) speed /= 5;
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
    const held = p.inventory.held();
    const tool = held ? getItem(held.id) : undefined;
    g.particles!.blockBreak(x, y, z, id, this.tintAt(x, y, z, id));
    g.playBlockSound(id, x, y, z, 'break');
    this.removeBlockAndPartner(x, y, z, v);
    if (!p.creative) {
      const drops = blockDrops(id, metaOf(v), tool, this.rng);
      for (const d of drops) g.dropItem(x + 0.5, y + 0.5, z + 0.5, d);
      this.dropTileContents(x, y, z, v);
      // xp from ores
      const xp = id === B.COAL_ORE ? this.rng.int(3) : id === B.DIAMOND_ORE || id === B.EMERALD_ORE ? 3 + this.rng.int(5) : id === B.LAPIS_ORE ? 2 + this.rng.int(4) : id === B.REDSTONE_ORE ? 1 + this.rng.int(5) : 0;
      if (xp && drops.length) this.spawnXp(x + 0.5, y + 0.5, z + 0.5, xp);
      if (tool?.durability && BLOCKS[id].hardness > 0) this.damageHeld(tool.tool?.type === 'sword' ? 2 : 1);
      p.exhaust(0.005);
      // ice leaves water behind
      if (id === B.ICE && BLOCKS[w.getId(x, y - 1, z)].solid) w.set(x, y, z, B.WATER);
    } else {
      w.setTile(x, y, z, undefined);
    }
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
    if (id === B.OAK_DOOR) {
      const oy = meta & 8 ? y - 1 : y + 1;
      if (w.getId(x, oy, z) === B.OAK_DOOR) changes.push([x, oy, z, B.AIR]);
    } else if (id === B.BED) {
      const [dx, dz] = HORIZ[meta & 3];
      const ox = meta & 8 ? x - dx : x + dx, oz = meta & 8 ? z - dz : z + dz;
      if (w.getId(ox, y, oz) === B.BED) changes.push([ox, y, oz, B.AIR]);
    }
    if (changes.length === 1) w.set(x, y, z, B.AIR);
    else this.setAll(changes);
  }

  dropTileContents(x: number, y: number, z: number, v: number) {
    const t = this.world.getTile(x, y, z);
    if (!t) return;
    const items = (t.items ?? t.slots) as (ItemStack | null)[] | undefined;
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
    this.removeBlockAndPartner(x, y, z, v);
    if (drops) this.dropBlockItems(x, y, z, v);
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
    const map: Record<number, number> = { [B.REDSTONE_WIRE]: I.REDSTONE, [B.UNLIT_REDSTONE_TORCH]: B.REDSTONE_TORCH, [B.LIT_REDSTONE_LAMP]: B.REDSTONE_LAMP, [B.WHEAT]: I.WHEAT_SEEDS, [B.OAK_DOOR]: I.OAK_DOOR, [B.BED]: I.RED_BED, [B.SUGAR_CANE]: I.SUGAR_CANE, [B.LIT_FURNACE]: B.FURNACE, [B.FARMLAND]: B.DIRT, [B.DOUBLE_STONE_SLAB]: B.DOUBLE_STONE_SLAB };
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
  private use(fresh: boolean) {
    const g = this.game, p = this.player, w = this.world;
    this.useDelay = 4;
    if (p.spectator) return;
    const held = p.inventory.held();
    const item = held ? getItem(held.id) : undefined;
    // entity interaction
    if (g.targetEntity && fresh) {
      const e = g.targetEntity as unknown as { interact?: (game: Game, s: ItemStack | null) => boolean };
      if (e.interact && e.interact(g, held)) { p.swing(); return; }
    }
    const t = g.target;
    if (t) {
      const v = w.get(t.x, t.y, t.z);
      const id = idOf(v);
      if (!p.sneaking || !held) {
        if (this.activateBlock(t, id, v)) { p.swing(); this.useDelay = 4; return; }
      }
      if (held && item) {
        if (this.useItemOnBlock(t, held, item)) { p.swing(); return; }
        if (item.block !== undefined && this.placeBlock(t, held, item)) { p.swing(); return; }
      }
    }
    if (held && item && fresh) this.useItemInAir(held, item);
    else if (held && item && (item.food || item.name === 'bow')) this.useItemInAir(held, item);
  }

  private activateBlock(t: BlockHit, id: number, v: number): boolean {
    const g = this.game, w = this.world;
    const meta = metaOf(v);
    switch (id) {
      case B.CRAFTING_TABLE: g.ui.openCrafting(); return true;
      case B.LEVER: g.redstone.toggleLever(t.x, t.y, t.z); return true;
      case B.STONE_BUTTON: g.redstone.pressButton(t.x, t.y, t.z); return true;
      case B.FURNACE: case B.LIT_FURNACE: g.ui.openFurnace(t.x, t.y, t.z); return true;
      case B.CHEST: {
        if (OPAQUE[w.getId(t.x, t.y + 1, t.z)]) return true;
        g.ui.openChest(t.x, t.y, t.z);
        g.audio.play('chestOpen', { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 }, 0.5, 0.9 + Math.random() * 0.1);
        return true;
      }
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

  private sleep(x: number, y: number, z: number): boolean {
    const g = this.game, p = this.player;
    if (this.world.dimension === 'nether') {
      // beds explode outside the overworld
      this.removeBlockAndPartner(x, y, z, this.world.get(x, y, z));
      this.explode(x + 0.5, y + 0.5, z + 0.5, 5, true, null);
      return true;
    }
    p.spawnX = x; p.spawnY = y + 1; p.spawnZ = z;
    if (g.meta) g.meta.spawn = [x, y + 1, z];
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
    if (item.tool?.type === 'hoe') {
      if ((id === B.GRASS || id === B.DIRT || id === B.COARSE_DIRT) && t.face !== 2 && w.getId(t.x, t.y + 1, t.z) === B.AIR) {
        w.set(t.x, t.y, t.z, id === B.COARSE_DIRT ? B.DIRT : B.FARMLAND);
        g.playBlockSound(B.GRAVEL, t.x, t.y, t.z, 'place');
        this.damageHeld(1);
        return true;
      }
      return false;
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
      case I.WATER_BUCKET:
      case I.LAVA_BUCKET: {
        const fluid = held.id === I.WATER_BUCKET ? B.WATER : B.LAVA;
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
    if (item.armor) {
      const slot = item.armor.slot;
      const cur = p.inventory.armor[slot];
      p.inventory.armor[slot] = held;
      p.inventory.setHeld(cur);
      g.audio.play('dig.metal', null, 0.5, 1.2);
      return;
    }
    if (held.id === I.BOW) {
      if (p.creative || p.inventory.count(I.ARROW) > 0) { this.usingBow = true; this.bowTicks = 0; }
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
    if (held.id === I2.BOAT) {
      const eye = g.eyePos(1);
      const d = g.lookVec(p.yaw, p.pitch);
      const hit = raycastBlocks(w, eye.x, eye.y, eye.z, d.x, d.y, d.z, g.reach(), true);
      if (hit && hit.face === 3) {
        const b = new Boat(w, g);
        const onWater = w.getId(hit.x, hit.y, hit.z) === B.WATER;
        b.setPos(hit.hx, hit.y + (onWater ? 0.9 : 1), hit.hz);
        b.yaw = b.pyaw = p.yaw;
        g.addEntity(b);
        this.consume(1);
        p.swing();
      }
      return;
    }
    if (held.id === I.MILK_BUCKET) { p.fireTicks = 0; if (!p.creative) p.inventory.setHeld(stack(I.BUCKET)); return; }
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
    if (!held || !item?.food) { this.eating = 0; return; }
    this.eating++;
    p.eatingTicks = this.eating;
    if (this.eating % 4 === 0 && this.eating > 7) {
      g.audio.play('eat', p, 0.5 + 0.5 * this.rng.int(2), (this.rng.next() - this.rng.next()) * 0.2 + 1);
      const eye = g.eyePos(1);
      const d = g.lookVec(p.yaw, p.pitch);
      for (let i = 0; i < 5; i++)
        g.particles!.add({ x: eye.x + d.x * 0.5, y: eye.y - 0.2, z: eye.z + d.z * 0.5, vx: (this.rng.next() - 0.5) * 0.1 + d.x * 0.05, vy: 0.1, vz: (this.rng.next() - 0.5) * 0.1 + d.z * 0.05, layer: this.spriteLayer(item.name), u0: this.rng.next() * 0.7, v0: this.rng.next() * 0.7, u1: 0, v1: 0, size: 0.05, life: 10 + this.rng.int(10) });
      const last = g.particles!.list;
      for (let i = last.length - 5; i < last.length; i++) if (i >= 0) { last[i].u1 = last[i].u0 + 0.25; last[i].v1 = last[i].v0 + 0.25; }
    }
    if (this.eating >= 32) {
      p.eat(item.food.hunger, item.food.saturation);
      g.audio.play('burp', p, 0.5, this.rng.next() * 0.1 + 0.9);
      if (held.id === I.GOLDEN_APPLE) { p.heal(4); }
      if (!p.creative) {
        if (item.food.stew) p.inventory.setHeld(stack(I.BOWL));
        else this.consume(1);
      }
      this.eating = 0;
      p.eatingTicks = 0;
    }
  }

  private stopUsing() {
    const p = this.game.player;
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
    if (!p.creative && !p.inventory.remove(I.ARROW, 1)) return;
    const a = new Arrow(this.world, g, p);
    const eye = g.eyePos(1);
    const d = g.lookVec(p.yaw, p.pitch);
    a.setPos(eye.x, eye.y - 0.1, eye.z);
    a.shoot(d.x, d.y, d.z, f * 3, 1);
    a.pickup = !p.creative;
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
      const m = metaOf(tv);
      if ((face === 3 && m === 0) || (face === 2 && m === 1)) return this.setPlaced(x, y, z, this.doubleSlab(blockId), blockId);
    }
    if (BLOCKS[tid].replaceable && tid !== B.WATER && tid !== B.LAVA || tid === B.SNOW) {
      face = 3;
    } else {
      const [dx, dy, dz] = FACE_DIRS[face];
      x += dx; y += dy; z += dz;
      const cv = w.get(x, y, z);
      if (isSlab(blockId) && idOf(cv) === blockId) return this.setPlaced(x, y, z, this.doubleSlab(blockId), blockId);
    }
    if (y < 0 || y >= 256) return false;
    const cur = w.getId(x, y, z);
    if (!BLOCKS[cur].replaceable && cur !== B.AIR) return false;
    if (cur === blockId && blockId !== B.SNOW) return false;
    let meta = 0;
    const facing = this.playerFacing();
    if (isLog(blockId)) meta = face === 0 || face === 1 ? 1 : face === 4 || face === 5 ? 2 : 0;
    else if (isOriented(blockId)) meta = (facing + 2) & 3;
    else if (isStairs(blockId)) meta = facing | (face === 2 || (face !== 3 && fracY > 0.5) ? 4 : 0);
    else if (isSlab(blockId)) meta = face === 2 || (face !== 3 && fracY > 0.5) ? 1 : 0;
    else if (isLeaves(blockId)) meta = 1;
    else if (blockId === B.TORCH || blockId === B.LADDER || blockId === B.REDSTONE_TORCH || blockId === B.LEVER || blockId === B.STONE_BUTTON) {
      const wallDir: Record<number, number> = { 0: 1, 1: 3, 4: 2, 5: 0 };
      const wallMounted = blockId !== B.LADDER;
      if (face === 3 && wallMounted) meta = 0;
      else if (face in wallDir) meta = wallMounted ? wallDir[face] + 1 : wallDir[face];
      else return false;
      if (!g.ticker!.canStay(x, y, z, pack(blockId, meta))) return false;
    } else if (blockId === B.LILY_PAD) return false;
    else if (blockId === B.WHEAT || blockId === B.PUMPKIN_STEM) meta = 0;
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
    if (BLOCKS[blockId].needsSupport || blockId === B.WHEAT || blockId === B.SUGAR_CANE || blockId === B.CACTUS) {
      if (!g.ticker!.canStay(x, y, z, v)) return false;
    }
    if (!this.noEntities(x, y, z, v)) return false;
    // tile entities
    if (blockId === B.CHEST) w.setTile(x, y, z, undefined);
    return this.setPlaced(x, y, z, v, blockId);
  }

  private doubleSlab(slab: number) {
    return slab === B.STONE_SLAB ? B.DOUBLE_STONE_SLAB : slab === B.OAK_SLAB ? B.OAK_PLANKS : B.COBBLESTONE;
  }

  private setPlaced(x: number, y: number, z: number, v: number, soundBlock: number): boolean {
    const g = this.game, w = this.world;
    if (!w.set(x, y, z, v)) return false;
    const id = idOf(v);
    if (id === B.CHEST) w.setTile(x, y, z, { type: 'chest', items: new Array(27).fill(null) });
    if (id === B.FURNACE) w.setTile(x, y, z, { type: 'furnace', slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 });
    if (id === B.SAND || id === B.GRAVEL) g.ticker!.schedule(x, y, z, 2);
    g.playBlockSound(soundBlock, x, y, z, 'place');
    this.consume(1);
    return true;
  }

  private noEntities(x: number, y: number, z: number, v: number): boolean {
    const shapes = collisionShapes(v);
    if (!shapes.length) return true;
    const ents: Entity[] = [this.player, ...this.game.entities.filter((e) => e instanceof LivingEntity && !e.dead)];
    for (const s of shapes) {
      const b = { x0: x + s.x0, y0: y + s.y0, z0: z + s.z0, x1: x + s.x1, y1: y + s.y1, z1: z + s.z1 };
      for (const e of ents) {
        if (e === this.player && this.player.spectator) continue;
        if (aabbIntersects(b, e.box)) return false;
      }
    }
    return true;
  }

  // ------------------------------------------------------------------ combat
  attack(e: Entity) {
    const g = this.game, p = this.player;
    p.swing();
    if (e instanceof Fireball) {
      const d = g.lookVec(p.yaw, p.pitch);
      e.deflect(d.x, d.y, d.z);
      return;
    }
    if (e instanceof Boat) {
      e.attacked(p.creative);
      return;
    }
    if (p.spectator || !(e instanceof LivingEntity)) return;
    const held = p.inventory.held();
    const item = held ? getItem(held.id) : undefined;
    let dmg = item?.attack ?? 1;
    const crit = p.fallDistance > 0 && !p.onGround && !p.onLadder && !p.inWater && p.vy < 0;
    if (crit) dmg *= 1.5;
    const hit = e.damage(dmg, 'player', p);
    if (hit) {
      if (crit) g.particles!.crit(e.x, e.y + e.height * 0.6, e.z);
      if (p.sprinting) {
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
    const targets: Entity[] = [...g.entities, g.player!];
    for (const e of targets) {
      if (!(e instanceof LivingEntity) || e.dead || e === a.shooter && a.age < 5) continue;
      if (e === g.player && g.player!.spectator) continue;
      const b = e.box;
      if (nx > b.x0 - 0.3 && nx < b.x1 + 0.3 && ny > b.y0 - 0.3 && ny < b.y1 + 0.3 && nz > b.z0 - 0.3 && nz < b.z1 + 0.3) {
        const speed = Math.hypot(a.vx, a.vy, a.vz);
        let dmg = Math.ceil(speed * a.damageBase);
        if ((a as unknown as { crit?: boolean }).crit) dmg += this.rng.int(Math.floor(dmg / 2) + 2);
        if (e.damage(dmg, 'arrow', a.shooter ?? a)) {
          const h = Math.hypot(a.vx, a.vz) || 1;
          e.vx += (a.vx / h) * 0.6 * 0.6;
          e.vz += (a.vz / h) * 0.6 * 0.6;
          e.vy += 0.1;
          g.audio.play('arrowHit', a, 1, 1.2);
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
      if (!(e instanceof LivingEntity) || e.dead || e === s.shooter) continue;
      const b = e.box;
      if (nx > b.x0 - 0.2 && nx < b.x1 + 0.2 && ny > b.y0 - 0.2 && ny < b.y1 + 0.2 && nz > b.z0 - 0.2 && nz < b.z1 + 0.2) {
        e.damage(0.01, 'generic', s.shooter);
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
    const ents: Entity[] = [...g.entities, g.player!];
    for (const e of ents) {
      if (e === source || e.removed) continue;
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
    const t = g.ticker!;
    t.suppress = true;
    const changed: [number, number, number][] = [];
    for (const k of affected) {
      const [bx, by, bz] = k.split(',').map(Number);
      const v = w.get(bx, by, bz);
      const id = idOf(v);
      if (id === 0) continue;
      if (id === B.TNT) { w.set(bx, by, bz, B.AIR); this.primeTnt(bx, by, bz, true); continue; }
      if (this.rng.next() < 1 / power) {
        const def = BLOCKS[id];
        // explosions harvest as if with the correct tool
        const tool: ItemDef | undefined = def.harvestLevel >= 0 && def.tool ? { id: -1, name: 'explosion', display: '', maxStack: 1, tool: { type: def.tool, level: 3, speed: 1, damage: 0 } } : undefined;
        for (const d of blockDrops(id, metaOf(v), tool, this.rng)) g.dropItem(bx + 0.5, by + 0.5, bz + 0.5, d);
      }
      if (this.rng.int(4) === 0) g.particles!.smoke(bx + this.rng.next(), by + this.rng.next(), bz + this.rng.next(), true);
      this.dropTileContents(bx, by, bz, v);
      w.set(bx, by, bz, B.AIR);
      changed.push([bx, by, bz]);
    }
    t.suppress = false;
    for (const [bx, by, bz] of changed) {
      for (const [dx, dy, dz] of FACE_DIRS) t.neighborChanged(bx + dx, by + dy, bz + dz);
      if (fire && this.rng.int(3) === 0 && w.getId(bx, by, bz) === B.AIR && OPAQUE[w.getId(bx, by - 1, bz)]) w.set(bx, by, bz, B.FIRE);
    }
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
    const drop = { id: s.id, count: n, damage: s.damage };
    s.count -= n;
    if (s.count <= 0) p.inventory.setHeld(null);
    this.throwStack(drop);
    p.swing();
  }

  throwStack(s: ItemStack) {
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

  swapOffhand() {}

  fallingBlock(x: number, y: number, z: number, id: number) {
    const e = new FallingBlock(this.world, this.game, id);
    e.setPos(x + 0.5, y, z + 0.5);
    this.game.addEntity(e);
  }
}
