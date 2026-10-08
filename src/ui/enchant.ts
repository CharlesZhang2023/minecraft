// 1.8-style enchanting table screen.
import { ContainerScreen } from './containers';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { I, I3, getItem } from '../game/items';
import { B } from '../world/blocks';
import { Random } from '../noise';
import { canEnchant, slotCosts, rollEnchants, enchName } from '../game/enchant';
import { t } from '../i18n/i18n';

const RUNES = 'abcdefghijklmnopqrstuvwxyz';

export class EnchantScreen extends ContainerScreen {
  title = 'Enchant';
  slotsE: (import('../game/items').ItemStack | null)[] = [null, null];
  costs: [number, number, number] = [0, 0, 0];
  private lastId = -1;
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  override buildSlots() {
    const sl = this.slotsE;
    this.slots.push({ x: 15, y: 47, get: () => sl[0], set: (s) => (sl[0] = s), group: 'item', limit: 1 });
    this.slots.push({ x: 35, y: 47, get: () => sl[1], set: (s) => (sl[1] = s), group: 'lapis', canPlace: (s) => s.id === I.LAPIS });
    this.addPlayerSlots();
  }
  private shelves(): number {
    const w = this.game.world!;
    let n = 0;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
        for (let dy = 0; dy <= 1; dy++) if (w.getId(this.x + dx, this.y + dy, this.z + dz) === B.BOOKSHELF) n++;
      }
    return n;
  }
  private seed() { return (this.game.player as unknown as { enchantSeed: number }).enchantSeed ??= (Math.random() * 1e9) | 0; }
  override changed() {
    const it = this.slotsE[0];
    const id = it && canEnchant(it) ? it.id : -1;
    if (id !== this.lastId) {
      this.lastId = id;
      this.costs = id < 0 ? [0, 0, 0] : slotCosts(new Random(this.seed() ^ id), this.shelves());
    }
  }
  override quickTargets(s: { group: string }, st: import('../game/items').ItemStack): string[] {
    if (s.group === 'main' || s.group === 'hotbar') return st.id === I.LAPIS ? ['lapis'] : canEnchant(st) ? ['item'] : super.quickTargets(s as never, st);
    return super.quickTargets(s as never, st);
  }
  private btn(i: number) { return { x: this.left + 60, y: this.top + 14 + i * 19, w: 108, h: 19 }; }
  override drawBackground(ctx: Ctx, mx: number, my: number) {
    this.changed();
    const p = this.game.player!;
    const it = this.slotsE[0];
    for (let i = 0; i < 3; i++) {
      const b = this.btn(i), cost = this.costs[i];
      const ok = !!it && cost > 0 && (p.creative || (p.xpLevel >= cost && (this.slotsE[1]?.count ?? 0) >= i + 1));
      const hover = mx >= b.x && my >= b.y && mx < b.x + b.w && my < b.y + b.h;
      ctx.fillStyle = cost <= 0 ? '#8b8b8b' : ok ? (hover ? '#e0c8a0' : '#c8b490') : '#8a7a68';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
      if (cost <= 0) continue;
      const r = new Random(this.seed() + i * 17);
      let word = '';
      for (let k = 0; k < 3; k++) { let w = ''; const n = 3 + r.int(5); for (let j = 0; j < n; j++) w += RUNES[r.int(RUNES.length)]; word += (k ? ' ' : '') + w; }
      this.gui.text(ctx, word.slice(0, 16), b.x + 4, b.y + 2, ok ? '#685E4A' : '#3a3228', false);
      const cs = String(cost);
      this.gui.text(ctx, cs, b.x + b.w - this.gui.font.width(cs) - 3, b.y + 10, ok ? '#80FF20' : '#407F10');
      ctx.fillStyle = ok ? '#6fcf3f' : '#3a5a2a';
      for (let d = 0; d <= i; d++) ctx.fillRect(b.x + 3 + d * 4, b.y + 12, 3, 5);
    }
    // book
    ctx.fillStyle = '#6b2a1a';
    ctx.fillRect(this.left + 16, this.top + 16, 26, 20);
    ctx.fillStyle = '#f0e8d0';
    ctx.fillRect(this.left + 18, this.top + 18, 10, 16);
    ctx.fillRect(this.left + 30, this.top + 18, 10, 16);
  }
  override drawForeground(ctx: Ctx, mx: number, my: number) {
    this.label(ctx, 'Enchant', 12, 5);
    this.label(ctx, 'Inventory', 8, 72);
    for (let i = 0; i < 3; i++) {
      const b = this.btn(i), cost = this.costs[i];
      if (cost <= 0 || mx < b.x || my < b.y || mx >= b.x + b.w || my >= b.y + b.h || !this.slotsE[0]) continue;
      const roll = rollEnchants(this.slotsE[0], cost, new Random(this.seed() + i));
      const first = Object.entries(roll)[0];
      this.gui.tooltip(ctx, [first ? enchName(first[0], first[1]) + ' . . . ?' : '?', '§7' + t('{0} Lapis Lazuli', i + 1), '§7' + t(i ? '{0} Enchantment Levels' : '{0} Enchantment Level', i + 1)], mx, my);
    }
  }
  override mouseDown(mx: number, my: number, button: number): boolean {
    const p = this.game.player!;
    for (let i = 0; i < 3; i++) {
      const b = this.btn(i), cost = this.costs[i];
      if (mx < b.x || my < b.y || mx >= b.x + b.w || my >= b.y + b.h) continue;
      const it = this.slotsE[0], lap = this.slotsE[1];
      if (!it || cost <= 0) return true;
      if (!p.creative && (p.xpLevel < cost || (lap?.count ?? 0) < i + 1)) return true;
      const ench = rollEnchants(it, cost, new Random(this.seed() + i));
      if (it.id === I.BOOK) this.slotsE[0] = { id: I3.ENCHANTED_BOOK, count: 1, ench };
      else it.ench = ench;
      this.game.achievements.event('enchant');
      if (!p.creative) {
        p.xpLevel = Math.max(0, p.xpLevel - (i + 1));
        lap!.count -= i + 1;
        if (lap!.count <= 0) this.slotsE[1] = null;
      }
      (p as unknown as { enchantSeed: number }).enchantSeed = (Math.random() * 1e9) | 0;
      this.lastId = -2;
      this.game.audio.play('levelup', null, 0.5, 1.6);
      void getItem;
      return true;
    }
    return super.mouseDown(mx, my, button);
  }
  override onClose() {
    this.giveBack(this.slotsE);
    super.onClose();
  }
}
