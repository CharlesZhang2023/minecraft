// Container screens with Minecraft's slot-click semantics.
import { Screen, TextField } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { ItemStack, getItem, sameItem, cloneStack, ITEMS, ItemDef, I, I2, I3, POTION_ITEMS, itemByName } from '../game/items';
import { craft, SMELTING } from '../game/recipes';
import { addToSlots } from '../game/inventory';
import { BLOCKS, Render, B, isLeaves, isSapling, isStairs, isSlab } from '../world/blocks';
import { COOK_TIME, FurnaceTile } from '../game/furnace';
import { enchName, ENCHANTS } from '../game/enchant';
import { drawEffectList } from './effects';
import { POTION_BY_KEY, effectLine } from '../game/potiondata';

export interface Slot {
  x: number; y: number;
  get(): ItemStack | null;
  set(s: ItemStack | null): void;
  canPlace?(s: ItemStack): boolean;
  output?: boolean;
  group: string;
  limit?: number;
  onTake?(taken: ItemStack): void;
  infinite?: boolean; // creative palette
  big?: boolean; // large result slot
}

const inSlot = (s: Slot, mx: number, my: number, ox: number, oy: number) => mx >= ox + s.x - 1 && my >= oy + s.y - 1 && mx < ox + s.x + 17 && my < oy + s.y + 17;

export abstract class ContainerScreen extends Screen {
  pw = 176;
  ph = 166;
  left = 0;
  top = 0;
  slots: Slot[] = [];
  cursor: ItemStack | null = null;
  override hidesSelection = true;
  override touchTools = true;
  private drag: { button: number; slots: Slot[]; start: ItemStack } | null = null;
  private lastClick = { t: 0, slot: null as Slot | null };
  abstract title: string;

  get player() { return this.game.player!; }
  get inv() { return this.player.inventory; }

  override init() {
    this.left = Math.floor((this.gui.w - this.pw) / 2);
    this.top = Math.floor((this.gui.h - this.ph) / 2);
    this.slots = [];
    this.buildSlots();
  }
  abstract buildSlots(): void;

  addPlayerSlots(x0 = 8, y0 = 84, hotY = 142) {
    const m = this.inv.main;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 9; c++) {
        const i = 9 + r * 9 + c;
        this.slots.push({ x: x0 + c * 18, y: y0 + r * 18, get: () => m[i], set: (s) => (m[i] = s), group: 'main' });
      }
    for (let c = 0; c < 9; c++) this.slots.push({ x: x0 + c * 18, y: hotY, get: () => m[c], set: (s) => (m[c] = s), group: 'hotbar' });
  }

  drawPanelBase(ctx: Ctx) {
    this.gui.panel(ctx, this.left, this.top, this.pw, this.ph);
  }

  override render(ctx: Ctx, mx: number, my: number) {
    this.backgroundGradient(ctx);
    this.drawPanelBase(ctx);
    this.drawBackground(ctx, mx, my);
    const L = this.left, T = this.top;
    for (const s of this.slots) this.gui.slot(ctx, L + s.x - 1, T + s.y - 1, s.big ? 26 : 18, s.big ? 26 : 18);
    for (const s of this.slots) {
      const st = s.get();
      const ox = s.big ? 4 : 0;
      if (st) this.ui.drawItem(ctx, st, L + s.x + ox, T + s.y + ox);
      if (this.drag && this.drag.slots.includes(s) && this.drag.slots.length > 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(L + s.x + ox, T + s.y + ox, 16, 16);
      }
    }
    const hover = this.slotAt(mx, my);
    if (hover) {
      const ox = hover.big ? 4 : 0;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(L + hover.x + ox, T + hover.y + ox, 16, 16);
    }
    this.drawForeground(ctx, mx, my);
    super.render(ctx, mx, my);
    if (this.cursor) this.ui.drawItem(ctx, this.cursor, mx - 8, my - 8);
    else if (hover?.get()) this.gui.tooltip(ctx, tooltipLines(hover.get()!), mx, my);
  }
  drawBackground(_ctx: Ctx, _mx: number, _my: number) {}
  drawForeground(_ctx: Ctx, _mx: number, _my: number) {}

  slotAt(mx: number, my: number): Slot | null {
    for (const s of this.slots) {
      if (s.big) {
        if (mx >= this.left + s.x + 3 && my >= this.top + s.y + 3 && mx < this.left + s.x + 21 && my < this.top + s.y + 21) return s;
      } else if (inSlot(s, mx, my, this.left, this.top)) return s;
    }
    return null;
  }

  // ---------------------------------------------------------------- clicks
  override mouseDown(mx: number, my: number, button: number): boolean {
    if (super.mouseDown(mx, my, button)) return true;
    const s = this.slotAt(mx, my);
    const shift = this.game.input.isDown('ShiftLeft') || this.game.input.isDown('ShiftRight');
    if (!s) {
      if (this.outsidePanel(mx, my) && this.cursor) {
        if (button === 0) { this.game.interact!.throwStack(this.cursor); this.cursor = null; }
        else if (button === 2) {
          this.game.interact!.throwStack({ ...this.cursor, count: 1 });
          this.cursor.count--;
          if (this.cursor.count <= 0) this.cursor = null;
        }
      }
      return true;
    }
    if (button === 2 && this.game.player!.creative && s.get() && !this.cursor) {
      // middle-click clone (creative)
      const it = s.get()!;
      this.cursor = { ...it, count: getItem(it.id).maxStack };
      return true;
    }
    if (shift && (button === 0 || button === 2)) { this.quickMove(s); this.changed(); return true; }
    // double click: collect all of this item
    const now = performance.now();
    if (button === 0 && this.lastClick.slot === s && now - this.lastClick.t < 250 && this.cursor && !s.output) {
      this.collect();
      this.lastClick.t = 0;
      return true;
    }
    this.lastClick = { t: now, slot: s };
    if (this.cursor && !s.output && !s.infinite && (button === 0 || button === 2)) {
      this.drag = { button, slots: [s], start: { ...this.cursor } };
      return true;
    }
    this.click(s, button);
    this.changed();
    return true;
  }

  override mouseMove(mx: number, my: number) {
    super.mouseMove(mx, my);
    if (!this.drag) return;
    const s = this.slotAt(mx, my);
    if (!s || s.output || s.infinite || this.drag.slots.includes(s)) return;
    const cur = s.get();
    if (cur && !sameItem(cur, this.drag.start)) return;
    if (s.canPlace && !s.canPlace(this.drag.start)) return;
    if (this.drag.slots.length >= this.drag.start.count && this.drag.button === 0) return;
    this.drag.slots.push(s);
  }

  override mouseUp(mx: number, my: number, button: number) {
    super.mouseUp(mx, my, button);
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.slots.length === 1) {
      this.click(d.slots[0], d.button);
      this.changed();
      return;
    }
    // distribute
    const total = this.cursor!.count;
    const per = d.button === 0 ? Math.floor(total / d.slots.length) : 1;
    let left = total;
    for (const s of d.slots) {
      const cur = s.get();
      const max = Math.min(getItem(d.start.id).maxStack, s.limit ?? 64);
      const have = cur ? cur.count : 0;
      const k = Math.min(per, max - have, left);
      if (k <= 0) continue;
      s.set({ ...d.start, count: have + k });
      left -= k;
    }
    this.cursor = left > 0 ? { ...d.start, count: left } : null;
    this.changed();
  }

  click(s: Slot, button: number) {
    const cur = s.get();
    if (s.infinite) {
      if (this.cursor) { this.cursor = null; return; }
      if (cur) this.cursor = { ...cur, count: button === 0 ? getItem(cur.id).maxStack : 1 };
      return;
    }
    if (s.output) {
      if (!cur) return;
      if (this.cursor && (!sameItem(this.cursor, cur) || this.cursor.count + cur.count > getItem(cur.id).maxStack)) return;
      if (this.cursor) this.cursor.count += cur.count;
      else this.cursor = cloneStack(cur);
      s.set(null);
      s.onTake?.(cur);
      return;
    }
    const limit = (st: ItemStack) => Math.min(getItem(st.id).maxStack, s.limit ?? 64);
    if (button === 0) {
      if (!this.cursor) { this.cursor = cur; s.set(null); }
      else if (!cur) {
        if (s.canPlace && !s.canPlace(this.cursor)) return;
        const k = Math.min(this.cursor.count, limit(this.cursor));
        s.set({ ...this.cursor, count: k });
        this.cursor.count -= k;
        if (this.cursor.count <= 0) this.cursor = null;
      } else if (sameItem(cur, this.cursor)) {
        const k = Math.min(this.cursor.count, limit(cur) - cur.count);
        cur.count += k;
        this.cursor.count -= k;
        if (this.cursor.count <= 0) this.cursor = null;
      } else {
        if (s.canPlace && !s.canPlace(this.cursor)) return;
        if (this.cursor.count > limit(this.cursor)) return;
        s.set(this.cursor);
        this.cursor = cur;
      }
    } else if (button === 2) {
      if (!this.cursor) {
        if (!cur) return;
        const half = Math.ceil(cur.count / 2);
        this.cursor = { ...cur, count: half };
        cur.count -= half;
        if (cur.count <= 0) s.set(null);
      } else if (!cur) {
        if (s.canPlace && !s.canPlace(this.cursor)) return;
        s.set({ ...this.cursor, count: 1 });
        this.cursor.count--;
        if (this.cursor.count <= 0) this.cursor = null;
      } else if (sameItem(cur, this.cursor) && cur.count < limit(cur)) {
        cur.count++;
        this.cursor.count--;
        if (this.cursor.count <= 0) this.cursor = null;
      } else if (!sameItem(cur, this.cursor)) {
        if (s.canPlace && !s.canPlace(this.cursor)) return;
        s.set(this.cursor);
        this.cursor = cur;
      }
    }
  }

  private collect() {
    const c = this.cursor!;
    const max = getItem(c.id).maxStack;
    for (const s of this.slots) {
      if (c.count >= max) break;
      const st = s.get();
      if (!st || s.output || s.infinite || !sameItem(st, c)) continue;
      const k = Math.min(max - c.count, st.count);
      c.count += k;
      st.count -= k;
      if (st.count <= 0) s.set(null);
    }
  }

  /** Shift-click behaviour. */
  quickMove(s: Slot) {
    const st = s.get();
    if (!st) return;
    if (s.output) {
      // craft repeatedly into the inventory
      for (let n = 0; n < 64; n++) {
        const r = s.get();
        if (!r) break;
        if (!this.tryInsert(r, ['hotbar', 'main'], true)) break;
        s.set(null);
        s.onTake?.(r);
        this.changed();
      }
      return;
    }
    const targets = this.quickTargets(s, st);
    const left = this.insertInto(st, targets);
    if (left <= 0) s.set(null);
    else st.count = left;
  }

  quickTargets(s: Slot, _st: ItemStack): string[] {
    if (s.group === 'hotbar') return ['main'];
    if (s.group === 'main') return ['hotbar'];
    return ['main', 'hotbar'];
  }

  private tryInsert(st: ItemStack, groups: string[], reverseHotbar = false): boolean {
    const sim = this.slots.filter((s) => groups.includes(s.group)).map((s) => cloneStack(s.get()));
    const order = sim.map((_, i) => i);
    if (reverseHotbar) order.reverse();
    const left = addToSlots(sim, { ...st }, order);
    if (left > 0) return false;
    this.insertInto(st, groups, reverseHotbar);
    return true;
  }

  insertInto(st: ItemStack, groups: string[], reverse = false): number {
    let left = st.count;
    const max = getItem(st.id).maxStack;
    const targets = this.slots.filter((s) => groups.includes(s.group) && !s.output && (!s.canPlace || s.canPlace(st)));
    if (reverse) targets.reverse();
    for (const t of targets) {
      const cur = t.get();
      if (cur && sameItem(cur, st)) {
        const k = Math.min(Math.min(max, t.limit ?? 64) - cur.count, left);
        if (k > 0) { cur.count += k; left -= k; }
        if (!left) return 0;
      }
    }
    for (const t of targets) {
      if (!t.get()) {
        const k = Math.min(Math.min(max, t.limit ?? 64), left);
        t.set({ ...st, count: k });
        left -= k;
        if (!left) return 0;
      }
    }
    return left;
  }

  changed() {}

  outsidePanel(mx: number, my: number) {
    return mx < this.left || my < this.top || mx >= this.left + this.pw || my >= this.top + this.ph;
  }

  override key(e: KeyboardEvent): boolean {
    for (const w of this.widgets) if (w.key?.(e)) return true;
    if (e.code === 'Escape' || e.code === 'KeyE') { this.close(); return true; }
    const s = this.slotAt(this.ui.mx, this.ui.my);
    if (s && e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5)) - 1;
      if (n >= 0 && n < 9 && !s.output && !s.infinite) {
        const hot = this.inv.main[n];
        const cur = s.get();
        if (s.canPlace && hot && !s.canPlace(hot)) return true;
        this.inv.main[n] = cur;
        s.set(hot);
        this.changed();
      } else if (n >= 0 && n < 9 && s.get()) {
        const it = s.get()!;
        this.inv.main[n] = s.infinite ? { ...it, count: getItem(it.id).maxStack } : it;
        if (!s.infinite) { s.set(null); s.onTake?.(it); }
        this.changed();
      }
      return true;
    }
    if (s && e.code === 'KeyQ' && s.get() && !s.infinite) {
      const st = s.get()!;
      const all = e.ctrlKey || e.metaKey;
      const n = all ? st.count : 1;
      this.game.interact!.throwStack({ ...st, count: n });
      st.count -= n;
      if (st.count <= 0) { s.set(null); s.onTake?.(st); }
      this.changed();
      return true;
    }
    return true;
  }

  override onClose() {
    if (this.cursor) {
      const left = this.inv.add(this.cursor);
      if (left > 0) this.game.interact!.throwStack({ ...this.cursor, count: left });
      this.cursor = null;
    }
  }

  giveBack(items: (ItemStack | null)[]) {
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      if (!s) continue;
      const left = this.inv.add(s);
      if (left > 0) this.game.interact!.throwStack({ ...s, count: left });
      items[i] = null;
    }
  }

  label(ctx: Ctx, t: string, x: number, y: number) {
    this.gui.text(ctx, t, this.left + x, this.top + y, '#404040', false);
  }
}

export function tooltipLines(s: ItemStack): string[] {
  const d = getItem(s.id);
  const col = d.rarity === 'rare' ? '§b' : d.rarity === 'uncommon' ? '§e' : s.ench ? '§b' : '';
  const lines = [col + (s.name ?? d.display)];
  if (d.potion) {
    const type = POTION_BY_KEY.get(d.potion);
    if (type && type.effects.length) for (const e of type.effects) lines.push(effectLine(e));
    else lines.push('§7No Effects');
  }
  if (s.ench) for (const [k, v] of Object.entries(s.ench)) lines.push('§7' + enchName(k, v));
  if (d.tool?.type === 'sword' || d.attack) lines.push('', `§9+${d.attack ?? 1} Attack Damage`);
  if (d.armor) lines.push('', `§9+${d.armor.points} Armor`);
  if (d.durability && s.damage) lines.push(`Durability: ${d.durability - s.damage} / ${d.durability}`);
  if (d.food) lines.push(`§7Restores ${d.food.hunger / 2} hunger`);
  return lines;
}

// ------------------------------------------------------------------ crafting helpers
class CraftGrid {
  items: (ItemStack | null)[];
  result: ItemStack | null = null;
  constructor(public size: number) {
    this.items = new Array(size * size).fill(null);
  }
  update() {
    this.result = craft(this.items, this.size);
  }
  consume() {
    for (let i = 0; i < this.items.length; i++) {
      const s = this.items[i];
      if (!s) continue;
      s.count--;
      if (s.count <= 0) this.items[i] = null;
    }
    this.update();
  }
}

function addGridSlots(scr: ContainerScreen, g: CraftGrid, x0: number, y0: number, rx: number, ry: number, big = true) {
  for (let r = 0; r < g.size; r++)
    for (let c = 0; c < g.size; c++) {
      const i = r * g.size + c;
      scr.slots.push({ x: x0 + c * 18, y: y0 + r * 18, get: () => g.items[i], set: (s) => { g.items[i] = s; }, group: 'craft' });
    }
  scr.slots.push({ x: big ? rx - 4 : rx, y: big ? ry - 4 : ry, get: () => g.result, set: (s) => { g.result = s; }, output: true, big, group: 'result', onTake: (t) => { scr.game.achievements.onCraft(t.id); g.consume(); } });
}

export function arrow(ctx: Ctx, x: number, y: number, progress = 0, len = 22) {
  const shaft = len - 7;
  const shape = (col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y + 6, shaft, 4);
    for (let i = 0; i < 8; i++) ctx.fillRect(x + shaft + i, y + i, 1, 16 - i * 2);
  };
  shape('#8b8b8b');
  if (progress > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, len * progress + 0.5, 17);
    ctx.clip();
    shape('#ffffff');
    ctx.restore();
  }
}

// ------------------------------------------------------------------ player inventory
export class InventoryScreen extends ContainerScreen {
  title = 'Crafting';
  grid = new CraftGrid(2);
  override buildSlots() {
    const armor = this.inv.armor;
    for (let i = 0; i < 4; i++)
      this.slots.push({ x: 8, y: 8 + i * 18, get: () => armor[i], set: (s) => (armor[i] = s), group: 'armor', limit: 1, canPlace: (s) => getItem(s.id).armor?.slot === i || (i === 0 && s.id === B.PUMPKIN) });
    addGridSlots(this, this.grid, 98, 18, 154, 28, false);
    this.addPlayerSlots();
  }
  override changed() { this.grid.update(); }
  override init() {
    super.init();
    // 1.8: the inventory shifts right to make room for the effect list
    if (this.player.effects.size) this.left += 60;
  }
  override quickTargets(s: Slot, st: ItemStack): string[] {
    if ((s.group === 'main' || s.group === 'hotbar') && getItem(st.id).armor) {
      const slot = getItem(st.id).armor!.slot;
      if (!this.inv.armor[slot]) return ['armor'];
    }
    return super.quickTargets(s, st);
  }
  override drawBackground(ctx: Ctx, mx: number, my: number) {
    const L = this.left, T = this.top;
    drawEffectList(ctx, this.ui, L - 124, T);
    // player preview box
    ctx.fillStyle = '#000000';
    ctx.fillRect(L + 25, T + 7, 52, 72);
    ctx.clearRect(L + 26, T + 8, 50, 70);
    this.ui.previewBox = { x: L + 26, y: T + 8, w: 50, h: 70, yaw: Math.atan((L + 51 - mx) / 40), pitch: Math.atan((T + 25 - my) / 40) };
    arrow(ctx, L + 135, T + 29, 0, 16);
  }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, 'Crafting', 97, 6);
  }
  override onClose() {
    this.giveBack(this.grid.items);
    this.ui.previewBox = null;
    super.onClose();
  }
}

export class CraftingScreen extends ContainerScreen {
  title = 'Crafting';
  grid = new CraftGrid(3);
  override buildSlots() {
    addGridSlots(this, this.grid, 30, 17, 124, 35);
    this.addPlayerSlots();
  }
  override changed() { this.grid.update(); }
  override drawBackground(ctx: Ctx) { arrow(ctx, this.left + 90, this.top + 35); }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, 'Crafting', 28, 6);
    this.label(ctx, 'Inventory', 8, 72);
  }
  override onClose() {
    this.giveBack(this.grid.items);
    super.onClose();
  }
}

export class FurnaceScreen extends ContainerScreen {
  title = 'Furnace';
  tile!: FurnaceTile;
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  override buildSlots() {
    const w = this.game.world!;
    let t = w.getTile(this.x, this.y, this.z) as unknown as FurnaceTile | undefined;
    if (!t) {
      t = { type: 'furnace', slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 };
      w.setTile(this.x, this.y, this.z, t as unknown as { type: 'furnace' });
    }
    this.tile = t;
    const sl = t.slots;
    this.slots.push({ x: 56, y: 17, get: () => sl[0], set: (s) => (sl[0] = s), group: 'input' });
    this.slots.push({ x: 56, y: 53, get: () => sl[1], set: (s) => (sl[1] = s), group: 'fuel', canPlace: (s) => !!getItem(s.id).fuel });
    this.slots.push({ x: 112, y: 31, get: () => sl[2], set: (s) => (sl[2] = s), group: 'out', output: true, big: true, onTake: (t) => { this.game.achievements.onSmelt(t.id); this.takeXp(); } });
    this.addPlayerSlots();
  }
  takeXp() {
    const xp = Math.floor(this.tile.xp ?? 0);
    if (xp > 0) { this.game.player!.addXp(xp); this.tile.xp = (this.tile.xp ?? 0) - xp; this.game.audio.play('orb', null, 0.3, 1); }
  }
  override quickTargets(s: Slot, st: ItemStack): string[] {
    if (s.group === 'main' || s.group === 'hotbar') {
      if (SMELTING[st.id]) return ['input'];
      if (getItem(st.id).fuel) return ['fuel'];
    }
    return super.quickTargets(s, st);
  }
  override drawBackground(ctx: Ctx) {
    const L = this.left, T = this.top, t = this.tile;
    // flame
    ctx.fillStyle = '#8b8b8b';
    ctx.fillRect(L + 57, T + 37, 13, 13);
    if (t.burn > 0 && t.burnMax > 0) {
      const f = t.burn / t.burnMax;
      const h = Math.ceil(13 * f);
      ctx.fillStyle = '#ff9a1a';
      ctx.fillRect(L + 57, T + 37 + 13 - h, 13, h);
      ctx.fillStyle = '#ffd84a';
      ctx.fillRect(L + 60, T + 37 + 13 - Math.max(0, h - 3), 7, Math.max(0, h - 3));
    }
    arrow(ctx, L + 79, T + 34, t.cook / COOK_TIME);
  }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, 'Furnace', 88 - this.gui.font.width('Furnace') / 2, 6);
    this.label(ctx, 'Inventory', 8, 72);
  }
}

export class ChestScreen extends ContainerScreen {
  title = 'Chest';
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  override buildSlots() {
    const w = this.game.world!;
    let t = w.getTile(this.x, this.y, this.z) as unknown as { type: 'chest'; items: (ItemStack | null)[] } | undefined;
    if (!t) {
      t = { type: 'chest', items: new Array(27).fill(null) };
      w.setTile(this.x, this.y, this.z, t);
    }
    const items = t.items;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 9; c++) {
        const i = r * 9 + c;
        this.slots.push({ x: 8 + c * 18, y: 18 + r * 18, get: () => items[i], set: (s) => (items[i] = s), group: 'chest' });
      }
    this.addPlayerSlots();
  }
  override quickTargets(s: Slot): string[] {
    return s.group === 'chest' ? ['hotbar', 'main'] : ['chest'];
  }
  override changed() {
    const c = this.game.world!.chunkAt(this.x, this.z);
    if (c) c.modified = true;
  }
  override drawForeground(ctx: Ctx) {
    this.label(ctx, 'Chest', 8, 6);
    this.label(ctx, 'Inventory', 8, 72);
  }
  override onClose() {
    this.changed();
    this.game.audio.play('chestClose', { x: this.x + 0.5, y: this.y + 0.5, z: this.z + 0.5 }, 0.5, 0.9 + Math.random() * 0.1);
    super.onClose();
  }
}

// ------------------------------------------------------------------ creative
type Tab = { name: string; icon: number; items: () => ItemStack[] };
const one = (id: number): ItemStack => ({ id, count: 1 });
const defs = () => [...ITEMS.values()].filter((d) => d.id !== 0);
const REDSTONE_IDS = [I.REDSTONE, B.REDSTONE_TORCH, I3.REPEATER, I3.COMPARATOR, B.REDSTONE_BLOCK, B.LEVER, B.STONE_BUTTON, B.STONE_PRESSURE_PLATE,
  B.PISTON, B.STICKY_PISTON, B.OBSERVER, B.DISPENSER, B.DROPPER, B.HOPPER, B.REDSTONE_LAMP, B.TNT, I.OAK_DOOR];
const BREWING_IDS = [I3.GLASS_BOTTLE, I.GHAST_TEAR, I3.FERMENTED_SPIDER_EYE, I2.BLAZE_POWDER, I3.MAGMA_CREAM, I3.BREWING_STAND, I3.GLISTERING_MELON, I.SPIDER_EYE];
const MISC_IDS = [I.BUCKET, I.WATER_BUCKET, I.LAVA_BUCKET, I.MILK_BUCKET, I.FIRE_CHARGE, I2.ENDER_EYE, I.PAPER, I.BOOK, I2.SLIME_BALL, I.BONE_MEAL, I.SNOWBALL];
const TOOL_ENCH = ['efficiency', 'silk_touch', 'unbreaking', 'fortune', 'luck_of_the_sea', 'lure'];
const special = new Set<number>([...REDSTONE_IDS, ...BREWING_IDS, ...MISC_IDS, I2.BOAT, I3.ENCHANTED_BOOK]);
const isFood = (d: ItemDef) => !!d.food && !d.potion;
const isTool = (d: ItemDef) => (!!d.tool && d.tool.type !== 'sword') || [I.FLINT_AND_STEEL, I.COMPASS, I.CLOCK, I2.FISHING_ROD, I3.NAME_TAG].includes(d.id);
const isCombat = (d: ItemDef) => d.tool?.type === 'sword' || !!d.armor || d.id === I.BOW || d.id === I.ARROW || d.id === I.EGG || d.id === I.ENDER_PEARL;
const isDecoration = (d: ItemDef) => {
  if (d.block === undefined || d.sprite) return d.id === I.RED_BED || d.id === I3.NETHER_WART && false;
  const b = BLOCKS[d.block];
  return b.render !== Render.Cube && !isStairs(b.id) && !isSlab(b.id) || isLeaves(b.id) || isSapling(b.id) || [B.CRAFTING_TABLE, B.FURNACE, B.CHEST, B.PUMPKIN, B.JACK_O_LANTERN, B.MELON, B.BOOKSHELF, B.GLOWSTONE, B.SPONGE, B.SLIME_BLOCK].includes(b.id);
};
const isBuilding = (d: ItemDef) => d.block !== undefined && !d.sprite && !isDecoration(d);
const books = (filter: (id: string) => boolean, allLevels: boolean): ItemStack[] => {
  const out: ItemStack[] = [];
  for (const e of ENCHANTS) {
    if (!filter(e.id)) continue;
    for (let l = allLevels ? 1 : e.max; l <= e.max; l++) out.push({ id: I3.ENCHANTED_BOOK, count: 1, ench: { [e.id]: l } });
  }
  return out;
};
const potions = (): ItemStack[] => [...defs().filter((d) => d.potion && !d.splash), ...defs().filter((d) => d.splash)].map((d) => one(d.id));
const general = (f: (d: ItemDef) => boolean) => () => defs().filter((d) => !special.has(d.id) && !d.egg && !d.potion && f(d)).map((d) => one(d.id));
const TABS: Tab[] = [
  { name: 'Building Blocks', icon: B.BRICKS, items: general(isBuilding) },
  { name: 'Decoration Blocks', icon: B.POPPY, items: general(isDecoration) },
  { name: 'Redstone', icon: I.REDSTONE, items: () => REDSTONE_IDS.map(one) },
  { name: 'Transportation', icon: I2.BOAT, items: () => [one(I2.BOAT)] },
  { name: 'Miscellaneous', icon: I.LAVA_BUCKET, items: () => [...MISC_IDS.map(one), ...defs().filter((d) => d.egg).map((d) => one(d.id))] },
  { name: 'Search Items', icon: I.COMPASS, items: () => [...defs().filter((d) => d.id !== I3.ENCHANTED_BOOK).map((d) => one(d.id)), ...books(() => true, true)] },
  { name: 'Foodstuffs', icon: I.APPLE, items: general(isFood) },
  { name: 'Tools', icon: 0, items: () => [...general(isTool)(), ...books((e) => TOOL_ENCH.includes(e), false)] },
  { name: 'Combat', icon: 0, items: () => [...general(isCombat)(), ...books((e) => !TOOL_ENCH.includes(e), false)] },
  { name: 'Brewing', icon: 0, items: () => [...potions(), ...BREWING_IDS.map(one)] },
  { name: 'Materials', icon: I.STICK, items: general((d) => !isBuilding(d) && !isDecoration(d) && !isFood(d) && !isTool(d) && !isCombat(d)) },
  { name: 'Survival Inventory', icon: B.CHEST, items: () => [] },
];
const SEARCH = 5, SURVIVAL = 11;

export class CreativeScreen extends ContainerScreen {
  title = 'Creative';
  tab = 0;
  scroll = 0;
  items: ItemStack[] = [];
  search!: TextField;
  private draggingScroll = false;
  override init() {
    this.pw = 195;
    this.ph = 136;
    TABS[7].icon = itemByName('iron_axe')?.id ?? I.STICK;
    TABS[8].icon = itemByName('golden_sword')?.id ?? I.BOW;
    TABS[9].icon = POTION_ITEMS.strength;
    this.search = new TextField(this.ui, 0, 0, 89, 11, this.search?.value ?? '', 30);
    super.init();
    this.search.x = this.left + 82;
    this.search.y = this.top + 5;
    this.search.visible = this.tab === SEARCH;
    this.search.focused = this.tab === SEARCH;
    this.widgets = [this.search];
  }
  override buildSlots() {
    this.refreshItems();
    const inv = this.inv;
    if (this.tab === SURVIVAL) {
      // survival inventory tab
      for (let i = 0; i < 4; i++) {
        const k = i;
        this.slots.push({ x: 54 + (i >> 1) * 54, y: 6 + (i & 1) * 27, get: () => inv.armor[k], set: (s) => (inv.armor[k] = s), group: 'armor', limit: 1, canPlace: (s) => getItem(s.id).armor?.slot === k });
      }
      this.addPlayerSlots(9, 54, 112);
      // destroy slot
      this.slots.push({ x: 173, y: 112, get: () => null, set: () => {}, group: 'trash', canPlace: () => true, infinite: true });
      return;
    }
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 9; c++) {
        const k = r * 9 + c;
        this.slots.push({ x: 9 + c * 18, y: 18 + r * 18, get: () => cloneStack(this.items[(this.scroll + r) * 9 + c] ?? null), set: () => {}, group: 'palette', infinite: true });
        void k;
      }
    for (let c = 0; c < 9; c++) this.slots.push({ x: 9 + c * 18, y: 112, get: () => inv.main[c], set: (s) => (inv.main[c] = s), group: 'hotbar' });
  }
  refreshItems() {
    const q = this.search?.value.toLowerCase() ?? '';
    const tab = TABS[this.tab];
    this.items = tab.items().filter((st) => this.tab !== SEARCH || !q || tooltipLines(st).join(' ').replace(/§./g, '').toLowerCase().includes(q));
    this.scroll = Math.min(this.scroll, this.maxScroll());
  }
  maxScroll() {
    return Math.max(0, Math.ceil(this.items.length / 9) - 5);
  }
  override quickMove(s: Slot) {
    if (s.infinite && s.get()) {
      const st = s.get()!;
      this.insertInto({ ...st, count: getItem(st.id).maxStack }, ['hotbar']);
      return;
    }
    if (this.tab !== SURVIVAL && s.group === 'hotbar') { s.set(null); return; }
    super.quickMove(s);
  }
  override click(s: Slot, button: number) {
    if (s.group === 'trash') { this.cursor = null; return; }
    super.click(s, button);
  }
  override drawPanelBase(ctx: Ctx) {
    const L = this.left, T = this.top;
    // tabs (behind)
    TABS.forEach((t, i) => {
      if (i === this.tab) return;
      const [tx, ty] = this.tabPos(i);
      this.gui.panel(ctx, tx, ty, 28, 30);
      if (t.icon) ctx.drawImage(this.game.icons.get(t.icon), tx + 6, ty + (ty < T ? 8 : 6), 16, 16);
    });
    this.gui.panel(ctx, L, T, this.pw, this.ph);
    const [tx, ty] = this.tabPos(this.tab);
    this.gui.panel(ctx, tx, ty, 28, 32);
    ctx.fillStyle = '#C6C6C6';
    ctx.fillRect(tx + 2, ty < T ? T : ty - 3, 24, 5);
    if (TABS[this.tab].icon) ctx.drawImage(this.game.icons.get(TABS[this.tab].icon), tx + 6, ty + (ty < T ? 8 : 8), 16, 16);
  }
  tabPos(i: number): [number, number] {
    const L = this.left, T = this.top;
    const x = i % 6 === 5 ? L + this.pw - 28 : L + (i % 6) * 29;
    return i < 6 ? [x, T - 28] : [x, T + this.ph - 4];
  }
  override drawBackground(ctx: Ctx, mx: number, my: number) {
    const L = this.left, T = this.top;
    if (this.tab !== SURVIVAL) {
      // scrollbar
      ctx.fillStyle = '#8b8b8b';
      ctx.fillRect(L + 174, T + 18, 14, 90);
      ctx.fillStyle = '#373737';
      ctx.fillRect(L + 174, T + 18, 14, 1);
      const ms = this.maxScroll();
      const ky = T + 18 + (ms ? (this.scroll / ms) * (90 - 15) : 0);
      this.gui.button(ctx, L + 175, ky, 12, 15, '', false, ms > 0);
    }
    this.label(ctx, TABS[this.tab].name, 8, 6);
    if (this.tab === SURVIVAL) {
      this.label(ctx, '', 0, 0);
      ctx.fillStyle = '#000000';
      ctx.fillRect(L + 72, T + 5, 34, 45);
      ctx.clearRect(L + 73, T + 6, 32, 43);
      this.ui.previewBox = { x: L + 73, y: T + 6, w: 32, h: 43, yaw: Math.atan((L + 89 - mx) / 40), pitch: Math.atan((T + 20 - my) / 40) };
      // trash icon
      ctx.fillStyle = '#8b2020';
      ctx.fillRect(L + 176, T + 115, 10, 10);
      this.gui.text(ctx, 'x', L + 179, T + 115, '#ffffff', false);
    } else this.ui.previewBox = null;
  }
  override drawForeground(ctx: Ctx, mx: number, my: number) {
    // tab tooltips
    TABS.forEach((t, i) => {
      const [tx, ty] = this.tabPos(i);
      if (mx >= tx && mx < tx + 28 && my >= ty && my < ty + 30 && !this.slotAt(mx, my)) this.gui.tooltip(ctx, [t.name], mx, my);
    });
  }
  override mouseDown(mx: number, my: number, button: number): boolean {
    for (let i = 0; i < TABS.length; i++) {
      const [tx, ty] = this.tabPos(i);
      if (mx >= tx && mx < tx + 28 && my >= ty && my < ty + 30 && !(my >= this.top && my < this.top + this.ph && mx >= this.left && mx < this.left + this.pw && i < 6 && false)) {
        if (my < this.top || my >= this.top + this.ph - 4) {
          this.tab = i;
          this.scroll = 0;
          this.game.audio.play('click', null, 0.5, 1);
          this.init();
          return true;
        }
      }
    }
    const L = this.left, T = this.top;
    if (this.tab !== SURVIVAL && mx >= L + 174 && mx < L + 188 && my >= T + 18 && my < T + 108) {
      this.draggingScroll = true;
      this.scrollTo(my);
      return true;
    }
    return super.mouseDown(mx, my, button);
  }
  private scrollTo(my: number) {
    const f = Math.max(0, Math.min(1, (my - this.top - 18 - 7) / (90 - 15)));
    this.scroll = Math.round(f * this.maxScroll());
  }
  override mouseMove(mx: number, my: number) {
    if (this.draggingScroll) this.scrollTo(my);
    super.mouseMove(mx, my);
  }
  override mouseUp(mx: number, my: number, b: number) {
    this.draggingScroll = false;
    super.mouseUp(mx, my, b);
  }
  override wheel(d: number) {
    this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll + d));
  }
  override touchScrolls = true;
  override touchImmediate(mx: number, my: number) {
    // the scrollbar and tabs are pressed immediately; the item grid scrolls when dragged
    const L = this.left, T = this.top;
    return (mx >= L + 174 && mx < L + 188 && my >= T + 18 && my < T + 108) || my < T + 4 || my >= T + this.ph - 4;
  }
  override key(e: KeyboardEvent): boolean {
    if (this.tab === SEARCH && this.search.focused) {
      if (e.code === 'Escape') { this.close(); return true; }
      if (this.search.key(e)) { this.refreshItems(); return true; }
      return true;
    }
    return super.key(e);
  }
  override char(ch: string) {
    if (this.tab === SEARCH && this.search.focused) {
      this.search.char(ch);
      this.refreshItems();
    } else if (this.tab !== SEARCH && /[a-z]/i.test(ch) && ch.toLowerCase() !== 'e' && ch.toLowerCase() !== 'q' && !this.game.input.isDown('ControlLeft')) {
      // typing jumps to search like vanilla
      this.tab = SEARCH;
      this.init();
      this.search.value = ch;
      this.refreshItems();
    }
  }
  override onClose() {
    this.ui.previewBox = null;
    super.onClose();
  }
}
