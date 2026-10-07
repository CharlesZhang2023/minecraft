// The recipe book (1.12): a green book button by the crafting grid opens a list of what you could make: the recipes
// that fit the grid and use something you carry, those you have everything for in green. Click one and its
// ingredients move from your inventory into the grid (shift-click: as many sets as you can). The book is drawn left
// of the window; its clicks reach the server's copy of the window like any other, relative to the window's corner.
import type { Widget } from './screen';
import type { Ctx } from './gui';
import type { ItemStack } from '../game/items';
import { getItem, stack } from '../game/items';
import { recipeList, ingredientMatches, type FlatRecipe } from '../game/recipes';

interface Host {
  left: number; top: number; pw: number;
  inv: { main: (ItemStack | null)[] };
  grid: { items: (ItemStack | null)[]; size: number; update(): void };
  gui: { w: number; tooltip(ctx: Ctx, lines: string[], x: number, y: number): void; text(ctx: Ctx, t: string, x: number, y: number, c?: string, s?: boolean): void };
  ui: { drawItem(ctx: Ctx, s: ItemStack, x: number, y: number): void };
  giveBack(items: (ItemStack | null)[]): void;
  changed(): void;
  game: { input: { isDown(k: string): boolean }; audio: { play(n: string, p: null, v: number, pitch: number): void } };
}

const PW = 147, PH = 166, COLS = 5, ROWS = 4, CELL = 25;
export class RecipeBook implements Widget {
  x = 0; y = 0; w = 0; h = 0;
  open = false;
  page = 0;
  craftableOnly = false;
  /** Where the window was before the book pushed it aside. */
  private baseLeft = -1;
  constructor(private host: Host, private button: [number, number]) {}

  /** Recipes for this grid that use something we carry (craftable ones first). */
  list(): { r: FlatRecipe; can: boolean }[] {
    const inv = this.host.inv.main, size = this.host.grid.size;
    const have = (want: number | number[]) => inv.some((s) => s && ingredientMatches(s, want));
    const out: { r: FlatRecipe; can: boolean }[] = [];
    const seen = new Set<number>();
    for (const r of recipeList()) {
      if (r.w > size || r.h > size) continue;
      const cells = r.cells.filter((c): c is number | number[] => c !== undefined);
      if (!cells.some(have)) continue;
      const can = this.sets(r, inv) > 0;
      if (this.craftableOnly && !can) continue;
      // one entry per result item (the first recipe that makes it)
      if (seen.has(r.out.id)) continue;
      seen.add(r.out.id);
      out.push({ r, can });
    }
    return out.sort((a, b) => Number(b.can) - Number(a.can));
  }
  /** How many times the inventory (plus what's in the grid) covers the recipe. */
  private sets(r: FlatRecipe, inv: (ItemStack | null)[]): number {
    const pool = [...inv, ...this.host.grid.items].map((s) => (s ? { ...s } : null));
    let n = 0;
    for (; n < 64; n++) {
      for (const want of r.cells) {
        if (want === undefined) continue;
        const s = pool.find((q) => q && q.count > 0 && ingredientMatches(q, want));
        if (!s) return n;
        s.count--;
      }
    }
    return n;
  }

  private panel() { const h = this.host; return { x: h.left - PW - 2, y: h.top }; }
  render(ctx: Ctx, mx: number, my: number) {
    const h = this.host;
    // the window steps aside while the book is open (if there's room)
    if (this.baseLeft < 0) this.baseLeft = h.left;
    h.left = this.open ? Math.max(this.baseLeft, Math.min(h.gui.w - h.pw - 2, PW + 4)) : this.baseLeft;
    const [bx, by] = this.button;
    // the green book button
    const bX = h.left + bx, bY = h.top + by;
    ctx.fillStyle = '#2a5a2a'; ctx.fillRect(bX, bY, 20, 18);
    ctx.fillStyle = '#4a9a3a'; ctx.fillRect(bX + 2, bY + 2, 16, 14);
    ctx.fillStyle = '#e8e0c0'; ctx.fillRect(bX + 4, bY + 4, 5, 10); ctx.fillRect(bX + 11, bY + 4, 5, 10);
    ctx.fillStyle = '#2a5a2a'; ctx.fillRect(bX + 9, bY + 3, 2, 12);
    if (!this.open) return;
    const p = this.panel();
    ctx.fillStyle = '#c6c6c6'; ctx.fillRect(p.x, p.y, PW, PH);
    ctx.fillStyle = '#555555'; ctx.fillRect(p.x, p.y + PH - 1, PW, 1); ctx.fillRect(p.x + PW - 1, p.y, 1, PH);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(p.x, p.y, PW, 1); ctx.fillRect(p.x, p.y, 1, PH);
    // "craftable only" toggle
    ctx.fillStyle = this.craftableOnly ? '#4a9a3a' : '#8b8b8b'; ctx.fillRect(p.x + 110, p.y + 8, 26, 14);
    h.gui.text(ctx, this.craftableOnly ? 'All' : 'Can', p.x + 114, p.y + 11, '#ffffff', false);
    h.gui.text(ctx, 'Recipe Book', p.x + 8, p.y + 11, '#404040', false);
    const list = this.list(), per = COLS * ROWS, pages = Math.max(1, Math.ceil(list.length / per));
    this.page = Math.min(this.page, pages - 1);
    let hover: FlatRecipe | null = null;
    list.slice(this.page * per, this.page * per + per).forEach(({ r, can }, i) => {
      const x = p.x + 11 + (i % COLS) * CELL, y = p.y + 31 + Math.floor(i / COLS) * CELL;
      ctx.fillStyle = can ? '#6a9a5a' : '#9a5a5a'; ctx.fillRect(x, y, CELL - 1, CELL - 1);
      ctx.fillStyle = can ? '#8aca7a' : '#c07070'; ctx.fillRect(x + 1, y + 1, CELL - 3, CELL - 3);
      h.ui.drawItem(ctx, r.out, x + 4, y + 4);
      if (mx >= x && my >= y && mx < x + CELL && my < y + CELL) hover = r;
    });
    // pages
    h.gui.text(ctx, `${this.page + 1}/${pages}`, p.x + 62, p.y + 137, '#404040', false);
    if (this.page > 0) h.gui.text(ctx, '<', p.x + 40, p.y + 137, '#404040', false);
    if (this.page < pages - 1) h.gui.text(ctx, '>', p.x + 100, p.y + 137, '#404040', false);
    if (hover) h.gui.tooltip(ctx, [getItem((hover as FlatRecipe).out.id).display, ...ingredientLines(hover as FlatRecipe)], mx, my);
  }
  mouseDown(mx: number, my: number): boolean {
    const h = this.host, [bx, by] = this.button;
    if (mx >= h.left + bx && my >= h.top + by && mx < h.left + bx + 20 && my < h.top + by + 18) { this.open = !this.open; this.click(); return true; }
    if (!this.open) return false;
    const p = this.panel();
    if (mx < p.x || my < p.y || mx >= p.x + PW || my >= p.y + PH) return false;
    if (mx >= p.x + 110 && my >= p.y + 8 && mx < p.x + 136 && my < p.y + 22) { this.craftableOnly = !this.craftableOnly; this.page = 0; this.click(); return true; }
    if (my >= p.y + 134 && my < p.y + 146) {
      if (mx >= p.x + 36 && mx < p.x + 50 && this.page > 0) { this.page--; this.click(); }
      if (mx >= p.x + 96 && mx < p.x + 110) { this.page++; this.click(); }
      return true;
    }
    const col = Math.floor((mx - p.x - 11) / CELL), row = Math.floor((my - p.y - 31) / CELL);
    if (col >= 0 && col < COLS && row >= 0 && row < ROWS) {
      const e = this.list()[this.page * COLS * ROWS + row * COLS + col];
      if (e) this.fill(e.r, h.game.input.isDown('ShiftLeft') || h.game.input.isDown('ShiftRight'));
    }
    return true;
  }
  private click() { this.host.game.audio.play('click', null, 0.3, 1); }

  /** Put the recipe's ingredients in the grid: what's there goes back first, then one set (or as many as fit). */
  fill(r: FlatRecipe, all: boolean) {
    const h = this.host, g = h.grid, inv = h.inv.main;
    h.giveBack(g.items);
    let n = Math.min(this.sets(r, inv), all ? 64 : 1);
    for (let i = 0; i < r.cells.length; i++) if (r.cells[i] !== undefined) {
      const any = inv.find((s) => s && ingredientMatches(s, r.cells[i]!));
      if (any) n = Math.min(n, getItem(any.id).maxStack);
    }
    if (n <= 0) return;
    for (let i = 0; i < r.cells.length; i++) {
      const want = r.cells[i];
      if (want === undefined) continue;
      const gx = i % r.w, gy = Math.floor(i / r.w);
      const at = gy * g.size + gx;
      let need = n;
      for (let k = 0; k < inv.length && need > 0; k++) {
        const s = inv[k];
        if (!s || !ingredientMatches(s, want)) continue;
        if (g.items[at] && g.items[at]!.id !== s.id) continue;
        const take = Math.min(need, s.count);
        g.items[at] = g.items[at] ? { ...g.items[at]!, count: g.items[at]!.count + take } : { ...s, count: take };
        s.count -= take;
        if (s.count <= 0) inv[k] = null;
        need -= take;
      }
    }
    g.update();
    h.changed();
  }
}
function ingredientLines(r: FlatRecipe): string[] {
  const counts = new Map<string, number>();
  for (const c of r.cells) {
    if (c === undefined) continue;
    const name = getItem(Array.isArray(c) ? c[0] : c).display + (Array.isArray(c) && c.length > 1 ? ' (any)' : '');
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([n, k]) => `§7${k} x ${n}`);
}
void stack;
