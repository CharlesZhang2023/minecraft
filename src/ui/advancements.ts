// The advancements screen (L): a tab per tree, each advancement an icon in its frame (square tasks, rounded goals,
// spiky challenges), gold once earned; lines join them to their parents; drag to look around, hover for details.
import { Screen } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { ADVANCEMENTS, TABS, layout, type Adv, type AdvTab } from '../game/advancements';
import { itemByName, stack, I } from '../game/items';
import { t } from '../i18n/i18n';

const CW = 28, CH = 26;
export class AdvancementsScreen extends Screen {
  tab: AdvTab = 'story';
  private pan: Record<string, [number, number]> = {};
  private drag: [number, number] | null = null;
  private box() {
    const w = Math.min(this.gui.w - 20, 252), h = Math.min(this.gui.h - 50, 140);
    return { x: Math.floor((this.gui.w - w) / 2), y: Math.floor((this.gui.h - h) / 2) + 10, w, h };
  }
  private earned(a: Adv) { return this.game.achievements.has('adv:' + a.id); }
  override render(ctx: Ctx, mx: number, my: number) {
    this.backgroundGradient(ctx);
    const g = this.gui, b = this.box();
    // the tabs
    TABS.forEach(([t, name, icon], i) => {
      const tx = b.x + i * 30, ty = b.y - 28, on = t === this.tab;
      ctx.fillStyle = on ? '#c6c6c6' : '#8b8b8b';
      ctx.fillRect(tx, ty, 28, on ? 30 : 27);
      ctx.fillStyle = '#373737'; ctx.fillRect(tx, ty, 28, 1); ctx.fillRect(tx, ty, 1, on ? 30 : 27); ctx.fillRect(tx + 27, ty, 1, on ? 30 : 27);
      this.ui.drawItem(ctx, stack(itemByName(icon)?.id ?? I.BOOK), tx + 6, ty + 6);
      if (mx >= tx && my >= ty && mx < tx + 28 && my < ty + 28 && !on) g.tooltip(ctx, [name], mx, my);
    });
    // the window
    ctx.fillStyle = '#c6c6c6'; ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 22);
    ctx.fillStyle = '#373737'; ctx.fillRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
    ctx.fillStyle = TAB_BG[this.tab]; ctx.fillRect(b.x, b.y, b.w, b.h);
    const name = TABS.find((t) => t[0] === this.tab)![1];
    const list = ADVANCEMENTS.filter((a) => a.tab === this.tab);
    const done = list.filter((a) => this.earned(a)).length;
    g.text(ctx, `${t(name)}  §7${done}/${list.length}`, b.x, b.y + b.h + 5, '#404040', false);
    const pos = layout(this.tab);
    const [px, py] = this.pan[this.tab] ?? [8, 8];
    const at = (id: string): [number, number] => { const p = pos.get(id)!; return [b.x + px + p[0] * CW, b.y + py + p[1] * CH]; };
    ctx.save();
    ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
    // lines to the parents
    for (const a of list) {
      if (!a.parent || !pos.has(a.parent)) continue;
      const [x0, y0] = at(a.parent), [x1, y1] = at(a.id);
      ctx.fillStyle = this.earned(a) ? '#ffffff' : '#000000';
      const mid = x0 + 13 + Math.floor((x1 - x0 - 13) / 2);
      ctx.fillRect(x0 + 13, y0 + 12, mid - x0 - 13, 2);
      ctx.fillRect(mid, Math.min(y0, y1) + 12, 2, Math.abs(y1 - y0) + 2);
      ctx.fillRect(mid, y1 + 12, x1 - mid, 2);
    }
    let hover: Adv | null = null;
    for (const a of list) {
      const [x, y] = at(a.id);
      const got = this.earned(a);
      frame(ctx, x, y, a.frame ?? 'task', got);
      this.ui.drawItem(ctx, stack(itemByName(a.icon)?.id ?? I.BOOK), x + 5, y + 5);
      if (mx >= x && my >= y && mx < x + 26 && my < y + 26 && mx >= b.x && my >= b.y && mx < b.x + b.w && my < b.y + b.h) hover = a;
    }
    ctx.restore();
    if (hover) {
      const lines = [(hover.frame === 'challenge' ? '§5' : '§a') + hover.title, '§7' + hover.desc];
      if (hover.every) { const [n, all] = this.game.achievements.progressOf(hover); if (!this.earned(hover)) lines.push(`§8${n}/${all}`); }
      if (this.earned(hover)) lines.push('§eDone');
      g.tooltip(ctx, lines, mx, my);
    }
    super.render(ctx, mx, my);
  }
  override mouseDown(mx: number, my: number, button: number): boolean {
    const b = this.box();
    for (const [i, [t]] of TABS.entries()) {
      const tx = b.x + i * 30, ty = b.y - 28;
      if (mx >= tx && my >= ty && mx < tx + 28 && my < ty + 28) { this.tab = t; this.game.audio.play('click', null, 0.3, 1); return true; }
    }
    if (mx >= b.x && my >= b.y && mx < b.x + b.w && my < b.y + b.h) { this.drag = [mx, my]; return true; }
    return super.mouseDown(mx, my, button);
  }
  override mouseMove(mx: number, my: number) {
    if (!this.drag) return;
    const [px, py] = this.pan[this.tab] ?? [8, 8];
    this.pan[this.tab] = [px + mx - this.drag[0], py + my - this.drag[1]];
    this.drag = [mx, my];
  }
  override mouseUp() { this.drag = null; }
  override key(e: KeyboardEvent): boolean {
    if (e.code === 'KeyL' || e.code === 'Escape') { this.close(); return true; }
    return false;
  }
}
const TAB_BG: Record<AdvTab, string> = { story: '#6b5a3f', nether: '#5a2a2a', end: '#4a4a3a', adventure: '#5a4630', husbandry: '#3f5a33' };

/** An advancement's frame: a square (task), rounded (goal) or spiked (challenge) tile, gold once earned. */
function frame(ctx: Ctx, x: number, y: number, kind: string, got: boolean) {
  const fill = got ? '#e8b830' : '#c6c6c6', edge = got ? '#7a5a10' : '#555555';
  ctx.fillStyle = edge;
  if (kind === 'goal') { ctx.fillRect(x + 2, y, 22, 26); ctx.fillRect(x, y + 2, 26, 22); }
  else ctx.fillRect(x, y, 26, 26);
  if (kind === 'challenge') { ctx.fillRect(x - 2, y + 11, 2, 4); ctx.fillRect(x + 26, y + 11, 2, 4); ctx.fillRect(x + 11, y - 2, 4, 2); ctx.fillRect(x + 11, y + 26, 4, 2); }
  ctx.fillStyle = fill;
  if (kind === 'goal') { ctx.fillRect(x + 3, y + 1, 20, 24); ctx.fillRect(x + 1, y + 3, 24, 20); }
  else ctx.fillRect(x + 1, y + 1, 24, 24);
  if (kind === 'challenge') { ctx.fillStyle = got ? '#b060d0' : '#9a9a9a'; ctx.fillRect(x + 1, y + 1, 24, 2); ctx.fillRect(x + 1, y + 23, 24, 2); }
}
