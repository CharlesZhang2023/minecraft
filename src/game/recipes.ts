// Crafting & smelting recipes.
import { B, WOOL_COLORS } from '../world/blocks';
import { I, I2, TOOLS, ARMOR, ItemStack, stack, getItem } from './items';

interface Shaped { pattern: string[]; key: Record<string, number | number[]>; out: ItemStack }
interface Shapeless { ingredients: (number | number[])[]; out: ItemStack }

const shaped: Shaped[] = [];
const shapeless: Shapeless[] = [];
const S = (pattern: string[], key: Record<string, number | number[]>, id: number, count = 1) => shaped.push({ pattern, key, out: stack(id, count) });
const L = (ingredients: (number | number[])[], id: number, count = 1) => shapeless.push({ ingredients, out: stack(id, count) });

const PLANKS = [B.OAK_PLANKS, B.SPRUCE_PLANKS, B.BIRCH_PLANKS];
const LOGS = [B.OAK_LOG, B.SPRUCE_LOG, B.BIRCH_LOG];
const STONEISH = [B.COBBLESTONE];
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
S(['##', '##', '##'], { '#': PLANKS }, I.OAK_DOOR, 3);
S(['#S#', '#S#'], { '#': PLANKS, S: I.STICK }, B.OAK_FENCE, 3);
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
const toolMats: [string, number[]][] = [['wooden', PLANKS], ['stone', [B.COBBLESTONE]], ['iron', [I.IRON_INGOT]], ['golden', [I.GOLD_INGOT]], ['diamond', [I.DIAMOND]]];
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
S(['# #', '###'], { '#': PLANKS }, I2.BOAT);
S(['R', 'S'], { R: I.REDSTONE, S: I.STICK }, B.REDSTONE_TORCH);
S(['S', 'C'], { S: I.STICK, C: B.COBBLESTONE }, B.LEVER);
L([B.STONE], B.STONE_BUTTON);
S(['##'], { '#': B.STONE }, B.STONE_PRESSURE_PLATE);
S([' R ', 'RGR', ' R '], { R: I.REDSTONE, G: B.GLOWSTONE }, B.REDSTONE_LAMP);
S(['###', '###', '###'], { '#': I.REDSTONE }, B.REDSTONE_BLOCK);
L([B.REDSTONE_BLOCK], I.REDSTONE, 9);
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

function matches(slot: ItemStack | null, want: number | number[] | undefined): boolean {
  if (want === undefined) return !slot;
  if (!slot) return false;
  return Array.isArray(want) ? want.includes(slot.id) : slot.id === want;
}

/** grid is w*w row-major. Returns crafting result or null. */
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

// ------------------------------------------------------------------ smelting
export const SMELTING: Record<number, { out: number; xp: number }> = {
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
};
