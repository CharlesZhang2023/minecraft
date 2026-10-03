// Entity replication: the server sends each entity's fields, the client keeps a "puppet" of the same class that
// never ticks and just takes those fields, so the existing renderer draws it exactly as it would the real thing.
// Only what changed since the last tick is sent; references to other entities travel as their ids.
import { Entity } from '../entity/entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { Inventory } from '../game/inventory';
import { Player } from '../game/player';
import { MOB_TYPES } from '../entity/registry';
import { ItemEntity, XpOrb, FallingBlock, PrimedTnt, Arrow, Snowball, Fireball } from '../entity/item';
import { Boat } from '../entity/boat';
import { Minecart } from '../entity/minecart';
import { ThrownPotion } from '../entity/potion';
import { FishingHook } from '../entity/fishing';
import { EyeOfEnder } from '../entity/eye';
import { FireworkRocket } from '../entity/firework';

type Make = (w: World, g: Game, me: Player) => Entity;

/** Every entity class that can exist in a world, by a name that survives minification. */
const TYPES: Record<string, Make> = {
  player: (w) => new Player(w),
  item: (w, g) => new ItemEntity(w, g, { id: 1, count: 1 }),
  xp_orb: (w, g) => new XpOrb(w, g, 1),
  falling_block: (w, g) => new FallingBlock(w, g, 1),
  tnt: (w, g) => new PrimedTnt(w, g),
  arrow: (w, g) => new Arrow(w, g, null),
  snowball: (w, g) => new Snowball(w, g, null),
  fireball: (w, g) => new Fireball(w, g, null, 0, 0, 1),
  boat: (w, g) => new Boat(w, g),
  minecart: (w, g) => new Minecart(w, g),
  potion: (w, g) => new ThrownPotion(w, g, null, { id: 1, count: 1 }),
  fishing_hook: (w, g, me) => new FishingHook(w, g, me),
  eye_of_ender: (w, g) => new EyeOfEnder(w, g, 0),
  firework_rocket: (w, g) => new FireworkRocket(w, g, null),
};
for (const [k, C] of Object.entries(MOB_TYPES)) if (!k.includes(' ')) TYPES[k] = (w, g) => new C(w, g);

const CLASS_NAMES = new Map<unknown, string>();

/** The registry name of an entity's class (cached per constructor). */
export function netType(e: Entity): string | null {
  const C = e.constructor;
  const known = CLASS_NAMES.get(C);
  if (known !== undefined) return known;
  let name: string | null = null;
  if (e instanceof Player) name = 'player';
  else if (e instanceof ItemEntity) name = 'item';
  else if (e instanceof XpOrb) name = 'xp_orb';
  else if (e instanceof FallingBlock) name = 'falling_block';
  else if (e instanceof PrimedTnt) name = 'tnt';
  else if (e instanceof Arrow) name = 'arrow';
  else if (e instanceof Snowball) name = 'snowball';
  else if (e instanceof Fireball) name = 'fireball';
  else if (e instanceof Boat) name = 'boat';
  else if (e instanceof Minecart) name = 'minecart';
  else if (e instanceof ThrownPotion) name = 'potion';
  else if (e instanceof FishingHook) name = 'fishing_hook';
  else if (e instanceof EyeOfEnder) name = 'eye_of_ender';
  else if (e instanceof FireworkRocket) name = 'firework_rocket';
  else for (const [k, M] of Object.entries(MOB_TYPES)) if (C === M && !k.includes(' ')) { name = k; break; }
  CLASS_NAMES.set(C, name ?? '');
  return name;
}

export function makePuppet(type: string, w: World, g: Game, me: Player): Entity | null {
  const make = TYPES[type];
  return make ? make(w, g, me) : null;
}

/** Fields the client recomputes itself (previous-tick copies made by preTick) or never needs (AI bookkeeping). */
const SKIP = new Set([
  'world', 'game', 'px', 'py', 'pz', 'pyaw', 'ppitch', 'pHeadYaw', 'pBodyYaw', 'pLimbSwingAmount', 'pSwingProgress',
  'path', 'pathTimer', 'wanderTimer', 'sayTimer', 'despawnTimer', 'attackCooldown', 'lookTimer', 'breedCooldown', 'growTimer',
  'jumpTicks', 'invulnerable', 'lastDamage', 'lookTarget', 'onDamaged', 'onDeath', 'netV', 'conn', 'stuckTicks',
  'rocketBoost', 'wallHit', 'jumpWasDown',
]);

/** JSON-safe form of a field value, or undefined to leave it out. */
export function encodeValue(v: unknown, depth = 0): unknown {
  if (v === null) return null;
  switch (typeof v) {
    case 'number': return Number.isInteger(v) ? v : Math.round(v * 1e4) / 1e4;
    case 'string': case 'boolean': return v;
    case 'undefined': case 'function': case 'symbol': case 'bigint': return undefined;
  }
  if (depth > 6) return undefined;
  if (v instanceof Entity) return { $e: v.id };
  if (Array.isArray(v)) return v.map((x) => encodeValue(x, depth + 1) ?? null);
  if (v instanceof Map) return { $m: [...v].map(([k, x]) => [k, encodeValue(x, depth + 1) ?? null]) };
  if (v instanceof Set) return { $s: [...v].map((x) => encodeValue(x, depth + 1) ?? null) };
  if (v instanceof Inventory) return { $inv: encodeValue(v.toJSON(), depth + 1) };
  if (Object.getPrototypeOf(v) !== Object.prototype) return undefined; // other class instances stay server-side
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const ex = encodeValue(x, depth + 1);
    if (ex !== undefined) o[k] = ex;
  }
  return o;
}

export function decodeValue(v: unknown, resolve: (id: number) => Entity | null): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, resolve));
  const o = v as Record<string, unknown>;
  if ('$e' in o) return resolve(o.$e as number);
  if ('$m' in o) return new Map((o.$m as [unknown, unknown][]).map(([k, x]) => [k, decodeValue(x, resolve)]));
  if ('$s' in o) return new Set((o.$s as unknown[]).map((x) => decodeValue(x, resolve)));
  const r: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) r[k] = decodeValue(x, resolve);
  return r;
}

export type State = Record<string, unknown>;

/** All replicated fields of an entity, encoded. */
export function captureState(e: Entity): State {
  const s: State = {};
  for (const k of Object.keys(e)) {
    if (SKIP.has(k)) continue;
    const v = encodeValue((e as unknown as Record<string, unknown>)[k]);
    if (v !== undefined) s[k] = v;
  }
  return s;
}

/** Comparable form of an encoded value (objects compare by their JSON). */
export function sig(v: unknown): unknown {
  return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
}

/** Copy encoded fields onto a puppet. */
export function applyState(e: Entity, s: State, resolve: (id: number) => Entity | null) {
  const o = e as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(s)) {
    if (v && typeof v === 'object' && '$inv' in (v as object)) {
      const inv = o[k];
      if (inv instanceof Inventory) syncInventory(inv, (v as { $inv: { main: unknown[]; armor: unknown[]; selected: number } }).$inv as never);
      continue;
    }
    o[k] = decodeValue(v, resolve);
  }
}

/** Load inventory contents in place, so screens holding on to the slot arrays keep seeing the live data. */
export function syncInventory(inv: Inventory, d: { main: Inventory['main']; armor: Inventory['armor']; selected?: number }, keepSelected = false) {
  for (let i = 0; i < inv.main.length; i++) inv.main[i] = d.main[i] ? { ...d.main[i]! } : null;
  for (let i = 0; i < inv.armor.length; i++) inv.armor[i] = d.armor?.[i] ? { ...d.armor[i]! } : null;
  if (!keepSelected && d.selected !== undefined) inv.selected = d.selected;
}
