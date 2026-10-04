// The spell catalogue: what each spell costs, how it changes the cast it's part of, and what its projectile does.
// Pure data and small functions, shared by the server (casting, projectiles), the client (visuals, the editor's
// cast preview) and the workers (which only need the item list).
//
// Units: times are game ticks (20 a second; the editor shows seconds), speeds blocks per tick, damage half-hearts.

import type { Entity } from '../sdk';

export type SpellType = 'projectile' | 'static' | 'modifier' | 'multicast' | 'material' | 'other';
export type Trigger = 'hit' | 'timer' | 'expire';
/** How a projectile looks (the client's renderer picks its drawing by this). */
export type Visual =
  | 'spark' | 'arrow' | 'bolt' | 'burst' | 'orb' | 'spit' | 'wood' | 'fire' | 'bomb' | 'dynamite' | 'holy' | 'hole'
  | 'dig' | 'saw' | 'drill' | 'lightning' | 'lance' | 'bubble' | 'heal' | 'tp' | 'cross' | 'ray' | 'tentacle' | 'rock'
  | 'blast' | 'field' | 'cloud' | 'liquid' | 'sand' | 'snow';
export type Path = 'straight' | 'sine' | 'chaos' | 'spiral' | 'accel';

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
}

/** A cast state: the projectiles one press of the wand produces, and everything that adds up across them. */
export class Shot {
  projs: Proj[] = [];
  mods: ((p: Proj) => void)[] = [];
  spread = 0;
  castDelay = 0;
  recharge = 0;
  /** Projectiles start this far ahead (Long-Distance Cast). */
  forward = 0;
  /** Projectiles start where the caster is looking (Teleport Cast). */
  teleport = false;
}

/** What a card (a spell in a wand slot, or a copy of one) can do while the wand is being fired. */
export interface CastCtx {
  /** Draw `n` more cards into `shot`. */
  draw(shot: Shot, n: number): void;
  /** Take the next card without playing it (Divide By, Add Trigger). */
  take(): SpellDef | null;
  /** Play a spell as if drawn (copies: Alpha, Omega, Divide By). */
  play(spell: SpellDef, shot: Shot): void;
  /** The wand's spells in slot order (empty slots left out). */
  readonly spells: SpellDef[];
  rand(): number;
  /** Reload as soon as this cast is out (Wand Refresh). */
  refresh: boolean;
}

/** What spell hooks can do in the world (the server's projectile system implements it). */
export interface SpellWorld {
  /** An explosion: hurts and pushes what's near, breaks blocks up to `terrain` blast resistance. */
  blast(x: number, y: number, z: number, r: number, dmg: number, terrain: number, fire: boolean, color: number): void;
  /** Break a ball of blocks up to a hardness. */
  dig(x: number, y: number, z: number, r: number, hardness: number): void;
  /** Living things near a point (the caster included unless `others`). */
  near(x: number, y: number, z: number, r: number, others?: boolean): Entity[];
  hurt(e: Entity, dmg: number, opts?: { fire?: boolean; freeze?: boolean; kx?: number; ky?: number; kz?: number }): void;
  heal(e: Entity, n: number): void;
  effect(e: Entity, id: string, ticks: number, amp: number): void;
  /** Block helpers (names like 'water'; meta for fluids' levels). */
  id(x: number, y: number, z: number): string;
  solid(x: number, y: number, z: number): boolean;
  place(x: number, y: number, z: number, name: string, meta?: number): void;
  ignite(x: number, y: number, z: number): void;
  teleportCaster(x: number, y: number, z: number): void;
  /** Pull an entity toward a point. */
  pull(e: Entity, x: number, y: number, z: number, strength: number): void;
  /** Fire a spell's projectile from a point (child projectiles: Death Cross rays). */
  spawn(spell: string, x: number, y: number, z: number, dx: number, dy: number, dz: number): void;
  /** A visual effect for everyone near (lightning strikes...). */
  fx(kind: string, x: number, y: number, z: number, data?: number[]): void;
  sound(name: string, x: number, y: number, z: number, volume?: number, pitch?: number): void;
  rand(): number;
}

/** A live projectile, as hooks see it. */
export interface Live {
  readonly p: Proj;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  readonly caster: Entity | null;
  /** End it now (it explodes / releases its payload as if it had hit something). */
  kill(): void;
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
  icon: Icon;
  /** The projectile (projectile / static / material spells). */
  proj?: Partial<Proj>;
  trigger?: Trigger;
  timer?: number;
  /** Every tick the projectile lives (server). */
  tick?(l: Live, w: SpellWorld): void;
  /** When it ends (server). */
  hit?(l: Live, h: HitInfo, w: SpellWorld): void;
  /** Modifiers: change every projectile of the cast. */
  mod?(p: Proj): void;
  /** Multicast: how many more cards to draw, and the formation they fly in (yaw, pitch degrees). */
  draw?: number;
  formation?: [number, number][];
  scatter?: number;
  /** Other spells: their own card logic. */
  play?(c: CastCtx, shot: Shot): void;
  /** Not found in the world (helper projectiles of other spells). */
  hidden?: boolean;
}

const BASE: Omit<Proj, 'spell'> = {
  visual: 'spark', dmg: 0, explR: 0, explDmg: 0, terrain: 0, digHard: 0, digCount: 0, digR: 0, fire: false, fireTrail: false,
  freeze: false, elec: 0, heal: 0, knock: 0, crit: 0, speed: 1, spread: 0, gravity: 0, drag: 1, life: 20, bounces: 0,
  bounceKeep: 0.9, fuse: false, pierce: false, homing: 0, path: 'straight', ghost: false, sky: false, aim: false, color: 0xffffff, rainbow: false,
  size: 0.15, dmgMul: 1, yawOff: 0, pitchOff: 0,
};

/** A fresh projectile of a spell. */
export function makeProj(s: SpellDef): Proj {
  const p: Proj = { ...BASE, ...s.proj, spell: s };
  if (s.trigger) { p.trigger = s.trigger; p.timer = s.timer; }
  return p;
}

// ------------------------------------------------------------------ the catalogue
const S: SpellDef[] = [];
const def = (d: SpellDef) => { S.push(d); return d; };
const proj = (id: string, name: string, tier: number, mana: number, desc: string, icon: Icon, p: Partial<Proj>, extra: Partial<SpellDef> = {}) =>
  def({ id, name, type: 'projectile', tier, mana, desc, icon, proj: p, ...extra });
const modifier = (id: string, name: string, tier: number, mana: number, desc: string, icon: Icon, mod: (p: Proj) => void, extra: Partial<SpellDef> = {}) =>
  def({ id, name, type: 'modifier', tier, mana, desc, icon, mod, ...extra });

// ---- projectiles
const SPARK: Partial<Proj> = { visual: 'spark', dmg: 3, speed: 1.4, life: 16, spread: -1, color: 0xd08cff, size: 0.12 };
proj('spark_bolt', 'Spark Bolt', 0, 5, 'A weak but enchanting sparkling projectile.', { g: 'spark', c: '#d08cff' }, SPARK, { delay: -1 });
proj('spark_bolt_trigger', 'Spark Bolt with Trigger', 1, 10, 'A spark bolt that casts another spell when it hits something.', { g: 'spark', c: '#d08cff', n: 'trigger' }, SPARK, { delay: -1, trigger: 'hit' });
proj('spark_bolt_timer', 'Spark Bolt with Timer', 1, 10, 'A spark bolt that casts another spell after half a second.', { g: 'spark', c: '#d08cff', n: 'timer' }, SPARK, { delay: -1, trigger: 'timer', timer: 10 });
const ARROW: Partial<Proj> = { visual: 'arrow', dmg: 6, speed: 1.25, life: 30, color: 0x7af4ff, size: 0.14 };
proj('magic_arrow', 'Magic Arrow', 0, 20, 'A handy magical arrow.', { g: 'arrow', c: '#7af4ff' }, ARROW, { delay: 1 });
proj('magic_arrow_trigger', 'Magic Arrow with Trigger', 1, 30, 'A magic arrow that casts another spell when it hits something.', { g: 'arrow', c: '#7af4ff', n: 'trigger' }, ARROW, { delay: 1, trigger: 'hit' });
proj('magic_bolt', 'Magic Bolt', 1, 30, 'A powerful magical bolt.', { g: 'bolt', c: '#ffc040' }, { visual: 'bolt', dmg: 8, speed: 1.7, life: 26, color: 0xffc040, size: 0.18 }, { delay: 2 });
const BURST: Partial<Proj> = { visual: 'burst', dmg: 2, speed: 0.9, life: 50, bounces: 10, gravity: 0.03, color: 0xfff060, size: 0.12 };
proj('bouncing_burst', 'Bouncing Burst', 0, 5, 'A very bouncy projectile.', { g: 'burst', c: '#fff060' }, BURST, { delay: -1 });
proj('bouncing_burst_trigger', 'Bouncing Burst with Trigger', 2, 10, 'A bouncy projectile that casts another spell when it ends.', { g: 'burst', c: '#fff060', n: 'expire' }, BURST, { delay: -1, trigger: 'expire' });
const ORB: Partial<Proj> = { visual: 'orb', dmg: 4, explR: 1.2, explDmg: 4, speed: 0.45, life: 70, color: 0xff60d0, size: 0.3 };
proj('energy_orb', 'Energy Orb', 1, 30, 'A slow but powerful orb of energy.', { g: 'orb', c: '#ff60d0' }, ORB, { delay: 2 });
proj('energy_orb_trigger', 'Energy Orb with Trigger', 2, 35, 'An energy orb that casts another spell when it hits something.', { g: 'orb', c: '#ff60d0', n: 'trigger' }, ORB, { delay: 2, trigger: 'hit' });
const SPIT: Partial<Proj> = { visual: 'spit', dmg: 2, speed: 1.0, life: 7, spread: 5, gravity: 0.02, color: 0xa0ff60, size: 0.1 };
proj('spitter', 'Spitter Bolt', 0, 5, 'A short-lived, weak and wobbly bolt.', { g: 'spit', c: '#a0ff60' }, SPIT, { delay: -1 });
proj('spitter_timer', 'Spitter Bolt with Timer', 1, 10, 'A spitter bolt that casts another spell when it fades.', { g: 'spit', c: '#a0ff60', n: 'timer' }, SPIT, { delay: -1, trigger: 'timer', timer: 6 });
proj('arrow', 'Arrow', 0, 15, 'Summons an arrow.', { g: 'wood', c: '#d8b080' }, { visual: 'wood', dmg: 5, speed: 1.6, gravity: 0.05, life: 60, color: 0xd8b080, size: 0.12 }, { delay: 2 });
const FIREBALL: Partial<Proj> = { visual: 'fire', explR: 2.2, explDmg: 9, terrain: 6, fire: true, gravity: 0.015, speed: 0.8, life: 60, color: 0xff7a1a, size: 0.3 };
proj('fireball', 'Fireball', 2, 70, 'A powerful exploding spell that sets things alight.', { g: 'fireball', c: '#ff7a1a' }, FIREBALL, { delay: 6 });
proj('firebolt', 'Firebolt', 1, 50, 'A bouncy, burning bolt of fire.', { g: 'firebolt', c: '#ff4a00' }, { visual: 'fire', dmg: 3, fire: true, explR: 1.3, explDmg: 5, terrain: 2, gravity: 0.035, speed: 1.1, life: 40, color: 0xff4a00, size: 0.2 }, { delay: 10, uses: 25 });
proj('meteor', 'Meteor', 4, 150, 'Calls a burning rock down from the sky on what you look at.', { g: 'meteor', c: '#ff6020' }, { ...FIREBALL, explR: 4, explDmg: 30, terrain: 10, gravity: 0.06, speed: 1.4, life: 80, size: 0.6, sky: true }, { delay: 40, uses: 10 });
proj('bomb', 'Bomb', 1, 25, 'A bomb that bounces and rolls for three seconds, then explodes.', { g: 'bomb', c: '#3a3a3a' }, { visual: 'bomb', explR: 3.5, explDmg: 20, terrain: 8, gravity: 0.05, speed: 0.65, life: 60, bounces: 999, bounceKeep: 0.55, drag: 0.99, fuse: true, color: 0xff9020, size: 0.3 }, { delay: 20, uses: 3 });
proj('dynamite', 'Dynamite', 2, 50, 'A stick of dynamite with a short fuse.', { g: 'dynamite', c: '#d02020' }, { visual: 'dynamite', explR: 2.5, explDmg: 14, terrain: 6, gravity: 0.05, speed: 0.8, life: 30, bounces: 999, bounceKeep: 0.4, fuse: true, color: 0xffa040, size: 0.25 }, { delay: 17, uses: 16 });
proj('holy_bomb', 'Holy Bomb', 5, 300, 'An extremely destructive bomb. Run.', { g: 'holy', c: '#ffe080' }, { visual: 'holy', explR: 7, explDmg: 60, terrain: 50, gravity: 0.05, speed: 0.5, life: 80, bounces: 999, bounceKeep: 0.5, fuse: true, color: 0xffe080, size: 0.35 }, { delay: 40, uses: 2 });
proj('black_hole', 'Black Hole', 4, 180, 'A slow orb of void that eats through anything in its way.', { g: 'hole', c: '#7020c0' }, { visual: 'hole', speed: 0.18, life: 70, ghost: true, pierce: true, color: 0x9040ff, size: 0.45 }, {
  delay: 30, uses: 3,
  tick(l, w) {
    if (l.age % 3 === 0) w.dig(l.x, l.y, l.z, 1.6, 30);
    for (const e of w.near(l.x, l.y, l.z, 6, true)) {
      w.pull(e, l.x, l.y, l.z, 0.06);
      if (l.age % 10 === 0 && Math.hypot(e.x - l.x, e.y + e.height / 2 - l.y, e.z - l.z) < 1.8) w.hurt(e, 3);
    }
  },
});
proj('digging_bolt', 'Digging Bolt', 0, 0, 'Digs through soft ground: dirt, sand, gravel, stone.', { g: 'dig', c: '#d8c090' }, { visual: 'dig', dmg: 1, digHard: 2, digCount: 3, speed: 1.0, life: 8, color: 0xd8c090, size: 0.1 }, { delay: 0 });
proj('digging_blast', 'Digging Blast', 1, 0, 'Blasts a small hole into soft ground.', { g: 'digblast', c: '#c89060' }, { visual: 'dig', dmg: 1, digHard: 2.5, digCount: 1, digR: 1.3, speed: 1.1, life: 4, color: 0xc89060, size: 0.12 }, { delay: 0 });
proj('chainsaw', 'Chainsaw', 1, 1, 'Cuts and digs at very close range. Makes the wand fire as fast as it can.', { g: 'saw', c: '#e8e8e8' }, { visual: 'saw', dmg: 3, digHard: 1.6, digCount: 1, speed: 0.9, life: 2, color: 0xffffff, size: 0.1 }, { delay: -20, reload: -3 });
proj('luminous_drill', 'Luminous Drill', 2, 10, 'A bright, piercing drill of light: ores and stone alike.', { g: 'drill', c: '#9ff8ff' }, { visual: 'drill', dmg: 4, digHard: 3.5, digCount: 6, pierce: true, speed: 2.2, life: 3, color: 0x9ff8ff, size: 0.1 }, { delay: -12 });
proj('lightning_bolt', 'Lightning Bolt', 3, 70, 'A bolt of lightning that strikes with a thunderclap.', { g: 'lightning', c: '#d0e8ff' }, { visual: 'lightning', dmg: 6, explR: 1.6, explDmg: 8, terrain: 1.5, elec: 6, speed: 3.5, life: 12, color: 0xd0e8ff, size: 0.15 }, { delay: 10 });
proj('glowing_lance', 'Glowing Lance', 2, 30, 'A long spear of light that goes through everything it hits.', { g: 'lance', c: '#ffffa0' }, { visual: 'lance', dmg: 10, pierce: true, speed: 2.2, life: 25, color: 0xffffa0, size: 0.1 }, { delay: 7 });
proj('bubble_spark', 'Bubble Spark', 0, 5, 'A bouncy bubble that floats upwards.', { g: 'bubble', c: '#80d8ff' }, { visual: 'bubble', dmg: 2, speed: 0.45, life: 45, gravity: -0.008, bounces: 3, color: 0x80d8ff, size: 0.18 }, { delay: -1 });
proj('healing_bolt', 'Healing Bolt', 1, 15, 'Heals whatever it hits (not yourself).', { g: 'heal', c: '#60ff80' }, { visual: 'heal', heal: 3, speed: 1.3, life: 30, color: 0x60ff80, size: 0.14 }, { delay: 3 });
proj('teleport_bolt', 'Teleport Bolt', 1, 40, 'Teleports you to where it lands.', { g: 'tp', c: '#8080ff' }, { visual: 'tp', speed: 2, life: 30, color: 0x8080ff, size: 0.16 }, {
  delay: 3,
  hit(l, h, w) {
    // land on the near side of what it hit
    const k = 0.6;
    w.teleportCaster(h.x - Math.sign(l.vx) * k * (h.nx !== 0 ? 1 : 0) + h.nx * k, h.y + h.ny * k, h.z - Math.sign(l.vz) * k * (h.nz !== 0 ? 1 : 0) + h.nz * k);
  },
});
proj('death_cross', 'Death Cross', 3, 80, 'A cross that bursts into four deadly rays.', { g: 'cross', c: '#ff3050' }, { visual: 'cross', dmg: 4, speed: 0.4, life: 18, color: 0xff3050, size: 0.3 }, {
  delay: 8,
  hit(l, _h, w) {
    const yaw = Math.atan2(l.vx, l.vz);
    for (let k = 0; k < 4; k++) {
      const a = yaw + (k * Math.PI) / 2 + Math.PI / 4;
      w.spawn('death_ray', l.x, l.y, l.z, Math.sin(a), 0, Math.cos(a));
    }
  },
});
proj('death_ray', 'Death Ray', 5, 0, 'A ray of the Death Cross.', { g: 'cross', c: '#ff3050' }, { visual: 'ray', dmg: 8, pierce: true, speed: 2.5, life: 6, color: 0xff3050, size: 0.1 }, { hidden: true });
proj('tentacle', 'Tentacle', 2, 20, 'A grabbing tentacle that pulls what it hits to you.', { g: 'tentacle', c: '#50e090' }, { visual: 'tentacle', dmg: 3, speed: 1.8, life: 5, color: 0x50e090, size: 0.12 }, {
  delay: 4,
  hit(l, h, w) {
    if (h.entity && l.caster) w.pull(h.entity, l.caster.x, l.caster.y + 1, l.caster.z, 0.9);
  },
});
proj('summon_rock', 'Summon Rock', 2, 100, 'Conjures a heavy rock. Where it lands, it stays.', { g: 'rock', c: '#8a8a8a' }, { visual: 'rock', dmg: 8, gravity: 0.06, speed: 0.7, life: 80, color: 0x9a9a9a, size: 0.4 }, {
  delay: 10, uses: 3,
  hit(_l, h, w) {
    if (h.reason === 'block') {
      const x = Math.floor(h.x + h.nx * 0.5), y = Math.floor(h.y + h.ny * 0.5), z = Math.floor(h.z + h.nz * 0.5);
      if (!w.solid(x, y, z)) w.place(x, y, z, 'cobblestone');
    }
  },
});

// ---- static projectiles: they stay where they're cast (at the wand's tip, or where a trigger releases them)
const stat = (id: string, name: string, tier: number, mana: number, desc: string, icon: Icon, p: Partial<Proj>, extra: Partial<SpellDef> = {}) =>
  def({ id, name, type: 'static', tier, mana, desc, icon, proj: { speed: 0, ghost: true, pierce: true, ...p }, ...extra });
stat('explosion', 'Explosion', 2, 80, 'An explosion right where it\'s cast.', { g: 'explosion', c: '#ffa040' }, { visual: 'blast', explR: 2.5, explDmg: 12, terrain: 6, life: 1, color: 0xffa040, size: 0.5 }, { delay: 3 });
const field = (id: string, name: string, tier: number, mana: number, desc: string, color: string, tick: SpellDef['tick'], extra: Partial<SpellDef> = {}) =>
  stat(id, name, tier, mana, desc, { g: 'circle', c: color }, { visual: 'field', life: 100, color: parseInt(color.slice(1), 16), size: 3 }, { tick, delay: 10, uses: 10, ...extra });
field('circle_of_fire', 'Circle of Fire', 2, 60, 'A ring of fire that burns everything inside it.', '#ff6020', (l, w) => {
  if (l.age === 1) for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; w.ignite(Math.floor(l.x + Math.cos(a) * 2.5), Math.floor(l.y), Math.floor(l.z + Math.sin(a) * 2.5)); }
  if (l.age % 10 === 0) for (const e of w.near(l.x, l.y, l.z, 3, true)) w.hurt(e, 1, { fire: true });
}, { uses: 15 });
field('circle_of_vigour', 'Circle of Vigour', 2, 60, 'A healing circle: everyone inside recovers.', '#60ff60', (l, w) => {
  if (l.age % 10 === 0) for (const e of w.near(l.x, l.y, l.z, 3)) w.heal(e, 1);
});
field('circle_of_stillness', 'Circle of Stillness', 2, 50, 'Everything inside it slows to a crawl.', '#80c0ff', (l, w) => {
  if (l.age % 10 === 0) for (const e of w.near(l.x, l.y, l.z, 3, true)) w.effect(e, 'slowness', 30, 3);
});
stat('rain_cloud', 'Rain Cloud', 1, 30, 'A cloud that rains on what\'s below it, putting out fires.', { g: 'cloud', c: '#9aa0b0' }, { visual: 'cloud', life: 160, color: 0x9aa0b0, size: 2, aim: true }, {
  delay: 10, uses: 10,
  tick(l, w) {
    if (l.age === 1) l.y += 4;
    if (l.age % 5) return;
    for (let k = 0; k < 4; k++) {
      const x = Math.floor(l.x + (w.rand() - 0.5) * 5), z = Math.floor(l.z + (w.rand() - 0.5) * 5);
      for (let y = Math.floor(l.y); y > l.y - 12; y--) {
        const id = w.id(x, y, z);
        if (id === 'fire') { w.place(x, y, z, 'air'); break; }
        if (id === 'lava') { w.place(x, y, z, 'obsidian'); break; }
        if (w.solid(x, y, z)) break;
      }
    }
    for (const e of w.near(l.x, l.y - 4, l.z, 4)) e.fireTicks = 0;
  },
});
stat('thundercloud', 'Thundercloud', 3, 90, 'A storm cloud that strikes lightning below it.', { g: 'cloud', c: '#606878', c2: '#fff080' }, { visual: 'cloud', life: 140, color: 0x5a6070, size: 2.2, aim: true }, {
  delay: 12, uses: 5,
  tick(l, w) {
    if (l.age === 1) l.y += 4;
    if (l.age % 20 !== 10) return;
    const x = l.x + (w.rand() - 0.5) * 6, z = l.z + (w.rand() - 0.5) * 6;
    let y = Math.floor(l.y);
    while (y > l.y - 20 && !w.solid(Math.floor(x), y - 1, Math.floor(z))) y--;
    w.fx('strike', x, y, z, [l.y]);
    w.sound('wands:thunder', x, y, z, 2, 0.9 + w.rand() * 0.2);
    for (const e of w.near(x, y, z, 2, true)) w.hurt(e, 6, { fire: w.rand() < 0.3 });
    if (w.rand() < 0.3) w.ignite(Math.floor(x), y, Math.floor(z));
  },
});
const sea = (id: string, name: string, tier: number, block: string, color: string) =>
  stat(id, name, tier, 140, `Conjures a pool of ${block} where it's cast.`, { g: 'sea', c: color }, { visual: 'blast', life: 1, color: parseInt(color.slice(1), 16), size: 1 }, {
    delay: 20, uses: 3,
    hit(l, _h, w) {
      const cx = Math.floor(l.x), cy = Math.floor(l.y), cz = Math.floor(l.z);
      for (let dx = -3; dx <= 3; dx++)
        for (let dz = -3; dz <= 3; dz++) {
          if (dx * dx + dz * dz > 10) continue;
          for (let dy = 0; dy >= -2; dy--) if (!w.solid(cx + dx, cy + dy, cz + dz)) w.place(cx + dx, cy + dy, cz + dz, block);
        }
    },
  });
sea('sea_of_water', 'Sea of Water', 3, 'water', '#3070ff');
sea('sea_of_lava', 'Sea of Lava', 4, 'lava', '#ff5010');

// ---- materials: a short stream of something that stays where it lands
const material = (id: string, name: string, tier: number, mana: number, desc: string, icon: Icon, p: Partial<Proj>, hit: SpellDef['hit'], extra: Partial<SpellDef> = {}) =>
  def({ id, name, type: 'material', tier, mana, desc, icon, proj: { speed: 0.8, gravity: 0.06, life: 30, spread: 4, size: 0.1, ...p }, hit, ...extra });
/** Where a material lands: the open spot in front of what it hit. */
const landing = (h: HitInfo) => [Math.floor(h.x + h.nx * 0.5), Math.floor(h.y + h.ny * 0.5), Math.floor(h.z + h.nz * 0.5)];
material('water', 'Water', 0, 0, 'A splash of water. Puts out fires, cools lava.', { g: 'drop', c: '#3070ff' }, { visual: 'liquid', color: 0x3070ff }, (_l, h, w) => {
  const [x, y, z] = landing(h);
  const id = w.id(x, y, z), below = w.id(x, y - 1, z);
  if (id === 'fire') w.place(x, y, z, 'air');
  else if (below === 'lava') w.place(x, y - 1, z, 'obsidian');
  else if (!w.solid(x, y, z) && id !== 'water') w.place(x, y, z, 'water', 5);
  if (h.entity) h.entity.fireTicks = 0;
});
material('lava', 'Lava', 2, 20, 'A splash of lava. Hot.', { g: 'drop', c: '#ff5010' }, { visual: 'liquid', color: 0xff5010, fire: true }, (_l, h, w) => {
  const [x, y, z] = landing(h);
  if (!w.solid(x, y, z) && w.id(x, y, z) !== 'lava') w.place(x, y, z, w.id(x, y, z) === 'water' ? 'obsidian' : 'lava', 6);
});
material('sand', 'Sand', 0, 5, 'Conjures sand. It falls.', { g: 'sand', c: '#e0d090' }, { visual: 'sand', color: 0xe0d090 }, (_l, h, w) => {
  const [x, y, z] = landing(h);
  if (!w.solid(x, y, z)) w.place(x, y, z, 'sand');
});
material('snow', 'Snow', 1, 5, 'A flurry of snow: covers the ground, freezes water.', { g: 'snowflake', c: '#ffffff' }, { visual: 'snow', color: 0xeef8ff, freeze: true }, (_l, h, w) => {
  const [x, y, z] = landing(h);
  if (w.id(x, y - 1, z) === 'water') w.place(x, y - 1, z, 'ice');
  else if (!w.solid(x, y, z) && w.solid(x, y - 1, z) && w.id(x, y, z) === 'air') w.place(x, y, z, 'snow');
});

// ---- modifiers: change every projectile of the cast, and draw one more spell
modifier('damage_plus', 'Damage Plus', 0, 5, 'Increases the damage done by a projectile.', { g: 'plus', c: '#ff5050' }, (p) => { p.dmg += 3; p.crit += 0.05; }, { delay: 2 });
modifier('heavy_shot', 'Heavy Shot', 1, 7, 'A slower but much more damaging projectile.', { g: 'heavy', c: '#a0a0b0' }, (p) => { p.dmg += 6; p.speed *= 0.35; }, { delay: 10 });
modifier('light_shot', 'Light Shot', 1, 5, 'A faster, more accurate, but weaker projectile.', { g: 'feather', c: '#e0f0ff' }, (p) => { p.speed *= 2; p.spread -= 6; p.dmg = Math.max(0, p.dmg - 1); }, { delay: -1 });
modifier('speed_up', 'Speed Up', 0, 3, 'Makes a projectile fly much faster.', { g: 'speed', c: '#80ffff' }, (p) => { p.speed *= 2.5; });
modifier('accelerating_shot', 'Accelerating Shot', 2, 20, 'The projectile starts slow and keeps speeding up.', { g: 'accel', c: '#80ffc0' }, (p) => { p.path = 'accel'; p.dmg += 1; }, { delay: 8 });
modifier('piercing_shot', 'Piercing Shot', 3, 70, 'The projectile goes through what it hits.', { g: 'pierce', c: '#c0c0ff' }, (p) => { p.pierce = true; });
modifier('bounce', 'Bounce', 0, 0, 'The projectile bounces off walls.', { g: 'bounce', c: '#fff060' }, (p) => { p.bounces += 10; });
modifier('homing', 'Homing', 2, 70, 'The projectile seeks out monsters.', { g: 'homing', c: '#ff8080' }, (p) => { p.homing = Math.max(p.homing, 0.25); });
modifier('explosive_projectile', 'Explosive Projectile', 2, 30, 'The projectile explodes when it ends.', { g: 'boom', c: '#ffa040' }, (p) => { p.explR = Math.max(p.explR, 1.4) + 0.4; p.explDmg += 5; p.terrain = Math.max(p.terrain, 2.5); p.speed *= 0.75; }, { delay: 6 });
modifier('fire_trail', 'Fire Trail', 1, 10, 'The projectile leaves a trail of fire and sets what it hits alight.', { g: 'flametrail', c: '#ff7020' }, (p) => { p.fireTrail = true; p.fire = true; });
modifier('critical_plus', 'Critical Plus', 1, 5, 'Increases the chance of a critical hit by 15%.', { g: 'crit', c: '#ffe040' }, (p) => { p.crit += 0.15; });
modifier('add_mana', 'Add Mana', 1, -30, 'Gives the wand back some mana.', { g: 'mana', c: '#4080ff' }, () => {}, { delay: 3 });
modifier('reduce_recharge', 'Reduce Recharge Time', 1, 12, 'Shortens the wand\'s recharge time.', { g: 'recharge', c: '#c0ff80' }, () => {}, { reload: -7 });
modifier('increase_lifetime', 'Increase Lifetime', 2, 40, 'The projectile lasts much longer.', { g: 'lifeup', c: '#c0a0ff' }, (p) => { p.life = Math.round(p.life * 1.75) + 5; }, { delay: 3 });
modifier('reduce_lifetime', 'Reduce Lifetime', 1, 10, 'The projectile fades out sooner.', { g: 'lifedown', c: '#a080c0' }, (p) => { p.life = Math.max(1, Math.round(p.life * 0.5)); }, { delay: -3 });
modifier('reduce_spread', 'Reduce Spread', 0, 1, 'Makes the spell more accurate.', { g: 'spread', c: '#ffffff' }, (p) => { p.spread -= 30; });
modifier('linear_arc', 'Linear Arc', 0, 0, 'The projectile flies in a straight line, unaffected by gravity.', { g: 'line', c: '#ffffff' }, (p) => { p.gravity = 0; p.path = 'straight'; });
modifier('sinewave', 'Slithering Path', 1, 0, 'The projectile slithers from side to side.', { g: 'wave', c: '#80ff80' }, (p) => { p.path = 'sine'; });
modifier('chaotic_arc', 'Chaotic Path', 1, 0, 'The projectile flies about erratically.', { g: 'chaos', c: '#ff80ff' }, (p) => { p.path = 'chaos'; p.speed *= 1.3; });
modifier('spiral_arc', 'Spiral Arc', 1, 0, 'The projectile corkscrews through the air.', { g: 'spiral', c: '#80c0ff' }, (p) => { p.path = 'spiral'; });
modifier('gravity', 'Gravity', 0, 1, 'The projectile falls like a stone.', { g: 'down', c: '#c08060' }, (p) => { p.gravity += 0.05; });
modifier('anti_gravity', 'Anti-gravity', 0, 1, 'The projectile falls upwards.', { g: 'up', c: '#80c0ff' }, (p) => { p.gravity -= 0.05; });
modifier('knockback', 'Knockback', 0, 5, 'The projectile knocks back what it hits.', { g: 'push', c: '#ffd080' }, (p) => { p.knock += 0.8; });
modifier('freeze_charge', 'Freeze Charge', 1, 10, 'The projectile freezes what it hits.', { g: 'snowflake', c: '#a0e0ff' }, (p) => { p.freeze = true; });
modifier('electric_charge', 'Electric Charge', 1, 8, 'The projectile shocks everything near where it hits.', { g: 'zap', c: '#ffff60' }, (p) => { p.elec += 3; });
const glimmer = (id: string, name: string, color: string, rainbow = false) =>
  modifier(id, name, 0, 0, 'Colours the projectile. Purely decorative.', { g: 'glimmer', c: color }, (p) => { p.color = parseInt(color.slice(1), 16); p.rainbow = rainbow; });
glimmer('red_glimmer', 'Red Glimmer', '#ff4040');
glimmer('green_glimmer', 'Green Glimmer', '#40ff60');
glimmer('blue_glimmer', 'Blue Glimmer', '#4080ff');
glimmer('rainbow_glimmer', 'Rainbow Glimmer', '#ffffff', true);

// ---- multicasts: draw more spells into the same cast
const multi = (id: string, name: string, tier: number, mana: number, desc: string, icon: Icon, draw: number, extra: Partial<SpellDef> = {}) =>
  def({ id, name, type: 'multicast', tier, mana, desc, icon, draw, ...extra });
multi('double_spell', 'Double Spell', 0, 0, 'Casts two spells at once.', { g: 'digit', c: '#80ff80', n: '2' }, 2);
multi('triple_spell', 'Triple Spell', 1, 2, 'Casts three spells at once.', { g: 'digit', c: '#80ff80', n: '3' }, 3);
multi('quadruple_spell', 'Quadruple Spell', 2, 5, 'Casts four spells at once.', { g: 'digit', c: '#80ff80', n: '4' }, 4);
multi('octuple_spell', 'Octuple Spell', 4, 30, 'Casts eight spells at once.', { g: 'digit', c: '#80ff80', n: '8' }, 8);
multi('scatter_2', 'Double Scatter Spell', 0, 0, 'Casts two spells at once, with a wide spread.', { g: 'scatter', c: '#c0ff80', n: '2' }, 2, { scatter: 10 });
multi('scatter_3', 'Triple Scatter Spell', 1, 1, 'Casts three spells at once, with a wide spread.', { g: 'scatter', c: '#c0ff80', n: '3' }, 3, { scatter: 20 });
multi('scatter_4', 'Quadruple Scatter Spell', 2, 2, 'Casts four spells at once, with a very wide spread.', { g: 'scatter', c: '#c0ff80', n: '4' }, 4, { scatter: 40 });
const around = (n: number) => Array.from({ length: n }, (_, i) => [(i * 360) / n, 0] as [number, number]);
multi('formation_behind', 'Formation - Behind Your Back', 1, 0, 'Casts two spells: one ahead, one behind you.', { g: 'form', c: '#80ffe0', n: 'behind' }, 2, { formation: [[0, 0], [180, 0]] });
multi('formation_bifurcated', 'Formation - Bifurcated', 1, 2, 'Casts two spells in a V.', { g: 'form', c: '#80ffe0', n: 'bi' }, 2, { formation: [[-15, 0], [15, 0]] });
multi('formation_trifurcated', 'Formation - Trifurcated', 2, 3, 'Casts three spells in a fan.', { g: 'form', c: '#80ffe0', n: 'tri' }, 3, { formation: [[-20, 0], [0, 0], [20, 0]] });
multi('formation_above_below', 'Formation - Above and Below', 2, 3, 'Casts three spells: ahead, above and below.', { g: 'form', c: '#80ffe0', n: 'ab' }, 3, { formation: [[0, 0], [0, 30], [0, -30]] });
multi('formation_pentagon', 'Formation - Pentagon', 3, 5, 'Casts five spells all around you.', { g: 'form', c: '#80ffe0', n: 'penta' }, 5, { formation: around(5) });
multi('formation_hexagon', 'Formation - Hexagon', 3, 6, 'Casts six spells all around you.', { g: 'form', c: '#80ffe0', n: 'hexa' }, 6, { formation: around(6) });

// ---- other: spells about spells
const other = (id: string, name: string, tier: number, mana: number, desc: string, icon: Icon, play: (c: CastCtx, shot: Shot) => void, extra: Partial<SpellDef> = {}) =>
  def({ id, name, type: 'other', tier, mana, desc, icon, play, ...extra });
/** Give the next projectile drawn a trigger, carrying the spell after it. */
const addTrigger = (t: Trigger, timer?: number) => (c: CastCtx, shot: Shot) => {
  const n = shot.projs.length;
  c.draw(shot, 1);
  const p = shot.projs[n];
  if (!p || p.trigger) return;
  p.trigger = t;
  p.timer = timer;
  p.payload = new Shot();
  c.draw(p.payload, 1);
};
other('add_trigger', 'Add Trigger', 2, 10, 'The next projectile casts the spell after it when it hits something.', { g: 'tag', c: '#ffb040', n: 'trigger' }, addTrigger('hit'));
other('add_timer', 'Add Timer', 2, 10, 'The next projectile casts the spell after it after a moment.', { g: 'tag', c: '#ffb040', n: 'timer' }, addTrigger('timer', 15));
other('add_expiration', 'Add Expiration Trigger', 2, 10, 'The next projectile casts the spell after it when it ends.', { g: 'tag', c: '#ffb040', n: 'expire' }, addTrigger('expire'));
const divide = (n: number, mana: number, mul: number, tier: number) =>
  other(`divide_${n}`, `Divide by ${n}`, tier, mana, `Casts the next spell ${n} times, each a little weaker.`, { g: 'divide', c: '#ff80c0', n: String(n) }, (c, shot) => {
    const next = c.take();
    if (!next) return;
    const from = shot.projs.length;
    for (let k = 0; k < n; k++) c.play(next, shot);
    for (const p of shot.projs.slice(from)) p.dmgMul *= mul;
  }, { delay: 6 + n * 2 });
divide(2, 35, 0.7, 3);
divide(3, 50, 0.6, 4);
divide(4, 70, 0.5, 4);
const isCopy = (s: SpellDef) => ['alpha', 'gamma', 'omega', 'mu'].includes(s.id) || s.id.startsWith('divide_') || s.id.startsWith('random_');
other('alpha', 'Alpha', 4, 30, 'Casts a copy of the first spell in the wand.', { g: 'greek', c: '#ffe080', n: 'alpha' }, (c, shot) => { const s = c.spells.find((x) => !isCopy(x)); if (s) c.play(s, shot); }, { delay: 15 });
other('gamma', 'Gamma', 4, 30, 'Casts a copy of the last spell in the wand.', { g: 'greek', c: '#ffe080', n: 'gamma' }, (c, shot) => { const s = [...c.spells].reverse().find((x) => !isCopy(x)); if (s) c.play(s, shot); }, { delay: 15 });
other('omega', 'Omega', 5, 300, 'Casts a copy of every spell in the wand.', { g: 'greek', c: '#ffe080', n: 'omega' }, (c, shot) => { for (const s of c.spells) if (!isCopy(s) && s.type !== 'modifier') c.play(s, shot); }, { delay: 25 });
other('mu', 'Mu', 5, 120, 'Applies every modifier in the wand to this cast.', { g: 'greek', c: '#ffe080', n: 'mu' }, (c, shot) => { for (const s of c.spells) if (s.type === 'modifier' && s.mod) shot.mods.push(s.mod); c.draw(shot, 1); }, { delay: 10 });
const pool = (pred: (s: SpellDef) => boolean) => () => S.filter((s) => pred(s) && !s.hidden && !isCopy(s));
const randomOf = (id: string, name: string, tier: number, mana: number, desc: string, c: string, from: () => SpellDef[]) =>
  other(id, name, tier, mana, desc, { g: 'random', c }, (cc, shot) => {
    const list = from();
    if (list.length) cc.play(list[Math.floor(cc.rand() * list.length)], shot);
  });
randomOf('random_spell', 'Random Spell', 2, 5, 'Casts a random spell. Anything can happen.', '#ffffff', pool((s) => s.type !== 'other'));
randomOf('random_projectile', 'Random Projectile Spell', 1, 20, 'Casts a random projectile spell.', '#7aa0ff', pool((s) => s.type === 'projectile'));
randomOf('random_modifier', 'Random Modifier Spell', 1, 20, 'Applies a random modifier to the cast.', '#60e0c0', pool((s) => s.type === 'modifier'));
other('long_distance_cast', 'Long-Distance Cast', 1, 0, 'The spells of this cast appear further away.', { g: 'far', c: '#c0c0ff' }, (c, shot) => { shot.forward += 3; c.draw(shot, 1); }, { delay: -3 });
other('teleport_cast', 'Teleport Cast', 3, 100, 'The spells of this cast appear where you look.', { g: 'telecast', c: '#a080ff' }, (c, shot) => { shot.teleport = true; c.draw(shot, 1); }, { delay: 10 });
other('wand_refresh', 'Wand Refresh', 3, 0, 'The wand recharges straight away.', { g: 'refresh', c: '#80ffff' }, (c) => { c.refresh = true; }, { delay: 5 });

export const SPELLS: readonly SpellDef[] = S;
export const SPELL_BY_ID = new Map(S.map((s) => [s.id, s]));
/** Network index of a spell (both sides run the same mod version). */
export const SPELL_INDEX = new Map(S.map((s, i) => [s.id, i]));
export const spellAt = (i: number) => S[i];

export const TYPE_ORDER: SpellType[] = ['projectile', 'static', 'modifier', 'multicast', 'material', 'other'];
export const TYPE_NAMES: Record<SpellType, string> = {
  projectile: 'Projectile', static: 'Static projectile', modifier: 'Projectile modifier', multicast: 'Multicast', material: 'Material', other: 'Other',
};
/** Card colours by type (frame, background). */
export const TYPE_COLORS: Record<SpellType, [string, string]> = {
  projectile: ['#5a7cf0', '#1a2244'],
  static: ['#e05a4a', '#3a1614'],
  modifier: ['#3fc0aa', '#0f302a'],
  multicast: ['#6cd060', '#16301a'],
  material: ['#c89048', '#33240f'],
  other: ['#b070e0', '#2a1838'],
};
