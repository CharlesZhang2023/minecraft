// The server's once-a-second look at each player for advancements: what they carry and wear, where they are (dimension,
// biome, which structure: asked of a copy of each dimension's generator on this thread), their effects and mount.
import type { Game } from './game';
import type { ServerPlayer } from '../server/splayer';
import { getItem, ITEMS } from './items';
import { BIOMES } from '../world/biomes';
import { WorldGen } from '../world/worldgen';
import { NetherGen } from '../world/nethergen';
import { EndGen } from '../world/endgen';
import { startsNear, type GenAccess, type StructureType } from '../world/structure';
import { OVERWORLD_STRUCTURES } from '../world/structures/overworld';
import { NETHER_STRUCTURES } from '../world/structures/nether';
import { END_STRUCTURES } from '../world/structures/end';
import { fortressesNear } from '../world/fortress';
import { strongholdSites } from '../world/stronghold';
import { FOODS, OVERWORLD_BIOMES, type ScanCtx } from './advancements';

const OTHER_DIMS = ['Nether Wastes', 'Soul Sand Valley', 'Crimson Forest', 'Warped Forest', 'Basalt Deltas', 'The End', 'Small End Islands', 'End Midlands', 'End Highlands', 'End Barrens'];
/** Rare variants vanilla's "Adventuring Time" doesn't ask for. */
const NOT_NEEDED = ['Sunflower Plains', 'Ice Spikes', 'Gravelly Mountains', 'Flower Forest', 'Tall Birch Forest'];
let filled = false;
function fillLists() {
  if (filled) return;
  filled = true;
  for (const b of BIOMES) if (b && !OTHER_DIMS.includes(b.name) && !NOT_NEEDED.includes(b.name) && !b.dim) OVERWORLD_BIOMES.push(b.name);
  for (const d of ITEMS.values()) if (d.food && !FOODS.includes(d.name)) FOODS.push(d.name);
}

const gens: Record<string, { seed: number; g: GenAccess } | undefined> = {};
function genOf(dim: string, seed: number): GenAccess {
  let e = gens[dim];
  if (!e || e.seed !== seed) e = gens[dim] = { seed, g: dim === 'nether' ? new NetherGen(seed) : dim === 'end' ? new EndGen(seed) : new WorldGen(seed) };
  return e.g;
}
const TYPES: Record<string, StructureType[]> = { overworld: OVERWORLD_STRUCTURES, nether: NETHER_STRUCTURES, end: END_STRUCTURES };

/** The structures whose bounds hold (x, y, z). */
export function structuresAt(dim: string, seed: number, x: number, y: number, z: number): Set<string> {
  const out = new Set<string>();
  const types = TYPES[dim];
  if (!types) return out;
  const cx = Math.floor(x) >> 4, cz = Math.floor(z) >> 4;
  for (const s of startsNear(types, genOf(dim, seed), cx, cz)) {
    const b = s.box;
    if (x >= b.x0 && x <= b.x1 + 1 && z >= b.z0 && z <= b.z1 + 1 && y >= b.y0 - 2 && y <= b.y1 + 3) out.add(s.type);
  }
  if (dim === 'nether') for (const f of fortressesNear(seed, cx, cz)) if (Math.hypot(f.x - x, f.z - z) < 72 && Math.abs(f.y - y) < 30) out.add('fortress');
  if (dim === 'overworld') for (const s of strongholdSites(seed)) if (Math.hypot(s.x - x, s.z - z) < 64 && y < 60) out.add('stronghold');
  return out;
}

export function scanAdvancements(g: Game, sp: ServerPlayer) {
  fillLists();
  const p = sp.entity, inv = p.inventory, a = sp.achievements;
  const items = new Set<string>();
  for (const s of [...inv.main, ...inv.armor, inv.offhand]) if (s) items.add(getItem(s.id).name);
  const effects = new Set(p.effects.keys());
  // levitation: how far up since it began
  if (effects.has('levitation')) a.levitateFrom ??= p.y;
  else a.levitateFrom = null;
  const seed = g.meta?.seed ?? 0;
  const ctx: ScanCtx = {
    dim: sp.dim,
    biome: g.biomeAt(Math.floor(p.x), Math.floor(p.z))?.name ?? '',
    structures: structuresAt(sp.dim, seed, p.x, p.y, p.z),
    items,
    armor: inv.armor.filter((s) => s).map((s) => getItem(s!.id).name),
    effects,
    riding: (p.riding as unknown as { typeName?: string } | null)?.typeName ?? '',
    sleeping: !!p.sleeping,
    levitated: a.levitateFrom === null ? 0 : p.y - a.levitateFrom,
    screen: sp.ui.screen?.constructor?.name ?? '',
  };
  a.scan(ctx);
}
