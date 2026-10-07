// Books: a book and quill is written in page by page and signed into a written book (title, author, generation);
// written books are read, in the hand or on a lectern (whose page is shared by everyone and read by comparators).
// The screen runs twice like a sign's: the server's copy, fed the same keys and clicks, saves what was written.
import { Screen } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { ItemStack, I7, I11 } from '../game/items';
import type { LecternTile } from '../game/stations';

export interface BookTag { pages: string[]; title?: string; author?: string; generation?: number }
export const bookTag = (s: ItemStack | null | undefined): BookTag => {
  const t = s?.tag as Partial<BookTag> | undefined;
  return { ...(t ?? {}), pages: Array.isArray(t?.pages) ? t!.pages!.slice() : [] };
};
export const GENERATIONS = ['Original', 'Copy of original', 'Copy of a copy', 'Tattered'];
const PAGE_W = 114, PAGE_LINES = 14, MAX_PAGES = 50, PAGE_CHARS = 256, TITLE_CHARS = 16;

/** Where the book is: the player's hotbar slot, or a lectern. */
type Source = { slot: number } | { lectern: [number, number, number] };

export class BookScreen extends Screen {
  override twin = true;
  pages: string[] = [''];
  page = 0;
  edit = false;
  signing = false;
  title = '';
  author = '';
  private blink = 0;
  constructor(ui: UI, public source: Source) { super(ui); }
  private lectern(): LecternTile | null {
    if (!('lectern' in this.source)) return null;
    const [x, y, z] = this.source.lectern;
    const t = this.game.world!.getTile(x, y, z) as unknown as LecternTile | undefined;
    return t?.type === 'lectern' ? t : null;
  }
  private book(): ItemStack | null {
    if ('slot' in this.source) return this.game.player!.inventory.main[this.source.slot] ?? null;
    return this.lectern()?.items[0] ?? null;
  }
  private loaded = false;
  override init() { this.load(); }
  /** Read the book (on the client it may arrive a moment after the screen opens). */
  private load() {
    const b = this.book();
    if (!b || this.loaded) return;
    this.loaded = true;
    const t = bookTag(b);
    this.edit = b?.id === I7.WRITABLE_BOOK && 'slot' in this.source;
    this.pages = t.pages.length ? t.pages : [''];
    this.author = t.author ?? '';
    const lt = this.lectern();
    this.page = Math.min(this.pages.length - 1, lt?.page ?? 0);
  }
  override tick() { this.blink++; this.load(); }
  /** The book's corner: clicks reach the server's twin relative to it (the server's copy has no screen size of its own). */
  get left() { return this.onServer ? 0 : Math.floor(this.gui.w / 2) - 73; }
  get top() { return this.onServer ? 0 : Math.max(2, Math.floor(this.gui.h / 2) - 100); }
  private layout() {
    const left = this.left, top = this.top;
    return { cx: left + 73, top, left, w: 146, h: 180 };
  }
  buttons(): { id: string; x: number; y: number; w: number; h: number; label: string; on: boolean }[] {
    const { cx, top, left, h } = this.layout();
    const by = top + h + 4;
    const out = [
      { id: 'prev', x: left + 10, y: top + 154, w: 23, h: 13, label: '<', on: this.page > 0 && !this.signing },
      { id: 'next', x: left + 113, y: top + 154, w: 23, h: 13, label: '>', on: !this.signing && (this.page < this.pages.length - 1 || (this.edit && this.pages.length < MAX_PAGES)) },
    ];
    if (this.signing) {
      out.push({ id: 'sign', x: cx - 100, y: by, w: 98, h: 20, label: 'Sign and Close', on: this.title.trim().length > 0 });
      out.push({ id: 'cancel', x: cx + 2, y: by, w: 98, h: 20, label: 'Cancel', on: true });
    } else if (this.edit) {
      out.push({ id: 'signing', x: cx - 100, y: by, w: 98, h: 20, label: 'Sign', on: true });
      out.push({ id: 'done', x: cx + 2, y: by, w: 98, h: 20, label: 'Done', on: true });
    } else if (this.lectern()) {
      out.push({ id: 'take', x: cx - 100, y: by, w: 98, h: 20, label: 'Take Book', on: true });
      out.push({ id: 'done', x: cx + 2, y: by, w: 98, h: 20, label: 'Done', on: true });
    } else out.push({ id: 'done', x: cx - 50, y: by, w: 100, h: 20, label: 'Done', on: true });
    return out;
  }
  override render(ctx: Ctx, mx: number, my: number) {
    this.load();
    const g = this.gui, { cx, top, left, w, h } = this.layout();
    // the page: parchment with a darker edge
    ctx.fillStyle = '#4a3a22'; ctx.fillRect(left - 2, top - 2, w + 4, h + 4);
    ctx.fillStyle = '#f2e8cc'; ctx.fillRect(left, top, w, h);
    ctx.fillStyle = '#e2d4b0'; ctx.fillRect(left, top, 6, h);
    if (this.signing) {
      g.textCenter(ctx, 'Enter Book Title:', cx, top + 34, '#000000', false);
      const cur = Math.floor(this.blink / 6) % 2 === 0 ? '_' : '';
      g.textCenter(ctx, this.title + cur, cx, top + 50, '#000000', false);
      g.textCenter(ctx, `by ${this.game.player?.name || 'Player'}`, cx, top + 60, '#555555', false);
      g.textCenter(ctx, 'Note! When you sign the', cx, top + 84, '#000000', false);
      g.textCenter(ctx, 'book, it will no longer', cx, top + 94, '#000000', false);
      g.textCenter(ctx, 'be editable.', cx, top + 104, '#000000', false);
    } else {
      const label = `Page ${this.page + 1} of ${this.pages.length}`;
      g.text(ctx, label, left + w - 10 - g.font.width(label), top + 12, '#000000', false);
      const text = this.pages[this.page] ?? '';
      const lines = g.font.wrap(text + (this.edit && Math.floor(this.blink / 6) % 2 === 0 ? '_' : ''), PAGE_W);
      lines.slice(0, PAGE_LINES).forEach((l, i) => g.text(ctx, l, left + 18, top + 26 + i * 9, '#000000', false));
    }
    for (const b of this.buttons()) {
      const hover = mx >= b.x && my >= b.y && mx < b.x + b.w && my < b.y + b.h;
      if (b.id === 'prev' || b.id === 'next') { if (b.on) g.text(ctx, b.id === 'prev' ? '<' : '>', b.x + 8, b.y + 3, hover ? '#c03030' : '#6a4a2a', false); continue; }
      g.button(ctx, b.x, b.y, b.w, b.h, b.label, hover, b.on);
    }
    super.render(ctx, mx, my);
  }
  override mouseDown(mx: number, my: number, button: number): boolean {
    for (const b of this.buttons()) {
      if (mx < b.x || my < b.y || mx >= b.x + b.w || my >= b.y + b.h || !b.on) continue;
      this.press(b.id);
      return true;
    }
    return super.mouseDown(mx, my, button);
  }
  private press(id: string) {
    switch (id) {
      case 'prev': this.turn(-1); break;
      case 'next':
        if (this.page === this.pages.length - 1 && this.edit) this.pages.push('');
        this.turn(1);
        break;
      case 'signing': this.signing = true; break;
      case 'cancel': this.signing = false; break;
      case 'sign': this.save(true); this.close(); break;
      case 'done': this.close(); break;
      case 'take': this.take(); break;
    }
    this.game.audio.play('click', null, 0.3, 1.4);
  }
  private turn(d: number) {
    this.page = Math.max(0, Math.min(this.pages.length - 1, this.page + d));
    // a lectern's page is the world's (comparators read it, a turned page pulses redstone)
    const lt = this.lectern();
    if (lt && this.onServer && lt.page !== this.page) {
      const [x, y, z] = (this.source as { lectern: [number, number, number] }).lectern;
      lt.page = this.page;
      this.game.world!.setTile(x, y, z, lt as never);
      (this.game as unknown as { redstone?: { update(x: number, y: number, z: number): void } }).redstone?.update(x, y, z);
    }
  }
  private take() {
    const lt = this.lectern();
    if (lt && this.onServer && lt.items[0]) {
      const [x, y, z] = (this.source as { lectern: [number, number, number] }).lectern;
      const p = this.game.player!;
      const book = lt.items[0];
      lt.items[0] = null; lt.page = 0;
      const w = this.game.world!;
      w.set(x, y, z, w.get(x, y, z) & ~(4 << 12));
      w.setTile(x, y, z, lt as never);
      if (p.inventory.add(book) > 0) (this.game as unknown as { dropItem?(x: number, y: number, z: number, s: ItemStack): void }).dropItem?.(p.x, p.y + 1, p.z, book);
    }
    this.close();
  }
  override key(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') { this.close(); return true; }
    if (this.signing) {
      if (e.code === 'Backspace') { this.title = this.title.slice(0, -1); return true; }
      if (e.code === 'Enter') { if (this.title.trim()) { this.save(true); this.close(); } return true; }
      return e.key.length === 1;
    }
    if (e.code === 'PageUp') { this.press('prev'); return true; }
    if (e.code === 'PageDown') { this.press('next'); return true; }
    if (!this.edit) return false;
    if (e.code === 'Backspace') { this.pages[this.page] = (this.pages[this.page] ?? '').slice(0, -1); return true; }
    if (e.code === 'Enter') { this.char('\n'); return true; }
    return e.key.length === 1;
  }
  override char(ch: string) {
    if (this.signing) { if (ch >= ' ' && ch !== '§' && this.title.length < TITLE_CHARS) this.title += ch; return; }
    if (!this.edit || (ch < ' ' && ch !== '\n') || ch === '§') return;
    const next = (this.pages[this.page] ?? '') + ch;
    if (next.length <= PAGE_CHARS && this.gui.font.wrap(next, PAGE_W).length <= PAGE_LINES) this.pages[this.page] = next;
  }
  /** Write the pages back into the book and quill, or sign it into a written book. */
  private save(sign: boolean) {
    if (!('slot' in this.source) || !this.edit) return;
    const inv = this.game.player!.inventory, s = inv.main[this.source.slot];
    if (!s || s.id !== I7.WRITABLE_BOOK) return;
    // trailing empty pages aren't kept
    const pages = this.pages.slice();
    while (pages.length > 1 && !pages[pages.length - 1]) pages.pop();
    if (sign) inv.main[this.source.slot] = { id: I11.WRITTEN_BOOK, count: 1, tag: { pages, title: this.title.trim(), author: this.game.player!.name || 'Player', generation: 0 } };
    else inv.main[this.source.slot] = { ...s, tag: { pages } };
  }
  override onClose() { this.save(false); }
}
