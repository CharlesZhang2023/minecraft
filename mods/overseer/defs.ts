// Units, buildings, factions and resources: plain data shared by the server and the client (no game classes, so
// the worker realm can load it too).

export type Res = 'food' | 'wood' | 'ore';
export const RES: Res[] = ['food', 'wood', 'ore'];
export type Cost = Partial<Record<Res, number>>;
export type FactionId = 'villagers' | 'monsters';
export const FACTIONS: FactionId[] = ['villagers', 'monsters'];
export const FACTION_NAMES: Record<FactionId, string> = { villagers: 'Villagers', monsters: 'Monsters' };

export const START_RES: Record<Res, number> = { food: 150, wood: 200, ore: 50 };
export const POP_CAP = 100;
/** How much a worker carries before taking it home. */
export const CARRY = 10;

// ------------------------------------------------------------------------------------------------- units
export interface UnitDef {
  id: string;
  name: string;
  faction: FactionId;
  desc: string;
  /** Looks: a model, and a player skin preset (`look`) or a mob skin. */
  model: string;
  look?: string;
  slim?: boolean;
  skin?: string;
  arms?: string;
  /** Held item and worn armour (vanilla item names). */
  held?: string;
  armor?: (string | null)[];
  width: number;
  height: number;
  eye: number;
  hp: number;
  damage: number;
  /** Ticks between attacks. */
  cooldown: number;
  /** Walking speed (a player walks at 0.1). */
  speed: number;
  /** Shoots from this far (arrows); melee when absent. */
  range?: number;
  /** Blows up on reaching its target, this big (and dies). */
  explode?: number;
  /** Gathers, builds and farms. */
  worker?: boolean;
  /** Goes after enemies this close by itself. */
  aggro: number;
  cost: Cost;
  /** Training time, ticks. */
  time: number;
  pop: number;
  sounds?: { say?: string; hurt?: string; death?: string; pitch?: number };
  /** Command-card hotkey (KeyboardEvent.code) when its building is selected. */
  key: string;
}

const u = (d: UnitDef) => d;
export const UNITS: Record<string, UnitDef> = Object.fromEntries([
  u({ id: 'peasant', name: 'Peasant', faction: 'villagers', desc: 'Gathers food, wood and ore, and builds.', model: 'biped', look: 'farmer', slim: true, width: 0.6, height: 1.8, eye: 1.62, hp: 15, damage: 1, cooldown: 20, speed: 0.1, worker: true, aggro: 0, cost: { food: 50 }, time: 200, pop: 1, key: 'KeyQ' }),
  u({ id: 'militia', name: 'Militia', faction: 'villagers', desc: 'Cheap swordsman.', model: 'biped', look: 'steve', held: 'iron_sword', armor: ['leather_helmet', null, null, null], width: 0.6, height: 1.8, eye: 1.62, hp: 30, damage: 4, cooldown: 18, speed: 0.1, aggro: 12, cost: { food: 60, wood: 20, ore: 20 }, time: 300, pop: 1, key: 'KeyQ' }),
  u({ id: 'knight', name: 'Knight', faction: 'villagers', desc: 'Armoured, hits hard.', model: 'biped', look: 'knight', held: 'iron_sword', armor: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'], width: 0.6, height: 1.8, eye: 1.62, hp: 55, damage: 6, cooldown: 20, speed: 0.095, aggro: 12, cost: { food: 80, ore: 80 }, time: 440, pop: 2, key: 'KeyW' }),
  u({ id: 'archer', name: 'Archer', faction: 'villagers', desc: 'Shoots arrows from afar.', model: 'biped', look: 'explorer', slim: true, held: 'bow', arms: 'bow', width: 0.6, height: 1.8, eye: 1.62, hp: 22, damage: 3, cooldown: 30, speed: 0.1, range: 14, aggro: 15, cost: { food: 40, wood: 50 }, time: 300, pop: 1, key: 'KeyQ' }),
  u({ id: 'ghoul', name: 'Ghoul', faction: 'monsters', desc: 'Gathers food, wood and ore, and builds.', model: 'biped', skin: 'zombie', width: 0.6, height: 1.95, eye: 1.74, hp: 15, damage: 1, cooldown: 20, speed: 0.1, worker: true, aggro: 0, cost: { food: 50 }, time: 200, pop: 1, sounds: { hurt: 'zombie.hurt', death: 'zombie.death', pitch: 1.2 }, key: 'KeyQ' }),
  u({ id: 'zombie', name: 'Zombie', faction: 'monsters', desc: 'Slow, tough brawler.', model: 'biped', skin: 'zombie', arms: 'zombie', width: 0.6, height: 1.95, eye: 1.74, hp: 40, damage: 4, cooldown: 24, speed: 0.08, aggro: 12, cost: { food: 60, wood: 20 }, time: 300, pop: 1, sounds: { say: 'zombie.say', hurt: 'zombie.hurt', death: 'zombie.death' }, key: 'KeyQ' }),
  u({ id: 'creeper', name: 'Creeper', faction: 'monsters', desc: 'Walks up to its target and explodes. Wrecks buildings.', model: 'creeper', skin: 'creeper', width: 0.6, height: 1.7, eye: 1.45, hp: 20, damage: 0, cooldown: 30, speed: 0.1, explode: 3, aggro: 10, cost: { food: 50, ore: 60 }, time: 340, pop: 1, sounds: { hurt: 'creeper.hurt', death: 'creeper.hurt' }, key: 'KeyW' }),
  u({ id: 'skeleton', name: 'Skeleton', faction: 'monsters', desc: 'Shoots arrows from afar.', model: 'bipedThin', skin: 'skeleton', held: 'bow', arms: 'bow', width: 0.6, height: 1.99, eye: 1.74, hp: 20, damage: 3, cooldown: 30, speed: 0.1, range: 14, aggro: 15, cost: { food: 40, wood: 50 }, time: 300, pop: 1, sounds: { say: 'skeleton.say', hurt: 'skeleton.hurt', death: 'skeleton.hurt' }, key: 'KeyQ' }),
  u({ id: 'spider', name: 'Spider', faction: 'monsters', desc: 'Fast, climbs walls.', model: 'spider', skin: 'spider', width: 1.4, height: 0.9, eye: 0.65, hp: 26, damage: 3, cooldown: 15, speed: 0.14, aggro: 14, cost: { food: 60, wood: 30 }, time: 300, pop: 1, sounds: { say: 'spider.say', hurt: 'spider.say', death: 'spider.death' }, key: 'KeyW' }),
].map((d) => [d.id, d]));

// ------------------------------------------------------------------------------------------------- buildings
/**
 * A building's shape: layers from the ground up (layer 0 replaces the ground's top block), each a list of rows
 * from north to south (z), each row west to east (x). Letters are blocks of the faction's palette, '.' must be
 * air (cleared when building), ' ' is left alone.
 */
export interface Blueprint { w: number; d: number; h: number; cells: string[] }

export interface BuildingDef {
  id: string;
  names: Record<FactionId, string>;
  desc: string;
  cost: Cost;
  blueprint: Blueprint;
  /** Units it trains, per faction. */
  trains?: Record<FactionId, string[]>;
  /** Workers bring what they gather here. */
  dropoff?: boolean;
  /** Raises the population cap. */
  pop?: number;
  /** Shoots arrows at enemies this close. */
  tower?: number;
  /** A field of crops workers tend. */
  farm?: boolean;
  /** Where units come out: a cell on the footprint's edge (x, z). */
  door: [number, number];
  /** An item that stands for it on buttons. */
  icon: string;
  key: string;
}

/** Builds a blueprint with a few drawing helpers. */
class Shape {
  cells: string[];
  constructor(public w: number, public d: number, public h: number) {
    this.cells = new Array(w * d * h).fill(' ');
  }
  set(x: number, y: number, z: number, c: string) {
    if (x < 0 || z < 0 || y < 0 || x >= this.w || z >= this.d || y >= this.h) return;
    this.cells[(y * this.d + z) * this.w + x] = c;
  }
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, c);
  }
  /** Walls around the rectangle (inside left as air), logs at the corners. */
  walls(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, wall: string, corner: string) {
    this.fill(x0, y0, z0, x1, y1, z1, '.');
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) { this.set(x, y, z0, wall); this.set(x, y, z1, wall); }
      for (let z = z0; z <= z1; z++) { this.set(x0, y, z, wall); this.set(x1, y, z, wall); }
      for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) this.set(x, y, z, corner);
    }
  }
  /** A stepped pyramid roof starting at y over the given rectangle. */
  roof(x0: number, z0: number, x1: number, z1: number, y: number, c: string) {
    while (x0 <= x1 && z0 <= z1) { this.fill(x0, y, z0, x1, y, z1, c); x0++; z0++; x1--; z1--; y++; }
  }
  done(): Blueprint { return { w: this.w, d: this.d, h: this.h, cells: this.cells }; }
}

// Palette letters: F floor, P planks, L logs, C wall stone, S trim stone, G window, R roof, W team-coloured wool,
// T torch, N fence, H hay / target, K shelf, A farmland, Q water, Y crops, X work block
function townCentre(): Blueprint {
  const s = new Shape(9, 9, 11);
  s.fill(0, 0, 0, 8, 0, 8, 'F');
  s.walls(0, 0, 8, 8, 1, 3, 'P', 'L');
  for (const [x, z] of [[4, 0], [0, 4], [8, 4]]) s.set(x, 2, z, 'G');
  s.set(4, 1, 8, '.'); s.set(4, 2, 8, '.');
  s.set(1, 1, 1, 'T'); s.set(7, 1, 1, 'T'); s.set(1, 1, 7, 'X'); s.set(7, 1, 7, 'K');
  s.fill(0, 4, 0, 8, 4, 8, 'S');
  s.roof(1, 1, 7, 7, 5, 'R');
  s.set(4, 9, 4, 'N'); s.set(4, 10, 4, 'W');
  return s.done();
}
function house(): Blueprint {
  const s = new Shape(5, 5, 6);
  s.fill(0, 0, 0, 4, 0, 4, 'F');
  s.walls(0, 0, 4, 4, 1, 2, 'P', 'L');
  s.set(2, 2, 0, 'G'); s.set(0, 2, 2, 'G'); s.set(4, 2, 2, 'G');
  s.set(2, 1, 4, '.'); s.set(2, 2, 4, '.');
  s.set(1, 1, 1, 'T');
  s.roof(0, 0, 4, 4, 3, 'R');
  s.set(2, 5, 2, 'W');
  return s.done();
}
function barracks(): Blueprint {
  const s = new Shape(7, 7, 7);
  s.fill(0, 0, 0, 6, 0, 6, 'F');
  s.walls(0, 0, 6, 6, 1, 3, 'C', 'S');
  for (const [x, z] of [[3, 0], [0, 3], [6, 3]]) s.set(x, 2, z, 'G');
  s.set(3, 1, 6, '.'); s.set(3, 2, 6, '.');
  s.set(1, 1, 1, 'T'); s.set(5, 1, 1, 'X');
  s.fill(0, 4, 0, 6, 4, 6, 'S');
  for (let i = 0; i <= 6; i += 2) { s.set(i, 5, 0, 'C'); s.set(i, 5, 6, 'C'); s.set(0, 5, i, 'C'); s.set(6, 5, i, 'C'); }
  s.set(3, 5, 3, 'N'); s.set(3, 6, 3, 'W');
  return s.done();
}
function range(): Blueprint {
  const s = new Shape(7, 7, 6);
  s.fill(0, 0, 0, 6, 0, 6, 'F');
  s.fill(0, 1, 0, 6, 4, 6, '.');
  for (const [x, z] of [[0, 0], [6, 0], [0, 6], [6, 6]]) s.fill(x, 1, z, x, 3, z, 'L');
  for (let x = 1; x <= 5; x++) { s.set(x, 1, 0, 'N'); }
  s.set(2, 1, 1, 'H'); s.set(2, 2, 1, 'H'); s.set(4, 1, 1, 'H'); s.set(4, 2, 1, 'H');
  s.set(1, 1, 5, 'T');
  s.fill(0, 4, 0, 6, 4, 6, 'P');
  s.set(3, 5, 3, 'W');
  return s.done();
}
function farm(): Blueprint {
  const s = new Shape(9, 9, 2);
  s.fill(0, 0, 0, 8, 0, 8, 'F');
  s.fill(1, 0, 1, 7, 0, 7, 'A');
  s.set(4, 0, 4, 'Q');
  s.fill(0, 1, 0, 8, 1, 8, 'N');
  s.fill(1, 1, 1, 7, 1, 7, 'Y');
  s.set(4, 1, 4, '.');
  s.set(4, 1, 8, '.');
  return s.done();
}
function stockpile(): Blueprint {
  const s = new Shape(3, 3, 3);
  s.fill(0, 0, 0, 2, 0, 2, 'F');
  s.set(0, 1, 0, 'L'); s.set(2, 1, 0, 'H'); s.set(0, 1, 2, 'H'); s.set(2, 1, 2, 'L');
  s.set(1, 1, 1, 'X'); s.set(1, 2, 1, 'W');
  s.set(1, 1, 0, '.'); s.set(0, 1, 1, '.'); s.set(2, 1, 1, '.'); s.set(1, 1, 2, '.');
  return s.done();
}
function tower(): Blueprint {
  const s = new Shape(3, 3, 10);
  s.fill(0, 0, 0, 2, 0, 2, 'F');
  s.walls(0, 0, 2, 2, 1, 6, 'C', 'S');
  s.fill(0, 7, 0, 2, 7, 2, 'S');
  for (const [x, z] of [[0, 0], [2, 0], [0, 2], [2, 2]]) s.set(x, 8, z, 'N');
  s.set(1, 8, 1, '.'); s.set(1, 9, 1, 'W');
  return s.done();
}

const b = (d: BuildingDef) => d;
export const BUILDINGS: Record<string, BuildingDef> = Object.fromEntries([
  b({ id: 'town_centre', names: { villagers: 'Town Hall', monsters: 'Mausoleum' }, desc: 'Trains workers. Workers bring resources here. +10 population.', cost: { wood: 300, ore: 100 }, blueprint: townCentre(), trains: { villagers: ['peasant'], monsters: ['ghoul'] }, dropoff: true, pop: 10, door: [4, 8], icon: 'crafting_table', key: 'KeyT' }),
  b({ id: 'house', names: { villagers: 'House', monsters: 'Haunt' }, desc: '+10 population.', cost: { wood: 75 }, blueprint: house(), pop: 10, door: [2, 4], icon: 'oak_door', key: 'KeyH' }),
  b({ id: 'farm', names: { villagers: 'Farm', monsters: 'Grave Plot' }, desc: 'Crops for workers to tend and harvest (food).', cost: { wood: 60 }, blueprint: farm(), farm: true, door: [4, 8], icon: 'wheat', key: 'KeyF' }),
  b({ id: 'stockpile', names: { villagers: 'Stockpile', monsters: 'Hoard' }, desc: 'Workers bring resources here.', cost: { wood: 50 }, blueprint: stockpile(), dropoff: true, door: [1, 2], icon: 'chest', key: 'KeyP' }),
  b({ id: 'barracks', names: { villagers: 'Barracks', monsters: 'Graveyard' }, desc: 'Trains melee soldiers.', cost: { wood: 150, ore: 25 }, blueprint: barracks(), trains: { villagers: ['militia', 'knight'], monsters: ['zombie', 'creeper'] }, door: [3, 6], icon: 'iron_sword', key: 'KeyB' }),
  b({ id: 'range', names: { villagers: 'Archery Range', monsters: 'Spider Den' }, desc: 'Trains ranged and fast units.', cost: { wood: 140 }, blueprint: range(), trains: { villagers: ['archer'], monsters: ['skeleton', 'spider'] }, door: [3, 6], icon: 'bow', key: 'KeyR' }),
  b({ id: 'tower', names: { villagers: 'Watchtower', monsters: 'Bone Spire' }, desc: 'Shoots arrows at enemies within 16 blocks.', cost: { wood: 75, ore: 75 }, blueprint: tower(), tower: 16, door: [1, 2], icon: 'arrow', key: 'KeyG' }),
].map((d) => [d.id, d]));
export const BUILD_ORDER = ['town_centre', 'house', 'farm', 'stockpile', 'barracks', 'range', 'tower'];

/** Palette letters to vanilla block names, per faction ('W' is the owner's wool colour). */
export const PALETTES: Record<FactionId, Record<string, string>> = {
  villagers: { F: 'cobblestone', P: 'oak_planks', L: 'oak_log', C: 'cobblestone', S: 'stone_bricks', G: 'glass', R: 'spruce_planks', T: 'torch', N: 'oak_fence', H: 'hay_block', K: 'bookshelf', A: 'farmland', Q: 'water', Y: 'wheat', X: 'crafting_table' },
  monsters: { F: 'mossy_cobblestone', P: 'spruce_planks', L: 'spruce_log', C: 'mossy_cobblestone', S: 'nether_bricks', G: 'iron_bars', R: 'nether_bricks', T: 'jack_o_lantern', N: 'nether_brick_fence', H: 'soul_sand', K: 'bookshelf', A: 'farmland', Q: 'water', Y: 'wheat', X: 'pumpkin' },
};

/** Team colours: wool and the HUD colour. */
export const TEAMS = [
  { wool: 'blue_wool', hex: '#3c6cff' }, { wool: 'red_wool', hex: '#e03c3c' }, { wool: 'lime_wool', hex: '#5ad23c' },
  { wool: 'yellow_wool', hex: '#f0d23c' }, { wool: 'purple_wool', hex: '#a050e0' }, { wool: 'orange_wool', hex: '#f08c28' },
  { wool: 'cyan_wool', hex: '#30c0c8' }, { wool: 'pink_wool', hex: '#f08cb4' },
];
/** Raiders (waves of monsters): their own side. */
export const RAIDERS = '#raiders';
export const RAIDER_HEX = '#802020';

export interface Cell { dx: number; dy: number; dz: number; c: string }
/** A blueprint turned by rot quarter turns (clockwise seen from above), as cells relative to the building's corner. */
export function cellsOf(bp: Blueprint, rot: number): Cell[] {
  const out: Cell[] = [];
  const r = ((rot % 4) + 4) % 4;
  for (let y = 0; y < bp.h; y++)
    for (let z = 0; z < bp.d; z++)
      for (let x = 0; x < bp.w; x++) {
        const c = bp.cells[(y * bp.d + z) * bp.w + x];
        if (c === ' ') continue;
        const [dx, dz] = turn(x, z, bp.w, bp.d, r);
        out.push({ dx, dy: y, dz, c });
      }
  return out;
}
/** Where template cell (x, z) lands after rot quarter turns. */
export function turn(x: number, z: number, w: number, d: number, rot: number): [number, number] {
  switch (((rot % 4) + 4) % 4) {
    case 1: return [d - 1 - z, x];
    case 2: return [w - 1 - x, d - 1 - z];
    case 3: return [z, w - 1 - x];
    default: return [x, z];
  }
}
/** The footprint's size after turning. */
export function footprint(bp: Blueprint, rot: number): [number, number] {
  return rot % 2 ? [bp.d, bp.w] : [bp.w, bp.d];
}

export const canAfford = (have: Record<Res, number>, c: Cost) => RES.every((r) => (have[r] ?? 0) >= (c[r] ?? 0));
export const costText = (c: Cost) => RES.filter((r) => c[r]).map((r) => `${c[r]} ${r}`).join(', ');

// ------------------------------------------------------------------------------------------------- resources
/** What a block gives a worker who mines it (by vanilla name), and how long it takes (ticks). */
export function resourceOf(name: string): { res: Res; amount: number; ticks: number } | null {
  if (name.endsWith('_log')) return { res: 'wood', amount: 3, ticks: 18 };
  if (name.endsWith('_ore')) {
    const v: Record<string, number> = { coal_ore: 5, iron_ore: 8, gold_ore: 10, redstone_ore: 6, lit_redstone_ore: 6, lapis_ore: 6, diamond_ore: 20, emerald_ore: 16, nether_quartz_ore: 6 };
    return { res: 'ore', amount: v[name] ?? 5, ticks: 50 };
  }
  if (['stone', 'cobblestone', 'andesite', 'diorite', 'granite', 'mossy_cobblestone', 'sandstone', 'netherrack'].includes(name)) return { res: 'ore', amount: 2, ticks: 40 };
  if (name === 'melon' || name === 'pumpkin') return { res: 'food', amount: 6, ticks: 20 };
  return null;
}
/** Crops a worker harvests (and replants), food per harvest. */
export const CROPS: Record<string, number> = { wheat: 6, carrots: 6, potatoes: 6 };
