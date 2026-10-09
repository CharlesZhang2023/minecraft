// The screens: the main menu, the schematic library (import, export, place), placements (move, turn, mirror,
// paste), saving the selection, the material list, the verifier and stand-ins for unknown blocks. Screens are
// page-only classes, so they're made in `makeScreens`, called from the client entrypoint.
import type { ModContext, Client, UI, Ctx, Screen as ScreenT } from '../sdk';
import { state, changed, boxSize, selectedPlacement, addPlacement, removePlacement, newId, type LayerMode } from './state';
import * as lib from './library';
import { Placement, remaps } from './placement';
import { readSchematic, writeSchematic, EXTENSIONS, type Format } from './formats';
import { VERSIONS, versionName } from './vanilla';
import { capture } from './capture';
import { totals, doneByBlock, nearbyMarks, Mark } from './ghost';
import { materials } from './blocks';
import { startPaste, undoPaste, pasting, cancelPaste, type PasteMode } from './paste';
import { bounds } from './model';

export interface Settings { exportVersion: string; pasteMode: string }

const KIND_NAMES: Record<number, [string, string]> = {
  [Mark.Missing]: ['Missing', '#6fc3ff'], [Mark.WrongBlock]: ['Wrong block', '#ff5555'], [Mark.WrongState]: ['Wrong state', '#ffaa33'],
  [Mark.Extra]: ['Extra', '#ff66ff'], [Mark.Unknown]: ['Unknown', '#b28cff'],
};
const LAYERS: LayerMode[] = ['all', 'single', 'below', 'above'];
const LAYER_NAMES: Record<LayerMode, string> = { all: 'All', single: 'One layer', below: 'At and below', above: 'At and above' };
const MIRRORS = ['None', 'North-south', 'East-west'];
const PASTE_NAMES: Record<string, string> = { all: 'All', solid: 'No air', empty: 'Into air' };

export function saveRemaps() {
  try { localStorage.setItem('blueprints:remaps', JSON.stringify([...remaps])); } catch { /* this session only */ }
}
export function loadRemaps() {
  try { for (const [k, v] of JSON.parse(localStorage.getItem('blueprints:remaps') ?? '[]')) remaps.set(k, v); } catch { /* none */ }
}

export function makeScreens(mod: ModContext, settings: Settings, say: (m: string) => void) {
  const { Screen, Button, TextField } = mod.mc;
  const mc = mod.mc;
  let lastUrl = '';

  /** A list of rows the screen draws, with scrolling and picking. */
  class List<T> {
    scroll = 0;
    selected = -1;
    constructor(public x: number, public y: number, public w: number, public h: number, public rowH: number, public rows: () => T[], public draw: (ctx: Ctx, row: T, x: number, y: number, w: number, sel: boolean) => void) {}
    get visible() { return Math.max(1, Math.floor(this.h / this.rowH)); }
    render(ctx: Ctx) {
      const rows = this.rows();
      this.scroll = Math.max(0, Math.min(this.scroll, rows.length - this.visible));
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(this.x, this.y, this.w, this.h);
      for (let k = 0; k < this.visible && k + this.scroll < rows.length; k++) {
        const i = k + this.scroll, ry = this.y + k * this.rowH;
        if (i === this.selected) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(this.x, ry, this.w, this.rowH); }
        this.draw(ctx, rows[i], this.x + 3, ry, this.w - 6, i === this.selected);
      }
      if (rows.length > this.visible) {
        const th = Math.max(8, (this.h * this.visible) / rows.length), ty = this.y + ((this.h - th) * this.scroll) / Math.max(1, rows.length - this.visible);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(this.x + this.w - 3, ty, 3, th);
      }
    }
    /** The row index clicked, or -1. */
    pick(mx: number, my: number): number {
      if (mx < this.x || mx >= this.x + this.w || my < this.y || my >= this.y + this.h) return -1;
      const i = Math.floor((my - this.y) / this.rowH) + this.scroll;
      return i < this.rows().length ? i : -1;
    }
    wheel(d: number) { this.scroll = Math.max(0, this.scroll + d); }
  }

  abstract class Base extends Screen {
    override pausesGame = false;
    override touchScrolls = true;
    message = '';
    title = '';
    constructor(ui: UI, protected parent: ScreenT | null) { super(ui); }
    get client() { return this.ui.game as unknown as Client; }
    override close() { this.ui.open(this.parent); }
    header(ctx: Ctx) {
      this.backgroundGradient(ctx);
      this.gui.textCenter(ctx, this.title, this.gui.w / 2, 8, '#ffffff');
    }
    footer(ctx: Ctx) {
      if (this.message) this.gui.textCenter(ctx, this.message.slice(0, 90), this.gui.w / 2, this.gui.h - 34, '#ffff88');
    }
    btn(x: number, y: number, w: number, label: string | (() => string), fn: () => void, enabled: () => boolean = () => true) {
      const b = new Button(this.ui, x, y, w, 20, label, fn);
      const self = this;
      const base = b.render.bind(b);
      b.render = (ctx: Ctx, mx: number, my: number) => { b.enabled = enabled.call(self); base(ctx, mx, my); };
      this.widgets.push(b);
      return b;
    }
    done() { this.btn(this.gui.w / 2 - 50, this.gui.h - 24, 100, 'Done', () => this.close()); }
  }

  // ------------------------------------------------------------------ main menu
  class MainScreen extends Base {
    override title = 'Blueprints';
    override init() {
      this.widgets = [];
      const cx = Math.floor(this.gui.w / 2), w = 150, g = 4, top = Math.max(24, Math.min(40, this.gui.h / 2 - 100));
      const L = cx - w - g / 2, R = cx + g / 2;
      let y = top;
      const row = () => { const r = y; y += 22; return r; };
      let r = row();
      this.btn(L, r, w, 'Schematics...', () => this.ui.open(new LibraryScreen(this.ui, this)));
      this.btn(R, r, w, () => `Placements (${state.placements.length})...`, () => this.ui.open(new PlacementScreen(this.ui, this)));
      r = row();
      this.btn(L, r, w, 'Save Selection...', () => this.ui.open(new SaveScreen(this.ui, this)));
      this.btn(R, r, w, 'Material List...', () => this.ui.open(new MaterialsScreen(this.ui, this)), () => !!selectedPlacement());
      r = row();
      this.btn(L, r, w, 'Verify...', () => this.ui.open(new VerifyScreen(this.ui, this)), () => state.placements.length > 0);
      this.btn(R, r, w, () => `Unknown Blocks (${unknownNames().length})...`, () => this.ui.open(new RemapScreen(this.ui, this)), () => unknownNames().length > 0 || remaps.size > 0);
      r = row();
      this.btn(L, r, w, () => `Ghost Blocks: ${state.ghosts ? 'On' : 'Off'}`, () => { state.ghosts = !state.ghosts; changed(); });
      this.btn(R, r, w, () => `Highlights: ${state.highlights ? 'On' : 'Off'}`, () => { state.highlights = !state.highlights; changed(); });
      r = row();
      this.btn(L, r, w, () => `Layers: ${LAYER_NAMES[state.layer.mode]}`, () => { state.layer.mode = LAYERS[(LAYERS.indexOf(state.layer.mode) + 1) % LAYERS.length]; changed(); });
      this.btn(R, r, 30, '-', () => { state.layer.y = Math.max(0, state.layer.y - 1); changed(); }, () => state.layer.mode !== 'all');
      this.btn(R + 32, r, w - 64, () => `Y ${state.layer.y}`, () => { state.layer.y = Math.floor(this.client.player!.y); changed(); }, () => state.layer.mode !== 'all');
      this.btn(R + w - 30, r, 30, '+', () => { state.layer.y = Math.min(255, state.layer.y + 1); changed(); }, () => state.layer.mode !== 'all');
      r = row();
      this.btn(L, r, w, () => `Easy Place: ${state.easyPlace ? 'On' : 'Off'}`, () => { state.easyPlace = !state.easyPlace; changed(); });
      this.btn(R, r, w, () => `Wand: ${state.wand === 'area' ? 'Select area' : 'Move placement'}`, () => { state.wand = state.wand === 'area' ? 'move' : 'area'; changed(); });
      if (pasting()) { r = row(); this.btn(cx - 75, r, 150, 'Stop Pasting', () => cancelPaste()); }
      this.done();
    }
    override render(ctx: Ctx, mx: number, my: number) {
      this.header(ctx);
      const p = selectedPlacement();
      const sel = state.boxes.length ? `Selection: ${state.boxes.length} box${state.boxes.length > 1 ? 'es' : ''}, ${state.boxes.map((b) => boxSize(b).join('x')).join(' + ')}` : 'No selection (wand: left-click a corner, right-click the other)';
      this.gui.textCenter(ctx, sel, this.gui.w / 2, this.gui.h - 58, '#c0c0c0');
      this.gui.textCenter(ctx, p ? `Placement: ${p.data.name} at ${p.data.origin.join(', ')}` : 'No placement selected', this.gui.w / 2, this.gui.h - 46, '#c0c0c0');
      super.render(ctx, mx, my);
      this.footer(ctx);
    }
  }

  const unknownNames = () => [...new Set(state.placements.flatMap((p) => [...p.unknown]))].sort();

  // ------------------------------------------------------------------ library
  class LibraryScreen extends Base {
    override title = 'Schematics';
    items: lib.Summary[] = [];
    list!: List<lib.Summary>;
    confirmDelete = '';
    constructor(ui: UI, parent: ScreenT | null) { super(ui, parent); this.refresh(); }
    async refresh() {
      try { this.items = await lib.list(); } catch (e) { this.message = 'The library can\'t be opened: ' + (e as Error).message; }
    }
    get pick() { return this.items[this.list?.selected ?? -1] ?? null; }
    override init() {
      this.widgets = [];
      const W = this.gui.w, H = this.gui.h, lw = Math.min(230, Math.floor(W * 0.55)), x = Math.max(4, Math.floor(W / 2 - (lw + 130) / 2));
      this.list = new List(x, 26, lw, H - 26 - 64, 20, () => this.items, (ctx, s, rx, ry, rw) => {
        this.gui.text(ctx, s.name.slice(0, 32), rx, ry + 2, '#ffffff');
        this.gui.text(ctx, `${s.size.join('x')}  ${s.blocks.toLocaleString()} blocks  ${s.source}`, rx, ry + 11, '#a0a0a0');
        void rw;
      });
      const bx = x + lw + 6, bw = Math.min(124, W - bx - 4);
      let y = 26;
      const next = () => { const r = y; y += 22; return r; };
      this.btn(bx, next(), bw, 'Import File...', () => this.importFiles());
      this.btn(bx, next(), bw, 'Place Here', () => this.placeHere(), () => !!this.pick);
      this.btn(bx, next(), bw, 'Export .litematic', () => this.export('litematic'), () => !!this.pick);
      this.btn(bx, next(), bw, 'Export .schem', () => this.export('schem'), () => !!this.pick);
      this.btn(bx, next(), bw, 'Export .nbt', () => this.export('nbt'), () => !!this.pick);
      this.btn(bx, next(), bw, () => `For Java ${settings.exportVersion}`, () => {
        const i = VERSIONS.findIndex(([n]) => n === settings.exportVersion);
        settings.exportVersion = VERSIONS[(i + 1) % VERSIONS.length][0];
      });
      this.btn(bx, next(), bw, () => (this.confirmDelete && this.confirmDelete === this.pick?.id ? 'Really Delete?' : 'Delete'), () => this.remove(), () => !!this.pick);
      this.done();
    }
    override render(ctx: Ctx, mx: number, my: number) {
      this.header(ctx);
      this.list.render(ctx);
      if (!this.items.length) this.gui.textCenter(ctx, 'Empty: import a file or save a selection', this.list.x + this.list.w / 2, this.list.y + 20, '#a0a0a0');
      super.render(ctx, mx, my);
      this.footer(ctx);
    }
    override mouseDown(mx: number, my: number, b: number) {
      const i = this.list.pick(mx, my);
      if (i >= 0) { this.list.selected = i; this.confirmDelete = ''; return true; }
      return super.mouseDown(mx, my, b);
    }
    override wheel(d: number) { this.list.wheel(d); }
    importFiles() {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.litematic,.schem,.schematic,.nbt';
      inp.multiple = true;
      inp.onchange = async () => {
        const files = [...(inp.files ?? [])];
        for (const f of files) {
          try {
            const r = await readSchematic(new Uint8Array(await f.arrayBuffer()), f.name);
            await lib.put(r.schematic);
            this.message = `Imported ${r.schematic.name} (Java ${versionName(r.schematic.dataVersion)})${r.warnings.length ? ': ' + r.warnings[0] : ''}`;
          } catch (e) { this.message = `${f.name}: ${(e as Error).message}`; }
        }
        await this.refresh();
        this.list.selected = 0;
      };
      inp.click();
    }
    async placeHere() {
      const s = this.pick && await lib.get(this.pick.id);
      if (!s) return;
      const pl = this.client.player!;
      const p = new Placement({ id: newId(), schematicId: s.id, name: s.name, origin: [Math.floor(pl.x), Math.floor(pl.y), Math.floor(pl.z)], rotation: 0, mirror: 0, visible: true }, s);
      addPlacement(p);
      this.message = `Placed ${s.name}${p.unknown.size ? ` (${p.unknown.size} kinds of block unknown here: see Unknown Blocks)` : ''}`;
    }
    async export(fmt: Format) {
      const s = this.pick && await lib.get(this.pick.id);
      if (!s) return;
      const dv = VERSIONS.find(([n]) => n === settings.exportVersion)?.[1] ?? VERSIONS[0][1];
      try {
        const r = await writeSchematic(s, fmt, dv);
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = URL.createObjectURL(new Blob([r.data as BlobPart], { type: 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = lastUrl;
        a.download = (s.name.replace(/[^\w .-]+/g, '_').trim() || 'schematic') + EXTENSIONS[fmt];
        a.click();
        this.message = `Saved ${a.download} for Java ${settings.exportVersion}${r.warnings.length ? '. ' + r.warnings[0] : ''}`;
      } catch (e) { this.message = 'Export failed: ' + (e as Error).message; }
    }
    async remove() {
      const p = this.pick;
      if (!p) return;
      if (this.confirmDelete !== p.id) { this.confirmDelete = p.id; return; }
      await lib.remove(p.id);
      this.confirmDelete = '';
      this.message = `Deleted ${p.name}`;
      await this.refresh();
    }
  }

  // ------------------------------------------------------------------ placements
  class PlacementScreen extends Base {
    override title = 'Placements';
    list!: List<Placement>;
    override init() {
      this.widgets = [];
      const W = this.gui.w, H = this.gui.h, lw = Math.min(150, Math.floor(W * 0.38)), total = lw + 6 + 190, x = Math.max(4, Math.floor(W / 2 - total / 2));
      this.list = new List(x, 26, lw, H - 26 - 64, 14, () => state.placements, (ctx, p, rx, ry) => {
        this.gui.text(ctx, (p.data.visible ? '' : '(hidden) ') + p.data.name.slice(0, 22), rx, ry + 3, p.data.visible ? '#ffffff' : '#909090');
      });
      this.list.selected = state.placements.findIndex((p) => p.data.id === state.selected);
      const bx = x + lw + 6, bw = 92, g = 4;
      let y = 26 + 34;
      const sel = () => !!selectedPlacement();
      const edit = (f: (p: Placement) => void) => () => { const p = selectedPlacement(); if (!p) return; f(p); p.resolve(); changed(); };
      const row = () => { const r = y; y += 22; return r; };
      let r = row();
      this.btn(bx, r, bw, 'Move to Me', edit((p) => { const pl = this.client.player!; p.data.origin = [Math.floor(pl.x), Math.floor(pl.y), Math.floor(pl.z)]; }), sel);
      this.btn(bx + bw + g, r, bw, () => (selectedPlacement()?.data.visible === false ? 'Show' : 'Hide'), edit((p) => { p.data.visible = !p.data.visible; }), sel);
      r = row();
      const nudge = (a: number, d: number, label: string, xx: number, w2: number) => this.btn(xx, r, w2, label, edit((p) => { p.data.origin[a] += d; }), sel);
      const nw = Math.floor((bw * 2 + g - 5 * 2) / 6);
      ['X-', 'X+', 'Y-', 'Y+', 'Z-', 'Z+'].forEach((lab, k) => nudge(k >> 1, k & 1 ? 1 : -1, lab, bx + k * (nw + 2), nw));
      r = row();
      this.btn(bx, r, bw, 'Turn Right', edit((p) => { p.data.rotation = (p.data.rotation + 1) & 3; }), sel);
      this.btn(bx + bw + g, r, bw, 'Turn Left', edit((p) => { p.data.rotation = (p.data.rotation + 3) & 3; }), sel);
      r = row();
      this.btn(bx, r, bw * 2 + g, () => `Mirror: ${MIRRORS[selectedPlacement()?.data.mirror ?? 0]}`, edit((p) => { p.data.mirror = (p.data.mirror + 1) % 3; }), sel);
      r = row();
      this.btn(bx, r, bw, () => (pasting() ? 'Pasting...' : 'Paste'), () => { const p = selectedPlacement(); if (p) { startPaste(p, settings.pasteMode as PasteMode); this.message = `Pasting ${p.data.name}...`; } }, () => sel() && !pasting() && !!this.client.player?.creative);
      this.btn(bx + bw + g, r, bw, () => `Paste: ${PASTE_NAMES[settings.pasteMode] ?? 'All'}`, () => { const ks = Object.keys(PASTE_NAMES); settings.pasteMode = ks[(ks.indexOf(settings.pasteMode) + 1) % ks.length]; });
      r = row();
      this.btn(bx, r, bw, 'Undo Paste', () => { undoPaste(); this.message = 'Taking back the last paste...'; }, () => !!this.client.player?.creative);
      this.btn(bx + bw + g, r, bw, 'Remove', () => { removePlacement(state.selected); this.list.selected = state.placements.findIndex((p) => p.data.id === state.selected); }, sel);
      this.done();
    }
    override render(ctx: Ctx, mx: number, my: number) {
      this.header(ctx);
      this.list.render(ctx);
      if (!state.placements.length) this.gui.textCenter(ctx, 'None: place one from Schematics', this.list.x + this.list.w / 2, this.list.y + 20, '#a0a0a0');
      const p = selectedPlacement();
      const bx = this.list.x + this.list.w + 6;
      if (p) {
        this.gui.text(ctx, p.data.name.slice(0, 30), bx, 28, '#ffffff');
        const s = p.size;
        this.gui.text(ctx, `${p.data.origin.join(', ')}  ${s[0]}x${s[1]}x${s[2]}  turned ${p.data.rotation * 90}`, bx, 40, '#a0a0a0');
      }
      if (!this.client.player?.creative) this.gui.textCenter(ctx, 'Pasting works in creative mode (with commands allowed)', this.gui.w / 2, this.gui.h - 46, '#a0a0a0');
      super.render(ctx, mx, my);
      this.footer(ctx);
    }
    override mouseDown(mx: number, my: number, b: number) {
      const i = this.list.pick(mx, my);
      if (i >= 0) { this.list.selected = i; state.selected = state.placements[i].data.id; changed(); return true; }
      return super.mouseDown(mx, my, b);
    }
    override wheel(d: number) { this.list.wheel(d); }
  }

  // ------------------------------------------------------------------ saving the selection
  class SaveScreen extends Base {
    override title = 'Save Selection';
    name!: InstanceType<typeof TextField>;
    author!: InstanceType<typeof TextField>;
    override init() {
      this.widgets = [];
      const cx = Math.floor(this.gui.w / 2), w = 200;
      this.name = new TextField(this.ui, cx - w / 2, 40, w, 20, this.name?.value ?? '', 50, 'Name');
      this.author = new TextField(this.ui, cx - w / 2, 74, w, 20, this.author?.value ?? this.client.options.playerName ?? '', 40, 'Author');
      this.widgets.push(this.name, this.author);
      this.btn(cx - w / 2, 100, w, 'Save to Library', () => this.save(), () => state.boxes.length > 0 && this.name.value.trim().length > 0);
      this.btn(cx - w / 2, 130, 98, 'Add Another Box', () => { state.active = state.boxes.length; changed(); this.message = 'The next corners you pick make a new box'; });
      this.btn(cx + 2, 130, 98, 'Remove Box', () => { state.boxes.splice(Math.min(state.active, state.boxes.length - 1), 1); state.active = Math.max(0, state.boxes.length - 1); changed(); }, () => state.boxes.length > 0);
      this.btn(cx - w / 2, 152, w, 'Clear Selection', () => { state.boxes = []; state.active = 0; changed(); }, () => state.boxes.length > 0);
      this.done();
    }
    override render(ctx: Ctx, mx: number, my: number) {
      this.header(ctx);
      this.gui.text(ctx, 'Name', this.name.x, 30, '#a0a0a0');
      this.gui.text(ctx, 'Author', this.author.x, 64, '#a0a0a0');
      const vol = state.boxes.reduce((a, b) => { const s = boxSize(b); return a + s[0] * s[1] * s[2]; }, 0);
      this.gui.textCenter(ctx, state.boxes.length ? `${state.boxes.length} box${state.boxes.length > 1 ? 'es' : ''}: ${vol.toLocaleString()} blocks of space` : 'Nothing selected: with the wand, left-click one corner and right-click the other', this.gui.w / 2, 178, '#c0c0c0');
      super.render(ctx, mx, my);
      this.footer(ctx);
    }
    async save() {
      try {
        const s = capture(this.client, state.boxes, this.name.value.trim(), this.author.value.trim());
        await lib.put(s);
        this.message = `Saved ${s.name}: ${bounds(s).size.join('x')}`;
      } catch (e) { this.message = (e as Error).message; }
    }
  }

  // ------------------------------------------------------------------ material list
  interface Material { item: number; total: number; left: number; have: number }
  class MaterialsScreen extends Base {
    override title = 'Material List';
    rows: Material[] = [];
    list!: List<Material>;
    override init() {
      this.widgets = [];
      this.compute();
      const W = this.gui.w, w = Math.min(300, W - 8), x = Math.floor(W / 2 - w / 2);
      this.list = new List(x, 38, w, this.gui.h - 38 - 30, 20, () => this.rows, (ctx, m, rx, ry, rw) => {
        this.ui.drawItem(ctx, mc.stack(m.item, 1), rx, ry + 2);
        this.gui.text(ctx, (mc.getItem(m.item)?.display ?? '?').slice(0, 24), rx + 20, ry + 6, '#ffffff');
        const cols = [[m.total, '#ffffff'], [m.left, m.left ? '#ffaa33' : '#55ff55'], [m.have, m.have >= m.left ? '#55ff55' : '#ff5555']] as const;
        cols.forEach(([n, c], k) => this.gui.text(ctx, String(n), rx + rw - 120 + k * 42, ry + 6, c));
      });
      this.done();
    }
    compute() {
      const p = selectedPlacement();
      this.rows = [];
      if (!p) return;
      const total = new Map<number, number>(), left = new Map<number, number>();
      // counts by block, then by item
      const byBlock = new Map<number, number>();
      p.schematic.regions.forEach((r, ri) => { const vals = p.values[ri]; for (const i of r.blocks) { const v = vals[i]; if (v > 0) byBlock.set(v, (byBlock.get(v) ?? 0) + 1); } });
      const done = doneByBlock();
      for (const [v, n] of byBlock) for (const [it, k] of materials(v)) {
        total.set(it, (total.get(it) ?? 0) + n * k);
        left.set(it, (left.get(it) ?? 0) + Math.max(0, n - (done.get(v) ?? 0)) * k);
      }
      const inv = this.client.player!.inventory;
      for (const [it, n] of total) this.rows.push({ item: it, total: n, left: left.get(it) ?? 0, have: inv.count(it) });
      this.rows.sort((a, b) => b.left - a.left || b.total - a.total);
    }
    override tick() { if (this.client.ticks % 20 === 0) { const s = this.list.scroll; this.compute(); this.list.scroll = s; } }
    override render(ctx: Ctx, mx: number, my: number) {
      this.header(ctx);
      const l = this.list;
      this.gui.text(ctx, 'Item', l.x + 23, 27, '#a0a0a0');
      ['Total', 'Left', 'Have'].forEach((t, k) => this.gui.text(ctx, t, l.x + l.w - 123 + k * 42, 27, '#a0a0a0'));
      l.render(ctx);
      super.render(ctx, mx, my);
      this.footer(ctx);
    }
    override wheel(d: number) { this.list.wheel(d); }
  }

  // ------------------------------------------------------------------ verifier
  interface Diff { x: number; y: number; z: number; kind: Mark }
  class VerifyScreen extends Base {
    override title = 'Verify';
    rows: Diff[] = [];
    list!: List<Diff>;
    override init() {
      this.widgets = [];
      const W = this.gui.w, w = Math.min(320, W - 8), x = Math.floor(W / 2 - w / 2);
      this.refresh();
      this.list = new List(x, 64, w, this.gui.h - 64 - 30, 12, () => this.rows, (ctx, d, rx, ry) => {
        const [name, color] = KIND_NAMES[d.kind];
        this.gui.text(ctx, name, rx, ry + 2, color);
        this.gui.text(ctx, `${d.x}, ${d.y}, ${d.z}`, rx + 70, ry + 2, '#c0c0c0');
        this.gui.text(ctx, this.describe(d).slice(0, 34), rx + 150, ry + 2, '#909090');
      });
      this.done();
    }
    describe(d: Diff): string {
      const w = this.client.world!, have = w.get(d.x, d.y, d.z);
      let want = -1;
      for (let k = state.placements.length - 1; k >= 0 && want < 0; k--) if (state.placements[k].data.visible) { const v = state.placements[k].at(d.x, d.y, d.z); if (v >= 0) want = v; }
      const nm = (v: number) => (v ? mc.BLOCKS[v & 0xfff]?.display ?? '?' : 'air');
      if (d.kind === Mark.Missing) return `needs ${nm(want)}`;
      if (d.kind === Mark.Extra) return `${nm(have)}, should be air`;
      if (d.kind === Mark.Unknown) return 'a block this game lacks';
      return `${nm(have)} -> ${nm(want)}`;
    }
    refresh() {
      const p = this.client.player!;
      this.rows = nearbyMarks(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), 500);
    }
    override tick() { if (this.client.ticks % 20 === 0) this.refresh(); }
    override render(ctx: Ctx, mx: number, my: number) {
      this.header(ctx);
      const t = totals();
      const done = t.correct + t.missing + t.wrongBlock + t.wrongState + t.unknown;
      const pct = done ? Math.floor((t.correct / done) * 100) : 0;
      this.gui.textCenter(ctx, `${pct}% done: ${t.correct.toLocaleString()} right of ${done.toLocaleString()} blocks checked`, this.gui.w / 2, 24, '#ffffff');
      const parts: [string, string][] = [
        [`Missing ${t.missing}`, KIND_NAMES[Mark.Missing][1]], [`Wrong block ${t.wrongBlock}`, KIND_NAMES[Mark.WrongBlock][1]],
        [`Wrong state ${t.wrongState}`, KIND_NAMES[Mark.WrongState][1]], [`Extra ${t.extra}`, KIND_NAMES[Mark.Extra][1]],
      ];
      let x = this.list.x;
      for (const [s, c] of parts) { this.gui.text(ctx, s, x, 38, c); x += this.gui.textWidth(s) + 10; }
      this.gui.text(ctx, t.unchecked > 0 ? `${t.unchecked} chunks not loaded yet: go closer to check them` : 'Nearest first:', this.list.x, 51, '#a0a0a0');
      this.list.render(ctx);
      super.render(ctx, mx, my);
      this.footer(ctx);
    }
    override wheel(d: number) { this.list.wheel(d); }
  }

  // ------------------------------------------------------------------ stand-ins for unknown blocks
  class RemapScreen extends Base {
    override title = 'Unknown Blocks';
    list!: List<string>;
    field!: InstanceType<typeof TextField>;
    names: string[] = [];
    override init() {
      this.widgets = [];
      this.names = [...new Set([...unknownNames(), ...remaps.keys()])].sort();
      const W = this.gui.w, lw = Math.min(200, Math.floor(W * 0.5)), total = lw + 6 + 130, x = Math.max(4, Math.floor(W / 2 - total / 2));
      this.list = new List(x, 26, lw, this.gui.h - 26 - 40, 12, () => this.names, (ctx, n, rx, ry) => {
        this.gui.text(ctx, n.replace(/^minecraft:/, '').slice(0, 30), rx, ry + 2, remaps.has(n) ? '#55ff55' : '#ff8888');
      });
      const bx = x + lw + 6;
      this.field = new TextField(this.ui, bx, 40, 130, 20, '', 60, 'e.g. stone');
      this.widgets.push(this.field);
      this.btn(bx, 64, 130, 'Use This Block', () => this.set(), () => this.list.selected >= 0 && this.field.value.trim().length > 0);
      this.btn(bx, 86, 130, 'Forget Stand-in', () => this.clear(), () => remaps.has(this.names[this.list.selected]));
      this.done();
    }
    override render(ctx: Ctx, mx: number, my: number) {
      this.header(ctx);
      this.list.render(ctx);
      this.gui.text(ctx, 'Stand-in from this game:', this.field.x, 28, '#a0a0a0');
      const n = this.names[this.list.selected];
      if (n) this.gui.text(ctx, remaps.has(n) ? `now: ${remaps.get(n)}` : 'none yet', this.field.x, 112, '#a0a0a0');
      super.render(ctx, mx, my);
      this.footer(ctx);
    }
    override mouseDown(mx: number, my: number, b: number) {
      const i = this.list.pick(mx, my);
      if (i >= 0) { this.list.selected = i; this.field.value = remaps.get(this.names[i]) ?? this.guess(this.names[i]); return true; }
      return super.mouseDown(mx, my, b);
    }
    override wheel(d: number) { this.list.wheel(d); }
    /** A first suggestion: the closest name this game has. */
    guess(n: string) { return mc.blockspec.suggest(n.replace(/^[^:]+:/, ''), 1)[0] ?? ''; }
    set() {
      const n = this.names[this.list.selected], spec = this.field.value.trim();
      try { mc.blockspec.parseBlock(spec); } catch (e) { this.message = (e as Error).message; return; }
      remaps.set(n, spec);
      this.after();
    }
    clear() { remaps.delete(this.names[this.list.selected]); this.after(); }
    after() {
      saveRemaps();
      for (const p of state.placements) p.resolve();
      changed();
      this.message = 'Placements updated';
    }
  }

  const byName = { main: MainScreen, schematics: LibraryScreen, placements: PlacementScreen, save: SaveScreen, materials: MaterialsScreen, verify: VerifyScreen, unknown: RemapScreen };
  return {
    /** Open the main menu, or another screen by name (`schematics`, `placements`, `save`, `materials`, `verify`, `unknown`). */
    open: (client: Client, name: keyof typeof byName = 'main') => {
      const main = new MainScreen(client.ui, null);
      client.ui.open(name === 'main' ? main : new byName[name](client.ui, main));
    },
  };
}
