// The wand editor, after Noita's Spell Lab mod: your wands along the top, a palette of spells on the left (every
// spell in creative, the ones you carry in survival), the wand's stats on the right (editable in creative), and
// the wand's slots along the bottom, grouped by the cast each spell fires in. Spells move by dragging, or by
// tapping one and then where it should go (phones), and the server checks every change.
import type { ModContext, UI, Ctx, ItemStack, Channel } from '../sdk';
import { SPELLS, SPELL_BY_ID, TYPE_ORDER, TYPE_NAMES, TYPE_COLORS, type SpellDef, type SpellType } from './spells';
import { wandOf, cloneWand, statLines, secs, STAT_LIMITS, MAX_ALWAYS, MAX_CAP, type WandData, type WandStats } from './wand';
import { previewCycle, type CyclePreview } from './engine';

export interface EditMsg { slot: number; spells: (string | null)[]; always?: string[]; s?: WandStats }
export interface EditorDeps {
  edit: Channel<EditMsg>;
  spellItem(id: string): number | undefined;
  spellOfItem(itemId: number): string | undefined;
  tierOf(itemId: number): number | undefined;
  /** The editor registers here for the server's answers to its edits. */
  acks: { on: ((rev: number, ok: boolean, msg?: string) => void) | null };
  touch(): boolean;
  /** The key that opens the editor (it closes it too). */
  editKey(): string;
}

type Loc =
  | { k: 'pal'; id: string }
  | { k: 'slot'; i: number }
  | { k: 'always'; i: number };
interface Rect { x: number; y: number; w: number; h: number }
const inside = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
const same = (a: Loc | null, b: Loc | null) => !!a && !!b && a.k === b.k && (a.k === 'pal' ? a.id === (b as typeof a).id : a.i === (b as { i: number }).i);

const C = 18;
const BOX_KEY = 'wands.box';
const GROUP_COLS = ['#ffd04a', '#4ad0ff', '#ff6ad0', '#7aff6a', '#ff9a4a', '#b08aff'];

export function editorScreen(mod: ModContext, d: EditorDeps) {
  const { Screen, TextField } = mod.mc;
  return class WandEditor extends Screen {
    override hidesSelection = true;
    override darkens = false;
    slot: number;
    local: WandData | null = null;
    private pending = 0;
    private waitRev = -1;
    private undoStack: WandData[] = [];
    private redoStack: WandData[] = [];
    private filter: SpellType | 'all' = 'all';
    private scroll = 0;
    private sel: Loc | null = null;
    private press: { loc: Loc | null; x: number; y: number; t0: number; moved: boolean; mode: 'pending' | 'drag' | 'scroll' | 'none'; s0: number } | null = null;
    private msg = '';
    private msgT = 0;
    private box = false;
    private preview: CyclePreview | null = null;
    private search: InstanceType<typeof TextField> | null = null;
    private lastMx = 0;
    private lastMy = 0;
    private ticks = 0;

    constructor(ui: UI, slot: number) {
      super(ui);
      this.slot = slot;
      this.adopt();
    }

    override init() {
      const L = this.layout();
      this.widgets = [];
      if (L.search) {
        const old = this.search;
        this.search = new TextField(this.ui, L.search.x, L.search.y, L.search.w, L.search.h, old?.value ?? '', 24, 'Search');
        this.widgets.push(this.search);
      } else this.search = null;
      d.acks.on = (rev, ok, msg) => {
        this.pending = Math.max(0, this.pending - 1);
        this.waitRev = Math.max(this.waitRev, rev);
        if (!ok) { this.say(msg ?? 'That can\'t be done'); this.waitRev = -1; }
      };
    }
    override onClose() { d.acks.on = null; }
    override wantsKeyboard() { return !!this.search?.focused; }

    private get player() { return this.game.player!; }
    private get creative() { return !!this.player.creative; }
    private stackAt(i: number): ItemStack | null { return this.player.inventory.main[i] ?? null; }
    private isWand(s: ItemStack | null) { return !!s && d.tierOf(s.id) !== undefined; }
    private say(m: string) { this.msg = m; this.msgT = 60; }

    /** Take the wand as the server has it (when none of our edits are still on their way). */
    private adopt() {
      const w = wandOf(this.stackAt(this.slot));
      if (!w?.uid) { this.local = null; return; }
      if (this.local && JSON.stringify(w) === JSON.stringify(this.local)) return;
      this.local = cloneWand(w);
      this.preview = previewCycle(this.local);
    }

    // ------------------------------------------------------------------ layout
    private layout() {
      const W = this.gui.w, H = this.gui.h;
      const w = this.local;
      const top = 24;
      const rightW = W >= 460 ? 132 : W >= 380 ? 116 : 104;
      const right: Rect = { x: W - rightW - 4, y: top, w: rightW, h: 0 };
      const alwaysN = w ? (this.creative ? Math.min(MAX_ALWAYS, w.always.length + 1) : w.always.length) : 0;
      const alwaysW = alwaysN ? Math.max(alwaysN * C, 36) + 6 : 0;
      const perRow = Math.max(4, Math.floor((W - 8 - alwaysW) / C));
      const cap = w?.s.cap ?? 0;
      const rows = Math.max(1, Math.min(3, Math.ceil(cap / perRow)));
      const bottomH = 12 + rows * C + 5;
      const bottom: Rect = { x: 4, y: H - bottomH - 2, w: W - 8, h: bottomH };
      right.h = bottom.y - 3 - top;
      const filters: Rect = { x: 4, y: top, w: C, h: (TYPE_ORDER.length + 1) * C };
      const pal: Rect = { x: 4 + C + 3, y: top, w: right.x - 4 - (4 + C + 3), h: right.h };
      const cols = Math.max(1, Math.floor(pal.w / C)), prow = Math.max(1, Math.floor(pal.h / C));
      // header: wand tabs, the search field, buttons
      const btns = ['undo', 'redo', 'clear', 'box', 'close'];
      const bx = W - 4 - btns.length * 18;
      const tabsMax = Math.max(1, Math.floor((bx - 8 - (W >= 400 ? 84 : 0)) / 20));
      const search = W >= 400 ? { x: bx - 84, y: 6, w: 78, h: 12 } : null;
      return { W, H, top, right, bottom, filters, pal, cols, prow, perRow, rows, alwaysN, alwaysW, btns, bx, tabsMax, search };
    }

    /** Wands the player carries (hotbar first). */
    private wands(): number[] {
      const out: number[] = [];
      for (let i = 0; i < 36; i++) if (this.isWand(this.stackAt(i))) out.push(i);
      return out;
    }

    /** Spells for the palette: everything in creative, what you carry in survival (with how many). */
    private palette(): { s: SpellDef; n: number }[] {
      const q = (this.search?.value ?? '').trim().toLowerCase();
      const ok = (s: SpellDef) => !s.hidden && (this.filter === 'all' || s.type === this.filter) && (!q || s.name.toLowerCase().includes(q) || s.id.includes(q));
      if (this.creative) return SPELLS.filter(ok).map((s) => ({ s, n: Infinity }));
      const avail = this.available();
      return SPELLS.filter((s) => ok(s) && (avail.get(s.id) ?? 0) > 0).map((s) => ({ s, n: avail.get(s.id)! }));
    }

    /** Spells you could still put in: those in the inventory, adjusted for edits the server hasn't confirmed yet. */
    private available(): Map<string, number> {
      const m = new Map<string, number>();
      for (const st of this.player.inventory.main) {
        const id = st ? d.spellOfItem(st.id) : undefined;
        if (id) m.set(id, (m.get(id) ?? 0) + st!.count);
      }
      const server = wandOf(this.stackAt(this.slot));
      const add = (w: WandData | null, k: number) => { for (const id of w?.spells ?? []) if (id) m.set(id, (m.get(id) ?? 0) + k); };
      add(server, 1);
      add(this.local, -1);
      return m;
    }

    // ------------------------------------------------------------------ editing
    private commit(prev: WandData) {
      const w = this.local!;
      this.undoStack.push(prev);
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
      this.send();
      this.preview = previewCycle(w);
      w.rev = prev.rev;
    }
    private send() {
      const w = this.local!;
      this.pending++;
      d.edit.toServer({ slot: this.slot, spells: w.spells, always: w.always, s: w.s });
    }
    private change(fn: (w: WandData) => boolean | void) {
      if (!this.local) return;
      const prev = cloneWand(this.local);
      if (fn(this.local) === false) return;
      if (JSON.stringify(prev) === JSON.stringify(this.local)) return;
      this.commit(prev);
      this.game.audio.play('click', null, 0.4, 1.4);
    }
    private undo() {
      const p = this.undoStack.pop();
      if (!p || !this.local) return;
      this.redoStack.push(cloneWand(this.local));
      this.restore(p);
    }
    private redo() {
      const p = this.redoStack.pop();
      if (!p || !this.local) return;
      this.undoStack.push(cloneWand(this.local));
      this.restore(p);
    }
    private restore(w: WandData) {
      const rev = this.local!.rev;
      this.local = cloneWand(w);
      if (!this.creative) { this.local.s = { ...wandOf(this.stackAt(this.slot))!.s }; this.local.always = [...wandOf(this.stackAt(this.slot))!.always]; this.fitCap(); }
      this.local.rev = rev;
      this.send();
      this.preview = previewCycle(this.local);
    }
    private fitCap() {
      const w = this.local!;
      w.spells = Array.from({ length: w.s.cap }, (_, i) => w.spells[i] ?? null);
    }

    private spellAt(l: Loc): string | null {
      const w = this.local;
      if (l.k === 'pal') return l.id;
      if (!w) return null;
      return l.k === 'slot' ? w.spells[l.i] ?? null : w.always[l.i] ?? null;
    }

    /** Put what's at `src` at `dst` (swapping wand slots; a palette spell is placed, the old one goes back). */
    private move(src: Loc, dst: Loc) {
      const id = this.spellAt(src);
      if (!id || src.k === 'pal' && dst.k === 'pal') return;
      if ((dst.k === 'always' || src.k === 'always') && !this.creative) { this.say('Always-cast spells are part of the wand'); return; }
      if (src.k === 'pal' && !this.creative && (this.available().get(id) ?? 0) <= 0) { this.say(`No ${SPELL_BY_ID.get(id)?.name ?? id} left`); return; }
      this.change((w) => {
        const get = (l: Loc) => (l.k === 'slot' ? w.spells[l.i] : l.k === 'always' ? w.always[l.i] ?? null : null);
        const put = (l: Loc, v: string | null) => {
          if (l.k === 'slot') w.spells[l.i] = v;
          else if (l.k === 'always') { if (v) w.always[l.i] = v; else w.always.splice(l.i, 1); }
        };
        if (src.k === 'pal') put(dst, id);
        else {
          const there = get(dst);
          put(dst, id);
          put(src, there);
        }
        w.always = w.always.filter(Boolean).slice(0, MAX_ALWAYS);
      });
    }
    private remove(l: Loc) {
      if (l.k === 'pal') return;
      if (l.k === 'always' && !this.creative) { this.say('Always-cast spells are part of the wand'); return; }
      this.change((w) => { if (l.k === 'slot') w.spells[l.i] = null; else w.always.splice(l.i, 1); });
    }
    /** Shift-click: a palette spell into the first free slot. */
    private quickAdd(id: string) {
      const i = this.local?.spells.indexOf(null) ?? -1;
      if (i < 0) { this.say('The wand is full'); return; }
      this.move({ k: 'pal', id }, { k: 'slot', i });
    }

    private setStat(k: keyof WandStats, dir: number, big: boolean) {
      if (!this.creative) return;
      const [lo, hi, step] = STAT_LIMITS[k];
      this.change((w) => {
        if (k === 'shuffle') { w.s.shuffle = !w.s.shuffle; return; }
        const v = Math.round(((w.s[k] as number) + dir * step * (big ? 10 : 1)) * 1000) / 1000;
        (w.s as unknown as Record<string, number>)[k] = Math.max(lo, Math.min(hi, v));
        if (k === 'cap') w.spells = Array.from({ length: w.s.cap }, (_, i) => w.spells[i] ?? null);
      });
    }

    // ------------------------------------------------------------------ hit testing
    private hit(mx: number, my: number): Loc | null {
      const L = this.layout(), w = this.local;
      if (!w) return null;
      if (inside(L.pal, mx, my) && !this.box) {
        const c = Math.floor((mx - L.pal.x) / C), r = Math.floor((my - L.pal.y) / C);
        if (c < L.cols && r < L.prow) {
          const list = this.palette(), i = (r + this.scroll) * L.cols + c;
          if (list[i]) return { k: 'pal', id: list[i].s.id };
        }
        return null;
      }
      for (let i = 0; i < L.alwaysN; i++) if (inside(this.alwaysRect(L, i), mx, my)) return { k: 'always', i };
      for (let i = 0; i < w.s.cap; i++) if (inside(this.slotRect(L, i), mx, my)) return { k: 'slot', i };
      return null;
    }
    private slotRect(L: ReturnType<WandEditor['layout']>, i: number): Rect {
      const r = Math.floor(i / L.perRow), c = i % L.perRow;
      return { x: L.bottom.x + L.alwaysW + c * C, y: L.bottom.y + 12 + r * C, w: C, h: C };
    }
    private alwaysRect(L: ReturnType<WandEditor['layout']>, i: number): Rect {
      return { x: L.bottom.x + i * C, y: L.bottom.y + 12, w: C, h: C };
    }
    private statRows(L: ReturnType<WandEditor['layout']>) {
      const keys: (keyof WandStats)[] = ['shuffle', 'multi', 'delay', 'reload', 'mana', 'regen', 'cap', 'spread', 'speed'];
      return keys.map((k, i) => ({ k, y: L.right.y + 14 + i * 11 }));
    }

    // ------------------------------------------------------------------ input
    override mouseDown(mx: number, my: number, button: number): boolean {
      if (super.mouseDown(mx, my, button)) return true;
      if (this.search) this.search.focused = false;
      const L = this.layout();
      this.lastMx = mx; this.lastMy = my;
      // header
      if (my < L.top - 2) {
        const bi = Math.floor((mx - L.bx) / 18);
        if (mx >= L.bx && bi >= 0 && bi < L.btns.length) { this.button(L.btns[bi]); return true; }
        const ws = this.wands();
        const ti = Math.floor((mx - 4) / 20);
        if (mx >= 4 && ti >= 0 && ti < Math.min(ws.length, L.tabsMax)) { this.switchTo(ws[ti]); return true; }
        return true;
      }
      if (this.box) { this.boxClick(mx, my); return true; }
      // filters
      if (inside(L.filters, mx, my)) {
        const i = Math.floor((my - L.filters.y) / C);
        this.filter = i === 0 ? 'all' : TYPE_ORDER[i - 1] ?? 'all';
        this.scroll = 0;
        this.game.audio.play('click', null, 0.4, 1.2);
        return true;
      }
      // stats (creative: - / + at the ends of each row)
      if (inside(L.right, mx, my) && this.local) {
        for (const r of this.statRows(L)) {
          if (my < r.y - 1 || my >= r.y + 10) continue;
          const big = this.game.input.isDown('ShiftLeft') || this.game.input.isDown('ShiftRight');
          if (r.k === 'shuffle') { this.setStat('shuffle', 1, false); return true; }
          if (mx < L.right.x + 12) { this.setStat(r.k, -1, big); return true; }
          if (mx >= L.right.x + L.right.w - 12) { this.setStat(r.k, 1, big); return true; }
        }
        return true;
      }
      // palette scroll arrows
      const list = this.palette(), maxScroll = Math.max(0, Math.ceil(list.length / L.cols) - L.prow);
      if (maxScroll > 0 && mx >= L.pal.x + L.pal.w - 8 && inside(L.pal, mx, my) && L.cols * C > L.pal.w - 8) {
        this.scroll = Math.max(0, Math.min(maxScroll, this.scroll + (my < L.pal.y + L.pal.h / 2 ? -1 : 1)));
        return true;
      }
      const loc = this.hit(mx, my);
      if (button === 2) {
        // right-click: back to the palette
        if (loc && loc.k !== 'pal' && this.spellAt(loc)) this.remove(loc);
        return true;
      }
      const shift = this.game.input.isDown('ShiftLeft') || this.game.input.isDown('ShiftRight');
      if (shift && loc) {
        if (loc.k === 'pal') this.quickAdd(loc.id);
        else if (this.spellAt(loc)) this.remove(loc);
        return true;
      }
      this.press = { loc, x: mx, y: my, t0: performance.now(), moved: false, mode: 'pending', s0: this.scroll };
      return true;
    }

    override mouseMove(mx: number, my: number) {
      super.mouseMove(mx, my);
      this.lastMx = mx; this.lastMy = my;
      const p = this.press;
      if (!p) return;
      const dx = mx - p.x, dy = my - p.y;
      if (!p.moved && Math.hypot(dx, dy) > 3) {
        p.moved = true;
        if (p.mode === 'pending') {
          // a finger dragging up or down the palette scrolls it; anything else drags the spell
          if (d.touch() && p.loc?.k === 'pal' && Math.abs(dy) > Math.abs(dx)) p.mode = 'scroll';
          else if (d.touch() && !p.loc && inside(this.layout().pal, p.x, p.y)) p.mode = 'scroll';
          else p.mode = p.loc && this.spellAt(p.loc) ? 'drag' : 'none';
        }
      }
      if (p.mode === 'scroll') {
        const L = this.layout(), maxScroll = Math.max(0, Math.ceil(this.palette().length / L.cols) - L.prow);
        this.scroll = Math.max(0, Math.min(maxScroll, p.s0 - Math.round(dy / C)));
      }
    }

    override mouseUp(mx: number, my: number, button: number) {
      super.mouseUp(mx, my, button);
      const p = this.press;
      this.press = null;
      if (!p) return;
      if (p.mode === 'drag' && p.loc) {
        const to = this.hit(mx, my);
        if (to && to.k !== 'pal') this.move(p.loc, to);
        else if (p.loc.k !== 'pal' && !inside(this.layout().bottom, mx, my)) this.remove(p.loc);
        this.sel = null;
        return;
      }
      if (!p.moved) this.tap(p.loc);
    }

    /** Tap / click: pick a spell up, then tap where it goes (or the palette to take it out). */
    private tap(loc: Loc | null) {
      if (!loc) { this.sel = null; return; }
      const s = this.sel;
      if (!s) { if (this.spellAt(loc) || loc.k !== 'pal') this.sel = this.spellAt(loc) ? loc : null; return; }
      if (same(s, loc)) { this.sel = null; return; }
      if (loc.k === 'pal') {
        if (s.k !== 'pal') { this.remove(s); this.sel = null; }
        else this.sel = loc;
        return;
      }
      this.move(s, loc);
      this.sel = null;
    }

    override wheel(dy: number) {
      const L = this.layout(), maxScroll = Math.max(0, Math.ceil(this.palette().length / L.cols) - L.prow);
      this.scroll = Math.max(0, Math.min(maxScroll, this.scroll + Math.sign(dy)));
    }

    override key(e: KeyboardEvent): boolean {
      if (this.search?.focused) {
        if (e.code === 'Escape' || e.code === 'Enter') { this.search.focused = false; return true; }
        if (super.key(e)) { this.scroll = 0; return true; }
        return true;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.code === 'KeyZ') { e.preventDefault?.(); if (e.shiftKey) this.redo(); else this.undo(); return true; }
      if (ctrl && e.code === 'KeyY') { e.preventDefault?.(); this.redo(); return true; }
      if ((e.code === 'Delete' || e.code === 'Backspace') && this.sel && this.sel.k !== 'pal') { this.remove(this.sel); this.sel = null; return true; }
      if (e.code === 'Escape') { if (this.box) { this.box = false; return true; } if (this.sel) { this.sel = null; return true; } this.close(); return true; }
      if (e.code === 'KeyE' || e.code === d.editKey()) { this.close(); return true; }
      if (/^Digit[1-9]$/.test(e.code)) { const ws = this.wands(), i = Number(e.code.slice(5)) - 1; if (ws[i] !== undefined) this.switchTo(ws[i]); return true; }
      return super.key(e);
    }

    override char(ch: string) {
      if (this.search?.focused) { super.char(ch); this.scroll = 0; }
    }

    private switchTo(slot: number) {
      if (slot === this.slot) return;
      this.slot = slot;
      this.local = null;
      this.undoStack = [];
      this.redoStack = [];
      this.sel = null;
      this.pending = 0;
      this.waitRev = -1;
      this.adopt();
      this.relayout();
      this.game.audio.play('click', null, 0.4, 1);
    }

    private button(id: string) {
      this.game.audio.play('click', null, 0.5, 1);
      switch (id) {
        case 'undo': this.undo(); break;
        case 'redo': this.redo(); break;
        case 'clear':
          this.change((w) => { w.spells = w.spells.map(() => null); if (this.creative) w.always = []; });
          break;
        case 'box': this.box = !this.box; break;
        case 'close': this.close(); break;
      }
    }

    // ------------------------------------------------------------------ the wand box (saved layouts)
    private boxList(): (WandData | null)[] {
      try {
        const v = JSON.parse(localStorage.getItem(BOX_KEY) ?? '[]');
        return Array.from({ length: 8 }, (_, i) => v[i] ?? null);
      } catch { return new Array(8).fill(null); }
    }
    private boxSave(list: (WandData | null)[]) { try { localStorage.setItem(BOX_KEY, JSON.stringify(list)); } catch { /* private window */ } }
    private boxRect(): Rect {
      const L = this.layout();
      return { x: L.pal.x, y: L.pal.y, w: L.right.x + L.right.w - L.pal.x, h: L.pal.h };
    }
    private boxClick(mx: number, my: number) {
      const r = this.boxRect(), list = this.boxList();
      const row = Math.floor((my - r.y - 14) / 16);
      if (!inside(r, mx, my) || row < 0 || row >= Math.min(8, Math.floor((r.h - 16) / 16))) return;
      const bx = r.x + r.w - 3 * 30 - 4;
      const which = mx < bx ? -1 : Math.floor((mx - bx) / 30);
      if (which === 0 && this.local) { list[row] = cloneWand(this.local); delete list[row]!.uid; delete list[row]!.uses; this.boxSave(list); this.say('Saved'); }
      else if (which === 1 && list[row] && this.local) {
        const saved = list[row]!;
        const prev = cloneWand(this.local);
        if (this.creative) { this.local.s = { ...saved.s }; this.local.always = [...saved.always]; }
        this.local.spells = Array.from({ length: this.local.s.cap }, (_, i) => saved.spells[i] ?? null);
        this.commit(prev);
        this.box = false;
      } else if (which === 2) { list[row] = null; this.boxSave(list); }
      this.game.audio.play('click', null, 0.5, 1);
    }

    // ------------------------------------------------------------------ every tick
    override tick() {
      if (this.onServer) return;
      this.ticks++;
      if (this.msgT > 0) this.msgT--;
      if (!this.isWand(this.stackAt(this.slot))) {
        const ws = this.wands();
        if (!ws.length) { this.close(); return; }
        this.switchTo(ws[0]);
      }
      const w = wandOf(this.stackAt(this.slot));
      if (!this.pending && w?.uid && (w.rev >= this.waitRev || this.waitRev < 0)) this.adopt();
      // a finger held still on a spell picks it up to drag
      const p = this.press;
      if (p && !p.moved && p.mode === 'pending' && p.loc && this.spellAt(p.loc) && d.touch() && performance.now() - p.t0 > 300) { p.mode = 'drag'; p.moved = true; }
    }

    // ------------------------------------------------------------------ drawing
    private icon(id: string): HTMLCanvasElement | null {
      const item = d.spellItem(id);
      return item === undefined ? null : (this.game as unknown as { icons: { get(id: number): HTMLCanvasElement } }).icons.get(item);
    }
    private cell(ctx: Ctx, x: number, y: number, id: string | null, o: { sel?: boolean; hover?: boolean; count?: number; uses?: number | null; always?: boolean; target?: boolean; dim?: boolean } = {}) {
      ctx.fillStyle = o.always ? 'rgba(90,70,20,0.85)' : 'rgba(20,24,40,0.85)';
      ctx.fillRect(x, y, C - 1, C - 1);
      ctx.fillStyle = o.always ? '#c8a040' : 'rgba(120,130,170,0.6)';
      ctx.fillRect(x, y, C - 1, 1); ctx.fillRect(x, y + C - 2, C - 1, 1); ctx.fillRect(x, y, 1, C - 1); ctx.fillRect(x + C - 2, y, 1, C - 1);
      if (id) {
        const ic = this.icon(id);
        if (ic) { if (o.dim) ctx.globalAlpha = 0.35; ctx.drawImage(ic, x + 0.5, y + 0.5, 16, 16); ctx.globalAlpha = 1; }
        if (typeof o.uses === 'number') this.gui.text(ctx, String(o.uses), x + 2, y + 1, o.uses > 0 ? '#ffffff' : '#ff6060');
        if (o.count !== undefined && Number.isFinite(o.count) && o.count > 1) { const t = String(o.count); this.gui.text(ctx, t, x + 17 - this.gui.font.width(t), y + 9, '#ffffff'); }
      }
      if (o.target) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x + 1, y + 1, C - 3, C - 3); }
      else if (o.hover) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 1, y + 1, C - 3, C - 3); }
      if (o.sel) {
        const k = Math.floor(this.ticks / 6) % 2 ? '#ffff80' : '#ffd040';
        ctx.fillStyle = k;
        ctx.fillRect(x - 1, y - 1, C + 1, 1); ctx.fillRect(x - 1, y + C - 1, C + 1, 1); ctx.fillRect(x - 1, y - 1, 1, C + 1); ctx.fillRect(x + C - 1, y - 1, 1, C + 1);
      }
    }

    private spellLines(s: SpellDef): string[] {
      const lines = [`§f${s.name}`, `§8${TYPE_NAMES[s.type]}`];
      const words = s.desc.split(' ');
      let cur = '';
      for (const w of words) { if ((cur + ' ' + w).length > 34) { lines.push('§7' + cur.trim()); cur = ''; } cur += ' ' + w; }
      if (cur.trim()) lines.push('§7' + cur.trim());
      lines.push(`§9Mana drain §f${s.mana}`);
      const p = s.proj;
      if (p?.dmg) lines.push(`§cDamage §f${p.dmg}`);
      if (p?.explR) lines.push(`§6Explosion §f${p.explDmg} §7(radius ${p.explR})`);
      if (p?.heal) lines.push(`§aHeals §f${p.heal}`);
      if (s.delay) lines.push(`§7Cast delay §f${s.delay > 0 ? '+' : ''}${secs(s.delay)}`);
      if (s.reload) lines.push(`§7Recharge §f${s.reload > 0 ? '+' : ''}${secs(s.reload)}`);
      if (p?.speed !== undefined && s.type !== 'static') lines.push(`§7Speed §f${Math.round((p.speed ?? 0) * 20)} b/s`);
      if (p?.spread) lines.push(`§7Spread §f${p.spread > 0 ? '+' : ''}${p.spread} DEG`);
      if (s.draw) lines.push(`§aDraws §f${s.draw}`);
      if (s.uses) lines.push(`§eUses §f${s.uses}`);
      if (s.trigger) lines.push(`§6Trigger: §f${s.trigger === 'hit' ? 'on hit' : s.trigger === 'timer' ? 'timer' : 'on expiry'}`);
      return lines;
    }

    override render(ctx: Ctx, mx: number, my: number) {
      const L = this.layout(), gui = this.gui, w = this.local;
      // a darkened, slightly blue-tinted lab
      ctx.fillStyle = 'rgba(8,10,22,0.78)';
      ctx.fillRect(0, 0, L.W, L.H);
      ctx.strokeStyle = 'rgba(80,90,140,0.12)';
      ctx.lineWidth = 1;
      for (let x = 0; x < L.W; x += 24) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, L.H); ctx.stroke(); }
      for (let y = 0; y < L.H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(L.W, y + 0.5); ctx.stroke(); }
      this.drawHeader(ctx, L, mx, my);
      if (!w) {
        gui.textCenter(ctx, 'Attuning wand...', L.W / 2, L.H / 2, '#c0c0ff');
        super.render(ctx, mx, my);
        return;
      }
      const dragging = this.press?.mode === 'drag' ? this.press.loc : null;
      const over = this.hit(mx, my);
      if (this.box) this.drawBox(ctx, mx, my);
      else this.drawPalette(ctx, L, mx, my, over, dragging);
      this.drawFilters(ctx, L, mx, my);
      this.drawStats(ctx, L, mx, my, w);
      this.drawWand(ctx, L, over, dragging, w);
      super.render(ctx, mx, my);
      // the spell being dragged follows the pointer
      if (dragging) {
        const id = this.spellAt(dragging), ic = id ? this.icon(id) : null;
        if (ic) { ctx.globalAlpha = 0.85; ctx.drawImage(ic, mx - 8, my - 8, 16, 16); ctx.globalAlpha = 1; }
      }
      // what a spell is: hovering (mouse), or the one picked up (touch)
      const info = this.sel ? this.spellAt(this.sel) : !d.touch() && over && !dragging ? this.spellAt(over) : null;
      const s = info ? SPELL_BY_ID.get(info) : null;
      if (s) {
        const lines = this.spellLines(s);
        if (this.sel && (d.touch() || !over)) gui.tooltip(ctx, lines, L.right.x - 12, L.right.y + 12);
        else gui.tooltip(ctx, lines, mx, my);
      }
      if (this.msgT > 0) {
        const tw = gui.font.width(this.msg);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(L.W / 2 - tw / 2 - 4, L.bottom.y - 14, tw + 8, 12);
        gui.textCenter(ctx, this.msg, L.W / 2, L.bottom.y - 12, '#ff8080');
      }
    }

    private drawHeader(ctx: Ctx, L: ReturnType<WandEditor['layout']>, mx: number, my: number) {
      const gui = this.gui, ws = this.wands();
      const icons = (this.game as unknown as { icons: { get(id: number): HTMLCanvasElement } }).icons;
      ws.slice(0, L.tabsMax).forEach((slot, i) => {
        const x = 4 + i * 20, y = 3, st = this.stackAt(slot)!;
        const on = slot === this.slot;
        ctx.fillStyle = on ? 'rgba(255,220,120,0.35)' : 'rgba(30,34,56,0.85)';
        ctx.fillRect(x, y, 19, 19);
        ctx.fillStyle = on ? '#ffd860' : 'rgba(120,130,170,0.6)';
        ctx.fillRect(x, y, 19, 1); ctx.fillRect(x, y + 18, 19, 1); ctx.fillRect(x, y, 1, 19); ctx.fillRect(x + 18, y, 1, 19);
        ctx.drawImage(icons.get(st.id), x + 1.5, y + 1.5, 16, 16);
        if (slot < 9) gui.text(ctx, String(slot + 1), x + 13, y + 11, '#a0a0a0');
      });
      if (!ws.length) gui.text(ctx, 'No wand', 6, 8, '#ff8080');
      const labels: Record<string, string> = { undo: '←', redo: '→', clear: 'C', box: 'B', close: 'X' };
      const tips: Record<string, string> = { undo: 'Undo (Ctrl+Z)', redo: 'Redo (Ctrl+Y)', clear: 'Take every spell out', box: 'Wand box: saved layouts', close: 'Close' };
      L.btns.forEach((b, i) => {
        const x = L.bx + i * 18, y = 4, hov = mx >= x && mx < x + 16 && my >= y && my < y + 16;
        const enabled = b === 'undo' ? this.undoStack.length > 0 : b === 'redo' ? this.redoStack.length > 0 : true;
        gui.button(ctx, x, y, 16, 16, '', hov, enabled);
        glyph(ctx, b, x + 4, y + 4, enabled ? (b === 'box' && this.box ? '#ffff80' : '#ffffff') : '#707070');
        if (hov && !d.touch()) gui.tooltip(ctx, [tips[b]], mx, my + 14);
        void labels;
      });
    }

    private drawFilters(ctx: Ctx, L: ReturnType<WandEditor['layout']>, mx: number, my: number) {
      const reps: Record<SpellType, string> = { projectile: 'spark_bolt', static: 'explosion', modifier: 'damage_plus', multicast: 'double_spell', material: 'water', other: 'alpha', utility: 'long_distance_cast', passive: 'torch' };
      const kinds: (SpellType | 'all')[] = ['all', ...TYPE_ORDER];
      kinds.forEach((k, i) => {
        const x = L.filters.x, y = L.filters.y + i * C, on = this.filter === k;
        ctx.fillStyle = on ? 'rgba(255,220,120,0.3)' : 'rgba(20,24,40,0.8)';
        ctx.fillRect(x, y, C - 1, C - 1);
        if (k === 'all') { this.gui.textCenter(ctx, '*', x + 8.5, y + 5, on ? '#ffff80' : '#d0d0d0'); }
        else { const ic = this.icon(reps[k]); if (ic) ctx.drawImage(ic, x + 0.5, y + 0.5, 16, 16); }
        if (on) { ctx.fillStyle = '#ffd860'; ctx.fillRect(x + C - 2, y, 1, C - 1); }
        if (!d.touch() && mx >= x && mx < x + C && my >= y && my < y + C) this.gui.tooltip(ctx, [k === 'all' ? 'All spells' : TYPE_NAMES[k]], mx, my);
      });
    }

    private drawPalette(ctx: Ctx, L: ReturnType<WandEditor['layout']>, mx: number, my: number, over: Loc | null, dragging: Loc | null) {
      const list = this.palette();
      const maxScroll = Math.max(0, Math.ceil(list.length / L.cols) - L.prow);
      if (this.scroll > maxScroll) this.scroll = maxScroll;
      for (let r = 0; r < L.prow; r++)
        for (let c = 0; c < L.cols; c++) {
          const it = list[(r + this.scroll) * L.cols + c];
          const x = L.pal.x + c * C, y = L.pal.y + r * C;
          if (!it) { ctx.fillStyle = 'rgba(20,24,40,0.45)'; ctx.fillRect(x, y, C - 1, C - 1); continue; }
          const loc: Loc = { k: 'pal', id: it.s.id };
          this.cell(ctx, x, y, it.s.id, { sel: same(this.sel, loc), hover: same(over, loc) && !dragging, count: it.n });
        }
      if (!list.length) this.gui.textCenter(ctx, this.creative ? 'No spells match' : 'No spells: find or craft some', L.pal.x + L.pal.w / 2, L.pal.y + L.pal.h / 2 - 4, '#a0a0c0');
      if (maxScroll > 0) {
        // a scrollbar on the right edge
        const x = L.pal.x + L.cols * C + 1, h = L.prow * C - 2, th = Math.max(10, (h * L.prow) / (L.prow + maxScroll));
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x, L.pal.y, 3, h);
        ctx.fillStyle = '#a0a8d0';
        ctx.fillRect(x, L.pal.y + ((h - th) * this.scroll) / maxScroll, 3, th);
      }
      void mx; void my;
      // the source of a drag shows where it came from
      if (dragging?.k === 'pal') { /* drawn faded by the drag image */ }
    }

    private drawStats(ctx: Ctx, L: ReturnType<WandEditor['layout']>, mx: number, my: number, w: WandData) {
      const gui = this.gui, R = L.right;
      ctx.fillStyle = 'rgba(14,16,30,0.85)';
      ctx.fillRect(R.x, R.y, R.w, R.h);
      ctx.fillStyle = 'rgba(120,130,170,0.5)';
      ctx.fillRect(R.x, R.y, R.w, 1);
      const st = this.stackAt(this.slot);
      const name = st ? (mod.mc.ITEMS.get(st.id)?.display ?? 'Wand') : 'Wand';
      gui.text(ctx, name.length > 20 ? name.slice(0, 19) + '.' : name, R.x + 3, R.y + 3, '#ffe080');
      const lines = statLines(w), rows = this.statRows(L);
      rows.forEach((r, i) => {
        if (r.y + 10 > R.y + R.h) return;
        const [k, v] = lines[i];
        const hov = my >= r.y - 1 && my < r.y + 10 && mx >= R.x && mx < R.x + R.w;
        if (hov && this.creative) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(R.x + 1, r.y - 1, R.w - 2, 11); }
        const x0 = this.creative && r.k !== 'shuffle' ? R.x + 13 : R.x + 4;
        gui.text(ctx, k, x0, r.y, '#a8a8c0');
        const vw = gui.font.width(v);
        const x1 = this.creative && r.k !== 'shuffle' ? R.x + R.w - 13 : R.x + R.w - 4;
        gui.text(ctx, v, x1 - vw, r.y, '#ffffff');
        if (this.creative && r.k !== 'shuffle') {
          gui.text(ctx, '-', R.x + 4, r.y, hov && mx < R.x + 12 ? '#ffff80' : '#8080a0');
          gui.text(ctx, '+', R.x + R.w - 9, r.y, hov && mx >= R.x + R.w - 12 ? '#ffff80' : '#8080a0');
        }
      });
      // the cast preview: what one round of the wand does
      let y = rows[rows.length - 1].y + 14;
      const pv = this.preview;
      const line = (t: string, c = '#c8c8d8') => { if (y + 9 <= R.y + R.h) gui.text(ctx, t, R.x + 4, y, c); y += 10; };
      ctx.fillStyle = 'rgba(120,130,170,0.35)';
      ctx.fillRect(R.x + 3, y - 3, R.w - 6, 1);
      if (pv && pv.casts.length) {
        line(`${pv.casts.length} cast${pv.casts.length > 1 ? 's' : ''} in ${pv.seconds.toFixed(2)} s`, '#ffffff');
        if (!w.inf) line(`Mana ${Math.round(pv.mana)} / cycle`, pv.mana > w.s.mana ? '#ff8080' : '#9cc4ff');
        const dps = pv.seconds > 0 ? pv.damage / pv.seconds : pv.damage;
        line(`~${dps >= 100 ? Math.round(dps) : dps.toFixed(1)} dmg/s`, '#ffb0b0');
        if (!w.inf && pv.seconds > 0) {
          const drain = pv.mana / pv.seconds;
          if (drain > w.s.regen) line(`Drains ${Math.round(drain - w.s.regen)}/s`, '#ff9a60');
        }
        if (pv.casts.some((c) => c.noMana)) line('Runs out of mana!', '#ff6060');
      } else line('Empty', '#808090');
    }

    private drawWand(ctx: Ctx, L: ReturnType<WandEditor['layout']>, over: Loc | null, dragging: Loc | null, w: WandData) {
      const gui = this.gui, B = L.bottom;
      ctx.fillStyle = 'rgba(14,16,30,0.85)';
      ctx.fillRect(B.x - 2, B.y - 2, B.w + 4, B.h + 4);
      const filled = w.spells.filter(Boolean).length;
      gui.text(ctx, `Spells ${filled}/${w.s.cap}`, B.x + L.alwaysW + 1, B.y + 1, '#c8c8d8');
      if (L.alwaysN) gui.text(ctx, 'Always', B.x + 1, B.y + 1, '#e8c060');
      const hint = d.touch() ? 'Tap a spell, then a slot' : 'Drag spells; right-click removes';
      const hw = gui.font.width(hint);
      if (B.w - L.alwaysW > hw + 90) gui.text(ctx, hint, B.x + B.w - hw - 2, B.y + 1, '#6a6a88');
      for (let i = 0; i < L.alwaysN; i++) {
        const r = this.alwaysRect(L, i), id = w.always[i] ?? null, loc: Loc = { k: 'always', i };
        this.cell(ctx, r.x, r.y, id, { always: true, sel: same(this.sel, loc), hover: same(over, loc), target: !!dragging && same(over, loc), dim: same(dragging, loc) });
      }
      // which cast each slot fires in (first round of the wand)
      const group = new Map<number, number>();
      this.preview?.casts.forEach((c, n) => { for (const k of c.cards) if (k >= 0 && !group.has(k)) group.set(k, n); });
      for (let i = 0; i < w.s.cap; i++) {
        const r = this.slotRect(L, i);
        if (r.y + C > B.y + B.h + 6) break;
        const id = w.spells[i] ?? null, loc: Loc = { k: 'slot', i };
        this.cell(ctx, r.x, r.y, id, { sel: same(this.sel, loc), hover: same(over, loc) && !dragging, uses: id ? w.uses?.[i] ?? null : null, target: !!dragging && same(over, loc), dim: same(dragging, loc) });
        const g = group.get(i);
        if (g !== undefined) {
          ctx.fillStyle = GROUP_COLS[g % GROUP_COLS.length];
          ctx.fillRect(r.x + 1, r.y + C - 1, C - 3, 2);
          const first = [...group.entries()].find(([, n]) => n === g)?.[0] === i;
          if (first && this.preview!.casts.length > 1) gui.text(ctx, String(g + 1), r.x + C - 6, r.y - 1, GROUP_COLS[g % GROUP_COLS.length]);
        }
      }
      // capacity past what fits
      const shown = Math.min(w.s.cap, L.perRow * L.rows);
      if (shown < w.s.cap) gui.text(ctx, `+${w.s.cap - shown}`, B.x + B.w - 18, B.y + B.h - 9, '#a0a0a0');
      void MAX_CAP;
    }

    private drawBox(ctx: Ctx, mx: number, my: number) {
      const r = this.boxRect(), gui = this.gui, list = this.boxList();
      ctx.fillStyle = 'rgba(14,16,30,0.95)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      gui.text(ctx, 'Wand box: save this wand\'s layout, load one into it', r.x + 4, r.y + 3, '#ffe080');
      const rows = Math.min(8, Math.floor((r.h - 16) / 16));
      const icons = (this.game as unknown as { icons: { get(id: number): HTMLCanvasElement } }).icons;
      for (let i = 0; i < rows; i++) {
        const y = r.y + 14 + i * 16, saved = list[i];
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(r.x + 2, y, r.w - 4, 15);
        gui.text(ctx, String(i + 1), r.x + 5, y + 4, '#808090');
        const bx = r.x + r.w - 3 * 30 - 4;
        if (saved) {
          const max = Math.floor((bx - r.x - 20) / 13);
          saved.spells.filter(Boolean).slice(0, max).forEach((id, k) => {
            const item = d.spellItem(id!);
            if (item !== undefined) ctx.drawImage(icons.get(item), r.x + 16 + k * 13, y + 1.5, 12, 12);
          });
          if (!saved.spells.some(Boolean)) gui.text(ctx, '(empty wand)', r.x + 16, y + 4, '#707080');
        } else gui.text(ctx, '-', r.x + 16, y + 4, '#505060');
        ['Save', 'Load', 'Del'].forEach((t, k) => {
          const x = bx + k * 30, en = k === 0 || !!saved;
          gui.button(ctx, x, y + 1, 28, 13, t, mx >= x && mx < x + 28 && my >= y && my < y + 15, en);
        });
      }
    }
  };
}

/** Header button glyphs (8x8). */
function glyph(ctx: Ctx, id: string, x: number, y: number, c: string) {
  ctx.fillStyle = c;
  const px = (rows: string[]) => rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') ctx.fillRect(x + i, y + j, 1, 1); });
  switch (id) {
    case 'undo': px(['..#.....', '.##.....', '#######.', '.##....#', '..#....#', '.......#', '...####.', '........']); break;
    case 'redo': px(['.....#..', '.....##.', '.#######', '#....##.', '#....#..', '#.......', '.####...', '........']); break;
    case 'clear': px(['..####..', '########', '.#.##.#.', '.#.##.#.', '.#.##.#.', '.#.##.#.', '.######.', '........']); break;
    case 'box': px(['.######.', '#......#', '########', '#..##..#', '#......#', '#......#', '########', '........']); break;
    case 'close': px(['#......#', '.#....#.', '..#..#..', '...##...', '...##...', '..#..#..', '.#....#.', '#......#']); break;
  }
}

export { TYPE_COLORS };
