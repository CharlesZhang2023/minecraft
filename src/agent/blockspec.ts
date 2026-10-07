// Block states in words, for programs driving the game: `stone`, `oak_stairs[facing=east,half=top]`, `oak_log:1`.
// A packed block (id | meta << 12) turns into such a name and back, and turns with a structure that's rotated.
import { B, B2, BLOCKS, idOf, metaOf, pack, blockByName, isStairs, isSlab, isLeaves, isOriented, isPiston, isRepeater, isRail, isPillar, isDoor, isBed, isButton, isTrapdoor, isGate, isDoublePlant, SHAPE, Shape, isCommandBlock, JIGSAW, JIGSAW_ORIENTS, STRUCTURE_BLOCK, STRUCTURE_MODES, waterloggable } from '../world/blocks';

const H4 = ['north', 'east', 'south', 'west'];
const F6 = ['down', 'up', 'north', 'south', 'west', 'east'];
/** FACING6 index of a horizontal direction (HORIZ index), and back. */
const H_TO_F6 = [2, 5, 3, 4];
const F6_TO_H: Record<number, number> = { 2: 0, 5: 1, 3: 2, 4: 3 };

type Family = 'stairs' | 'slab' | 'log' | 'leaves' | 'front' | 'door' | 'bed' | 'torch' | 'switch' | 'ladder' | 'diode' | 'anvil' | 'facing6' | 'hopper' | 'trapdoor' | 'rot16' | 'vine' | 'plant2' | 'jigsaw' | 'structure' | 'none';
/** Jigsaw orientations by name (vanilla's front_top). */
const ORIENT_NAMES = JIGSAW_ORIENTS.map(([f, t]) => `${F6[f]}_${F6[t]}`);
/** Blocks whose meta is a plain number (age, power, level...): the property's name and its largest value. */
const NUMBERED: Record<number, [string, number]> = {
  [B.WHEAT]: ['age', 7], [B.CARROTS]: ['age', 7], [B.POTATOES]: ['age', 7], [B2.BEETROOTS]: ['age', 3], [B.NETHER_WART]: ['age', 3],
  [B2.SWEET_BERRY_BUSH]: ['age', 3], [B.REDSTONE_WIRE]: ['power', 15], [B2.CAULDRON]: ['level', 3], [B2.COMPOSTER]: ['level', 8],
  [B2.RESPAWN_ANCHOR]: ['charges', 4], [B2.CAKE]: ['bites', 6], [B.FARMLAND]: ['moisture', 1],
};

export function familyOf(id: number): Family {
  if (isStairs(id)) return 'stairs';
  if (isSlab(id)) return 'slab';
  if (isPillar(id) || SHAPE[id] === Shape.Chain) return 'log';
  if (isLeaves(id)) return 'leaves';
  if (isOriented(id) || isGate(id) || SHAPE[id] === Shape.Campfire || id === B2.GRINDSTONE || id === B2.BELL || id === B2.LECTERN) return 'front';
  if (isDoor(id)) return 'door';
  if (isBed(id)) return 'bed';
  if (isTrapdoor(id)) return 'trapdoor';
  if (isDoublePlant(id)) return 'plant2';
  if (id === B.TORCH || id === B.REDSTONE_TORCH || id === B.UNLIT_REDSTONE_TORCH || id === B2.SOUL_TORCH) return 'torch';
  if (id === B.LEVER || isButton(id) || SHAPE[id] === Shape.CoralFan) return 'switch';
  if (id === B.LADDER || SHAPE[id] === Shape.WallSign || SHAPE[id] === Shape.WallHead || id === B2.COCOA || id === B2.TRIPWIRE_HOOK) return 'ladder';
  if (SHAPE[id] === Shape.Sign || SHAPE[id] === Shape.Head) return 'rot16';
  if (SHAPE[id] === Shape.Vine) return 'vine';
  if (isRepeater(id) || id === B.COMPARATOR) return 'diode';
  if (id === B.ANVIL) return 'anvil';
  if (isPiston(id) || id === B.DISPENSER || id === B.DROPPER || id === B.OBSERVER || isCommandBlock(id)) return 'facing6';
  if (id === JIGSAW) return 'jigsaw';
  if (id === STRUCTURE_BLOCK) return 'structure';
  if (id === B.HOPPER) return 'hopper';
  return 'none';
}

/** The named properties of a block state (only the ones that have names here; `meta` always works). */
export function stateOf(v: number): Record<string, string> {
  const id = idOf(v), m = metaOf(v);
  const st = familyState(id, m);
  if (NUMBERED[id]) st[NUMBERED[id][0]] = String(m);
  if (isRepeater(id)) st.delay = String(((m >> 2) & 3) + 1);
  if (id === B.COMPARATOR) { st.mode = m & 4 ? 'subtract' : 'compare'; st.powered = m & 8 ? 'true' : 'false'; }
  if (isCommandBlock(id)) st.conditional = m & 8 ? 'true' : 'false';
  if (waterloggable(id) && !st.waterlogged && !(isSlab(id) && (m & 7) === 2)) st.waterlogged = m & 8 ? 'true' : 'false';
  return st;
}
function familyState(id: number, m: number): Record<string, string> {
  switch (familyOf(id)) {
    case 'jigsaw': return { orientation: ORIENT_NAMES[m] ?? ORIENT_NAMES[10] };
    case 'structure': return { mode: STRUCTURE_MODES[m & 3] };
    case 'stairs': return { facing: H4[m & 3], half: m & 4 ? 'top' : 'bottom', ...(m & 8 ? { waterlogged: 'true' } : {}) };
    case 'trapdoor': return { facing: H4[m & 3], half: m & 4 ? 'top' : 'bottom', open: m & 8 ? 'true' : 'false' };
    case 'rot16': return { rotation: String(m) };
    case 'slab': return { half: m & 1 ? 'top' : 'bottom' };
    case 'log': return { axis: ['y', 'x', 'z'][m] ?? 'y' };
    case 'leaves': return { persistent: m & 1 ? 'true' : 'false' };
    case 'front': case 'diode': return { facing: H4[m & 3] };
    case 'anvil': return { facing: H4[(m + 3) & 3] };
    case 'door': return { facing: H4[m & 3], half: m & 8 ? 'upper' : 'lower', open: m & 4 ? 'true' : 'false' };
    case 'bed': return { facing: H4[m & 3], part: m & 8 ? 'head' : 'foot' };
    // wall-mounted things point away from the wall they hang on (meta - 1 is the wall's direction)
    case 'torch': return { facing: (m & 7) === 0 ? 'up' : H4[((m & 7) - 1 + 2) & 3] };
    case 'switch': return { facing: (m & 7) === 0 ? 'up' : H4[((m & 7) - 1 + 2) & 3], powered: m & 8 ? 'true' : 'false' };
    case 'ladder': return { facing: H4[(m + 2) & 3] };
    case 'facing6': case 'hopper': return { facing: F6[m & 7] ?? 'down' };
    default: return {};
  }
}

/** Change named properties (unknown ones are an error naming the ones that exist). */
function applyState(id: number, meta: number, props: Record<string, string>): number {
  const fam = familyOf(id);
  const bad = (k: string, v: string) => new Error(`${BLOCKS[id].name} has no ${k}=${v}${Object.keys(stateOf(pack(id))).length ? ` (it has: ${Object.entries(stateOf(pack(id, meta))).map(([a, b]) => `${a}=${b}`).join(', ')})` : ' (no named properties; use name:meta)'}`);
  for (const [k, raw] of Object.entries(props)) {
    const v = raw.toLowerCase();
    const h = H4.indexOf(v);
    if (k === 'meta') { meta = (parseInt(v) || 0) & 15; continue; }
    if (k === 'facing') {
      if (fam === 'stairs' || fam === 'front' || fam === 'diode' || fam === 'door' || fam === 'bed') { if (h < 0) throw bad(k, v); meta = (meta & ~3) | h; }
      else if (fam === 'anvil') { if (h < 0) throw bad(k, v); meta = (h + 1) & 3; }
      else if (fam === 'torch' || fam === 'switch') {
        if (v === 'up') meta = meta & 8;
        else { if (h < 0) throw bad(k, v); meta = (meta & 8) | (((h + 2) & 3) + 1); }
      } else if (fam === 'ladder') { if (h < 0) throw bad(k, v); meta = (h + 2) & 3; }
      else if (fam === 'facing6' || fam === 'hopper') { const f = F6.indexOf(v); if (f < 0 || (fam === 'hopper' && f === 1)) throw bad(k, v); meta = (meta & 8) | f; }
      else throw bad(k, v);
    } else if (k === 'half') {
      if (fam === 'stairs' && (v === 'top' || v === 'bottom')) meta = (meta & ~4) | (v === 'top' ? 4 : 0);
      else if (fam === 'slab' && (v === 'top' || v === 'bottom')) meta = v === 'top' ? 1 : 0;
      else if (fam === 'door' && (v === 'upper' || v === 'lower')) meta = (meta & ~8) | (v === 'upper' ? 8 : 0);
      else throw bad(k, v);
    } else if (k === 'axis' && fam === 'log') { const a = ['y', 'x', 'z'].indexOf(v); if (a < 0) throw bad(k, v); meta = a; }
    else if (k === 'open' && fam === 'door') meta = (meta & ~4) | (v === 'true' ? 4 : 0);
    else if (k === 'part' && fam === 'bed') meta = (meta & ~8) | (v === 'head' ? 8 : 0);
    else if (k === 'powered' && fam === 'switch') meta = (meta & ~8) | (v === 'true' ? 8 : 0);
    else if (k === 'persistent' && fam === 'leaves') meta = v === 'true' ? 1 : 0;
    else if (k === 'orientation' && fam === 'jigsaw') { const o = ORIENT_NAMES.indexOf(v); if (o < 0) throw bad(k, v); meta = o; }
    else if (k === 'mode' && fam === 'structure') { const o = (STRUCTURE_MODES as readonly string[]).indexOf(v); if (o < 0) throw bad(k, v); meta = o; }
    else if (NUMBERED[id] && k === NUMBERED[id][0]) { const n = parseInt(v); if (!(n >= 0 && n <= NUMBERED[id][1])) throw bad(k, v); meta = n; }
    else if (k === 'delay' && isRepeater(id)) { const n = parseInt(v); if (!(n >= 1 && n <= 4)) throw bad(k, v); meta = (meta & ~12) | ((n - 1) << 2); }
    else if (k === 'mode' && id === B.COMPARATOR && (v === 'compare' || v === 'subtract')) meta = (meta & ~4) | (v === 'subtract' ? 4 : 0);
    else if (k === 'powered' && id === B.COMPARATOR) meta = (meta & ~8) | (v === 'true' ? 8 : 0);
    else if (k === 'conditional' && isCommandBlock(id)) meta = (meta & ~8) | (v === 'true' ? 8 : 0);
    else if (k === 'waterlogged' && waterloggable(id)) meta = (meta & ~8) | (v === 'true' ? 8 : 0);
    else throw bad(k, v);
  }
  return meta & 15;
}

const cache = new Map<string, number>();

/** Closest block names to a misspelt one (for error messages). */
export function suggest(name: string, n = 5): string[] {
  const q = name.toLowerCase();
  const names = BLOCKS.filter((b) => b && !b.missing && b.name !== 'unused_1').map((b) => b.name);
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0];
      d[0] = i;
      for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
    }
    return d[b.length];
  };
  return names.map((s) => [s, dist(q, s) * (s.includes(q) || q.includes(s) ? 0.5 : 1)] as const).sort((a, b) => a[1] - b[1]).slice(0, n).map((x) => x[0]);
}

/**
 * A block from a name: `stone`, `minecraft:stone`, `Stone Bricks`, `oak_log:1` (raw meta), `oak_stairs[facing=east]`,
 * `air`. Leaves put by tools don't decay unless asked (`[persistent=false]`).
 */
export function parseBlock(spec: string | number): number {
  if (typeof spec === 'number') return spec;
  const key = spec.trim();
  const hit = cache.get(key);
  if (hit !== undefined && BLOCKS[idOf(hit)]?.name) return hit;
  const m = /^([a-z0-9_:. -]+?)(?::(\d+))?(?:\[([^\]]*)\])?$/i.exec(key);
  if (!m) throw new Error(`Can't read block '${spec}' (try e.g. stone, oak_log:1, oak_stairs[facing=east,half=top])`);
  let name = m[1].trim().toLowerCase().replace(/^minecraft:/, '');
  let def = blockByName(name) ?? blockByName(name.replace(/[ -]/g, '_'));
  if (!def) def = BLOCKS.find((b) => b && !b.missing && b.display.toLowerCase() === name);
  if (!def || def.missing || def.name === 'unused_1') throw new Error(`Unknown block '${m[1]}'. Did you mean: ${suggest(name).join(', ')}?`);
  name = def.name;
  let meta = m[2] !== undefined ? parseInt(m[2]) & 15 : isLeaves(def.id) ? 1 : 0;
  if (m[3]) {
    const props: Record<string, string> = {};
    for (const part of m[3].split(',')) {
      if (!part.trim()) continue;
      const [k, v] = part.split('=').map((s) => s.trim());
      if (!k || v === undefined) throw new Error(`Bad property '${part}' in '${spec}'`);
      props[k.toLowerCase()] = v;
    }
    meta = applyState(def.id, meta, props);
  }
  const v = pack(def.id, meta);
  cache.set(key, v);
  return v;
}

/** The shortest name that gives back exactly this block: `stone`, `oak_stairs[facing=east,half=top]` or `x:5`. */
export function formatBlock(v: number): string {
  const id = idOf(v), m = metaOf(v);
  const def = BLOCKS[id];
  const name = def?.name ?? `#${id}`;
  if (m === 0 && !isLeaves(id)) return name;
  if (isLeaves(id) && m === 1) return name;
  const st = stateOf(v);
  const keys = Object.keys(st);
  if (keys.length) {
    // name the properties that differ from the default state; fall back to raw meta if they don't say everything
    let base = 0;
    if (isLeaves(id)) base = 1;
    const def0 = stateOf(pack(id, base));
    const diff = keys.filter((k) => st[k] !== def0[k]);
    const s = diff.length ? `${name}[${diff.map((k) => `${k}=${st[k]}`).join(',')}]` : name;
    try { if (parseBlock(s) === v) return s; } catch { /* raw meta below */ }
  }
  return `${name}:${m}`;
}

/** The same block turned `q` quarter turns clockwise (seen from above). */
export function rotateBlock(v: number, q: number): number {
  q = ((q % 4) + 4) % 4;
  if (!q) return v;
  const id = idOf(v), m = metaOf(v);
  const turn = (h: number) => (h + q) & 3;
  switch (familyOf(id)) {
    case 'stairs': case 'front': case 'diode': case 'door': case 'bed': case 'trapdoor': return pack(id, (m & ~3) | turn(m & 3));
    case 'anvil': return pack(id, turn(m));
    case 'ladder': return pack(id, (m & ~3) | turn(m & 3));
    case 'rot16': return pack(id, (m + q * 4) & 15);
    case 'vine': { let o = 0; for (let d = 0; d < 4; d++) if (m & (1 << d)) o |= 1 << turn(d); return pack(id, o); }
    case 'log': return q & 1 && (m & 7) !== 0 ? pack(id, (m & 8) | ((m & 7) === 1 ? 2 : 1)) : v;
    case 'torch': case 'switch': { const a = m & 7; return a === 0 ? v : pack(id, (m & 8) | (turn(a - 1) + 1)); }
    case 'facing6': case 'hopper': { const f = m & 7, h = F6_TO_H[f]; return h === undefined ? v : pack(id, (m & 8) | H_TO_F6[turn(h)]); }
    case 'jigsaw': return pack(id, jigsawMap(m, (f) => { const h = F6_TO_H[f]; return h === undefined ? f : H_TO_F6[turn(h)]; }));
    default: return isRail(id) && q & 1 && m < 2 ? pack(id, m ^ 1) : v;
  }
}

/** A jigsaw orientation with both its directions (FACING6 indices) mapped through f. */
function jigsawMap(m: number, f: (d: number) => number): number {
  const [fr, top] = JIGSAW_ORIENTS[m] ?? JIGSAW_ORIENTS[10];
  const a = f(fr), b = f(top);
  const i = JIGSAW_ORIENTS.findIndex(([x, y]) => x === a && y === b);
  return i < 0 ? m : i;
}

/**
 * The same block mirrored: 'z' flips north and south (vanilla's LEFT_RIGHT), 'x' flips east and west (FRONT_BACK).
 */
export function mirrorBlock(v: number, axis: 'x' | 'z' | null): number {
  if (!axis) return v;
  const id = idOf(v), m = metaOf(v);
  const mh = (h: number) => (axis === 'z' ? ((h & 1) === 0 ? h ^ 2 : h) : (h & 1 ? h ^ 2 : h));
  const m6 = (f: number) => { const h = F6_TO_H[f]; return h === undefined ? f : H_TO_F6[mh(h)]; };
  switch (familyOf(id)) {
    case 'stairs': case 'front': case 'diode': case 'door': case 'bed': case 'trapdoor': case 'ladder': return pack(id, (m & ~3) | mh(m & 3));
    case 'anvil': return pack(id, (mh((m + 3) & 3) + 1) & 3);
    case 'rot16': return pack(id, (axis === 'z' ? 8 - m + 16 : 16 - m) & 15);
    case 'vine': { let o = 0; for (let d = 0; d < 4; d++) if (m & (1 << d)) o |= 1 << mh(d); return pack(id, o); }
    case 'torch': case 'switch': { const a = m & 7; return a === 0 ? v : pack(id, (m & 8) | (mh(a - 1) + 1)); }
    case 'facing6': case 'hopper': return pack(id, (m & 8) | m6(m & 7));
    case 'jigsaw': return pack(id, jigsawMap(m, m6));
    default: return v;
  }
}

/**
 * Every value each named property of a block can take (what the debug stick cycles through), in a stable order;
 * only values that give back a state with that value are kept.
 */
export function stateValues(id: number): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const seen: Record<string, Set<string>> = {};
  const metas = id === B2.CAULDRON ? [0, 1, 2, 3] : Array.from({ length: 16 }, (_, i) => i);
  for (const m of metas) for (const [k, val] of Object.entries(stateOf(pack(id, m)))) (seen[k] ??= new Set()).add(val);
  const ORDER = ['north', 'east', 'south', 'west', 'up', 'down', 'false', 'true', 'bottom', 'top', 'lower', 'upper', 'foot', 'head', 'x', 'y', 'z'];
  for (const [k, vals] of Object.entries(seen)) {
    const list = [...vals].sort((a, b) => {
      const na = Number(a), nb = Number(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    out[k] = list;
  }
  return out;
}

/** Set one property (null if the block can't take that value). */
export function withState(v: number, key: string, value: string): number | null {
  const id = idOf(v);
  try {
    const n = pack(id, applyState(id, metaOf(v), { [key]: value }));
    return stateOf(n)[key] === value ? n : null;
  } catch { return null; }
}

/** Blocks made of two halves (doors, beds): the other half's offset and block, for a lower/foot half. */
export function partnerOf(v: number): [number, number, number, number] | null {
  const id = idOf(v), m = metaOf(v);
  if ((isDoor(id) || isDoublePlant(id)) && !(m & 8)) return [0, 1, 0, pack(id, (m & 7) | 8)];
  if (isBed(id) && !(m & 8)) {
    const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][m & 3];
    return [d[0], 0, d[1], pack(id, (m & 3) | 8)];
  }
  return null;
}

// ------------------------------------------------------------------ palettes of single characters
const PREFERRED: Record<string, string> = { air: '.', water: '~', lava: '%', grass: ',', dirt: 'd', stone: '#', sand: ':', glass: '+', bedrock: '=' };
const POOL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$&*+=-:;!?^<>/\\|()[]{}\'"`_';

/** Gives each block a character (its initial if free) so a region or map can be printed as text. */
export class Palette {
  chars = new Map<number, string>();
  used = new Set<string>();
  /** `null` once the characters run out. */
  charFor(v: number, key = v): string | null {
    const c = this.chars.get(key);
    if (c) return c;
    const name = BLOCKS[idOf(v)]?.name ?? '?';
    const short = name.replace(/^.*:/, '');
    const tries = [PREFERRED[short], ...short.split('_').map((w) => w[0]), short[0]?.toUpperCase(), ...short.split('_').map((w) => w[0]?.toUpperCase()), ...short]
      .filter((x): x is string => !!x && x !== ' ' && x !== '.' || (x === '.' && short === 'air'));
    let pick = tries.find((x) => !this.used.has(x));
    if (!pick) pick = [...POOL].find((x) => !this.used.has(x));
    if (!pick) return null;
    this.used.add(pick);
    this.chars.set(key, pick);
    return pick;
  }
  legend(fmt: (key: number) => string = formatBlock): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, c] of this.chars) out[c] = fmt(k);
    return out;
  }
}
