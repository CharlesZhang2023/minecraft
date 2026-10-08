// Screens of the 1.14-1.16 workstations: the smithing table (diamond gear + netherite ingot), the stonecutter (one
// block into its cut shapes) and the grindstone (strip enchantments for experience, or combine worn tools). Like
// every container screen they run twice, on the player's client and as the server's twin fed the same clicks.
import { ContainerScreen, Slot, arrow } from './containers';
import { Screen } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { ItemStack, getItem, stack, I, I3, I7, DYES, itemId } from '../game/items';
import { BANNERS } from '../world/blocks';
import { createMap, lockMap, mapIdOf, mapStore } from '../game/maps';
import type { WorldMeta } from '../game/storage';
import { PATTERNS, PATTERN_ITEMS, PLAIN_PATTERNS, bannerPixels, BANNER_W, BANNER_H } from '../game/banners';
import { BLOCKS } from '../world/blocks';
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

/** A pattern's (or a whole banner's) picture, drawn once and kept. */
const bannerCanvases = new Map<string, HTMLCanvasElement>();
export function bannerCanvas(base: number, layers: { p: string; c: number }[]): HTMLCanvasElement {
  const key = base + ':' + layers.map((l) => l.p + l.c).join(',');
  let c = bannerCanvases.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = BANNER_W; c.height = BANNER_H;
    const img = new ImageData(BANNER_W, BANNER_H);
    img.data.set(bannerPixels(base, layers));
    c.getContext('2d')!.putImageData(img, 0, 0);
    bannerCanvases.set(key, c);
  }
  return c;
}

/**
 * The loom (1.14): a banner, a dye and (for the special designs) a banner pattern item; pick a pattern from the grid
 * and take the banner with that layer added in the dye's colour. Six layers at most; the pattern item isn't used up.
 */
export class LoomScreen extends ContainerScreen {
  title = 'Loom';
  items: Items = [null, null, null];
  sel = '';
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  /** The patterns on offer: the pattern item's own design, or the plain ones. */
  offered(): string[] {
    const [b, d, p] = this.items;
    if (!b || !d) return [];
    if (p) { const k = Object.keys(PATTERN_ITEMS).find((k) => itemId(PATTERN_ITEMS[k]) === p.id); return k ? [k] : []; }
    return PLAIN_PATTERNS;
  }
  result(): ItemStack | null {
    const [b, d] = this.items;
    if (!b || !d || !this.offered().includes(this.sel)) return null;
    const layers = b.banner ?? [];
    if (layers.length >= 6) return null;
    return { ...b, count: 1, banner: [...layers.map((l) => ({ ...l })), { p: this.sel, c: DYES.indexOf(d.id) }] };
  }
  override buildSlots() {
    const it = this.items;
    const patternItem = (s: ItemStack) => Object.values(PATTERN_ITEMS).some((n) => itemId(n) === s.id);
    this.slots.push({ x: 13, y: 26, get: () => it[0], set: (s) => (it[0] = s), group: 'banner', canPlace: (s) => BANNERS.includes(s.id) });
    this.slots.push({ x: 33, y: 26, get: () => it[1], set: (s) => (it[1] = s), group: 'dye', canPlace: (s) => DYES.includes(s.id) });
    this.slots.push({ x: 23, y: 45, get: () => it[2], set: (s) => (it[2] = s), group: 'pattern', limit: 1, canPlace: patternItem });
    this.slots.push({
      x: 143, y: 57, group: 'out', output: true,
      get: () => this.result(), set: () => {},
      onTake: () => { take(it, 0); take(it, 1); this.game.audio.play('dig.cloth', { x: this.x + 0.5, y: this.y + 0.5, z: this.z + 0.5 }, 0.6, 1.2); },
    });
    this.addPlayerSlots();
  }
  /** Pattern buttons: [x, y, id], seven to a row. */
  buttons(): [number, number, string][] { return this.offered().map((p, i) => [50 + (i % 7) * 12, 14 + Math.floor(i / 7) * 12, p]); }
  override quickTargets(s: Slot, st: ItemStack): string[] {
    if (s.group === 'main' || s.group === 'hotbar') return BANNERS.includes(st.id) ? ['banner'] : DYES.includes(st.id) ? ['dye'] : ['pattern'];
    return super.quickTargets(s, st);
  }
  override drawBackground(ctx: Ctx, mx: number, my: number) {
    const L = this.left, T = this.top;
    ctx.fillStyle = '#8b8b8b';
    ctx.fillRect(L + 49, T + 13, 85, 61);
    const dye = this.items[1] ? DYES.indexOf(this.items[1].id) : 15;
    const base = this.items[0] ? BANNERS.indexOf(this.items[0].id) : 0;
    for (const [bx, by, p] of this.buttons()) {
      const hover = mx >= L + bx && my >= T + by && mx < L + bx + 11 && my < T + by + 11;
      ctx.fillStyle = this.sel === p ? '#e0e0e0' : hover ? '#c0c0d8' : '#5a5a5a';
      ctx.fillRect(L + bx, T + by, 11, 11);
      ctx.drawImage(bannerCanvas(base, [{ p, c: dye }]), L + bx + 3, T + by + 1, 5, 9);
    }
    // the result, large
    const out = this.result() ?? this.items[0];
    if (out) ctx.drawImage(bannerCanvas(BANNERS.indexOf(out.id), out.banner ?? []), L + 145, T + 8, 12, 24);
    arrow(ctx, L + 136, T + 58, 0, 6);
  }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, 'Loom', 8, 4);
    this.label(ctx, 'Inventory', 8, 74);
    if ((this.items[0]?.banner?.length ?? 0) >= 6) this.label(ctx, 'Full', 140, 40);
  }
  override mouseDown(mx: number, my: number, button: number): boolean {
    const L = this.left, T = this.top;
    for (const [bx, by, p] of this.buttons()) {
      if (mx < L + bx || my < T + by || mx >= L + bx + 11 || my >= T + by + 11) continue;
      this.sel = p;
      this.game.audio.play('click', null, 0.4, 1);
      return true;
    }
    return super.mouseDown(mx, my, button);
  }
  override syncState() { return { sel: this.sel }; }
  override applySyncState(s: unknown) { const d = s as { sel?: string } | null; if (d) this.sel = d.sel ?? ''; }
  override onClose() {
    this.giveBack(this.items);
    super.onClose();
  }
}
void PATTERNS;

/**
 * The cartography table (1.14): a filled map and paper zooms it out a step (a new map, twice the area), an empty map
 * copies it (the copies share the map), a glass pane locks it (a new map that no longer changes).
 */
export class CartographyScreen extends ContainerScreen {
  title = 'Cartography Table';
  items: Items = [null, null];
  /** The map made for the current inputs (on the server, which keeps the maps). */
  private made: { key: string; id: number } | null = null;
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  private meta(): WorldMeta | null { const g = this.game as unknown as { meta?: WorldMeta | null; spawnXpAt?: unknown }; return g.spawnXpAt && g.meta ? g.meta : null; }
  kind(): 'zoom' | 'copy' | 'lock' | null {
    const [a, b] = this.items;
    const id = mapIdOf(a);
    if (id === null || !b) return null;
    const d = this.meta() ? mapStore(this.meta()!).get(id) : (this.game as unknown as { maps?: Map<number, { scale: number; locked?: boolean }> }).maps?.get(id);
    if (b.id === I.PAPER) return d && d.scale < 4 && !d.locked ? 'zoom' : null;
    if (b.id === I7.MAP) return 'copy';
    if (b.id === itemId('glass_pane')) return d && !d.locked ? 'lock' : null;
    return null;
  }
  result(): ItemStack | null {
    const k = this.kind(), a = this.items[0];
    if (!k || !a) return null;
    const id = mapIdOf(a)!;
    if (k === 'copy') return { ...a, count: 2, tag: { ...a.tag } };
    const meta = this.meta();
    if (!meta) return { ...a, count: 1, tag: { ...a.tag } };
    const key = `${id}:${k}`;
    if (this.made?.key !== key) {
      const d = mapStore(meta).get(id)!;
      const n = k === 'zoom' ? createMap(meta, d.x, d.z, d.scale + 1, d.dim, d) : lockMap(meta, d);
      this.made = { key, id: n.id };
    }
    return { ...a, count: 1, tag: { ...a.tag, map: this.made.id } };
  }
  override buildSlots() {
    const it = this.items;
    this.slots.push({ x: 15, y: 15, get: () => it[0], set: (s) => (it[0] = s), group: 'map', canPlace: (s) => mapIdOf(s) !== null });
    this.slots.push({ x: 15, y: 52, get: () => it[1], set: (s) => (it[1] = s), group: 'extra', canPlace: (s) => s.id === I.PAPER || s.id === I7.MAP || s.id === itemId('glass_pane') });
    this.slots.push({
      x: 145, y: 39, group: 'out', output: true,
      get: () => this.result(), set: () => {},
      onTake: () => { take(it, 0); take(it, 1); this.made = null; this.game.audio.play('dig.cloth', { x: this.x + 0.5, y: this.y + 0.5, z: this.z + 0.5 }, 0.5, 1.8); },
    });
    this.addPlayerSlots();
  }
  override quickTargets(s: Slot, st: ItemStack): string[] {
    if (s.group === 'main' || s.group === 'hotbar') return mapIdOf(st) !== null ? ['map'] : ['extra'];
    return super.quickTargets(s, st);
  }
  override drawBackground(ctx: Ctx) {
    const L = this.left, T = this.top;
    ctx.fillStyle = '#d8c8a0';
    ctx.fillRect(L + 66, T + 14, 64, 58);
    const k = this.kind();
    ctx.fillStyle = '#6a5a3a';
    if (k === 'zoom') { ctx.fillRect(L + 82, T + 27, 32, 32); ctx.fillStyle = '#d8c8a0'; ctx.fillRect(L + 90, T + 35, 16, 16); }
    else if (k === 'copy') { ctx.fillRect(L + 74, T + 22, 26, 26); ctx.fillRect(L + 96, T + 38, 26, 26); }
    else if (k === 'lock') { ctx.fillRect(L + 84, T + 24, 28, 28); ctx.fillStyle = '#a0a0a0'; ctx.fillRect(L + 104, T + 46, 12, 10); ctx.fillRect(L + 106, T + 41, 2, 5); ctx.fillRect(L + 112, T + 41, 2, 5); ctx.fillRect(L + 106, T + 41, 8, 2); }
    arrow(ctx, L + 134, T + 40, 0, 8);
  }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, 'Cartography Table', 8, 4);
    this.label(ctx, 'Inventory', 8, 72);
  }
  override onClose() {
    this.giveBack(this.items);
    super.onClose();
  }
}

/** A chest minecart's 27 slots, or a hopper minecart's 5. */
export class CartScreen extends ContainerScreen {
  title = 'Minecart with Chest';
  constructor(ui: UI, public cart: { items: Items; kind: string; typeName: string }) { super(ui); }
  override buildSlots() {
    const items = this.cart.items;
    this.title = this.cart.typeName;
    if (this.cart.kind === 'hopper') for (let i = 0; i < 5; i++) this.slots.push({ x: 44 + i * 18, y: 20, get: () => items[i], set: (s) => (items[i] = s), group: 'chest' });
    else for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) { const i = r * 9 + c; this.slots.push({ x: 8 + c * 18, y: 18 + r * 18, get: () => items[i], set: (s) => (items[i] = s), group: 'chest' }); }
    this.addPlayerSlots();
  }
  override quickTargets(s: Slot): string[] { return s.group === 'chest' ? ['hotbar', 'main'] : ['chest']; }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, this.title, 8, 6);
    this.label(ctx, 'Inventory', 8, 72);
  }
}

/** Editing a sign: four lines of up to 15 characters; Enter or the arrows move between lines, Done saves. */
export class SignScreen extends Screen {
  override twin = true;
  lines = ['', '', '', ''];
  line = 0;
  private blink = 0;
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  override init() {
    const t = this.game.world!.getTile(this.x, this.y, this.z) as unknown as { type: string; lines?: string[] } | undefined;
    if (t?.type === 'sign' && t.lines) this.lines = t.lines.slice(0, 4).concat(['', '', '', '']).slice(0, 4);
  }
  override tick() { this.blink++; }
  override wantsText() { return true; }
  override render(ctx: Ctx, mx: number, my: number) {
    const g = this.gui, cx = Math.floor(g.w / 2), top = Math.floor(g.h / 2) - 60;
    ctx.fillStyle = 'rgba(16,16,16,0.6)';
    ctx.fillRect(0, 0, g.w, g.h);
    g.textCenter(ctx, 'Edit Sign Message', cx, top - 20);
    // the board
    ctx.fillStyle = '#9a7a4a';
    ctx.fillRect(cx - 50, top, 100, 52);
    ctx.fillStyle = '#7a5a32';
    ctx.fillRect(cx - 50, top + 51, 100, 1);
    ctx.fillRect(cx - 2, top + 52, 4, 30);
    this.lines.forEach((l, i) => {
      const cur = i === this.line && Math.floor(this.blink / 6) % 2 === 0;
      g.font.drawCentered(ctx, cur ? `> ${l} <` : l, cx, top + 4 + i * 12, '#000000', false);
    });
    const b = this.done();
    const hover = mx >= b.x && my >= b.y && mx < b.x + b.w && my < b.y + b.h;
    g.button(ctx, b.x, b.y, b.w, b.h, 'Done', hover, true);
    super.render(ctx, mx, my);
  }
  private done() { return { x: Math.floor(this.gui.w / 2) - 50, y: Math.floor(this.gui.h / 2) + 40, w: 100, h: 20 }; }
  override mouseDown(mx: number, my: number, button: number): boolean {
    const b = this.done();
    if (mx >= b.x && my >= b.y && mx < b.x + b.w && my < b.y + b.h) { this.close(); return true; }
    return super.mouseDown(mx, my, button);
  }
  override key(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') { this.close(); return true; }
    if (e.code === 'Enter' || e.code === 'ArrowDown' || e.code === 'Tab') { this.line = (this.line + 1) & 3; return true; }
    if (e.code === 'ArrowUp') { this.line = (this.line + 3) & 3; return true; }
    if (e.code === 'Backspace') { this.lines[this.line] = this.lines[this.line].slice(0, -1); return true; }
    return e.key.length === 1;
  }
  override char(ch: string) {
    const l = this.lines[this.line];
    if (ch >= ' ' && ch !== '§' && l.length < 15 && this.gui.font.width(l + ch) <= 90) this.lines[this.line] = l + ch;
  }
  override onClose() {
    // the server's copy writes the sign (and every client sees it with the chunk's tiles)
    const w = this.game.world!;
    if (w.getId(this.x, this.y, this.z) && BLOCKS_IS_SIGN(w.getId(this.x, this.y, this.z))) {
      w.setTile(this.x, this.y, this.z, { type: 'sign', lines: this.lines.slice() } as never);
      const c = w.chunkAt(this.x, this.z);
      if (c) c.modified = true;
    }
  }
}
const BLOCKS_IS_SIGN = (id: number) => /_sign$/.test(BLOCKS[id]?.name ?? '');

