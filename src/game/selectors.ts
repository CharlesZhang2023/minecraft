// Target selectors for commands (vanilla 1.13+): @p nearest player, @a every player, @r a random player, @s whoever
// runs the command, @e every entity; filtered by [type=, name=, distance=, x= y= z=, dx= dy= dz=, limit=, sort=,
// gamemode=, level=] (type, name and gamemode take a leading ! to exclude). A plain name picks that player.
import type { Game } from './game';
import type { Entity } from '../entity/entity';

export interface Pos { x: number; y: number; z: number }

/** Split a command line into words, keeping selector brackets and quoted text together. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '', depth = 0, quote = '';
  for (const ch of line) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '[') depth++;
    if (ch === ']') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export const isSelector = (s: string | undefined): boolean => !!s && /^@[parse](\[.*\])?$/.test(s);

/** The name an entity goes by in command output. */
export function entityName(g: Game, e: Entity): string {
  const sp = g.playerOf(e);
  if (sp) return sp.name;
  const m = e as unknown as { customName?: string; typeName?: string };
  return m.customName || m.typeName || 'Entity';
}
/** An entity's type as selectors name it (player, zombie, item_frame...). */
export function entityType(g: Game, e: Entity): string {
  if (g.playerOf(e) || (e as unknown as { inventory?: unknown; gameMode?: unknown }).gameMode !== undefined) return 'player';
  return ((e as unknown as { typeName?: string }).typeName ?? '').toLowerCase().replace(/ /g, '_');
}

/** `5`, `..5`, `5..` or `1..5`. */
function range(s: string): [number, number] {
  const num = (t: string) => { if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) throw new Error(`Invalid range '${s}'`); return parseFloat(t); };
  const i = s.indexOf('..');
  if (i < 0) { const n = num(s); return [n, n]; }
  const a = s.slice(0, i), b = s.slice(i + 2);
  if (!a && !b) throw new Error(`Invalid range '${s}'`);
  return [a ? num(a) : -Infinity, b ? num(b) : Infinity];
}
const MODES = ['survival', 'creative', 'adventure', 'spectator'];

/**
 * The entities a selector (or a player's name) picks, seen from `origin`; `self` is who runs the command (none for
 * a command block). Throws on a malformed selector.
 */
export function select(g: Game, text: string, origin: Pos, self: Entity | null): Entity[] {
  if (!text.startsWith('@')) {
    const sp = g.players.find((p) => p.name.toLowerCase() === text.toLowerCase());
    return sp ? [sp.entity] : [];
  }
  const m = /^@([parse])(?:\[(.*)\])?$/.exec(text);
  if (!m) throw new Error(`Unknown selector '${text}'`);
  const kind = m[1];
  const opts: [string, string][] = [];
  if (m[2]?.trim()) for (const part of m[2].split(',')) {
    const i = part.indexOf('=');
    if (i < 0) throw new Error(`Expected value for option '${part.trim()}'`);
    opts.push([part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim().replace(/^["'](.*)["']$/, '$1')]);
  }
  const here = g.dimension;
  let list: Entity[];
  if (kind === 's') list = self && !self.removed ? [self] : [];
  else if (kind === 'e') list = [...new Set([...g.entities, ...g.playerEntities()])].filter((e) => !e.removed);
  else list = g.players.filter((sp) => kind === 'a' || sp.dim === here).map((sp) => sp.entity).filter((e) => kind === 'a' || !(e as unknown as { dead?: boolean }).dead);
  // where distances count from
  const base = { ...origin };
  for (const [k, v] of opts) if (k === 'x' || k === 'y' || k === 'z') { const n = parseFloat(v); if (isNaN(n)) throw new Error(`Invalid ${k} '${v}'`); base[k] = n; }
  let limit = kind === 'p' || kind === 'r' ? 1 : Infinity;
  let sort = kind === 'p' ? 'nearest' : kind === 'r' ? 'random' : 'arbitrary';
  const box: Partial<Record<'dx' | 'dy' | 'dz', number>> = {};
  for (const [k, raw] of opts) {
    const neg = raw.startsWith('!'), v = neg ? raw.slice(1) : raw;
    const keep = (f: (e: Entity) => boolean) => { list = list.filter((e) => f(e) !== neg); };
    switch (k) {
      case 'x': case 'y': case 'z': break;
      case 'type': { const t = v.replace(/^minecraft:/, '').toLowerCase(); keep((e) => entityType(g, e) === t); break; }
      case 'name': keep((e) => entityName(g, e) === v); break;
      case 'gamemode': { const gm = MODES.indexOf(v.toLowerCase()); if (gm < 0) throw new Error(`Unknown game mode '${v}'`); keep((e) => (e as unknown as { gameMode?: number }).gameMode === gm); break; }
      case 'level': { const [a, b] = range(v); list = list.filter((e) => { const l = (e as unknown as { xpLevel?: number }).xpLevel; return l !== undefined && l >= a && l <= b; }); break; }
      case 'distance': { const [a, b] = range(v); list = list.filter((e) => { const d = Math.hypot(e.x - base.x, e.y - base.y, e.z - base.z); return d >= a && d <= b; }); break; }
      case 'dx': case 'dy': case 'dz': { const n = parseFloat(v); if (isNaN(n)) throw new Error(`Invalid ${k} '${v}'`); box[k] = n; break; }
      case 'limit': { const n = parseInt(v); if (!(n >= 1)) throw new Error('Limit must be at least 1'); limit = n; break; }
      case 'sort': if (!['nearest', 'furthest', 'random', 'arbitrary'].includes(v)) throw new Error(`Invalid sort '${v}'`); sort = v; break;
      default: throw new Error(`Unknown option '${k}'`);
    }
  }
  if (box.dx !== undefined || box.dy !== undefined || box.dz !== undefined) {
    const lo = (a: number, d = 0) => Math.min(a, a + d), hi = (a: number, d = 0) => Math.max(a, a + d) + 1;
    list = list.filter((e) => e.x >= lo(base.x, box.dx) && e.x < hi(base.x, box.dx) && e.y >= lo(base.y, box.dy) && e.y < hi(base.y, box.dy) && e.z >= lo(base.z, box.dz) && e.z < hi(base.z, box.dz));
  }
  const dist = (e: Entity) => Math.hypot(e.x - base.x, e.y - base.y, e.z - base.z);
  if (sort === 'nearest') list.sort((a, b) => dist(a) - dist(b));
  else if (sort === 'furthest') list.sort((a, b) => dist(b) - dist(a));
  else if (sort === 'random') for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list.slice(0, limit);
}
