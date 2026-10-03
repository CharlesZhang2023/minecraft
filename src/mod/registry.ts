// Mod content registries. Mods register blocks and items under namespaced keys ('computer:computer'); the
// numbers the game stores (chunk data, inventories) are bound per world, like Fabric's registry sync:
// - a world remembers which key got which id (WorldMeta.registry), so adding or reordering mods never shuffles a
//   saved world's blocks;
// - a guest takes the host's numbering before any chunk arrives;
// - every worker (mesher, terrain) is told the same numbering;
// - ids whose mod is gone stay reserved as "missing" placeholders, so the data survives until the mod is back.
// Vanilla ids never move. Mod blocks take ids 2048-4095 (their items share the id); other mod items 4096 and up.
import { BLOCKS, makeBlockDef, setBlockDef, MOD_BLOCK_BASE, Render, TEXTURES, type BlockDef, type BlockOpts } from '../world/blocks';
import { ITEMS, setItemDef, deleteItemDef, MOD_ITEM_BASE, type ItemDef } from '../game/items';
import type { BlockBehavior, ItemBehavior } from './types';
import { isActive, modState } from './state';

/** A registered block. `id` is only meaningful after binding (and can change when another world is opened). */
export interface BlockRef { readonly key: string; readonly id: number; readonly def: BlockDef; readonly item: ItemRef | null }
export interface ItemRef { readonly key: string; readonly id: number; readonly def: ItemDef }

/** Item properties a mod can set (ids are the registry's business). */
export type ItemProps = Partial<Omit<ItemDef, 'id' | 'name' | 'key' | 'mod' | 'behavior' | 'block' | 'missing'>> & {
  display: string;
  /** Places this block (a BlockRef or a block key). */
  places?: BlockRef | string;
};

interface ModBlock { mod: string; def: BlockDef; item: ItemDef | null; ref: BlockRef }
interface ModItem { mod: string; def: ItemDef; places?: BlockRef | string; ref: ItemRef }

const blocks = new Map<string, ModBlock>();
const items = new Map<string, ModItem>();

const KEY = /^[a-z0-9_-]+:[a-z0-9_/.-]+$/;
const checkKey = (key: string) => { if (!KEY.test(key)) throw new Error(`Bad registry key '${key}' (lowercase letters, digits, _ - . / only)`); };

for (const id of ITEMS.keys()) if (id >= MOD_BLOCK_BASE) throw new Error(`vanilla item id ${id} is in the mod range`);
for (const b of BLOCKS) if (b.id >= MOD_BLOCK_BASE) throw new Error(`vanilla block id ${b.id} is in the mod range`);

export function registerBlock(mod: string, name: string, display: string, opts: BlockOpts = {}, behavior?: BlockBehavior, itemProps?: Partial<ItemProps>): BlockRef {
  const key = name.includes(':') ? name : `${mod}:${name}`;
  checkKey(key);
  if (blocks.has(key)) throw new Error(`Block ${key} is already registered`);
  const def = makeBlockDef(-1, key, display, { ...opts, key, mod, behavior });
  let item: ItemDef | null = null;
  if (def.item) {
    const flat = def.render === Render.Cross || def.render === Render.Torch || def.render === Render.Rail;
    item = { id: -1, name: key, display, maxStack: 64, block: -1, flatBlock: flat, key, mod, ...(itemProps ?? {}) } as ItemDef;
    if (def.flammable && def.sound === 'wood' && item.fuel === undefined) item.fuel = 300;
  }
  const itemRef: ItemRef | null = item ? { key, get id() { return item!.id; }, def: item } : null;
  const ref: BlockRef = { key, get id() { return def.id; }, def, item: itemRef };
  blocks.set(key, { mod, def, item, ref });
  return ref;
}

export function registerItem(mod: string, name: string, props: ItemProps, behavior?: ItemBehavior): ItemRef {
  const key = name.includes(':') ? name : `${mod}:${name}`;
  checkKey(key);
  if (items.has(key) || blocks.has(key)) throw new Error(`Item ${key} is already registered`);
  const { places, ...rest } = props;
  const def = { maxStack: 64, sprite: key, ...rest, id: -1, name: key, key, mod, behavior } as ItemDef;
  const ref: ItemRef = { key, get id() { return def.id; }, def };
  items.set(key, { mod, def, places, ref });
  return ref;
}

export const modBlock = (key: string) => blocks.get(key)?.ref;
export const modItem = (key: string) => items.get(key)?.ref ?? blocks.get(key)?.ref.item ?? undefined;
/** Everything a mod registered (for the Mods screen and creative tabs). */
export function contentOf(mod: string) {
  return { blocks: [...blocks.values()].filter((b) => b.mod === mod).map((b) => b.ref), items: [...items.values()].filter((i) => i.mod === mod).map((i) => i.ref) };
}

// ------------------------------------------------------------------ binding
/** Which mod key has which id, as saved with a world and sent to guests. */
export interface RegistryMap { blocks: Record<string, number>; items: Record<string, number> }

let current: RegistryMap = { blocks: {}, items: {} };
/** The numbering in force (what a world saves, what a host sends). */
export const currentMap = (): RegistryMap => ({ blocks: { ...current.blocks }, items: { ...current.items } });
/** Run after every binding (recipes, icon caches, creative tabs rebuild from the new ids). */
export const onBind: (() => void)[] = [];
let generation = 0;
/** Bumps on every binding: caches keyed by ids can check it. */
export const bindGeneration = () => generation;

const placeholders = new Map<string, BlockDef>();
function placeholderBlock(id: number, key?: string): BlockDef {
  const k = id + ':' + (key ?? '');
  let d = placeholders.get(k);
  if (!d) {
    d = makeBlockDef(id, key ?? `unknown_${id}`, key ? `Missing block (${key})` : 'Unknown block', { tex: 'missing', missing: true, item: false, drop: null, hardness: 1 });
    placeholders.set(k, d);
  }
  return d;
}
const missingItem = (id: number, key: string, block: boolean): ItemDef =>
  ({ id, name: key, display: `Missing ${block ? 'block' : 'item'} (${key})`, maxStack: 64, sprite: 'missing', missing: true, key });

/**
 * Give every active mod's blocks and items their ids: the ones `saved` lists keep theirs, new ones take free ids,
 * and saved keys nobody registered become placeholders. Returns the full numbering (to save / send on).
 */
export function bind(saved?: Partial<RegistryMap> | null): RegistryMap {
  const bmap = new Map<string, number>(Object.entries(saved?.blocks ?? {}).filter(([, v]) => Number.isInteger(v) && v >= MOD_BLOCK_BASE && v < 4096));
  const imap = new Map<string, number>(Object.entries(saved?.items ?? {}).filter(([, v]) => Number.isInteger(v) && v >= MOD_ITEM_BASE));
  // blocks
  const usedB = new Set(bmap.values());
  let nextB = MOD_BLOCK_BASE;
  for (let id = MOD_BLOCK_BASE; id < 4096; id++) setBlockDef(id, placeholderBlock(id));
  for (const b of blocks.values()) {
    if (!isActive(b.mod)) { b.def.id = -1; continue; }
    let id = bmap.get(b.def.name);
    if (id === undefined) {
      while (usedB.has(nextB)) nextB++;
      if (nextB >= 4096) throw new Error('Too many mod blocks (2048 at most)');
      id = nextB;
      usedB.add(id);
      bmap.set(b.def.name, id);
    }
    b.def.id = id;
    setBlockDef(id, b.def);
  }
  for (const [key, id] of bmap) if (BLOCKS[id].missing) setBlockDef(id, placeholderBlock(id, key));
  // items: block items share their block's id
  for (const id of [...ITEMS.keys()]) if (id >= MOD_BLOCK_BASE) deleteItemDef(id);
  for (const [key, id] of bmap) {
    const b = blocks.get(key);
    if (b && b.def.id === id) {
      if (b.item) { b.item.id = id; b.item.block = id; setItemDef(b.item); }
    } else setItemDef(missingItem(id, key, true));
  }
  const usedI = new Set(imap.values());
  let nextI = MOD_ITEM_BASE;
  for (const it of items.values()) {
    if (!isActive(it.mod)) { it.def.id = -1; continue; }
    let id = imap.get(it.def.name);
    if (id === undefined) {
      while (usedI.has(nextI)) nextI++;
      id = nextI;
      usedI.add(id);
      imap.set(it.def.name, id);
    }
    it.def.id = id;
    if (it.places !== undefined) {
      const pb = typeof it.places === 'string' ? blocks.get(it.places)?.def : it.places.def;
      it.def.block = pb && pb.id >= 0 ? pb.id : undefined;
    }
    setItemDef(it.def);
  }
  for (const [key, id] of imap) if (!ITEMS.has(id)) setItemDef(missingItem(id, key, false));
  current = { blocks: Object.fromEntries(bmap), items: Object.fromEntries(imap) };
  generation++;
  for (const f of onBind) f();
  return currentMap();
}

/** What a worker needs to number things exactly like this page. */
export interface WorkerRegistry { textures: string[]; blocks: Record<string, number>; active: string[] }
export const workerRegistry = (): WorkerRegistry => ({ textures: TEXTURES.slice(), blocks: { ...current.blocks }, active: [...modState.active] });
