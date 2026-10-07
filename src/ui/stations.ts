// Screens of the 1.14-1.16 workstations: the smithing table (diamond gear + netherite ingot), the stonecutter (one
// block into its cut shapes) and the grindstone (strip enchantments for experience, or combine worn tools). Like
// every container screen they run twice, on the player's client and as the server's twin fed the same clicks.
import { ContainerScreen, Slot, arrow } from './containers';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { ItemStack, getItem, stack, I, I3 } from '../game/items';
import { SMITHING, STONECUTTING } from '../game/recipes';
import { ENCH_BY_ID } from '../game/enchant';
import { BEACON_POWERS, BEACON_PAYMENT, type BeaconTile } from '../game/beacon';
import { effectIcon } from './effects';
import { EFFECTS } from '../game/potiondata';

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

/**
 * The beacon: pick a primary power (what the pyramid's levels allow) and, at four levels, a secondary one (regeneration
 * or the primary at level II), put in one iron, gold, emerald, diamond or netherite ingot and confirm.
 */
export class BeaconScreen extends ContainerScreen {
  title = 'Beacon';
  override pw = 230;
  override ph = 219;
  items: Items = [null];
  primary = '';
  secondary = '';
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  tile(): BeaconTile | null { const t = this.game.world!.getTile(this.x, this.y, this.z) as unknown as BeaconTile | undefined; return t?.type === 'beacon' ? t : null; }
  override init() { super.init(); const t = this.tile(); this.primary = t?.primary ?? ''; this.secondary = t?.secondary ?? ''; }
  override buildSlots() {
    const it = this.items;
    this.slots.push({ x: 136, y: 110, get: () => it[0], set: (s) => (it[0] = s), group: 'payment', limit: 1, canPlace: (s) => BEACON_PAYMENT().includes(s.id) });
    this.addPlayerSlots(36, 137, 195);
  }
  /** The buttons: [x, y, power, row (0-3; 4 = secondary)]. */
  buttons(): [number, number, string, number][] {
    const out: [number, number, string, number][] = [];
    BEACON_POWERS.slice(0, 3).forEach((row, r) => row.forEach((p, i) => out.push([row.length === 1 ? 64 : 52 + i * 24, 22 + r * 25, p, r])));
    out.push([154, 47, 'regeneration', 4]);
    if (this.primary) out.push([178, 47, this.primary, 4]);
    return out;
  }
  levels() { return this.tile()?.levels ?? 0; }
  override quickTargets(s: Slot, st: ItemStack): string[] {
    if ((s.group === 'main' || s.group === 'hotbar') && BEACON_PAYMENT().includes(st.id)) return ['payment'];
    return super.quickTargets(s, st);
  }
  override drawBackground(ctx: Ctx, mx: number, my: number) {
    const L = this.left, T = this.top, lv = this.levels();
    for (const [bx, by, p, r] of this.buttons()) {
      const on = r < 4 ? lv > r : lv >= 4;
      const sel = r < 4 ? this.primary === p : this.secondary === p;
      const hover = mx >= L + bx && my >= T + by && mx < L + bx + 22 && my < T + by + 22;
      ctx.fillStyle = !on ? '#3a3a3a' : sel ? '#5a8a3a' : hover ? '#8a8aaa' : '#6a6a7a';
      ctx.fillRect(L + bx, T + by, 22, 22);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(L + bx, T + by + 21, 22, 1); ctx.fillRect(L + bx + 21, T + by, 1, 22);
      ctx.globalAlpha = on ? 1 : 0.4;
      ctx.drawImage(effectIcon(p), L + bx + 2, T + by + 2, 18, 18);
      ctx.globalAlpha = 1;
    }
    // the confirm button
    const ok = this.canConfirm();
    ctx.fillStyle = ok ? '#4a8a2a' : '#5a5a5a';
    ctx.fillRect(L + 164, T + 107, 22, 22);
    ctx.fillStyle = ok ? '#b8f088' : '#8a8a8a';
    for (let k = 0; k < 6; k++) { ctx.fillRect(L + 168 + k, T + 117 + k, 2, 2); }
    for (let k = 0; k < 9; k++) ctx.fillRect(L + 173 + k, T + 122 - k, 2, 2);
    // payment hints
    BEACON_PAYMENT().slice(0, 4).forEach((id, i) => this.ui.drawItem(ctx, stack(id), L + 20 + i * 22 + (i > 1 ? 4 : 0), T + 109));
  }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, 'Primary Power', 40, 10);
    this.label(ctx, 'Secondary Power', 150, 10);
  }
  canConfirm() { return !!this.items[0] && !!this.primary && this.levels() > 0; }
  override mouseDown(mx: number, my: number, button: number): boolean {
    const L = this.left, T = this.top, lv = this.levels();
    for (const [bx, by, p, r] of this.buttons()) {
      if (mx < L + bx || my < T + by || mx >= L + bx + 22 || my >= T + by + 22) continue;
      if (r < 4 && lv > r) { this.primary = p; if (this.secondary && this.secondary !== 'regeneration') this.secondary = p; }
      else if (r === 4 && lv >= 4) this.secondary = p;
      this.game.audio.play('click', null, 0.4, 1);
      return true;
    }
    if (mx >= L + 164 && my >= T + 107 && mx < L + 186 && my < T + 129) {
      if (!this.canConfirm()) return true;
      const t = this.tile();
      if (t) {
        t.primary = this.primary; t.secondary = this.secondary;
        this.game.world!.setTile(this.x, this.y, this.z, t as never);
        take(this.items, 0);
        this.game.audio.play('beacon.power', { x: this.x + 0.5, y: this.y + 0.5, z: this.z + 0.5 }, 1, 1);
      }
      this.ui.open(null);
      return true;
    }
    return super.mouseDown(mx, my, button);
  }
  override syncState() { return { primary: this.primary, secondary: this.secondary }; }
  override applySyncState(s: unknown) { const d = s as { primary?: string; secondary?: string } | null; if (d) { this.primary = d.primary ?? ''; this.secondary = d.secondary ?? ''; } }
  override onClose() {
    this.giveBack(this.items);
    super.onClose();
  }
}
void EFFECTS;

