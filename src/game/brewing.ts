// Brewing stands (1.9+ rules: blaze powder fuel, 400 tick brews) and potion recipes.
import type { Game } from './game';
import { B, idOf, metaOf, pack } from '../world/blocks';
import { ItemStack, getItem, I, I2, I3, I7, POTION_ITEMS, SPLASH_ITEMS, LINGERING_ITEMS } from './items';
import { POTION_BY_KEY } from './potiondata';

export interface BrewingTile {
  type: 'brewing';
  items: (ItemStack | null)[]; // 0-2 bottles, 3 ingredient, 4 fuel
  brewTime: number;
  fuel: number;
  ingredient: number;
}
export const BREW_TIME = 400;

/** Effect ingredients applied to an awkward potion. */
const EFFECT_INGREDIENTS: Record<number, string> = {
  [I.SUGAR]: 'swiftness',
  [I3.MAGMA_CREAM]: 'fire_resistance',
  [I3.GLISTERING_MELON]: 'healing',
  [I.SPIDER_EYE]: 'poison',
  [I.GHAST_TEAR]: 'regeneration',
  [I2.BLAZE_POWDER]: 'strength',
  [I3.GOLDEN_CARROT]: 'night_vision',
  [I3.PUFFERFISH]: 'water_breathing',
  [I7.RABBIT_FOOT]: 'leaping',
  [I7.TURTLE_HELMET]: 'turtle_master',
  [I7.PHANTOM_MEMBRANE]: 'slow_falling',
};
/** Fermented spider eye corruptions. */
const CORRUPT: Record<string, string> = {
  water: 'weakness', mundane: 'weakness', thick: 'weakness', awkward: 'weakness',
  swiftness: 'slowness', long_swiftness: 'long_slowness', strong_swiftness: 'slowness',
  leaping: 'slowness', long_leaping: 'long_slowness', strong_leaping: 'slowness',
  fire_resistance: 'slowness', long_fire_resistance: 'long_slowness',
  healing: 'harming', strong_healing: 'strong_harming',
  poison: 'harming', long_poison: 'harming', strong_poison: 'strong_harming',
  night_vision: 'invisibility', long_night_vision: 'long_invisibility',
};

const baseOf = (k: string) => k.replace(/^(long_|strong_)/, '');

/** Result of adding `ingredient` to a potion, or null if nothing happens. */
export function brewResult(potion: string, splash: boolean, ingredient: number, lingering = false): { key: string; splash: boolean; lingering?: boolean } | null {
  const r = brewBase(potion, splash || lingering, ingredient, lingering);
  // a lingering potion stays lingering whatever else goes in
  return r && lingering && !r.lingering ? { ...r, splash: false, lingering: true } : r;
}
function brewBase(potion: string, splash: boolean, ingredient: number, lingering: boolean): { key: string; splash: boolean; lingering?: boolean } | null {
  const has = (k: string) => POTION_BY_KEY.has(k);
  if (ingredient === I.GUNPOWDER) return splash ? null : { key: potion, splash: true };
  // dragon's breath turns a splash potion lingering
  if (ingredient === I7.DRAGON_BREATH) return splash && !lingering ? { key: potion, splash: false, lingering: true } : null;
  if (ingredient === I3.NETHER_WART) return potion === 'water' ? { key: 'awkward', splash } : null;
  if (ingredient === I.REDSTONE) {
    if (potion === 'water') return { key: 'mundane', splash };
    const k = 'long_' + baseOf(potion);
    return has(k) && k !== potion ? { key: k, splash } : null;
  }
  if (ingredient === I.GLOWSTONE_DUST) {
    if (potion === 'water') return { key: 'thick', splash };
    const k = 'strong_' + baseOf(potion);
    return has(k) && k !== potion ? { key: k, splash } : null;
  }
  if (ingredient === I3.FERMENTED_SPIDER_EYE) return CORRUPT[potion] ? { key: CORRUPT[potion], splash } : null;
  const eff = EFFECT_INGREDIENTS[ingredient];
  if (eff) {
    if (potion === 'awkward') return { key: eff, splash };
    if (potion === 'water') return { key: 'mundane', splash };
  }
  return null;
}
export const isBrewingIngredient = (id: number) =>
  id === I.GUNPOWDER || id === I7.DRAGON_BREATH || id === I3.NETHER_WART || id === I.REDSTONE || id === I.GLOWSTONE_DUST || id === I3.FERMENTED_SPIDER_EYE || id in EFFECT_INGREDIENTS;
export const isBottle = (s: ItemStack) => !!getItem(s.id).potion;

function bottleResult(s: ItemStack | null, ingredient: number): ItemStack | null {
  if (!s) return null;
  const d = getItem(s.id);
  if (!d.potion) return null;
  const r = brewResult(d.potion, !!d.splash, ingredient, !!d.lingering);
  if (!r) return null;
  const id = (r.lingering ? LINGERING_ITEMS : r.splash ? SPLASH_ITEMS : POTION_ITEMS)[r.key];
  return id === undefined ? null : { id, count: 1 };
}

export function newBrewingTile(): BrewingTile {
  return { type: 'brewing', items: [null, null, null, null, null], brewTime: 0, fuel: 0, ingredient: 0 };
}

export class Brewing {
  constructor(private game: Game) {}

  private canBrew(t: BrewingTile): boolean {
    const ing = t.items[3];
    if (!ing || !isBrewingIngredient(ing.id)) return false;
    return [0, 1, 2].some((i) => bottleResult(t.items[i], ing.id) !== null);
  }

  tick() {
    const g = this.game, w = g.world!;
    for (const c of w.chunks.values()) {
      if (!c.ready || !c.tiles.size) continue;
      for (const [i, tile] of c.tiles) {
        if (tile.type !== 'brewing') continue;
        const t = tile as unknown as BrewingTile;
        const x = c.cx * 16 + (i & 15), z = c.cz * 16 + ((i >> 4) & 15), y = i >> 8;
        const fuel = t.items[4];
        if (t.fuel <= 0 && fuel && fuel.id === I2.BLAZE_POWDER) {
          t.fuel = 20;
          fuel.count--;
          if (fuel.count <= 0) t.items[4] = null;
          c.modified = true;
        }
        const can = this.canBrew(t);
        if (t.brewTime > 0) {
          t.brewTime--;
          const ing = t.items[3];
          if (t.brewTime === 0 && can) this.brew(t, x, y, z);
          else if (!can || !ing || ing.id !== t.ingredient) t.brewTime = 0;
          c.modified = true;
        } else if (can && t.fuel > 0) {
          t.fuel--;
          t.brewTime = BREW_TIME;
          t.ingredient = t.items[3]!.id;
          c.modified = true;
        }
        // bottle bits in the block meta (drawn on the stand)
        const v = w.get(x, y, z);
        if (idOf(v) === B.BREWING_STAND) {
          const m = (t.items[0] ? 1 : 0) | (t.items[1] ? 2 : 0) | (t.items[2] ? 4 : 0);
          if (m !== metaOf(v)) g.redstone.setMetaKeepTile(x, y, z, pack(B.BREWING_STAND, m));
        }
      }
    }
  }

  private brew(t: BrewingTile, x: number, y: number, z: number) {
    const ing = t.items[3]!;
    for (let i = 0; i < 3; i++) {
      const r = bottleResult(t.items[i], ing.id);
      if (r) t.items[i] = r;
    }
    ing.count--;
    if (ing.count <= 0) t.items[3] = null;
    this.game.audio.play('brew', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0.8, 1);
  }
}
