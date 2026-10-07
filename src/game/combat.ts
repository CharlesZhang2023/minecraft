// The combat of 1.9-1.16: weapons recharge between swings (damage scales with the charge), swords sweep, axes hit
// hard and disable shields, shields block from the front, crossbows load and fire (multishot, piercing, fireworks),
// tridents are thrown (loyalty, impaling, channeling) or ride the rain (riptide), and a totem of undying cheats death.
// Also the enchantments that came with them: mending, frost walker, soul speed, the curses.
import type { Game } from './game';
import { playerHooks, type Player } from './player';
import type { Entity } from '../entity/entity';
import { LivingEntity, type DamageSource } from '../entity/living';
import { Arrow } from '../entity/item';
import { FireworkRocket } from '../entity/firework';
import { I, I6, I7, ITEMS, TOOLS, ItemStack, getItem, stack } from './items';
import { level } from './enchant';
import { B, B2, BLOCKS, idOf, metaOf, pack } from '../world/blocks';
import { Mob, convertMob } from '../entity/mobs';

// ------------------------------------------------------------------ weapon stats (1.9)
/** Attack damage and attacks per second of each tool kind and material (vanilla 1.16). */
const AXE: Record<string, [number, number]> = { wooden: [7, 0.8], stone: [9, 0.8], iron: [9, 0.9], golden: [7, 1], diamond: [9, 1], netherite: [10, 1] };
const HOE_SPEED: Record<string, number> = { wooden: 1, stone: 2, iron: 3, golden: 1, diamond: 4, netherite: 4 };
const MAT_DMG: Record<string, number> = { wooden: 0, stone: 1, iron: 2, golden: 0, diamond: 3, netherite: 4 };
for (const [name, id] of Object.entries(TOOLS)) {
  const d = getItem(id);
  const [mat, kind] = [name.slice(0, name.lastIndexOf('_')), name.slice(name.lastIndexOf('_') + 1)];
  const m = MAT_DMG[mat] ?? 0;
  if (kind === 'sword') { d.attack = 4 + m; d.attackSpeed = 1.6; }
  else if (kind === 'axe') { [d.attack, d.attackSpeed] = AXE[mat] ?? [7, 0.8]; }
  else if (kind === 'pickaxe') { d.attack = 2 + m; d.attackSpeed = 1.2; }
  else if (kind === 'shovel') { d.attack = 2.5 + m; d.attackSpeed = 1; }
  else if (kind === 'hoe') { d.attack = 1; d.attackSpeed = HOE_SPEED[mat] ?? 1; }
}
getItem(I7.TRIDENT).attackSpeed = 1.1;
getItem(I7.TRIDENT).attack = 9;
/** Attacks per second of what's held (a bare hand, or anything that isn't a weapon: 4). */
export const attackSpeed = (s: ItemStack | null) => (s ? getItem(s.id).attackSpeed ?? 4 : 4);
/** How charged the next swing is, 0-1 (vanilla's attack strength, half a tick ahead). */
export function attackStrength(p: Player, partial = 0.5) {
  const period = 20 / attackSpeed(p.inventory.held());
  return Math.max(0, Math.min(1, (p.attackTicks + partial) / period));
}

/** Each tick on both sides: the attack charge counts up (a different item in hand starts it over), the shield's
 * cooldown counts down, and (on the server) frost walker freezes water underfoot. */
export function combatTick(p: Player) {
  const held = p.inventory.held();
  const key = held ? held.id : 0;
  if (key !== p.lastHeldId) { p.lastHeldId = key; p.attackTicks = 0; }
  p.attackTicks++;
  if (p.shieldCooldown > 0) p.shieldCooldown--;
  if (!p.clientSide && p.onGround) frostWalk(p);
  // a turtle shell: ten seconds of water breathing, counting down only once the head is under water
  if (!p.clientSide && p.inventory.armor[0]?.id === I7.TURTLE_HELMET) {
    const head = p.world.getId(Math.floor(p.x), Math.floor(p.y + p.eyeHeight()), Math.floor(p.z));
    if (head !== B.WATER && head !== B2.BUBBLE_COLUMN) p.addEffect('water_breathing', 200, 0);
  }
}

// ------------------------------------------------------------------ melee
/** The damage a player's swing does, after the charge (and whether it's a critical / sweep). */
export function swingDamage(p: Player, target: LivingEntity, base: number): { dmg: number; crit: boolean; sweep: boolean; strength: number } {
  const s = attackStrength(p);
  const held = p.inventory.held();
  let dmg = base * (0.2 + s * s * 0.8);
  const ench = enchantDamage(held, target) * s;
  const crit = s > 0.9 && p.fallDistance > 0 && !p.onGround && !p.onLadder && !p.inWater && !p.effects.has('blindness') && !p.riding && !p.sprinting;
  if (crit) dmg *= 1.5;
  dmg += ench;
  const sword = !!held && getItem(held.id).tool?.type === 'sword';
  const moved = Math.hypot(p.x - p.px, p.z - p.pz);
  const sweep = sword && s > 0.9 && !crit && !p.sprinting && p.onGround && moved < 0.25;
  return { dmg, crit, sweep, strength: s };
}
/** Sharpness, smite, bane of arthropods and impaling (1.16: impaling only against aquatic mobs). */
function enchantDamage(held: ItemStack | null, t: LivingEntity) {
  let d = 0;
  const sh = level(held, 'sharpness');
  if (sh) d += 0.5 * sh + 0.5;
  if (t.undead) d += level(held, 'smite') * 2.5;
  if (t.arthropod) d += level(held, 'bane_of_arthropods') * 2.5;
  if (isAquatic(t)) d += level(held, 'impaling') * 2.5;
  return d;
}
const AQUATIC = new Set(['Squid', 'Guardian', 'Elder Guardian', 'Cod', 'Salmon', 'Pufferfish', 'Tropical Fish', 'Dolphin', 'Turtle', 'Drowned']);
const isAquatic = (e: Entity) => AQUATIC.has((e as unknown as { typeName?: string }).typeName ?? '');
/** A sword's sweep: everything else in reach around the target takes a little (sweeping edge raises it). */
export function sweep(g: Game, p: Player, target: LivingEntity, dmg: number) {
  const se = level(p.inventory.held(), 'sweeping');
  const sdmg = 1 + (se ? (se / (se + 1)) * dmg : 0);
  for (const e of g.entities) {
    if (!(e instanceof LivingEntity) || e === target || e === p || e.dead || (e as unknown as { spectator?: boolean }).spectator) continue;
    if (Math.abs(e.x - target.x) > 1 + e.width || Math.abs(e.z - target.z) > 1 + e.width || Math.abs(e.y - target.y) > 0.25 + e.height) continue;
    if (Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z) > 3) continue;
    if ((e as unknown as { owner?: boolean }).owner === true) continue; // pets
    const r = (p.yaw * Math.PI) / 180;
    if (e.damage(sdmg, 'player', p)) e.knockback(Math.sin(r), -Math.cos(r), 0.4);
  }
  const r = (p.yaw * Math.PI) / 180;
  for (let i = 0; i < 4; i++) g.particles?.add({ x: p.x - Math.sin(r) * 1.2 + (Math.random() - 0.5), y: p.y + 1.1, z: p.z + Math.cos(r) * 1.2 + (Math.random() - 0.5), vx: 0, vy: 0, vz: 0, size: 0.3, life: 6 } as never);
  g.audio.play('sweep', p, 1, 1);
}

// ------------------------------------------------------------------ shields
/** Is the attack coming from in front of the blocking player (within 90° of where they look)? */
function fromFront(p: Player, from: { x: number; z: number }) {
  const r = (p.yaw * Math.PI) / 180;
  const lx = -Math.sin(r), lz = Math.cos(r);
  const dx = from.x - p.x, dz = from.z - p.z, l = Math.hypot(dx, dz) || 1;
  return (dx * lx + dz * lz) / l > 0;
}
/** The shield in use (main or off hand), if any. */
export function shieldHand(p: Player): 'main' | 'off' | null {
  if (p.inventory.held()?.id === I7.SHIELD) return 'main';
  if (p.inventory.offhand?.id === I7.SHIELD) return 'off';
  return null;
}
/**
 * A hit on a blocking player: blocked if it comes from the front (melee, arrows, explosions, tridents). The shield
 * wears by the damage, melee attackers are pushed back, and an axe knocks the shield out for five seconds.
 * Returns true if the damage was blocked.
 */
export function shieldBlocks(g: Game, p: Player, amount: number, source: DamageSource, attacker: Entity | null): boolean {
  if (!p.blocking || p.shieldCooldown > 0) return false;
  if (!['mob', 'player', 'arrow', 'explosion', 'trident', 'fire', 'firework', 'sting'].includes(source)) return false;
  if (source === 'fire' && !attacker) return false;
  const from = attacker ?? null;
  if (!from || !fromFront(p, from)) return false;
  const hand = shieldHand(p);
  if (!hand) return false;
  const sh = hand === 'main' ? p.inventory.held()! : p.inventory.offhand!;
  if (amount >= 3) wearShield(g, p, hand, sh, 1 + Math.floor(amount));
  g.audio.play('shield.block', p, 1, 0.8 + Math.random() * 0.4);
  const holder = (from as unknown as { shooter?: Entity }).shooter ?? from;
  if (holder instanceof LivingEntity && source !== 'arrow' && source !== 'explosion') {
    holder.knockback(p.x - holder.x, p.z - holder.z, 0.5);
    // an axe disables the shield
    const axe = (holder as unknown as { inventory?: { held(): ItemStack | null } }).inventory?.held() ?? null;
    const mobAxe = (holder as unknown as { heldItem?: number }).heldItem;
    const isAxe = (axe && getItem(axe.id).tool?.type === 'axe') || (mobAxe && getItem(mobAxe).tool?.type === 'axe');
    if (isAxe) { p.shieldCooldown = 100; p.blocking = false; g.audio.play('shield.break', p, 1, 0.8); }
  }
  return true;
}
function wearShield(g: Game, p: Player, hand: 'main' | 'off', s: ItemStack, n: number) {
  if (p.creative) return;
  const max = getItem(s.id).durability ?? 336;
  const ub = level(s, 'unbreaking');
  for (let i = 0; i < n; i++) if (!ub || Math.random() < 1 / (ub + 1)) s.damage = (s.damage ?? 0) + 1;
  if ((s.damage ?? 0) >= max) {
    if (hand === 'main') p.inventory.setHeld(null); else p.inventory.offhand = null;
    p.blocking = false;
    g.audio.play('shield.break', p, 1, 1);
  }
}

// ------------------------------------------------------------------ crossbows
/** Ticks a crossbow takes to load (quick charge shortens it by 5 a level). */
export const crossbowLoadTicks = (s: ItemStack | null) => Math.max(1, 25 - 5 * level(s, 'quick_charge'));
/** Ammunition a crossbow can load: arrows (any kind), or fireworks from the off hand. */
function findAmmo(p: Player): { slot: 'off' | number; s: ItemStack } | null {
  const off = p.inventory.offhand;
  if (off && (off.id === I6.FIREWORK_ROCKET || isArrow(off.id))) return { slot: 'off', s: off };
  for (let i = 0; i < p.inventory.main.length; i++) { const s = p.inventory.main[i]; if (s && isArrow(s.id)) return { slot: i, s }; }
  return null;
}
const isArrow = (id: number) => id === I.ARROW || id === I7.SPECTRAL_ARROW || getItem(id).name.startsWith('tipped_arrow');
/** Load a crossbow (after the charge): it takes one piece of ammunition (multishot doesn't use more). */
export function loadCrossbow(g: Game, p: Player, cb: ItemStack): boolean {
  const ammo = findAmmo(p);
  if (!ammo && !p.creative) return false;
  const id = ammo?.s.id ?? I.ARROW;
  cb.charged = { id, fw: ammo?.s.fw };
  if (ammo && !p.creative) {
    ammo.s.count--;
    if (ammo.s.count <= 0) { if (ammo.slot === 'off') p.inventory.offhand = null; else p.inventory.main[ammo.slot] = null; }
  }
  g.audio.play('crossbow.loaded', p, 1, 1);
  return true;
}
/** Fire a loaded crossbow: one projectile, or three with multishot (spread 10°). */
export function fireCrossbow(g: Game, p: Player, cb: ItemStack, eye: { x: number; y: number; z: number }, look: (yaw: number, pitch: number) => { x: number; y: number; z: number }) {
  const ch = cb.charged;
  if (!ch) return;
  cb.charged = undefined;
  const multi = level(cb, 'multishot') > 0;
  const pierce = level(cb, 'piercing');
  const yaws = multi ? [0, -10, 10] : [0];
  for (const dy of yaws) {
    const d = look(p.yaw + dy, p.pitch);
    if (ch.id === I6.FIREWORK_ROCKET) {
      const r = new FireworkRocket(g.world!, g, { id: ch.id, count: 1, fw: ch.fw });
      r.setPos(eye.x, eye.y - 0.15, eye.z);
      r.vx = d.x * 1.6; r.vy = d.y * 1.6; r.vz = d.z * 1.6;
      (r as unknown as { shot?: boolean; shooter?: Entity }).shot = true;
      (r as unknown as { shooter?: Entity }).shooter = p;
      g.addEntity(r);
    } else {
      const a = new Arrow(g.world!, g, p);
      a.setPos(eye.x, eye.y - 0.1, eye.z);
      a.shoot(d.x, d.y, d.z, 3.15, 1);
      a.damageBase = 2 + 0.5 * 0; // crossbow arrows fly faster (the damage comes from speed)
      a.pickup = !p.creative && dy === 0;
      a.pierce = pierce;
      (a as unknown as { crit: boolean }).crit = true;
      if (ch.id === I7.SPECTRAL_ARROW) a.effect = ['glowing', 200, 0];
      const tip = getItem(ch.id).potion;
      if (tip) a.tipped = tip;
      g.addEntity(a);
    }
  }
  g.audio.play('crossbow.shoot', p, 1, 1);
}

// ------------------------------------------------------------------ tridents
/** A thrown trident: an arrow that is a trident (it stays where it hits, returns with loyalty, calls lightning with channeling). */
export class ThrownTrident extends Arrow {
  override typeName = 'Trident';
  stack: ItemStack;
  loyalty = 0;
  returning = false;
  dealtDamage = false;
  constructor(world: import('../world/world').World, game: Game, shooter: Entity | null, s: ItemStack) {
    super(world, game, shooter);
    this.stack = { ...s };
    this.itemId = I7.TRIDENT;
    this.loyalty = level(s, 'loyalty');
    this.damageBase = 8;
    this.pickup = true;
  }
  override tick() {
    // loyal tridents fly back to their thrower once they've hit something (or fallen out of the world)
    const owner = this.shooter as Player | null;
    if (this.loyalty && owner && !owner.dead && (this.inGround || this.dealtDamage || this.y < -32)) this.returning = true;
    if (this.returning && owner) {
      this.inGround = false;
      this.noClip = true;
      const dx = owner.x - this.x, dy = owner.y + owner.eyeHeight() - this.y, dz = owner.z - this.z, l = Math.hypot(dx, dy, dz) || 1;
      const sp = 0.05 * this.loyalty;
      this.vx = this.vx * 0.95 + (dx / l) * sp * 3; this.vy = this.vy * 0.95 + (dy / l) * sp * 3; this.vz = this.vz * 0.95 + (dz / l) * sp * 3;
      this.x += this.vx; this.y += this.vy; this.z += this.vz;
      this.setPos(this.x, this.y, this.z);
      if (l < 1.5) this.giveBack(owner);
      if (this.age > 1200) this.removed = true;
      return;
    }
    super.tick();
    // picked up from the ground by its thrower (or anyone, if it wasn't thrown by a player in creative)
    if (this.inGround) for (const p of this.game.playerEntities()) if (p.distanceTo(this) < 1.5 && !p.dead && !p.spectator && (p === owner || !this.loyalty)) { this.giveBack(p); break; }
  }
  giveBack(p: Player) {
    if (!p.creative && p.inventory.add(this.stack) > 0) return;
    this.game.audio.play('trident.return', p, 1, 1);
    this.removed = true;
  }
  /** It hit something: damage plus impaling, channeling in a thunderstorm, then it drops (or returns). */
  onHitEntity(e: LivingEntity) {
    let dmg = 8 + (isAquatic(e) ? level(this.stack, 'impaling') * 2.5 : 0);
    if (e.undead) dmg += level(this.stack, 'smite') * 0;
    this.dealtDamage = true;
    if (e.damage(dmg, 'trident', this.shooter ?? this)) this.game.audio.play('trident.hit', this, 1, 1);
    if (level(this.stack, 'channeling') && (this.game.weather?.thunder ?? 0) > 0.5) {
      const w = this.world;
      if (w.topSolidY(Math.floor(e.x), Math.floor(e.z)) <= e.y + 1) strikeLightning(this.game, e.x, e.y, e.z);
    }
    this.vx *= -0.01; this.vy *= -0.1; this.vz *= -0.01;
  }
}
/** Throw the held trident (after holding use for at least 10 ticks) — or, with riptide in water or rain, launch the player. */
export function releaseTrident(g: Game, p: Player, s: ItemStack, ticks: number, eye: { x: number; y: number; z: number }, look: { x: number; y: number; z: number }, takeHeld: () => void, wear: (n: number) => void) {
  if (ticks < 10) return;
  const rip = level(s, 'riptide');
  if (rip) {
    const wet = p.inWater || (g.weather?.rainAt(p.x, p.y + 1, p.z) ?? false);
    if (!wet) return;
    // the player's own client flies them (like a rocket's boost)
    const f = 3 * ((1 + rip) / 4);
    g.playerOf(p)?.event(['riptide', look.x * f, look.y * f, look.z * f]);
    wear(1);
    g.audio.play('trident.riptide', p, 1, 1);
    return;
  }
  const t = new ThrownTrident(g.world!, g, p, s);
  t.setPos(eye.x, eye.y - 0.1, eye.z);
  t.shoot(look.x, look.y, look.z, 2.5, 1);
  t.pickup = !p.creative;
  g.addEntity(t);
  wear(1);
  if (!p.creative) takeHeld();
  g.audio.play('trident.throw', p, 1, 1);
}

/** A lightning bolt (thunderstorms, channeling): fire where it lands, and its effects on the mobs it hits. */
export function strikeLightning(g: Game, x: number, y: number, z: number) {
  const w = g.world!;
  const bx = Math.floor(x), bz = Math.floor(z), by = w.topSolidY(bx, bz) + 1;
  if (g.options.difficulty >= 2 && w.getId(bx, by, bz) === B.AIR && BLOCKS[w.getId(bx, by - 1, bz)].solid) w.set(bx, by, bz, B.FIRE);
  for (const p of g.playersHere()) p.event(['thunder', Math.hypot(p.entity.x - x, p.entity.z - z)]);
  g.audio.play('thunder', { x, y, z }, 2, 1);
  for (const e of g.entities) {
    if (!(e instanceof LivingEntity) || e.dead || Math.hypot(e.x - x, e.z - z) > 3 || Math.abs(e.y - y) > 6) continue;
    if (struck(g, e)) continue;
    e.damage(5, 'lightning', null);
    e.fireTicks = Math.max(e.fireTicks, 160);
  }
  for (let i = 0; i < 30; i++) g.particles?.spark(x + (Math.random() - 0.5) * 0.4, by + Math.random() * 12, z + (Math.random() - 0.5) * 0.4, 0, 0, 0, 0xe8f0ff, 6);
}
/** A natural bolt may leave a skeleton trap behind (vanilla: by the local difficulty). */
export function maybeSkeletonTrap(g: Game, x: number, y: number, z: number) {
  if (g.options.difficulty === 0 || Math.random() > 0.01 * g.options.difficulty) return;
  const h = g.interact!.spawnMob('skeleton_horse', x, y, z) as (Entity & { trap?: boolean }) | null;
  if (h) h.trap = true;
}

/** What lightning does to some mobs (returns true if the mob was replaced): creepers charge, pigs become zombified
 * piglins, villagers witches, mooshrooms change colour. */
function struck(g: Game, e: LivingEntity): boolean {
  const tn = (e as unknown as { typeName?: string }).typeName;
  const m = e as unknown as Mob;
  if (tn === 'Creeper') { (e as unknown as { charged: boolean }).charged = true; return false; }
  if (tn === 'Pig' && g.options.difficulty > 0) { convertMob(m, 'zombified_piglin'); return true; }
  if (tn === 'Villager' && g.options.difficulty > 0) { convertMob(m, 'witch'); return true; }
  if (tn === 'Mooshroom') { const mo = e as unknown as { variant: string }; mo.variant = mo.variant === 'brown' ? 'red' : 'brown'; return true; }
  return false;
}

// ------------------------------------------------------------------ totem of undying
/** The player is about to die: a totem in either hand saves them. Returns true if it did. */
export function useTotem(g: Game, p: Player, source: DamageSource): boolean {
  if (source === 'void' || source === 'kill') return false;
  let hand: 'main' | 'off' | null = null;
  if (p.inventory.held()?.id === I7.TOTEM_OF_UNDYING) hand = 'main';
  else if (p.inventory.offhand?.id === I7.TOTEM_OF_UNDYING) hand = 'off';
  if (!hand) return false;
  if (hand === 'main') p.inventory.setHeld(null); else p.inventory.offhand = null;
  p.health = 1;
  p.dead = false;
  p.clearEffects();
  p.addEffect('regeneration', 900, 1);
  p.addEffect('absorption', 100, 1);
  p.addEffect('fire_resistance', 800, 0);
  g.audio.play('totem.use', p, 1, 1);
  g.playerOf(p)?.event(['totem']);
  for (let i = 0; i < 40; i++) g.particles?.spell(p.x + (Math.random() - 0.5), p.y + Math.random() * 2, p.z + (Math.random() - 0.5), Math.random() < 0.5 ? 0xf0d040 : 0x60d040);
  return true;
}

// ------------------------------------------------------------------ enchantments
export { mend } from './mending';
/** Frost walker: water under the player's feet freezes into frosted ice (radius 2 + level). */
function frostWalk(p: Player) {
  const fw = level(p.inventory.armor[3], 'frost_walker');
  if (!fw) return;
  const w = p.world, r = Math.min(16, 2 + fw);
  const y = Math.floor(p.y - 0.5);
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (dx * dx + dz * dz > r * r) continue;
    const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + dz;
    const v = w.get(x, y, z);
    if (idOf(v) !== B.WATER || metaOf(v) !== 0 || w.getId(x, y + 1, z) !== B.AIR) continue;
    w.set(x, y, z, pack(B2.FROSTED_ICE, 0));
  }
}
/** Frosted ice ages in the light (and faster with fewer frosted neighbours) and melts back to water at age 3. */
BLOCKS[B2.FROSTED_ICE].behavior = {
  randomTick(c) {
    const [sky, blk] = c.world.getLight(c.x, c.y + 1, c.z);
    if (Math.max(sky - (c.game.isDaytime() ? 0 : 11), blk) < 11 - c.meta && Math.random() < 0.7) return;
    if (c.meta >= 3) c.set(B.WATER); else c.setMeta(c.meta + 1);
  },
};
/** Soul speed: walking on soul sand or soil is faster (and wears the boots now and then). */
export function soulSpeed(p: Player): number {
  const ss = level(p.inventory.armor[3], 'soul_speed');
  if (!ss || !p.onGround) return 1;
  const below = p.world.getId(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
  if (below !== B.SOUL_SAND && below !== B2.SOUL_SOIL) return 1;
  if (p.clientSide && Math.random() < 0.2) (p as unknown as { game?: Game }).game?.particles?.add({ x: p.x + (Math.random() - 0.5) * 0.6, y: p.y + 0.1, z: p.z + (Math.random() - 0.5) * 0.6, vx: 0, vy: 0.03, vz: 0, size: 0.1, life: 12 } as never);
  return 1.3 + ss * 0.105 * 3;
}
/** Curse of vanishing: those items are gone when their holder dies. */
export function vanishOnDeath(p: Player) {
  const inv = p.inventory;
  for (let i = 0; i < inv.main.length; i++) if (inv.main[i] && level(inv.main[i], 'vanishing_curse')) inv.main[i] = null;
  for (let i = 0; i < inv.armor.length; i++) if (inv.armor[i] && level(inv.armor[i], 'vanishing_curse')) inv.armor[i] = null;
  if (inv.offhand && level(inv.offhand, 'vanishing_curse')) inv.offhand = null;
}
/** Curse of binding: armour that can't come off (except in creative). */
export const bound = (s: ItemStack | null, p: Player) => !!s && !p.creative && level(s, 'binding_curse') > 0;

Object.assign(playerHooks, { combatTick, shieldBlocks, useTotem, vanishOnDeath, soulSpeed });
void ITEMS; void stack; void idOf;
