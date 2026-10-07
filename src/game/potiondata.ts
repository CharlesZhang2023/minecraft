// Status effects and potion types (pure data, shared by items, sprites and gameplay).

export interface EffectDef { id: string; name: string; color: number; bad: boolean; instant?: boolean; icon: number }

export const EFFECTS: Record<string, EffectDef> = {
  speed: { id: 'speed', name: 'Speed', color: 0x7cafc6, bad: false, icon: 0 },
  slowness: { id: 'slowness', name: 'Slowness', color: 0x5a6c81, bad: true, icon: 1 },
  haste: { id: 'haste', name: 'Haste', color: 0xd9c043, bad: false, icon: 2 },
  strength: { id: 'strength', name: 'Strength', color: 0x932423, bad: false, icon: 3 },
  instant_health: { id: 'instant_health', name: 'Instant Health', color: 0xf82423, bad: false, instant: true, icon: 4 },
  instant_damage: { id: 'instant_damage', name: 'Instant Damage', color: 0x430a09, bad: true, instant: true, icon: 5 },
  jump_boost: { id: 'jump_boost', name: 'Jump Boost', color: 0x22ff4c, bad: false, icon: 6 },
  regeneration: { id: 'regeneration', name: 'Regeneration', color: 0xcd5cab, bad: false, icon: 7 },
  resistance: { id: 'resistance', name: 'Resistance', color: 0x99453a, bad: false, icon: 8 },
  fire_resistance: { id: 'fire_resistance', name: 'Fire Resistance', color: 0xe49a3a, bad: false, icon: 9 },
  water_breathing: { id: 'water_breathing', name: 'Water Breathing', color: 0x2e5299, bad: false, icon: 10 },
  invisibility: { id: 'invisibility', name: 'Invisibility', color: 0x7f8392, bad: false, icon: 11 },
  night_vision: { id: 'night_vision', name: 'Night Vision', color: 0x1f1fa1, bad: false, icon: 12 },
  hunger: { id: 'hunger', name: 'Hunger', color: 0x587653, bad: true, icon: 13 },
  weakness: { id: 'weakness', name: 'Weakness', color: 0x484d48, bad: true, icon: 14 },
  poison: { id: 'poison', name: 'Poison', color: 0x4e9331, bad: true, icon: 15 },
  absorption: { id: 'absorption', name: 'Absorption', color: 0x2552a5, bad: false, icon: 16 },
  // the rest of vanilla 1.16's effects
  mining_fatigue: { id: 'mining_fatigue', name: 'Mining Fatigue', color: 0x4a4217, bad: true, icon: 17 },
  nausea: { id: 'nausea', name: 'Nausea', color: 0x551d4a, bad: true, icon: 18 },
  blindness: { id: 'blindness', name: 'Blindness', color: 0x1f1f23, bad: true, icon: 19 },
  wither: { id: 'wither', name: 'Wither', color: 0x352a27, bad: true, icon: 20 },
  health_boost: { id: 'health_boost', name: 'Health Boost', color: 0xf87d23, bad: false, icon: 21 },
  saturation: { id: 'saturation', name: 'Saturation', color: 0xf82423, bad: false, instant: true, icon: 22 },
  glowing: { id: 'glowing', name: 'Glowing', color: 0x94a061, bad: false, icon: 23 },
  levitation: { id: 'levitation', name: 'Levitation', color: 0xceffff, bad: true, icon: 24 },
  luck: { id: 'luck', name: 'Luck', color: 0x339900, bad: false, icon: 25 },
  unluck: { id: 'unluck', name: 'Bad Luck', color: 0xc0a44d, bad: true, icon: 26 },
  slow_falling: { id: 'slow_falling', name: 'Slow Falling', color: 0xfffefe, bad: false, icon: 27 },
  conduit_power: { id: 'conduit_power', name: 'Conduit Power', color: 0x1dc2d1, bad: false, icon: 28 },
  dolphins_grace: { id: 'dolphins_grace', name: "Dolphin's Grace", color: 0x88a3be, bad: false, icon: 29 },
  bad_omen: { id: 'bad_omen', name: 'Bad Omen', color: 0x0b6138, bad: false, icon: 30 },
  hero_of_the_village: { id: 'hero_of_the_village', name: 'Hero of the Village', color: 0x44ff44, bad: false, icon: 31 },
};

/** [effect id, duration ticks, amplifier] */
export type EffectSpec = [string, number, number];

export interface PotionType {
  key: string;
  name: string; // display name of the drinkable potion
  effects: EffectSpec[];
  sprite: string; // colour group for the bottle sprite
}

const M = 60 * 20; // one minute in ticks
const S = 20;

export const POTIONS: PotionType[] = [
  { key: 'water', name: 'Water Bottle', effects: [], sprite: 'water' },
  { key: 'mundane', name: 'Mundane Potion', effects: [], sprite: 'water' },
  { key: 'thick', name: 'Thick Potion', effects: [], sprite: 'water' },
  { key: 'awkward', name: 'Awkward Potion', effects: [], sprite: 'water' },
  { key: 'night_vision', name: 'Potion of Night Vision', effects: [['night_vision', 3 * M, 0]], sprite: 'night_vision' },
  { key: 'long_night_vision', name: 'Potion of Night Vision', effects: [['night_vision', 8 * M, 0]], sprite: 'night_vision' },
  { key: 'invisibility', name: 'Potion of Invisibility', effects: [['invisibility', 3 * M, 0]], sprite: 'invisibility' },
  { key: 'long_invisibility', name: 'Potion of Invisibility', effects: [['invisibility', 8 * M, 0]], sprite: 'invisibility' },
  { key: 'fire_resistance', name: 'Potion of Fire Resistance', effects: [['fire_resistance', 3 * M, 0]], sprite: 'fire_resistance' },
  { key: 'long_fire_resistance', name: 'Potion of Fire Resistance', effects: [['fire_resistance', 8 * M, 0]], sprite: 'fire_resistance' },
  { key: 'swiftness', name: 'Potion of Swiftness', effects: [['speed', 3 * M, 0]], sprite: 'swiftness' },
  { key: 'long_swiftness', name: 'Potion of Swiftness', effects: [['speed', 8 * M, 0]], sprite: 'swiftness' },
  { key: 'strong_swiftness', name: 'Potion of Swiftness', effects: [['speed', 90 * S, 1]], sprite: 'swiftness' },
  { key: 'slowness', name: 'Potion of Slowness', effects: [['slowness', 90 * S, 0]], sprite: 'slowness' },
  { key: 'long_slowness', name: 'Potion of Slowness', effects: [['slowness', 4 * M, 0]], sprite: 'slowness' },
  { key: 'water_breathing', name: 'Potion of Water Breathing', effects: [['water_breathing', 3 * M, 0]], sprite: 'water_breathing' },
  { key: 'long_water_breathing', name: 'Potion of Water Breathing', effects: [['water_breathing', 8 * M, 0]], sprite: 'water_breathing' },
  { key: 'healing', name: 'Potion of Healing', effects: [['instant_health', 1, 0]], sprite: 'healing' },
  { key: 'strong_healing', name: 'Potion of Healing', effects: [['instant_health', 1, 1]], sprite: 'healing' },
  { key: 'harming', name: 'Potion of Harming', effects: [['instant_damage', 1, 0]], sprite: 'harming' },
  { key: 'strong_harming', name: 'Potion of Harming', effects: [['instant_damage', 1, 1]], sprite: 'harming' },
  { key: 'poison', name: 'Potion of Poison', effects: [['poison', 45 * S, 0]], sprite: 'poison' },
  { key: 'long_poison', name: 'Potion of Poison', effects: [['poison', 2 * M, 0]], sprite: 'poison' },
  { key: 'strong_poison', name: 'Potion of Poison', effects: [['poison', 22 * S, 1]], sprite: 'poison' },
  { key: 'regeneration', name: 'Potion of Regeneration', effects: [['regeneration', 45 * S, 0]], sprite: 'regeneration' },
  { key: 'long_regeneration', name: 'Potion of Regeneration', effects: [['regeneration', 2 * M, 0]], sprite: 'regeneration' },
  { key: 'strong_regeneration', name: 'Potion of Regeneration', effects: [['regeneration', 22 * S, 1]], sprite: 'regeneration' },
  { key: 'strength', name: 'Potion of Strength', effects: [['strength', 3 * M, 0]], sprite: 'strength' },
  { key: 'long_strength', name: 'Potion of Strength', effects: [['strength', 8 * M, 0]], sprite: 'strength' },
  { key: 'strong_strength', name: 'Potion of Strength', effects: [['strength', 90 * S, 1]], sprite: 'strength' },
  { key: 'weakness', name: 'Potion of Weakness', effects: [['weakness', 90 * S, 0]], sprite: 'weakness' },
  { key: 'long_weakness', name: 'Potion of Weakness', effects: [['weakness', 4 * M, 0]], sprite: 'weakness' },
  { key: 'leaping', name: 'Potion of Leaping', effects: [['jump_boost', 3 * M, 0]], sprite: 'leaping' },
  { key: 'long_leaping', name: 'Potion of Leaping', effects: [['jump_boost', 8 * M, 0]], sprite: 'leaping' },
  { key: 'strong_leaping', name: 'Potion of Leaping', effects: [['jump_boost', 90 * S, 1]], sprite: 'leaping' },
];
export const POTION_BY_KEY = new Map(POTIONS.map((p) => [p.key, p]));

/** Liquid colour: vanilla mixes effect colours weighted by amplifier + 1. */
export function potionColor(effects: EffectSpec[]): number {
  if (!effects.length) return 0x385dc6;
  let r = 0, g = 0, b = 0, n = 0;
  for (const [id, , amp] of effects) {
    const c = EFFECTS[id].color;
    for (let i = 0; i <= amp; i++) { r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; n++; }
  }
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}

/** Distinct bottle sprites (one per colour group). */
export const POTION_SPRITES: Record<string, number> = {};
for (const p of POTIONS) if (!(p.sprite in POTION_SPRITES)) POTION_SPRITES[p.sprite] = potionColor(p.effects);

export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export function formatDuration(ticks: number): string {
  const s = Math.floor(ticks / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** Tooltip line for one effect, e.g. "Speed II (1:30)". */
export function effectLine([id, dur, amp]: EffectSpec, scale = 1): string {
  const e = EFFECTS[id];
  const lvl = amp > 0 ? ' ' + ROMAN[amp + 1] : '';
  return (e.bad ? '§c' : '§9') + e.name + lvl + (e.instant ? '' : ` (${formatDuration(Math.floor(dur * scale))})`);
}
