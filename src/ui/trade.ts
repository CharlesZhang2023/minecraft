// Villager trading screen (offer list on the left, player inventory on the right).
import { ContainerScreen } from './containers';
import type { UI } from './ui';
import type { Ctx } from './gui';
import type { Villager, Trade } from '../entity/mobs';
import { getItem, stack } from '../game/items';
import { villagerTraded, LEVEL_NAMES, LEVEL_XP } from '../entity/villagers';
import { heroDiscount } from '../game/raids';
import { I } from '../game/items';

export class TradeScreen extends ContainerScreen {
  title = 'Trading';
  constructor(ui: UI, public villager: Villager) {
    super(ui);
  }
  override init() {
    this.pw = 276;
    this.ph = 186;
    super.init();
  }
  override buildSlots() {
    this.addPlayerSlots(108, 104, 162);
  }
  private offerRect(i: number) {
    return { x: this.left + 5, y: this.top + 17 + i * 16.5, w: 88, h: 17 };
  }
  /** What the trade costs this player: emerald prices drop for a Hero of the Village. */
  private cost(t: Trade): [number, number] { return t.cost[0] === I.EMERALD ? [t.cost[0], heroDiscount(this.game.player, t.cost[1])] : t.cost; }
  private affordable(t: Trade) {
    const inv = this.inv;
    if (t.uses >= t.max) return false;
    const c = this.cost(t);
    if (inv.count(c[0]) < c[1]) return false;
    if (t.cost2 && inv.count(t.cost2[0]) < t.cost2[1]) return false;
    return true;
  }
  override drawBackground(ctx: Ctx, mx: number, my: number) {
    const trades = this.villager.ensureTrades();
    const v = this.villager, prof = v.profession || 'villager';
    const name = `${prof[0].toUpperCase() + prof.slice(1)} - ${LEVEL_NAMES[v.level - 1] ?? ''}`;
    this.gui.textCenter(ctx, name, this.left + 189, this.top + 6, '#404040', false);
    // the villager's experience toward its next level
    const lo = LEVEL_XP[v.level - 1] ?? 0, hi = LEVEL_XP[v.level] ?? lo;
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(this.left + 138, this.top + 16, 102, 5);
    ctx.fillStyle = '#7fd02a'; ctx.fillRect(this.left + 139, this.top + 17, v.level >= 5 ? 100 : Math.round((100 * (v.tradeXp - lo)) / Math.max(1, hi - lo)), 3);
    this.label(ctx, 'Trades', 30, 6);
    this.label(ctx, 'Inventory', 108, 92);
    trades.forEach((t, i) => {
      const r = this.offerRect(i);
      const hover = mx >= r.x && my >= r.y && mx < r.x + r.w && my < r.y + r.h;
      const can = this.affordable(t);
      this.gui.button(ctx, r.x, r.y, r.w, r.h, '', hover, t.uses < t.max);
      const c = this.cost(t);
      this.ui.drawItem(ctx, stack(c[0], c[1]), r.x + 4, r.y + 1);
      if (t.cost2) this.ui.drawItem(ctx, stack(t.cost2[0], t.cost2[1]), r.x + 24, r.y + 2);
      // arrow
      ctx.fillStyle = can ? '#ffffff' : t.uses >= t.max ? '#a02020' : '#8b8b8b';
      ctx.fillRect(r.x + 46, r.y + 9, 8, 2);
      for (let k = 0; k < 4; k++) ctx.fillRect(r.x + 54 + k, r.y + 6 + k, 1, 8 - k * 2);
      this.ui.drawItem(ctx, { ...stack(t.result[0], t.result[1]), ...(t.ench ? { ench: { ...t.ench } } : {}) }, r.x + 66, r.y + 2);
      if (t.uses >= t.max) { ctx.fillStyle = 'rgba(160,32,32,0.35)'; ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); }
    });
    // villager preview
    ctx.fillStyle = '#373737';
    ctx.fillRect(this.left + 108, this.top + 26, 162, 60);
    ctx.fillStyle = '#8b8b8b';
    ctx.fillRect(this.left + 109, this.top + 27, 160, 58);
    const hovered = trades.findIndex((_, i) => { const r = this.offerRect(i); return mx >= r.x && my >= r.y && mx < r.x + r.w && my < r.y + r.h; });
    const t = trades[hovered];
    if (t) {
      const lines = [`${t.cost[1]} x ${getItem(t.cost[0]).display}${t.cost2 ? ` + ${t.cost2[1]} x ${getItem(t.cost2[0]).display}` : ''}`, `-> ${t.result[1]} x ${getItem(t.result[0]).display}`, t.uses >= t.max ? '§cOut of stock' : this.affordable(t) ? '§aClick to trade' : '§7Not enough items'];
      lines.forEach((l, i) => this.gui.text(ctx, l, this.left + 113, this.top + 32 + i * 11, '#FFFFFF'));
    } else this.gui.text(ctx, 'Pick a trade on the left', this.left + 113, this.top + 32, '#E0E0E0');
  }
  override mouseDown(mx: number, my: number, button: number): boolean {
    const trades = this.villager.ensureTrades();
    for (let i = 0; i < trades.length; i++) {
      const r = this.offerRect(i);
      if (mx >= r.x && my >= r.y && mx < r.x + r.w && my < r.y + r.h) {
        const shift = this.game.input.isDown('ShiftLeft') || this.game.input.isDown('ShiftRight');
        let n = 0;
        do {
          if (!this.trade(trades[i])) break;
          n++;
        } while (shift && n < 64);
        this.game.audio.play(n ? 'villager.yes' : 'villager.no', this.villager, 1, 1);
        return true;
      }
    }
    return super.mouseDown(mx, my, button);
  }
  private trade(t: Trade): boolean {
    if (!this.affordable(t)) return false;
    const inv = this.inv;
    const c = this.cost(t);
    inv.remove(c[0], c[1]);
    if (t.cost2) inv.remove(t.cost2[0], t.cost2[1]);
    const left = inv.add({ ...stack(t.result[0], t.result[1]), ...(t.ench ? { ench: { ...t.ench } } : {}) });
    if (left > 0) this.game.interact!.throwStack(stack(t.result[0], left));
    t.uses++;
    this.game.player!.addXp(3 + Math.floor(Math.random() * 4));
    villagerTraded(this.villager, t);
    return true;
  }
  override onClose() {
    this.villager.tradingWith = null;
    super.onClose();
  }
}
