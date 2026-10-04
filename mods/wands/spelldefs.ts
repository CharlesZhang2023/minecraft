// What a spell is: the types every spell is made of, the numbers a fresh projectile starts with, and the helpers the
// catalogue (catalog/*.ts) defines spells with. Pure data and small functions, shared by the server (casting,
// projectiles), the client (visuals, the editor's cast preview) and the workers (which only need the item list).
//
// Units: times are game ticks (20 a second; the editor shows seconds), speeds blocks per tick, damage half-hearts.

import type { Entity } from '../sdk';

export type SpellType = 'projectile' | 'static' | 'modifier' | 'multicast' | 'material' | 'other' | 'utility' | 'passive';
export type Trigger = 'hit' | 'timer' | 'expire';
/** How a projectile looks (the client's renderer picks its drawing by this). `icon` draws the spell's own card art. */
export type Visual =
  | 'spark' | 'arrow' | 'bolt' | 'burst' | 'orb' | 'spit' | 'wood' | 'fire' | 'bomb' | 'dynamite' | 'holy' | 'hole'
  | 'dig' | 'saw' | 'drill' | 'lightning' | 'lance' | 'bubble' | 'heal' | 'tp' | 'cross' | 'ray' | 'tentacle' | 'rock'
  | 'blast' | 'field' | 'cloud' | 'liquid' | 'sand' | 'snow'
  | 'icon' | 'beam' | 'mist' | 'worm' | 'portal' | 'whitehole' | 'note' | 'none';
export type Path = 'straight' | 'sine' | 'chaos' | 'spiral' | 'accel';

/**
 * Steering beyond the path. Some only the server can work out (where the caster is, what they aim at): those
 * projectiles are re-synced to clients often.
 */
export type Steer =
  | 'flyDown' | 'flyUp' | 'pingpong' | 'horizontal' | 'decel' | 'phasing' | 'floating' | 'avoid'
  | 'orbit' | 'trueOrbit' | 'boomerang' | 'aim' | 'wandHoming' | 'antiHoming' | 'shortHoming' | 'accelHoming'
  | 'autoAim' | 'rotateFoes' | 'areaTeleport';
/** Steering only the server can do (clients get frequent position updates instead). */
export const SERVER_STEER: readonly Steer[] = ['trueOrbit', 'boomerang', 'aim', 'wandHoming', 'phasing', 'areaTeleport', 'avoid', 'floating'];

/** Conditions creatures can have (Noita's stains and curses). Kept by the server, ticking down. */
export type Status =
  | 'wet' | 'oiled' | 'bloody' | 'drunk' | 'slimy' | 'toxic' | 'cursed' | 'venom' | 'petrified' | 'charmed' | 'fervour'
  | 'shielded' | 'curseElec' | 'curseExpl' | 'curseMelee' | 'curseProj'
  | 'fireThrower' | 'lightningCaster' | 'tentacler' | 'gravityWell';

/** When a projectile casts something more: on a bounce, when it ends, now and then in flight... */
export interface SpawnRule {
  on: 'bounce' | 'end' | 'block' | 'entity' | 'tick' | 'down' | 'slow' | 'kill';
  /** Spell id, or 'self' for a copy of the projectile (copies never copy again). */
  spell: string;
  n?: number;
  /** For 'tick': every this many ticks. */
  every?: number;
  /** Which way they go: the projectile's own way, reflected off the wall, at random... */
  dir?: 'same' | 'reflect' | 'random' | 'ring' | 'up' | 'down' | 'perp' | 'foe' | 'back' | 'hemi' | 'cone';
  /** Degrees either side, for 'cone'. */
  cone?: number;
  chance?: number;
  /** Fire at most this many times in the projectile's life. */
  max?: number;
  /** Starting speed of what's spawned, relative to the spell's own (1). */
  speed?: number;
}

export interface Orbit {
  around: 'origin' | 'caster' | 'parent';
  r: number;
  /** Radians per tick. */
  w: number;
  phase: number;
  /** Projectile id (parent orbits). */
  parent?: number;
}

/** One projectile of a cast: its spell's numbers after every modifier of the cast has had its say. */
export interface Proj {
  spell: SpellDef;
  visual: Visual;
  /** Damage on contact (magic: armour doesn't help). */
  dmg: number;
  /** Explosion when it ends: radius (blocks), damage at the centre, and the blast resistance it can break. */
  explR: number;
  explDmg: number;
  terrain: number;
  /** Drills through blocks up to this hardness, at most digCount of them (digR > 0: a ball of that radius). */
  digHard: number;
  digCount: number;
  digR: number;
  fire: boolean;
  fireTrail: boolean;
  freeze: boolean;
  /** Shock damage to everything near where it hits. */
  elec: number;
  heal: number;
  knock: number;
  /** Chance (0-1) of a critical hit: three times the damage. */
  crit: number;
  speed: number;
  /** Degrees: added to the wand's spread (negative narrows it). */
  spread: number;
  gravity: number;
  drag: number;
  life: number;
  bounces: number;
  /** Bounces keep this much speed (bombs roll, bubbles hop). */
  bounceKeep: number;
  /** Ends only when its life runs out (bombs): walls are bounced off whatever `bounces` says. */
  fuse: boolean;
  pierce: boolean;
  homing: number;
  path: Path;
  steer: Steer[];
  /** Ignores blocks entirely (black holes eat their way through). */
  ghost: boolean;
  /** Comes down from the sky above what the caster looks at (meteors). */
  sky: boolean;
  /** Appears where the caster looks (clouds), not at the wand. */
  aim: boolean;
  color: number;
  rainbow: boolean;
  size: number;
  /** Damage scaling (Divide By). */
  dmgMul: number;
  /** Formation offsets (degrees). */
  yawOff: number;
  pitchOff: number;
  /** A trigger and the cast it carries. */
  trigger?: Trigger;
  timer?: number;
  payload?: Shot;
  /** Can hurt its own caster (Bloodlust, Piercing Shot, plasma crosses). */
  selfHit: boolean;
  /** Lies in wait: blown up by a nearby explosion (crystals, propane). */
  dormant: boolean;
  invisible: boolean;
  /** Chance to vanish as it's cast (Fizzle). */
  fizzle: number;
  /** More casts it makes. */
  spawns: SpawnRule[];
  orbit?: Orbit;
  /** Conditions it puts on what it hits, and for how long. */
  inflict: [Status, number][];
  /** Always a critical hit on creatures with any of these ('burning' and 'wet' are read from the creature). */
  critOn: (Status | 'burning')[];
  /** Explodes on creatures with this condition. */
  explodeOn: { status: Status; r: number; dmg: number }[];
  /** Lines of something between this cast's projectiles. */
  arcs: ('fire' | 'gunpowder' | 'poison' | 'electric')[];
  /** Left behind as it flies. */
  trails: string[];
  /** Turns blocks where it ends (Ground To Sand...). */
  transmute: string[];
  /** Heals the caster by this share of the damage done. */
  lifeSteal: number;
  /** Hurts what's within this radius while it flies. */
  aura: number;
  /** Eats blocks it passes. */
  eater: boolean;
  /** Pushes other projectiles away (Projectile Energy Shield). */
  shield: boolean;
  /** Copies (larpas, chain spells) don't copy again. */
  copy: boolean;
  /** Free numbers for spells' own hooks (chain counts...). */
  data: Record<string, number>;
  /** The cast it belongs to (arcs connect a cast's projectiles). */
  group: number;
}

/** A cast state: the projectiles one press of the wand produces, and everything that adds up across them. */
export class Shot {
  projs: Proj[] = [];
  mods: ((p: Proj) => void)[] = [];
  spread = 0;
  castDelay = 0;
  recharge = 0;
  /** Projectiles start this far ahead (Long-Distance Cast, Warp Cast). */
  forward = 0;
  /** Projectiles start where the caster is looking (Teleport Cast). */
  teleport = false;
  /** Projectiles start at the nearest enemy (Teleporting Cast). */
  fromFoe = false;
  /** Projectiles start in a ring around the caster and fly inwards (Inner Spell). */
  inner = false;
  /** Pushes the caster back. */
  recoil = 0;
  /** Recharge time fixed at this (Slow But Steady). */
  rechargeSet?: number;
  /** Health the caster pays (Blood Magic, Blood To Power). */
  bloodCost = 0;
  /** Ends every projectile the caster has out (Cessation). */
  cease = false;
  /** Turns every projectile the caster has out into this spell (Spells To ...). */
  convert?: string;
}

/** What a card (a spell in a wand slot, or a copy of one) can do while the wand is being fired. */
export interface CastCtx {
  /** Draw `n` more cards into `shot`. */
  draw(shot: Shot, n: number): void;
  /** Take the next card without playing it (Divide By, Add Trigger). */
  take(): SpellDef | null;
  /** Discard the next card unplayed and unpaid (requirements). */
  skip(): SpellDef | null;
  /** The next cards in the deck, not drawn (Tau). */
  peek(n: number): SpellDef[];
  /** Play a spell as if drawn (copies: Alpha, Omega, Divide By). */
  play(spell: SpellDef, shot: Shot): void;
  /** The wand's spells in slot order (empty slots left out). */
  readonly spells: SpellDef[];
  /** Spells in the slots before the card being played (Spell Duplication). */
  readonly before: SpellDef[];
  /** The spells of the caster's other wands (Zeta). */
  readonly others: SpellDef[];
  /** Mana left in the wand; spells may take it (Mana To Damage). */
  mana: number;
  /** The caster's health share (0-1) and nearby enemies (requirements). */
  readonly health: number;
  readonly enemies: number;
  /** The caster's projectiles in flight, and the gold they carry (ingots; nuggets count a ninth). */
  readonly flying: number;
  readonly gold: number;
  /** Flips each time it's read for this wand (Requirement - Every Other). */
  everyOther(): boolean;
  rand(): number;
  /** Reload as soon as this cast is out (Wand Refresh). */
  refresh: boolean;
}

/** What spell hooks can do in the world (the server's projectile system implements it). */
export interface SpellWorld {
  /** An explosion: hurts and pushes what's near, breaks blocks up to `terrain` blast resistance. */
  blast(x: number, y: number, z: number, r: number, dmg: number, terrain: number, fire: boolean, color: number, o?: { elec?: boolean; status?: Status; self?: boolean }): void;
  /** Break a ball of blocks up to a hardness. */
  dig(x: number, y: number, z: number, r: number, hardness: number): void;
  /** Living things near a point (the caster included unless `others`). */
  near(x: number, y: number, z: number, r: number, others?: boolean): Entity[];
  /** Creatures the caster would fight, nearest first. */
  foes(x: number, y: number, z: number, r: number): Entity[];
  hurt(e: Entity, dmg: number, opts?: { fire?: boolean; freeze?: boolean; kx?: number; ky?: number; kz?: number; self?: boolean; blast?: boolean }): void;
  heal(e: Entity, n: number): void;
  effect(e: Entity, id: string, ticks: number, amp: number): void;
  status(e: Entity, s: Status, ticks: number): void;
  has(e: Entity, s: Status): boolean;
  /** Block helpers (names like 'water'; meta for fluids' levels). */
  id(x: number, y: number, z: number): string;
  solid(x: number, y: number, z: number): boolean;
  place(x: number, y: number, z: number, name: string, meta?: number): void;
  /** A block that goes away again after `ticks` (platforms, walls). */
  temp(x: number, y: number, z: number, name: string, ticks: number): void;
  ignite(x: number, y: number, z: number): void;
  teleportCaster(x: number, y: number, z: number): void;
  teleport(e: Entity, x: number, y: number, z: number): void;
  /** Pull an entity toward a point. */
  pull(e: Entity, x: number, y: number, z: number, strength: number): void;
  /** Fire a spell's projectile from a point (child projectiles: Death Cross rays). Returns its id. */
  spawn(spell: string, x: number, y: number, z: number, dx: number, dy: number, dz: number, over?: Partial<Proj>): number | undefined;
  /** Projectiles in flight near a point (every caster's), and the caster's own anywhere. */
  projs(x: number, y: number, z: number, r: number): Live[];
  mine(): Live[];
  /** Turn a projectile into another spell where it is, going the same way. */
  replace(l: Live, spell: string): void;
  /** A creature (vanilla type name, or 'mod:name'). */
  mob(type: string, x: number, y: number, z: number): Entity | null;
  /** Make a creature explode (radius, damage) when it's hurt, or after `ticks` (Deercoy). */
  rig(e: Entity, r: number, dmg: number, ticks: number): void;
  /** Swap a creature for another kind (sheep...). */
  polymorph(e: Entity, type: string): void;
  /** Where the caster is aiming (up to 48 blocks), if they're a player or mob. */
  aim(): { x: number; y: number; z: number } | null;
  /** Change blocks in a ball: `fn` gets each block's name and returns a new one (or null to leave it). */
  transmute(x: number, y: number, z: number, r: number, fn: (name: string) => string | null, each?: (x: number, y: number, z: number) => void): void;
  /** Remove creatures' arrows and fireballs near a point (shields). */
  deflect(x: number, y: number, z: number, r: number): void;
  /** A visual effect for everyone near (lightning strikes...). */
  fx(kind: string, x: number, y: number, z: number, data?: number[]): void;
  sound(name: string, x: number, y: number, z: number, volume?: number, pitch?: number): void;
  rand(): number;
  /** Server ticks. */
  readonly time: number;
}

/** A live projectile, as hooks see it. */
export interface Live {
  readonly id: number;
  readonly p: Proj;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
  readonly ox: number; readonly oy: number; readonly oz: number;
  readonly caster: Entity | null;
  /** End it now (it explodes / releases its payload as if it had hit something). */
  kill(): void;
  /** Remove it without any of that. */
  remove(): void;
  /** Tell clients where it is now (after moving it by hand). */
  sync(): void;
}
export interface HitInfo { x: number; y: number; z: number; nx: number; ny: number; nz: number; entity: Entity | null; reason: 'block' | 'entity' | 'expire' }

export interface Icon { g: string; c: string; c2?: string; n?: string }

export interface SpellDef {
  id: string;
  name: string;
  type: SpellType;
  desc: string;
  mana: number;
  /** Added to the wand's cast delay / recharge time (ticks, may be negative). */
  delay?: number;
  reload?: number;
  /** Limited uses (bombs...): recover one at a time while the wand rests. */
  uses?: number;
  /** 0 common .. 5 legendary: how deep you must go (wand tier) to find it. */
  tier: number;
  /** Card art painted in code, used when there's no Noita icon. */
  icon: Icon;
  /** The Noita spell whose icon it wears (defaults to `name`). */
  noita?: string;
  /** The projectile (projectile / static / material spells). */
  proj?: Partial<Proj>;
  trigger?: Trigger;
  timer?: number;
  /** Cards a trigger carries (Double Trigger: 2). */
  triggerDraw?: number;
  /** Every tick the projectile lives (server). */
  tick?(l: Live, w: SpellWorld): void;
  /** When it ends (server). */
  hit?(l: Live, h: HitInfo, w: SpellWorld): void;
  /** When it hits a creature, before damage (server). */
  touch?(l: Live, e: Entity, w: SpellWorld): void;
  /** Modifiers: change every projectile of the cast. */
  mod?(p: Proj): void;
  /** Modifiers that also change the cast itself (recoil, mana...). */
  cast?(c: CastCtx, shot: Shot): void;
  /** Multicast: how many more cards to draw, and the formation they fly in (yaw, pitch degrees). */
  draw?: number;
  formation?: [number, number][];
  scatter?: number;
  /** Other spells: their own card logic. */
  play?(c: CastCtx, shot: Shot): void;
  /** Passive spells: what holding the wand does (server, every 10 ticks). */
  passive?: string;
  /** Not found in the world (helper projectiles of other spells). */
  hidden?: boolean;
  /** Whose card art an `icon` projectile wears (hidden helpers borrow their spell's). */
  sprite?: string;
  /** Drawn but plays no part in a cast (requirement markers). */
  marker?: 'else' | 'end';
}

export const BASE: Omit<Proj, 'spell'> = {
  visual: 'spark', dmg: 0, explR: 0, explDmg: 0, terrain: 0, digHard: 0, digCount: 0, digR: 0, fire: false, fireTrail: false,
  freeze: false, elec: 0, heal: 0, knock: 0, crit: 0, speed: 1, spread: 0, gravity: 0, drag: 1, life: 20, bounces: 0,
  bounceKeep: 0.9, fuse: false, pierce: false, homing: 0, path: 'straight', steer: [], ghost: false, sky: false, aim: false, color: 0xffffff, rainbow: false,
  size: 0.15, dmgMul: 1, yawOff: 0, pitchOff: 0, selfHit: false, dormant: false, invisible: false, fizzle: 0, spawns: [],
  inflict: [], critOn: [], explodeOn: [], arcs: [], trails: [], transmute: [], lifeSteal: 0, aura: 0, eater: false,
  shield: false, copy: false, data: {}, group: 0,
};

/** A fresh projectile of a spell (its lists are its own: modifiers add to them). */
export function makeProj(s: SpellDef): Proj {
  const q = s.proj ?? {};
  const p: Proj = {
    ...BASE, ...q, spell: s,
    steer: [...(q.steer ?? [])], spawns: [...(q.spawns ?? [])], inflict: [...(q.inflict ?? [])], critOn: [...(q.critOn ?? [])],
    explodeOn: [...(q.explodeOn ?? [])], arcs: [...(q.arcs ?? [])], trails: [...(q.trails ?? [])], transmute: [...(q.transmute ?? [])],
    data: { ...(q.data ?? {}) },
  };
  if (s.trigger) { p.trigger = s.trigger; p.timer = s.timer; }
  return p;
}
/** A copy of a projectile (its own lists), e.g. for Larpa copies. */
export function cloneProj(p: Proj): Proj {
  return {
    ...p, steer: [...p.steer], spawns: [...p.spawns], inflict: [...p.inflict], critOn: [...p.critOn], explodeOn: [...p.explodeOn],
    arcs: [...p.arcs], trails: [...p.trails], transmute: [...p.transmute], data: { ...p.data }, orbit: p.orbit ? { ...p.orbit } : undefined,
  };
}

// ------------------------------------------------------------------ the registry and its helpers
export const S: SpellDef[] = [];
export const def = (d: SpellDef) => { S.push(d); return d; };
export const proj = (id: string, name: string, tier: number, mana: number, desc: string, icon: Icon, p: Partial<Proj>, extra: Partial<SpellDef> = {}) =>
  def({ id, name, type: 'projectile', tier, mana, desc, icon, proj: p, ...extra });
export const modifier = (id: string, name: string, tier: number, mana: number, desc: string, icon: Icon, mod: (p: Proj) => void, extra: Partial<SpellDef> = {}) =>
  def({ id, name, type: 'modifier', tier, mana, desc, icon, mod, ...extra });
/** Static projectiles: they stay where they're cast (at the wand's tip, or where a trigger releases them). */
export const stat = (id: string, name: string, tier: number, mana: number, desc: string, icon: Icon, p: Partial<Proj>, extra: Partial<SpellDef> = {}) =>
  def({ id, name, type: 'static', tier, mana, desc, icon, proj: { speed: 0, ghost: true, pierce: true, ...p }, ...extra });
export const multi = (id: string, name: string, tier: number, mana: number, desc: string, icon: Icon, draw: number, extra: Partial<SpellDef> = {}) =>
  def({ id, name, type: 'multicast', tier, mana, desc, icon, draw, ...extra });
export const other = (id: string, name: string, tier: number, mana: number, desc: string, icon: Icon, play: (c: CastCtx, shot: Shot) => void, extra: Partial<SpellDef> = {}) =>
  def({ id, name, type: 'other', tier, mana, desc, icon, play, ...extra });
export const utility = (id: string, name: string, tier: number, mana: number, desc: string, icon: Icon, play: (c: CastCtx, shot: Shot) => void, extra: Partial<SpellDef> = {}) =>
  def({ id, name, type: 'utility', tier, mana, desc, icon, play, ...extra });

/** Seconds (as Noita lists them) to ticks. */
export const sec = (s: number) => Math.round(s * 20);
/** Where a material lands: the open spot in front of what it hit. */
export const landing = (h: HitInfo) => [Math.floor(h.x + h.nx * 0.5), Math.floor(h.y + h.ny * 0.5), Math.floor(h.z + h.nz * 0.5)];
/** Copy spells: they copy others, never each other. */
export const isCopy = (s: SpellDef) => ['alpha', 'gamma', 'omega', 'mu', 'tau', 'phi', 'sigma', 'zeta', 'spell_duplication'].includes(s.id) || s.id.startsWith('divide_') || s.id.startsWith('random_') || s.id.startsWith('copy_random');
export const hexCol = (c: string) => parseInt(c.slice(1), 16);
