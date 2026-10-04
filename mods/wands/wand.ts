// Wands as items: what a wand is (its stats and spell slots, kept in the item stack's tag), the tiers you can
// craft, how a fresh wand rolls its stats, and how one reads out in a tooltip or the editor.
import type { ItemStack } from '../sdk';
import { SPELLS, SPELL_BY_ID, type SpellDef } from './spells';

export interface WandStats {
  shuffle: boolean;
  /** Spells drawn per cast. */
  multi: number;
  /** Ticks between casts / after the last spell. */
  delay: number;
  reload: number;
  mana: number;
  /** Mana per second. */
  regen: number;
  cap: number;
  /** Degrees. */
  spread: number;
  /** Projectile speed multiplier. */
  speed: number;
}

export interface WandData {
  /** Random id: the server keeps each wand's mana and deck under it. */
  uid?: string;
  tier: number;
  s: WandStats;
  spells: (string | null)[];
  /** Cast with every cast, for free (found on good wands; set freely in creative). */
  always: string[];
  /** Uses left, per slot, for spells that have limited uses. */
  uses?: (number | null)[];
  /** Spell Lab wands: endless mana and uses. */
  inf?: boolean;
  /** Bumped on every edit (the editor waits for its own edits to come back). */
  rev: number;
}

export const MAX_CAP = 40, MAX_ALWAYS = 4;

/** Wand items, by tier. Tier 5 is the Spell Lab wand (creative). */
export const TIERS = [
  { key: 'wand_apprentice', name: 'Apprentice Wand', rarity: 'common' },
  { key: 'wand_adept', name: 'Adept Wand', rarity: 'uncommon' },
  { key: 'wand_master', name: 'Master Wand', rarity: 'rare' },
  { key: 'wand_archmage', name: 'Archmage Wand', rarity: 'epic' },
  { key: 'wand_starter', name: 'Starter Wand', rarity: 'common' },
  { key: 'wand_lab', name: 'Spell Lab Wand', rarity: 'epic' },
] as const;
export const LAB_TIER = 5, STARTER_TIER = 4;

export const wandOf = (s: ItemStack | null | undefined): WandData | null => (s?.tag?.wand as WandData | undefined) ?? null;
/** A copy of the stack with a new wand in it (stacks are replaced, never changed in place: other copies may share them). */
export const withWand = (s: ItemStack, w: WandData): ItemStack => ({ ...s, tag: { ...(s.tag ?? {}), wand: w } });

export const cloneWand = (w: WandData): WandData => ({ ...w, s: { ...w.s }, spells: [...w.spells], always: [...w.always], uses: w.uses ? [...w.uses] : undefined });

/** The spells of a wand, in slot order, without the gaps. */
export const wandSpells = (w: WandData): SpellDef[] => w.spells.flatMap((id) => (id && SPELL_BY_ID.get(id) ? [SPELL_BY_ID.get(id)!] : []));

/** Make the uses table match the slots: limited spells start full, others have none. */
export function fixUses(w: WandData, old?: WandData | null) {
  const uses: (number | null)[] = [];
  let any = false;
  w.spells.forEach((id, i) => {
    const s = id ? SPELL_BY_ID.get(id) : undefined;
    if (!s?.uses) { uses.push(null); return; }
    any = true;
    // a spell that stayed in its slot keeps what it had left
    const before = old && old.spells[i] === id ? old.uses?.[i] : undefined;
    uses.push(typeof before === 'number' ? Math.min(s.uses, before) : s.uses);
  });
  w.uses = any ? uses : undefined;
}

type Rng = () => number;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const between = (r: Rng, a: number, b: number) => lerp(a, b, r());
const ibetween = (r: Rng, a: number, b: number) => Math.floor(between(r, a, b + 1));
const pick = <T>(r: Rng, list: readonly T[]) => list[Math.floor(r() * list.length)];

/** Ranges per tier (Noita's wands get better the deeper you go). */
const ROLL = [
  { cap: [2, 4], multi: [1, 1], delay: [5, 12], reload: [12, 28], mana: [80, 160], regen: [20, 45], spread: [0, 8], shuffle: 0.7, always: 0, spells: 0.5 },
  { cap: [4, 7], multi: [1, 2], delay: [2, 9], reload: [7, 20], mana: [160, 320], regen: [40, 90], spread: [-2, 5], shuffle: 0.5, always: 0.05, spells: 0.45 },
  { cap: [6, 12], multi: [1, 3], delay: [0, 6], reload: [4, 15], mana: [300, 650], regen: [80, 170], spread: [-4, 3], shuffle: 0.35, always: 0.12, spells: 0.4 },
  { cap: [10, 20], multi: [1, 4], delay: [-2, 4], reload: [0, 10], mana: [600, 1300], regen: [160, 380], spread: [-6, 2], shuffle: 0.2, always: 0.25, spells: 0.35 },
];

/** Spells a wand of this tier could come with. */
export const spellPool = (tier: number, pred: (s: SpellDef) => boolean = () => true) =>
  SPELLS.filter((s) => !s.hidden && s.tier <= tier + 1 && pred(s));

/** A fresh wand of a tier, with stats rolled and (for found or crafted wands) a few spells already in it. */
export function rollWand(tier: number, r: Rng = Math.random, withSpells = true): WandData {
  if (tier === LAB_TIER) return labWand();
  if (tier === STARTER_TIER) return starterWand();
  const R = ROLL[Math.max(0, Math.min(3, tier))];
  const s: WandStats = {
    shuffle: r() < R.shuffle,
    multi: ibetween(r, R.multi[0], R.multi[1]),
    delay: ibetween(r, R.delay[0], R.delay[1]),
    reload: ibetween(r, R.reload[0], R.reload[1]),
    mana: Math.round(between(r, R.mana[0], R.mana[1]) / 5) * 5,
    regen: Math.round(between(r, R.regen[0], R.regen[1])),
    cap: ibetween(r, R.cap[0], R.cap[1]),
    spread: Math.round(between(r, R.spread[0], R.spread[1]) * 10) / 10,
    speed: Math.round(between(r, 0.9, 1.2) * 100) / 100,
  };
  // a multicast wand needs room to show it off
  s.multi = Math.min(s.multi, s.cap);
  const w: WandData = { tier, s, spells: new Array(s.cap).fill(null), always: [], rev: 0 };
  if (r() < R.always) w.always.push(pick(r, spellPool(tier, (x) => x.type === 'modifier' || x.type === 'projectile')).id);
  if (withSpells) {
    // a main projectile, sometimes with a modifier or two in front of it
    // attack spells (not utilities like teleporting or digging), one or two kinds, now and then a modifier
    const projs = spellPool(tier, (x) => x.type === 'projectile' && !x.trigger && (x.uses ?? 99) > 3 && x.mana <= s.mana / 2 && ((x.proj?.dmg ?? 0) > 0 || (x.proj?.explR ?? 0) > 0) && !x.proj?.digHard && !x.tick && !x.hit && !x.touch && !x.proj?.fuse && !x.proj?.selfHit);
    const mods = spellPool(tier, (x) => x.type === 'modifier' && x.mana <= s.mana / 4);
    const fallback = [SPELL_BY_ID.get('spark_bolt')!];
    const kinds = [pick(r, projs.length ? projs : fallback), pick(r, projs.length ? projs : fallback)];
    for (let i = 0; i < s.cap; i++) {
      if (r() > R.spells && i > 0) continue;
      w.spells[i] = r() < 0.25 && mods.length && i < s.cap - 1 ? pick(r, mods).id : kinds[r() < 0.7 ? 0 : 1].id;
    }
  }
  fixUses(w);
  return w;
}

/** Noita's starting wand: a dependable spark bolt shooter. */
export function starterWand(): WandData {
  const w: WandData = {
    tier: STARTER_TIER, rev: 0, always: [],
    s: { shuffle: false, multi: 1, delay: 3, reload: 5, mana: 120, regen: 40, cap: 4, spread: 0, speed: 1 },
    spells: ['spark_bolt', 'spark_bolt', 'bouncing_burst', null],
  };
  fixUses(w);
  return w;
}

/** The Spell Lab wand: room for everything, no waiting, endless mana. */
export function labWand(): WandData {
  return {
    tier: LAB_TIER, rev: 0, always: [], inf: true,
    s: { shuffle: false, multi: 1, delay: 0, reload: 0, mana: 10000, regen: 10000, cap: 26, spread: 0, speed: 1 },
    spells: new Array(26).fill(null),
  };
}

// ------------------------------------------------------------------ reading out
export const secs = (ticks: number) => `${(ticks / 20).toFixed(2)} s`;

/** The stats in the order Noita lists them, as [label, value]. */
export function statLines(w: WandData): [string, string][] {
  const s = w.s;
  return [
    ['Shuffle', s.shuffle ? 'Yes' : 'No'],
    ['Spells/Cast', String(s.multi)],
    ['Cast delay', secs(s.delay)],
    ['Rechrg. Time', secs(s.reload)],
    ['Mana max', w.inf ? 'INF' : String(s.mana)],
    ['Mana chg. Spd', w.inf ? 'INF' : String(s.regen)],
    ['Capacity', String(s.cap)],
    ['Spread', `${s.spread.toFixed(1)} DEG`],
    ['Speed', `x${s.speed.toFixed(2)}`],
  ];
}

export function wandTooltip(w: WandData | null, lines: string[]) {
  if (!w) { lines.push('§7Hold it to attune: its stats are rolled', '§7the first time it\'s used.'); return; }
  for (const [k, v] of statLines(w)) lines.push(`§7${k}: §f${v}`);
  const names = w.spells.map((id) => (id ? SPELL_BY_ID.get(id)?.name ?? id : null));
  const filled = names.filter(Boolean).length;
  lines.push(`§7Spells: §f${filled}/${w.s.cap}`);
  for (const n of names.filter(Boolean).slice(0, 6)) lines.push(`§8 - §b${n}`);
  if (filled > 6) lines.push(`§8 - ...and ${filled - 6} more`);
  if (w.always.length) lines.push(`§7Always casts: §e${w.always.map((id) => SPELL_BY_ID.get(id)?.name ?? id).join(', ')}`);
}

/** Stat limits for the Spell Lab's stat editor (creative). */
export const STAT_LIMITS: Record<keyof WandStats, [number, number, number]> = {
  shuffle: [0, 1, 1], multi: [1, 26, 1], delay: [-20, 200, 1], reload: [-20, 400, 1], mana: [0, 20000, 10], regen: [0, 20000, 10],
  cap: [1, MAX_CAP, 1], spread: [-45, 90, 0.5], speed: [0.1, 5, 0.05],
};

/** Clamp a wand that came over the network (creative edits) to sane values. */
export function sanitize(w: WandData): WandData {
  const s = w.s;
  for (const [k, [lo, hi]] of Object.entries(STAT_LIMITS) as [keyof WandStats, [number, number, number]][]) {
    if (k === 'shuffle') { s.shuffle = !!s.shuffle; continue; }
    const v = Number(s[k]);
    (s as unknown as Record<string, number>)[k] = Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo;
  }
  s.cap = Math.round(s.cap);
  s.multi = Math.round(s.multi);
  w.spells = Array.from({ length: s.cap }, (_, i) => { const id = w.spells[i]; return typeof id === 'string' && SPELL_BY_ID.has(id) && !SPELL_BY_ID.get(id)!.hidden ? id : null; });
  w.always = (Array.isArray(w.always) ? w.always : []).filter((id) => typeof id === 'string' && SPELL_BY_ID.has(id)).slice(0, MAX_ALWAYS);
  return w;
}
