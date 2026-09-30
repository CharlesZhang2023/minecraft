// Screens for hoppers, dispensers/droppers, brewing stands and anvils.
import { ContainerScreen, Slot, arrow } from './containers';
import { TextField } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { ItemStack, getItem, I, I2, I3, stackName } from '../game/items';
import { B, idOf, metaOf, pack } from '../world/blocks';
import { BrewingTile, BREW_TIME, isBrewingIngredient, newBrewingTile } from '../game/brewing';
import { anvilCombine, AnvilResult } from '../game/enchant';

type Items = (ItemStack | null)[];

function tileItems(ui: UI, x: number, y: number, z: number, type: 'hopper' | 'dispenser' | 'dropper', n: number): Items {
  const w = ui.game.world!;
  let t = w.getTile(x, y, z) as { type: string; items: Items; cooldown?: number } | undefined;
  if (!t || !t.items) {
    t = { type, items: new Array(n).fill(null), ...(type === 'hopper' ? { cooldown: 0 } : {}) };
    w.setTile(x, y, z, t as never);
  }
  return t.items;
}

abstract class TileScreen extends ContainerScreen {
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  override changed() {
    const c = this.game.world!.chunkAt(this.x, this.z);
    if (c) c.modified = true;
  }
}

export class HopperScreen extends TileScreen {
  title = 'Item Hopper';
  override buildSlots() {
    this.ph = 133;
    const items = tileItems(this.ui, this.x, this.y, this.z, 'hopper', 5);
    for (let i = 0; i < 5; i++) this.slots.push({ x: 44 + i * 18, y: 20, get: () => items[i], set: (s) => (items[i] = s), group: 'hopper' });
    this.addPlayerSlots(8, 51, 109);
  }
  override init() { this.ph = 133; super.init(); }
  override quickTargets(s: Slot): string[] { return s.group === 'hopper' ? ['hotbar', 'main'] : ['hopper']; }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, 'Item Hopper', 8, 6);
    this.label(ctx, 'Inventory', 8, 40);
  }
}

export class DispenserScreen extends TileScreen {
  title = 'Dispenser';
  constructor(ui: UI, x: number, y: number, z: number, public dropper: boolean) { super(ui, x, y, z); this.title = dropper ? 'Dropper' : 'Dispenser'; }
  override buildSlots() {
    const items = tileItems(this.ui, this.x, this.y, this.z, this.dropper ? 'dropper' : 'dispenser', 9);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const i = r * 3 + c;
        this.slots.push({ x: 62 + c * 18, y: 17 + r * 18, get: () => items[i], set: (s) => (items[i] = s), group: 'disp' });
      }
    this.addPlayerSlots();
  }
  override quickTargets(s: Slot): string[] { return s.group === 'disp' ? ['hotbar', 'main'] : ['disp']; }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, this.title, 88 - this.gui.font.width(this.title) / 2, 6);
    this.label(ctx, 'Inventory', 8, 72);
  }
}

export class BrewingScreen extends TileScreen {
  title = 'Brewing Stand';
  tile!: BrewingTile;
  override buildSlots() {
    const w = this.game.world!;
    let t = w.getTile(this.x, this.y, this.z) as BrewingTile | undefined;
    if (!t || t.type !== 'brewing') { t = newBrewingTile(); w.setTile(this.x, this.y, this.z, t as never); }
    this.tile = t;
    const it = t.items;
    const bottle = (s: ItemStack) => !!getItem(s.id).potion || s.id === I3.GLASS_BOTTLE;
    [[56, 51], [79, 58], [102, 51]].forEach(([x, y], i) => this.slots.push({ x, y, get: () => it[i], set: (s) => (it[i] = s), group: 'bottle', limit: 1, canPlace: bottle }));
    this.slots.push({ x: 79, y: 17, get: () => it[3], set: (s) => (it[3] = s), group: 'ingredient', canPlace: (s) => isBrewingIngredient(s.id) });
    this.slots.push({ x: 17, y: 17, get: () => it[4], set: (s) => (it[4] = s), group: 'fuel', canPlace: (s) => s.id === I2.BLAZE_POWDER });
    this.addPlayerSlots();
  }
  override quickTargets(s: Slot, st: ItemStack): string[] {
    if (s.group === 'main' || s.group === 'hotbar') {
      if (st.id === I2.BLAZE_POWDER) return ['fuel', 'ingredient'];
      if (isBrewingIngredient(st.id)) return ['ingredient'];
      if (getItem(st.id).potion || st.id === I3.GLASS_BOTTLE) return ['bottle'];
    }
    return super.quickTargets(s, st);
  }
  override drawBackground(ctx: Ctx) {
    const L = this.left, T = this.top, t = this.tile;
    // stand silhouette
    ctx.fillStyle = '#7a7a7a';
    ctx.fillRect(L + 83, T + 36, 8, 15);
    ctx.fillRect(L + 62, T + 44, 20, 3);
    ctx.fillRect(L + 92, T + 44, 20, 3);
    ctx.fillRect(L + 62, T + 44, 3, 7);
    ctx.fillRect(L + 109, T + 44, 3, 7);
    // brewing progress: arrow down on the right, bubbles rising on the left
    const f = t.brewTime > 0 ? 1 - t.brewTime / BREW_TIME : 0;
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(L + 97, T + 16, 9, 28);
    if (f > 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(L + 97, T + 16, 9, Math.round(28 * f)); }
    const bub = t.brewTime > 0 ? [0, 6, 11, 16, 20, 24, 29][Math.floor(((BREW_TIME - t.brewTime) / 2) % 7)] : 0;
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(L + 63, T + 14, 11, 29);
    if (bub) {
      ctx.fillStyle = '#e8e8ff';
      for (let k = 0; k < bub; k += 4) ctx.fillRect(L + 64 + ((k * 7) % 9), T + 42 - k, 2, 2);
    }
    // fuel bar (20 brews per blaze powder)
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(L + 60, T + 44 - 0, 0, 0);
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(L + 60, T + 62 + 8, 18, 4);
    if (t.fuel > 0) { ctx.fillStyle = '#ff8a1a'; ctx.fillRect(L + 60, T + 62 + 8, Math.ceil((18 * t.fuel) / 20), 4); }
    // fuel slot hint
    if (!t.items[4]) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(L + 17, T + 17, 16, 16); }
  }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, 'Brewing Stand', 88 - this.gui.font.width('Brewing Stand') / 2, 6);
    this.label(ctx, 'Inventory', 8, 72);
  }
}

export class AnvilScreen extends ContainerScreen {
  title = 'Repair & Name';
  items: Items = [null, null];
  result: AnvilResult | null = null;
  field!: TextField;
  private lastLeft: ItemStack | null = null;
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  override init() {
    const prev = this.field?.value ?? '';
    this.field = new TextField(this.ui, 0, 0, 103, 12, prev, 30);
    super.init();
    this.field.x = this.left + 62;
    this.field.y = this.top + 24;
    this.field.focused = true;
    this.widgets = [this.field];
  }
  override buildSlots() {
    const it = this.items;
    this.slots.push({ x: 27, y: 47, get: () => it[0], set: (s) => { it[0] = s; this.onLeftChanged(); }, group: 'left' });
    this.slots.push({ x: 76, y: 47, get: () => it[1], set: (s) => (it[1] = s), group: 'right' });
    this.slots.push({
      x: 134, y: 47, group: 'out', output: true,
      get: () => (this.result && this.affordable() ? this.result.out : null),
      set: () => {},
      onTake: () => this.take(),
    });
    this.addPlayerSlots();
  }
  private onLeftChanged() {
    const l = this.items[0];
    if (l !== this.lastLeft) {
      this.lastLeft = l;
      if (this.field) this.field.value = l ? stackName(l) : '';
    }
  }
  private affordable() {
    const p = this.game.player!;
    return !!this.result && (p.creative || (p.xpLevel >= this.result.cost && this.result.cost < 40));
  }
  override changed() {
    const l = this.items[0];
    this.onLeftChanged();
    const name = l && this.field ? (this.field.value === getItem(l.id).display && !l.name ? null : this.field.value) : null;
    this.result = anvilCombine(l, this.items[1], name);
  }
  private take() {
    const p = this.game.player!, r = this.result!;
    if (!p.creative) p.xpLevel = Math.max(0, p.xpLevel - r.cost);
    this.items[0] = null;
    const right = this.items[1];
    if (right && r.useRight) { right.count -= r.useRight; if (right.count <= 0) this.items[1] = null; }
    this.lastLeft = null;
    this.field.value = '';
    this.result = null;
    // anvils get damaged with use (12% chance), and break after three steps
    const w = this.game.world!;
    const v = w.get(this.x, this.y, this.z);
    if (!p.creative && idOf(v) === B.ANVIL && Math.random() < 0.12) {
      const dmg = ((metaOf(v) >> 2) & 3) + 1;
      if (dmg > 2) {
        w.set(this.x, this.y, this.z, B.AIR);
        this.game.audio.play('anvil.land', { x: this.x + 0.5, y: this.y + 0.5, z: this.z + 0.5 }, 1, 0.6);
        this.close();
        return;
      }
      w.set(this.x, this.y, this.z, pack(B.ANVIL, (metaOf(v) & 3) | (dmg << 2)));
    }
    this.game.audio.play('anvil.use', { x: this.x + 0.5, y: this.y + 0.5, z: this.z + 0.5 }, 1, 1);
  }
  override char(ch: string) {
    super.char(ch);
    this.changed();
  }
  override key(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') { this.close(); return true; }
    if (this.field.focused && this.field.key(e)) { this.changed(); return true; }
    return super.key(e);
  }
  override quickTargets(s: Slot, st: ItemStack): string[] {
    if (s.group === 'main' || s.group === 'hotbar') return this.items[0] ? ['right'] : ['left'];
    return super.quickTargets(s, st);
  }
  override drawBackground(ctx: Ctx) {
    this.changed();
    const L = this.left, T = this.top;
    // hammer icon
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(L + 16, T + 8, 18, 8);
    ctx.fillRect(L + 23, T + 16, 4, 10);
    // plus and arrow
    ctx.fillStyle = '#6a6a6a';
    ctx.fillRect(L + 54, T + 53, 13, 3);
    ctx.fillRect(L + 59, T + 48, 3, 13);
    arrow(ctx, L + 102, T + 48, 0);
    if (this.items[0] && !this.result && this.items[1]) {
      ctx.fillStyle = '#c02020';
      ctx.fillRect(L + 103, T + 50, 16, 3); ctx.fillRect(L + 109, T + 44, 3, 15);
    }
  }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, 'Repair & Name', 60, 6);
    this.label(ctx, 'Inventory', 8, 72);
    const r = this.result;
    if (r) {
      const p = this.game.player!;
      const tooMuch = r.cost >= 40 && !p.creative;
      const t = tooMuch ? 'Too Expensive!' : `Enchantment Cost: ${r.cost}`;
      const ok = this.affordable();
      const w = this.gui.font.width(t);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(this.left + 168 - w - 6, this.top + 67, w + 4, 11);
      this.gui.text(ctx, t, this.left + 168 - w - 4, this.top + 69, ok ? '#80FF20' : '#FF6060');
    }
  }
  override onClose() {
    this.giveBack(this.items);
    super.onClose();
  }
}
