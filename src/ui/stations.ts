// Screens of the 1.14-1.16 workstations: the smithing table (diamond gear + netherite ingot), the stonecutter (one
// block into its cut shapes) and the grindstone (strip enchantments for experience, or combine worn tools). Like
// every container screen they run twice, on the player's client and as the server's twin fed the same clicks.
import { ContainerScreen, Slot, arrow } from './containers';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { ItemStack, getItem, stack, I, I3 } from '../game/items';
import { SMITHING, STONECUTTING } from '../game/recipes';
import { ENCH_BY_ID } from '../game/enchant';

type Items = (ItemStack | null)[];
const take = (items: Items, i: number, n = 1) => { const s = items[i]; if (!s) return; s.count -= n; if (s.count <= 0) items[i] = null; };

export class SmithingScreen extends ContainerScreen {
  title = 'Upgrade Gear';
  items: Items = [null, null];
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  /** The upgraded item, keeping the base's enchantments, name and wear. */
  result(): ItemStack | null {
    const [a, b] = this.items;
    if (!a || !b) return null;
    const r = SMITHING.find((s) => s.base === a.id && s.addition === b.id);
    if (!r) return null;
    const out: ItemStack = { ...a, id: r.out, count: 1 };
    if (a.ench) out.ench = { ...a.ench };
    return out;
  }
  override buildSlots() {
    const it = this.items;
    this.slots.push({ x: 27, y: 47, get: () => it[0], set: (s) => (it[0] = s), group: 'base', canPlace: (s) => SMITHING.some((r) => r.base === s.id) });
    this.slots.push({ x: 76, y: 47, get: () => it[1], set: (s) => (it[1] = s), group: 'addition', canPlace: (s) => SMITHING.some((r) => r.addition === s.id) });
    this.slots.push({
      x: 134, y: 47, group: 'out', output: true,
      get: () => this.result(), set: () => {},
      onTake: () => { take(it, 0); take(it, 1); this.game.audio.play('anvil.use', { x: this.x + 0.5, y: this.y + 0.5, z: this.z + 0.5 }, 0.6, 1.2); },
    });
    this.addPlayerSlots();
  }
  override quickTargets(s: Slot, st: ItemStack): string[] {
    if (s.group === 'main' || s.group === 'hotbar') return SMITHING.some((r) => r.base === st.id) ? ['base'] : ['addition'];
    return super.quickTargets(s, st);
  }
  override drawBackground(ctx: Ctx) {
    const L = this.left, T = this.top;
    ctx.fillStyle = '#6a6a6a';
    ctx.fillRect(L + 54, T + 53, 13, 3);
    ctx.fillRect(L + 59, T + 48, 3, 13);
    arrow(ctx, L + 102, T + 48, 0);
  }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, 'Upgrade Gear', 60, 18);
    this.label(ctx, 'Inventory', 8, 72);
  }
  override onClose() {
    this.giveBack(this.items);
    super.onClose();
  }
}

/** The stonecutter: put a block in, take any of the shapes it can be cut into (one input each). */
export class StonecutterScreen extends ContainerScreen {
  title = 'Stonecutter';
  items: Items = [null];
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  options(): ItemStack[] {
    const a = this.items[0];
    if (!a) return [];
    return STONECUTTING.filter((r) => r.input === a.id).map((r) => stack(r.out, r.count));
  }
  override buildSlots() {
    const it = this.items;
    this.slots.push({ x: 20, y: 33, get: () => it[0], set: (s) => (it[0] = s), group: 'input', canPlace: (s) => STONECUTTING.some((r) => r.input === s.id) });
    for (let k = 0; k < 16; k++) {
      this.slots.push({
        x: 52 + (k % 4) * 18, y: 15 + Math.floor(k / 4) * 18, group: 'out', output: true,
        get: () => this.options()[k] ?? null, set: () => {},
        onTake: () => { take(it, 0); this.game.audio.play('dig.stone', { x: this.x + 0.5, y: this.y + 0.5, z: this.z + 0.5 }, 0.5, 1.4); },
      });
    }
    this.addPlayerSlots();
  }
  override quickTargets(s: Slot, st: ItemStack): string[] {
    if (s.group === 'main' || s.group === 'hotbar') return ['input'];
    return super.quickTargets(s, st);
  }
  override drawBackground(ctx: Ctx) {
    const L = this.left, T = this.top;
    ctx.fillStyle = '#8b8b8b';
    ctx.fillRect(L + 51, T + 14, 73, 73);
    arrow(ctx, L + 128, T + 33, 0, 14);
  }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, 'Stonecutter', 8, 4);
    this.label(ctx, 'Inventory', 8, 72 + 20);
  }
  override onClose() {
    this.giveBack(this.items);
    super.onClose();
  }
}

/** Curses stay on: the grindstone can't remove them. */
const isCurse = (id: string) => id === 'binding_curse' || id === 'vanishing_curse';

/** The grindstone: one enchanted item comes out plain (books turn back into books) and pays some experience; two of the same item combine their durability. */
export class GrindstoneScreen extends ContainerScreen {
  title = 'Repair & Disenchant';
  items: Items = [null, null];
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  result(): ItemStack | null {
    const [a, b] = this.items;
    const one = a && !b ? a : !a && b ? b : null;
    if (one) {
      if (!one.ench) return null;
      const keep = Object.fromEntries(Object.entries(one.ench).filter(([k]) => isCurse(k)));
      // an enchanted book without its enchantments is just a book
      if (one.id === I3.ENCHANTED_BOOK && !Object.keys(keep).length) return { id: I.BOOK, count: 1 };
      const out: ItemStack = { ...one, count: 1, repair: 0 };
      if (Object.keys(keep).length) out.ench = keep;
      else delete out.ench;
      return out;
    }
    if (a && b && a.id === b.id) {
      const d = getItem(a.id).durability;
      if (!d) return null;
      const left = (d - (a.damage ?? 0)) + (d - (b.damage ?? 0)) + Math.floor(d * 0.05);
      return { id: a.id, count: 1, damage: Math.max(0, d - left) };
    }
    return null;
  }
  /** Experience back: a share of the enchantments' levels (vanilla: their minimum enchanting cost, roughly). */
  private xpBack(): number {
    let n = 0;
    for (const s of this.items) if (s?.ench) for (const [k, l] of Object.entries(s.ench)) if (!isCurse(k) && ENCH_BY_ID.get(k)) n += 1 + l * 2;
    return Math.ceil(n / 2) + Math.floor(Math.random() * Math.ceil(n / 2 + 1));
  }
  override buildSlots() {
    const it = this.items;
    const placeable = (s: ItemStack) => !!getItem(s.id).durability || !!s.ench || s.id === I3.ENCHANTED_BOOK;
    this.slots.push({ x: 49, y: 19, get: () => it[0], set: (s) => (it[0] = s), group: 'top', canPlace: placeable });
    this.slots.push({ x: 49, y: 40, get: () => it[1], set: (s) => (it[1] = s), group: 'bottom', canPlace: placeable });
    this.slots.push({
      x: 129, y: 34, group: 'out', output: true,
      get: () => this.result(), set: () => {},
      onTake: () => {
        const xp = this.xpBack();
        it[0] = null; it[1] = null;
        // (experience orbs only come from the server's twin)
        const g = this.game as unknown as { spawnXpAt?: (x: number, y: number, z: number, n: number) => void };
        if (xp > 0) g.spawnXpAt?.(this.x + 0.5, this.y + 1, this.z + 0.5, xp);
        this.game.audio.play('anvil.use', { x: this.x + 0.5, y: this.y + 0.5, z: this.z + 0.5 }, 0.5, 1.5);
      },
    });
    this.addPlayerSlots();
  }
  override quickTargets(s: Slot, st: ItemStack): string[] {
    if (s.group === 'main' || s.group === 'hotbar') return this.items[0] ? ['bottom'] : ['top'];
    return super.quickTargets(s, st);
  }
  override drawBackground(ctx: Ctx) {
    arrow(ctx, this.left + 94, this.top + 34, 0);
  }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, 'Repair & Disenchant', 8, 6);
    this.label(ctx, 'Inventory', 8, 72);
  }
  override onClose() {
    this.giveBack(this.items);
    super.onClose();
  }
}
