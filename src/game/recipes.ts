// Crafting & smelting recipes.
import { B, WOOL_COLORS, blockByName } from '../world/blocks';
import { I, I2, I3, I4, I5, I6, I7, I11, TOOLS, ARMOR, ItemStack, stack, getItem, dyeColor, FireworkExplosion, itemByName } from './items';
import { ITEM_TAGS } from './tags';
import { registerRecipes116, type Smelt } from './recipes2';
export { STONECUTTING, SMITHING } from './recipes2';

interface Shaped { pattern: string[]; key: Record<string, number | number[]>; out: ItemStack }
interface Shapeless { ingredients: (number | number[])[]; out: ItemStack }

const shaped: Shaped[] = [];
const shapeless: Shapeless[] = [];
const S = (pattern: string[], key: Record<string, number | number[]>, id: number, count = 1) => shaped.push({ pattern, key, out: stack(id, count) });
const L = (ingredients: (number | number[])[], id: number, count = 1) => shapeless.push({ ingredients, out: stack(id, count) });

// every wood's planks and logs, and blackstone where cobblestone goes (tags.ts)
const PLANKS = ITEM_TAGS.planks;
const LOGS = ITEM_TAGS.logs;
const STONEISH = ITEM_TAGS.stone_crafting_materials;
const COAL = [I.COAL, I.CHARCOAL];

// basic materials
L([B.OAK_LOG], B.OAK_PLANKS, 4);
L([B.SPRUCE_LOG], B.SPRUCE_PLANKS, 4);
L([B.BIRCH_LOG], B.BIRCH_PLANKS, 4);
S(['#', '#'], { '#': PLANKS }, I.STICK, 4);
S(['##', '##'], { '#': PLANKS }, B.CRAFTING_TABLE);
S(['###', '# #', '###'], { '#': STONEISH }, B.FURNACE);
S(['###', '# #', '###'], { '#': PLANKS }, B.CHEST);
S(['C', 'S'], { C: COAL, S: I.STICK }, B.TORCH, 4);
S(['# #', '###', '# #'], { '#': I.STICK }, B.LADDER, 3);
S(['##', '##', '##'], { '#': B.OAK_PLANKS }, I.OAK_DOOR, 3);
S(['#S#', '#S#'], { '#': B.OAK_PLANKS, S: I.STICK }, B.OAK_FENCE, 3);
S(['###'], { '#': B.OAK_PLANKS }, B.OAK_SLAB, 6);
S(['###'], { '#': [B.STONE, B.DOUBLE_STONE_SLAB] }, B.STONE_SLAB, 6);
S(['###'], { '#': B.COBBLESTONE }, B.COBBLESTONE_SLAB, 6);
S(['#  ', '## ', '###'], { '#': B.OAK_PLANKS }, B.OAK_STAIRS, 4);
S(['#  ', '## ', '###'], { '#': B.SPRUCE_PLANKS }, B.SPRUCE_STAIRS, 4);
S(['#  ', '## ', '###'], { '#': B.BIRCH_PLANKS }, B.BIRCH_STAIRS, 4);
S(['#  ', '## ', '###'], { '#': B.COBBLESTONE }, B.COBBLESTONE_STAIRS, 4);
S(['#  ', '## ', '###'], { '#': B.STONE_BRICKS }, B.STONE_BRICK_STAIRS, 4);
S(['#  ', '## ', '###'], { '#': B.BRICKS }, B.BRICK_STAIRS, 4);
S(['##', '##'], { '#': B.STONE }, B.STONE_BRICKS, 4);
S(['##', '##'], { '#': I.BRICK }, B.BRICKS);
S(['##', '##'], { '#': B.SAND }, B.SANDSTONE);
S(['##', '##'], { '#': B.SANDSTONE }, B.SMOOTH_SANDSTONE, 4);
S(['##', '##'], { '#': I.SNOWBALL }, B.SNOW_BLOCK);
S(['##', '##'], { '#': I.CLAY_BALL }, B.CLAY);
S(['##', '##'], { '#': I.GLOWSTONE_DUST }, B.GLOWSTONE);
S(['##', '##'], { '#': I.STRING }, B.WOOL_WHITE);
S(['###'], { '#': B.SNOW_BLOCK }, B.SNOW, 6);
S(['###', '###'], { '#': B.GLASS }, B.GLASS_PANE, 16);
S(['###', '###', '###'], { '#': I.IRON_INGOT }, B.IRON_BLOCK);
S(['###', '###', '###'], { '#': I.GOLD_INGOT }, B.GOLD_BLOCK);
S(['###', '###', '###'], { '#': I.DIAMOND }, B.DIAMOND_BLOCK);
S(['###', '###', '###'], { '#': I.COAL }, B.COAL_BLOCK);
S(['###', '###', '###'], { '#': I.LAPIS }, B.LAPIS_BLOCK);
L([B.IRON_BLOCK], I.IRON_INGOT, 9);
L([B.GOLD_BLOCK], I.GOLD_INGOT, 9);
L([B.DIAMOND_BLOCK], I.DIAMOND, 9);
L([B.COAL_BLOCK], I.COAL, 9);
L([B.LAPIS_BLOCK], I.LAPIS, 9);
S(['###', 'XXX', '###'], { '#': PLANKS, X: I.BOOK }, B.BOOKSHELF);
S(['X#X', '#X#', 'X#X'], { '#': [B.SAND], X: I.GUNPOWDER }, B.TNT);
S(['A', 'B'], { A: B.PUMPKIN, B: B.TORCH }, B.JACK_O_LANTERN);
L([B.COBBLESTONE, B.STONE], B.MOSSY_COBBLESTONE); // simplified (vines absent)

// tools
const toolMats: [string, number[]][] = [['wooden', PLANKS], ['stone', STONEISH], ['iron', [I.IRON_INGOT]], ['golden', [I.GOLD_INGOT]], ['diamond', [I.DIAMOND]]];
for (const [m, mat] of toolMats) {
  S(['XXX', ' # ', ' # '], { X: mat, '#': I.STICK }, TOOLS[m + '_pickaxe']);
  S(['XX', 'X#', ' #'], { X: mat, '#': I.STICK }, TOOLS[m + '_axe']);
  S(['X', '#', '#'], { X: mat, '#': I.STICK }, TOOLS[m + '_shovel']);
  S(['XX', ' #', ' #'], { X: mat, '#': I.STICK }, TOOLS[m + '_hoe']);
  S(['X', 'X', '#'], { X: mat, '#': I.STICK }, TOOLS[m + '_sword']);
}
const armorMats: [string, number][] = [['leather', I.LEATHER], ['iron', I.IRON_INGOT], ['golden', I.GOLD_INGOT], ['diamond', I.DIAMOND]];
for (const [m, mat] of armorMats) {
  S(['XXX', 'X X'], { X: mat }, ARMOR[m + '_helmet']);
  S(['X X', 'XXX', 'XXX'], { X: mat }, ARMOR[m + '_chestplate']);
  S(['XXX', 'X X', 'X X'], { X: mat }, ARMOR[m + '_leggings']);
  S(['X X', 'X X'], { X: mat }, ARMOR[m + '_boots']);
}
S([' #X', '# X', ' #X'], { '#': I.STICK, X: I.STRING }, I.BOW);
S(['X', '#', 'Y'], { X: I.FLINT, '#': I.STICK, Y: I.FEATHER }, I.ARROW, 4);
S(['# #', ' # '], { '#': I.IRON_INGOT }, I.BUCKET);
L([I.IRON_INGOT, I.FLINT], I.FLINT_AND_STEEL);
S([' #', '# '], { '#': I.IRON_INGOT }, I.SHEARS);
S(['# #', ' # '], { '#': PLANKS }, I.BOWL, 4);
S(['# #', '###'], { '#': B.OAK_PLANKS }, I2.BOAT);
S(['R', 'S'], { R: I.REDSTONE, S: I.STICK }, B.REDSTONE_TORCH);
S(['  #', ' #S', '# S'], { '#': I.STICK, S: I.STRING }, I2.FISHING_ROD);
S(['S', 'C'], { S: I.STICK, C: B.COBBLESTONE }, B.LEVER);
L([B.STONE], B.STONE_BUTTON);
S(['##'], { '#': B.STONE }, B.STONE_PRESSURE_PLATE);
S([' R ', 'RGR', ' R '], { R: I.REDSTONE, G: B.GLOWSTONE }, B.REDSTONE_LAMP);
S(['###', '###', '###'], { '#': I.REDSTONE }, B.REDSTONE_BLOCK);
L([B.REDSTONE_BLOCK], I.REDSTONE, 9);
S([' B ', 'DOD', 'OOO'], { B: I.BOOK, D: I.DIAMOND, O: B.OBSIDIAN }, B.ENCHANTING_TABLE);
S([' # ', '#R#', ' # '], { '#': I.IRON_INGOT, R: I.REDSTONE }, I.COMPASS);
S([' # ', '#R#', ' # '], { '#': I.GOLD_INGOT, R: I.REDSTONE }, I.CLOCK);
S(['###', 'XXX'], { '#': [WOOL_COLORS[0], ...WOOL_COLORS], X: PLANKS }, I.RED_BED);

// food
S(['###'], { '#': I.WHEAT }, I.BREAD);
L([B.BROWN_MUSHROOM, B.RED_MUSHROOM, I.BOWL], I.MUSHROOM_STEW);
S(['###', '#A#', '###'], { '#': I.GOLD_INGOT, A: I.APPLE }, I.GOLDEN_APPLE);
L([I.SUGAR_CANE], I.SUGAR);
S(['###'], { '#': I.SUGAR_CANE }, I.PAPER, 3);
L([I.PAPER, I.PAPER, I.PAPER, I.LEATHER], I.BOOK);
L([I.BONE], I.BONE_MEAL, 3);
L([B.PUMPKIN], I.PUMPKIN_SEEDS, 4);
S(['#C#'], { '#': I.WHEAT, C: I.COCOA }, I.COOKIE, 8);
S(['###', '###', '###'], { '#': I.MELON_SLICE }, B.MELON);

// dyes → wool colours (simplified: bone meal whitens, lapis blue, etc.)
L([B.WOOL_WHITE, I.LAPIS], B.WOOL_BLUE);
L([B.WOOL_WHITE, I.REDSTONE], B.WOOL_RED);
L([B.WOOL_WHITE, B.DANDELION], B.WOOL_YELLOW);
L([B.WOOL_WHITE, B.POPPY], B.WOOL_RED);
L([B.WOOL_WHITE, B.CORNFLOWER], B.WOOL_BLUE);
L([B.WOOL_WHITE, B.ALLIUM], B.WOOL_MAGENTA);
L([B.WOOL_WHITE, B.OXEYE_DAISY], B.WOOL_LIGHT_GRAY);
L([B.WOOL_WHITE, B.CACTUS], B.WOOL_GREEN);
L([B.WOOL_WHITE, I.COCOA], B.WOOL_BROWN);
L([B.WOOL_WHITE, I.COAL], B.WOOL_BLACK);
L([[B.WOOL_BLACK, B.WOOL_GRAY, B.WOOL_BROWN, B.WOOL_BLUE, B.WOOL_RED], I.BONE_MEAL], B.WOOL_WHITE);
L([B.WOOL_RED, B.WOOL_WHITE], B.WOOL_PINK, 2);
L([B.WOOL_RED, B.WOOL_YELLOW], B.WOOL_ORANGE, 2);
L([B.WOOL_BLUE, B.WOOL_WHITE], B.WOOL_LIGHT_BLUE, 2);
L([B.WOOL_GREEN, B.WOOL_WHITE], B.WOOL_LIME, 2);
L([B.WOOL_BLACK, B.WOOL_WHITE], B.WOOL_GRAY, 2);
L([B.WOOL_BLUE, B.WOOL_GREEN], B.WOOL_CYAN, 2);
L([B.WOOL_BLUE, B.WOOL_RED], B.WOOL_PURPLE, 2);
void LOGS;

/** A recipe laid out as the grid cells it needs (row-major, `w` wide): what the recipe book shows and fills. */
export interface FlatRecipe { w: number; h: number; cells: (number | number[] | undefined)[]; out: ItemStack }
let flat: FlatRecipe[] | null = null;
export function recipeList(): FlatRecipe[] {
  if (flat) return flat;
  flat = [];
  for (const r of shaped) {
    const w = Math.max(...r.pattern.map((p) => p.length)), h = r.pattern.length;
    const cells: FlatRecipe['cells'] = [];
    for (const row of r.pattern) for (let x = 0; x < w; x++) { const ch = row[x] ?? ' '; cells.push(ch === ' ' ? undefined : r.key[ch]); }
    flat.push({ w, h, cells, out: r.out });
  }
  for (const r of shapeless) {
    const n = r.ingredients.length, w = n === 1 ? 1 : n <= 4 ? 2 : 3;
    flat.push({ w, h: Math.ceil(n / w), cells: r.ingredients.slice(), out: r.out });
  }
  return flat;
}
export const ingredientMatches = (s: ItemStack, want: number | number[]) => matches(s, want);

function matches(slot: ItemStack | null, want: number | number[] | undefined): boolean {
  if (want === undefined) return !slot;
  if (!slot) return false;
  return Array.isArray(want) ? want.includes(slot.id) : slot.id === want;
}

/** grid is w*w row-major. Returns crafting result or null. */
// redstone devices
S(['TRT', 'SSS'], { T: B.REDSTONE_TORCH, R: I.REDSTONE, S: B.STONE }, I3.REPEATER);
S([' T ', 'TQT', 'SSS'], { T: B.REDSTONE_TORCH, Q: I.QUARTZ, S: B.STONE }, I3.COMPARATOR);
S(['PPP', 'CIC', 'CRC'], { P: PLANKS, C: B.COBBLESTONE, I: I.IRON_INGOT, R: I.REDSTONE }, B.PISTON);
S(['S', 'P'], { S: I2.SLIME_BALL, P: B.PISTON }, B.STICKY_PISTON);
S(['CCC', 'RRQ', 'CCC'], { C: B.COBBLESTONE, R: I.REDSTONE, Q: I.QUARTZ }, B.OBSERVER);
S(['###', '###', '###'], { '#': I2.SLIME_BALL }, B.SLIME_BLOCK);
L([B.SLIME_BLOCK], I2.SLIME_BALL, 9);
S(['CCC', 'CBC', 'CRC'], { C: B.COBBLESTONE, B: I.BOW, R: I.REDSTONE }, B.DISPENSER);
S(['CCC', 'C C', 'CRC'], { C: B.COBBLESTONE, R: I.REDSTONE }, B.DROPPER);
S(['I I', 'ICI', ' I '], { I: I.IRON_INGOT, C: B.CHEST }, B.HOPPER);
S(['BBB', ' I ', 'III'], { B: B.IRON_BLOCK, I: I.IRON_INGOT }, B.ANVIL);
// brewing
S([' B ', 'CCC'], { B: I3.BLAZE_ROD, C: STONEISH }, I3.BREWING_STAND);
S(['G G', ' G '], { G: B.GLASS }, I3.GLASS_BOTTLE, 3);
L([I3.BLAZE_ROD], I2.BLAZE_POWDER, 2);
L([I2.SLIME_BALL, I2.BLAZE_POWDER], I3.MAGMA_CREAM);
L([I.SPIDER_EYE, B.BROWN_MUSHROOM, I.SUGAR], I3.FERMENTED_SPIDER_EYE);
S(['NNN', 'NMN', 'NNN'], { N: I.GOLD_NUGGET, M: I.MELON_SLICE }, I3.GLISTERING_MELON);
S(['NNN', 'NCN', 'NNN'], { N: I.GOLD_NUGGET, C: I3.CARROT }, I3.GOLDEN_CARROT);
L([I.GOLD_INGOT], I.GOLD_NUGGET, 9);
S(['###', '###', '###'], { '#': I.GOLD_NUGGET }, I.GOLD_INGOT);
L([I2.BLAZE_POWDER, I.ENDER_PEARL], I2.ENDER_EYE);
// the End
S(['OOO', 'OEO', 'OOO'], { O: B.OBSIDIAN, E: I2.ENDER_EYE }, B.ENDER_CHEST);
S(['GGG', 'GEG', 'GTG'], { G: B.GLASS, E: I2.ENDER_EYE, T: I.GHAST_TEAR }, I4.END_CRYSTAL);
S(['###', '###'], { '#': I.IRON_INGOT }, B.IRON_BARS, 16);
// nether bricks
S(['##', '##'], { '#': I3.NETHER_BRICK }, B.NETHER_BRICKS);
S(['###', '###'], { '#': B.NETHER_BRICKS }, B.NETHER_BRICK_FENCE, 6);
S(['#  ', '## ', '###'], { '#': B.NETHER_BRICKS }, B.NETHER_BRICK_STAIRS, 4);

/** Copying a written book: the book (original or a copy of it) and books and quill, which come out as copies. */
function bookCopy(items: ItemStack[]): ItemStack | null {
  const src = items.filter((s) => s.id === I11.WRITTEN_BOOK), blanks = items.filter((s) => s.id === I7.WRITABLE_BOOK);
  if (src.length !== 1 || !blanks.length || src.length + blanks.length !== items.length) return null;
  const gen = (src[0].tag?.generation as number | undefined) ?? 0;
  if (gen >= 2) return null;
  return { id: I11.WRITTEN_BOOK, count: blanks.length, tag: { ...structuredClone(src[0].tag ?? {}), generation: gen + 1 } };
}
/** What stays in the grid when an ingredient is used up (vanilla's container items). */
export function craftRemainder(s: ItemStack): ItemStack | null {
  if (s.id === I.MILK_BUCKET || s.id === I.WATER_BUCKET || s.id === I.LAVA_BUCKET) return stack(I.BUCKET);
  if (s.id === I7.HONEY_BOTTLE || s.id === I7.DRAGON_BREATH) return stack(I3.GLASS_BOTTLE);
  // the book being copied stays
  if (s.id === I11.WRITTEN_BOOK) return { ...s, count: 1, tag: structuredClone(s.tag ?? {}) };
  return null;
}

export function craft(grid: (ItemStack | null)[], w: number): ItemStack | null {
  // bounding box
  let minX = w, minY = w, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++)
      if (grid[y * w + x]) {
        count++;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
  if (!count) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const at = (x: number, y: number) => grid[(minY + y) * w + minX + x];
  for (const r of shaped) {
    const ph = r.pattern.length, pw = Math.max(...r.pattern.map((p) => p.length));
    if (pw !== bw || ph !== bh) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < ph && ok; y++)
        for (let x = 0; x < pw && ok; x++) {
          const ch = r.pattern[y][mirror ? pw - 1 - x : x] ?? ' ';
          const want = ch === ' ' ? undefined : r.key[ch];
          if (!matches(at(x, y), want)) ok = false;
        }
      if (ok) return { ...r.out };
    }
  }
  // shapeless
  const items = grid.filter((s): s is ItemStack => !!s);
  const fw = fireworkCraft(items);
  if (fw) return fw;
  const copy = bookCopy(items);
  if (copy) return copy;
  for (const r of shapeless) {
    if (r.ingredients.length !== items.length) continue;
    const used = new Array(items.length).fill(false);
    let ok = true;
    for (const ing of r.ingredients) {
      const i = items.findIndex((s, k) => !used[k] && matches(s, ing));
      if (i < 0) { ok = false; break; }
      used[i] = true;
    }
    if (ok) return { ...r.out };
  }
  // repair: two damaged tools of the same kind combine their durability (+5% bonus)
  if (items.length === 2 && items[0].id === items[1].id) {
    const def = getItem(items[0].id);
    if (def.durability && def.maxStack === 1) {
      const left = (def.durability - (items[0].damage ?? 0)) + (def.durability - (items[1].damage ?? 0)) + Math.floor(def.durability * 0.05);
      return { id: items[0].id, count: 1, damage: Math.max(0, def.durability - left) };
    }
  }
  return null;
}

/**
 * Fireworks (vanilla's special recipes): paper + 1-3 gunpowder + any stars = 3 rockets that fly that long and burst
 * as those stars; gunpowder + dyes (+ a shape: fire charge, gold nugget or feather; + diamond for a trail, glowstone
 * for a twinkle) = a star; a star + dyes = the same star fading to those colours.
 */
function fireworkCraft(items: ItemStack[]): ItemStack | null {
  const n = (id: number) => items.filter((s) => s.id === id).length;
  const dyes = items.map((s) => dyeColor(s.id)).filter((c): c is number => c !== undefined);
  const paper = n(I.PAPER), powder = n(I.GUNPOWDER), stars = items.filter((s) => s.id === I6.FIREWORK_STAR);
  if (paper === 1 && powder >= 1 && powder <= 3 && paper + powder + stars.length === items.length) {
    const ex = stars.map((s) => s.fw?.ex?.[0]).filter((e): e is FireworkExplosion => !!e);
    return { id: I6.FIREWORK_ROCKET, count: 3, fw: { flight: powder, ...(ex.length ? { ex } : {}) } };
  }
  if (powder === 1 && dyes.length) {
    const shapes: [number, number][] = [[I.FIRE_CHARGE, 1], [I.GOLD_NUGGET, 2], [I.FEATHER, 4]];
    const shape = shapes.filter(([id]) => n(id) > 0);
    const trail = n(I.DIAMOND), twinkle = n(I.GLOWSTONE_DUST);
    if (shape.length > 1 || shape.some(([id]) => n(id) > 1) || trail > 1 || twinkle > 1) return null;
    if (1 + dyes.length + (shape.length ? 1 : 0) + trail + twinkle !== items.length) return null;
    const e: FireworkExplosion = { shape: shape[0]?.[1] ?? 0, colors: dyes };
    if (trail) e.trail = true;
    if (twinkle) e.twinkle = true;
    return { id: I6.FIREWORK_STAR, count: 1, fw: { ex: [e] } };
  }
  if (stars.length === 1 && dyes.length && 1 + dyes.length === items.length) {
    const e = stars[0].fw?.ex?.[0];
    if (!e) return null;
    return { id: I6.FIREWORK_STAR, count: 1, fw: { ex: [{ ...e, fade: dyes }] } };
  }
  return null;
}

// ------------------------------------------------------------------ smelting
export const SMELTING: Record<number, Smelt> = {
  [B.IRON_ORE]: { out: I.IRON_INGOT, xp: 0.7 },
  [B.GOLD_ORE]: { out: I.GOLD_INGOT, xp: 1 },
  [B.DIAMOND_ORE]: { out: I.DIAMOND, xp: 1 },
  [B.COAL_ORE]: { out: I.COAL, xp: 0.1 },
  [B.REDSTONE_ORE]: { out: I.REDSTONE, xp: 0.7 },
  [B.LAPIS_ORE]: { out: I.LAPIS, xp: 0.2 },
  [B.EMERALD_ORE]: { out: I.EMERALD, xp: 1 },
  [B.SAND]: { out: B.GLASS, xp: 0.1 },
  [B.COBBLESTONE]: { out: B.STONE, xp: 0.1 },
  [B.STONE]: { out: B.DOUBLE_STONE_SLAB, xp: 0.1 },
  [B.STONE_BRICKS]: { out: B.CRACKED_STONE_BRICKS, xp: 0.1 },
  [B.CLAY]: { out: B.TERRACOTTA, xp: 0.35 },
  [I.CLAY_BALL]: { out: I.BRICK, xp: 0.3 },
  [B.OAK_LOG]: { out: I.CHARCOAL, xp: 0.15 },
  [B.SPRUCE_LOG]: { out: I.CHARCOAL, xp: 0.15 },
  [B.BIRCH_LOG]: { out: I.CHARCOAL, xp: 0.15 },
  [B.CACTUS]: { out: B.WOOL_GREEN, xp: 0.2 },
  [I.PORKCHOP]: { out: I.COOKED_PORKCHOP, xp: 0.35 },
  [I.BEEF]: { out: I.COOKED_BEEF, xp: 0.35 },
  [I.CHICKEN]: { out: I.COOKED_CHICKEN, xp: 0.35 },
  [I.MUTTON]: { out: I.COOKED_MUTTON, xp: 0.35 },
  [I2.COD]: { out: I2.COOKED_COD, xp: 0.35 },
  [I2.SALMON]: { out: I2.COOKED_SALMON, xp: 0.35 },
  [I3.POTATO]: { out: I3.BAKED_POTATO, xp: 0.35 },
  [B.NETHERRACK]: { out: I3.NETHER_BRICK, xp: 0.1 },
  [B.NETHER_QUARTZ_ORE]: { out: I.QUARTZ, xp: 0.2 },
};
// rails and horses
S(['I I', 'ISI', 'I I'], { I: I.IRON_INGOT, S: I.STICK }, B.RAIL, 16);
S(['G G', 'GSG', 'GRG'], { G: I.GOLD_INGOT, S: I.STICK, R: I.REDSTONE }, B.POWERED_RAIL, 6);
S(['I I', 'IPI', 'IRI'], { I: I.IRON_INGOT, P: B.STONE_PRESSURE_PLATE, R: I.REDSTONE }, B.DETECTOR_RAIL, 6);
S(['ISI', 'ITI', 'ISI'], { I: I.IRON_INGOT, S: I.STICK, T: B.REDSTONE_TORCH }, B.ACTIVATOR_RAIL, 6);
S(['I I', 'III'], { I: I.IRON_INGOT }, I5.MINECART);
S(['###', '###', '###'], { '#': I.WHEAT }, B.HAY_BLOCK);
L([B.HAY_BLOCK], I.WHEAT, 9);

// the 1.9 - 1.16 recipes (recipes2.ts)
registerRecipes116({ S, L, SMELTING });

// ------------------------------------------------------------------ mod recipes
/**
 * An ingredient as mods write it: an item or block key ('ruby:ruby', 'stick', 'minecraft:stick'), a tag ('#planks'),
 * a registered ref, a raw id, or a list of alternatives. Keys are resolved whenever ids are bound (per world).
 */
export type Ingredient = string | number | { readonly id: number } | readonly Ingredient[];
export interface ModRecipe {
  mod: string;
  kind: 'shaped' | 'shapeless' | 'smelting';
  pattern?: string[];
  key?: Record<string, Ingredient>;
  ingredients?: Ingredient[];
  input?: Ingredient;
  out: Ingredient;
  count: number;
  xp?: number;
}
export const MOD_RECIPES: ModRecipe[] = [];
/** Item tags mods can use as ingredients. */
export const TAGS: Record<string, number[]> = ITEM_TAGS;
void WOOL_COLORS; void COAL;

function resolveIngredient(ing: Ingredient): number[] | null {
  if (typeof ing === 'number') return [ing];
  if (Array.isArray(ing)) {
    const out: number[] = [];
    for (const i of ing) { const r = resolveIngredient(i); if (!r) return null; out.push(...r); }
    return out;
  }
  if (typeof ing === 'object') { const id = (ing as { id: number }).id; return id >= 0 ? [id] : null; }
  const s = ing as string;
  if (s.startsWith('#')) return TAGS[s.slice(1).replace(/^minecraft:/, '')] ?? null;
  const d = itemByName(s)?.id ?? blockItemOf(s);
  return d !== undefined ? [d] : null;
}
function blockItemOf(name: string): number | undefined {
  const b = blockByName(name);
  return b && !b.missing ? b.id : undefined;
}

const addedShaped = new Set<Shaped>(), addedShapeless = new Set<Shapeless>(), addedSmelting = new Set<number>();
/** Put the active mods' recipes in (with this world's ids), replacing the previous binding's. */
export function rebuildModRecipes(isActive: (mod: string) => boolean) {
  for (let i = shaped.length - 1; i >= 0; i--) if (addedShaped.has(shaped[i])) shaped.splice(i, 1);
  for (let i = shapeless.length - 1; i >= 0; i--) if (addedShapeless.has(shapeless[i])) shapeless.splice(i, 1);
  for (const id of addedSmelting) delete SMELTING[id];
  addedShaped.clear(); addedShapeless.clear(); addedSmelting.clear();
  for (const r of MOD_RECIPES) {
    if (!isActive(r.mod)) continue;
    const out = resolveIngredient(r.out)?.[0];
    if (out === undefined) { console.warn(`[mod ${r.mod}] recipe for an unknown item`, r.out); continue; }
    if (r.kind === 'shaped') {
      const key: Record<string, number[]> = {};
      let ok = true;
      for (const [k, v] of Object.entries(r.key ?? {})) { const ids = resolveIngredient(v); if (!ids) { ok = false; break; } key[k] = ids; }
      if (!ok) { console.warn(`[mod ${r.mod}] recipe with an unknown ingredient`, r); continue; }
      const e: Shaped = { pattern: r.pattern ?? [], key, out: stack(out, r.count) };
      shaped.push(e);
      addedShaped.add(e);
    } else if (r.kind === 'shapeless') {
      const ings = (r.ingredients ?? []).map(resolveIngredient);
      if (ings.some((x) => !x)) { console.warn(`[mod ${r.mod}] recipe with an unknown ingredient`, r); continue; }
      const e: Shapeless = { ingredients: ings as number[][], out: stack(out, r.count) };
      shapeless.push(e);
      addedShapeless.add(e);
    } else {
      const ins = r.input !== undefined ? resolveIngredient(r.input) : null;
      if (!ins) continue;
      for (const id of ins) {
        if (SMELTING[id] && !addedSmelting.has(id)) continue; // the game's own smelting wins
        SMELTING[id] = { out, xp: r.xp ?? 0.1 };
        addedSmelting.add(id);
      }
    }
  }
}
