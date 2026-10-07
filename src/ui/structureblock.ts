// Editing structure blocks and jigsaw blocks (creative). Like the command block's screen, the server keeps a twin
// fed the same clicks and keys; its copy writes the tile when the screen closes and then saves, loads, detects or
// generates if a button asked for it. Text fields take focus by click (or Tab).
import { Screen } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { JIGSAW, JIGSAW_ORIENTS, STRUCTURE_BLOCK, FACING6, idOf, metaOf, pack } from '../world/blocks';
import type { Game } from '../game/game';
import { structureTile, saveStructure, loadStructure, detectStructure, MAX_SIZE, SAVE, LOAD, CORNER, DATA, type StructureTile } from '../game/structureblocks';
import { jigsawTile, generateJigsaw, type JigsawTile } from '../game/jigsaw';

interface Field { id: string; x: number; y: number; w: number; get(): string; set(v: string): void; max: number; num?: boolean }
interface Button { id: string; x: number; y: number; w: number; label: string }

/** Shared by both screens: text fields with focus, buttons, Done and Cancel. */
abstract class EditScreen extends Screen {
  override twin = true;
  focus = '';
  cancelled = false;
  action = '';
  protected loaded = false;
  private blink = 0;
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  get left() { return this.onServer ? 0 : Math.floor(this.gui.w / 2) - 150; }
  get top() { return this.onServer ? 0 : Math.max(10, Math.floor(this.gui.h / 2) - 104); }
  abstract fields(): Field[];
  abstract buttons(): Button[];
  abstract press(id: string): void;
  abstract load(): void;
  override init() { this.load(); }
  override tick() { this.blink++; this.load(); }
  protected drawFields(ctx: Ctx) {
    const g = this.gui;
    for (const f of this.fields()) {
      const on = this.focus === f.id;
      g.textField(ctx, f.x, f.y, f.w, 20, f.get() + (on && Math.floor(this.blink / 6) % 2 === 0 ? '_' : ''), on);
    }
  }
  protected drawButtons(ctx: Ctx, mx: number, my: number) {
    for (const b of this.buttons()) this.gui.button(ctx, b.x, b.y, b.w, 20, b.label, mx >= b.x && my >= b.y && mx < b.x + b.w && my < b.y + 20, true);
  }
  override mouseDown(mx: number, my: number, button: number): boolean {
    for (const f of this.fields()) if (mx >= f.x && my >= f.y && mx < f.x + f.w && my < f.y + 20) { this.focus = f.id; return true; }
    for (const b of this.buttons()) {
      if (mx < b.x || my < b.y || mx >= b.x + b.w || my >= b.y + 20) continue;
      this.game.audio.play('click', null, 0.3, 1);
      if (b.id === 'done') this.close();
      else if (b.id === 'cancel') { this.cancelled = true; this.close(); }
      else this.press(b.id);
      return true;
    }
    this.focus = '';
    return super.mouseDown(mx, my, button);
  }
  override key(e: KeyboardEvent): boolean {
    if (e.code === 'Escape' || e.code === 'Enter') { this.close(); return true; }
    if (e.code === 'Tab') {
      const list = this.fields(), i = list.findIndex((f) => f.id === this.focus);
      this.focus = list.length ? list[(i + 1) % list.length].id : '';
      return true;
    }
    const f = this.fields().find((q) => q.id === this.focus);
    if (e.code === 'Backspace') { if (f) f.set(f.get().slice(0, -1)); return true; }
    return e.key.length === 1;
  }
  override char(ch: string) {
    const f = this.fields().find((q) => q.id === this.focus);
    if (!f || ch < ' ' || ch === '§' || f.get().length >= f.max) return;
    if (f.num && !/[-0-9.]/.test(ch)) return;
    f.set(f.get() + ch);
  }
  /** On the server: what an action reports goes to the player's chat. */
  protected report(fn: () => string) {
    try { this.ui.chat.add(fn()); } catch (e) { this.ui.chat.add('§c' + (e as Error).message); }
  }
}

const int = (s: string, lo: number, hi: number, def = 0) => { const n = parseInt(s); return isNaN(n) ? def : Math.max(lo, Math.min(hi, n)); };
const MODE_LABEL = ['Save', 'Load', 'Corner', 'Data'];
const MIRROR_LABEL = ['None', 'Left/Right', 'Front/Back'];

export class StructureBlockScreen extends EditScreen {
  mode = SAVE;
  name = '';
  pos = ['0', '1', '0'];
  size = ['0', '0', '0'];
  rotation = 0;
  mirror = 0;
  entities = false;
  showBox = true;
  integrity = '1.0';
  seed = '0';
  data = '';
  load() {
    if (this.loaded) return;
    const w = this.game.world!, v = w.get(this.x, this.y, this.z);
    if (idOf(v) !== STRUCTURE_BLOCK) return;
    const t = w.getTile(this.x, this.y, this.z) as unknown as StructureTile | undefined;
    if (!t && !this.onServer) return;
    const s = t ?? structureTile(w, this.x, this.y, this.z);
    this.loaded = true;
    this.mode = metaOf(v) & 3;
    this.name = s.name; this.pos = s.pos.map(String); this.size = s.size.map(String);
    this.rotation = s.rotation; this.mirror = s.mirror; this.entities = s.entities; this.showBox = s.showBox;
    this.integrity = String(s.integrity === 1 ? '1.0' : s.integrity); this.seed = String(s.seed); this.data = s.data;
  }
  fields(): Field[] {
    const L = this.left, T = this.top, out: Field[] = [];
    if (this.mode === DATA) out.push({ id: 'data', x: L, y: T + 22, w: 300, max: 128, get: () => this.data, set: (v) => (this.data = v) });
    else out.push({ id: 'name', x: L, y: T + 22, w: 300, max: 64, get: () => this.name, set: (v) => (this.name = v) });
    if (this.mode === SAVE || this.mode === LOAD) for (let a = 0; a < 3; a++) out.push({ id: 'p' + a, x: L + a * 50, y: T + 58, w: 46, max: 4, num: true, get: () => this.pos[a], set: (v) => (this.pos[a] = v) });
    if (this.mode === SAVE) for (let a = 0; a < 3; a++) out.push({ id: 's' + a, x: L + 154 + a * 50, y: T + 58, w: 46, max: 3, num: true, get: () => this.size[a], set: (v) => (this.size[a] = v) });
    if (this.mode === LOAD) {
      out.push({ id: 'integrity', x: L + 154, y: T + 58, w: 70, max: 6, num: true, get: () => this.integrity, set: (v) => (this.integrity = v) });
      out.push({ id: 'seed', x: L + 230, y: T + 58, w: 70, max: 12, num: true, get: () => this.seed, set: (v) => (this.seed = v) });
    }
    return out;
  }
  buttons(): Button[] {
    const L = this.left, T = this.top, out: Button[] = [];
    const onOff = (b: boolean) => (b ? 'ON' : 'OFF');
    if (this.mode === SAVE) {
      out.push({ id: 'entities', x: L, y: T + 88, w: 146, label: `Include entities: ${onOff(this.entities)}` });
      out.push({ id: 'detect', x: L + 154, y: T + 88, w: 70, label: 'Detect' });
      out.push({ id: 'box', x: L + 230, y: T + 88, w: 70, label: `Box: ${onOff(this.showBox)}` });
      out.push({ id: 'save', x: L + 102, y: T + 114, w: 96, label: 'SAVE' });
    }
    if (this.mode === LOAD) {
      [0, 90, 180, 270].forEach((deg, q) => out.push({ id: 'rot' + q, x: L + q * 37, y: T + 88, w: 35, label: this.rotation === q ? `[${deg}]` : String(deg) }));
      out.push({ id: 'mirror', x: L + 154, y: T + 88, w: 70, label: MIRROR_LABEL[this.mirror] });
      out.push({ id: 'entities', x: L + 230, y: T + 88, w: 70, label: `Ents: ${onOff(this.entities)}` });
      out.push({ id: 'load', x: L + 102, y: T + 114, w: 96, label: 'LOAD' });
      out.push({ id: 'box', x: L + 204, y: T + 114, w: 96, label: `Box: ${onOff(this.showBox)}` });
    }
    out.push({ id: 'mode', x: L, y: T + 114, w: 96, label: `Mode: ${MODE_LABEL[this.mode]}` });
    out.push({ id: 'done', x: L + 46, y: T + 168, w: 100, label: 'Done' });
    out.push({ id: 'cancel', x: L + 154, y: T + 168, w: 100, label: 'Cancel' });
    return out;
  }
  press(id: string) {
    if (id === 'mode') { this.mode = (this.mode + 1) & 3; this.focus = ''; }
    else if (id === 'entities') this.entities = !this.entities;
    else if (id === 'box') this.showBox = !this.showBox;
    else if (id === 'mirror') this.mirror = (this.mirror + 1) % 3;
    else if (id.startsWith('rot')) this.rotation = +id.slice(3);
    else if (id === 'save' || id === 'load' || id === 'detect') { this.action = id; this.close(); }
  }
  override render(ctx: Ctx, mx: number, my: number) {
    this.load();
    const g = this.gui, L = this.left, T = this.top;
    ctx.fillStyle = 'rgba(16,16,16,0.75)';
    ctx.fillRect(0, 0, g.w, g.h);
    g.textCenter(ctx, 'Structure Block', L + 150, T - 4);
    g.text(ctx, this.mode === DATA ? 'Custom Data Tag Name' : 'Structure Name', L, T + 12, '#a0a0a0');
    if (this.mode === SAVE || this.mode === LOAD) g.text(ctx, 'Relative Position', L, T + 48, '#a0a0a0');
    if (this.mode === SAVE) g.text(ctx, 'Structure Size', L + 154, T + 48, '#a0a0a0');
    if (this.mode === LOAD) { g.text(ctx, 'Integrity', L + 154, T + 48, '#a0a0a0'); g.text(ctx, 'Seed', L + 230, T + 48, '#a0a0a0'); }
    const hint = this.mode === CORNER ? 'Marks a corner of a structure for its save block\'s Detect' : this.mode === DATA ? 'A marker for generated structures (an entity, or "chest <loot table>")' : this.mode === LOAD ? 'Load once to show the size, again to place it' : `Up to ${MAX_SIZE} blocks each way; structure voids are skipped`;
    g.text(ctx, hint, L, T + 144, '#808080');
    this.drawFields(ctx);
    this.drawButtons(ctx, mx, my);
    super.render(ctx, mx, my);
  }
  override onClose() {
    if (!this.onServer || !this.loaded || this.cancelled) return;
    const g = this.game as unknown as Game, w = g.world!, v = w.get(this.x, this.y, this.z);
    if (idOf(v) !== STRUCTURE_BLOCK) return;
    const t = structureTile(w, this.x, this.y, this.z);
    t.name = this.name.trim();
    t.pos = this.pos.map((s) => int(s, -MAX_SIZE, MAX_SIZE)) as [number, number, number];
    t.size = this.size.map((s) => int(s, 0, MAX_SIZE)) as [number, number, number];
    t.rotation = this.rotation & 3; t.mirror = this.mirror; t.entities = this.entities; t.showBox = this.showBox;
    const integ = parseFloat(this.integrity);
    t.integrity = isNaN(integ) ? 1 : Math.max(0, Math.min(1, integ));
    t.seed = int(this.seed, -2147483648, 2147483647);
    t.data = this.data;
    t.author ||= g.playerOf(g.player)?.name ?? '';
    if ((metaOf(v) & 3) !== this.mode) w.set(this.x, this.y, this.z, pack(STRUCTURE_BLOCK, this.mode));
    w.setTile(this.x, this.y, this.z, t as never);
    if (this.action === 'save') this.report(() => saveStructure(g, this.x, this.y, this.z));
    if (this.action === 'load') this.report(() => loadStructure(g, this.x, this.y, this.z, true));
    if (this.action === 'detect') this.report(() => detectStructure(g, this.x, this.y, this.z));
  }
}

export class JigsawScreen extends EditScreen {
  pool = '';
  name = '';
  target = '';
  final = '';
  joint: 'rollable' | 'aligned' = 'rollable';
  levels = 0;
  keep = false;
  load() {
    if (this.loaded) return;
    const w = this.game.world!, v = w.get(this.x, this.y, this.z);
    if (idOf(v) !== JIGSAW) return;
    const t = w.getTile(this.x, this.y, this.z) as unknown as JigsawTile | undefined;
    if (!t && !this.onServer) return;
    const s = t ?? jigsawTile(w, this.x, this.y, this.z);
    this.loaded = true;
    this.pool = s.pool; this.name = s.name; this.target = s.target; this.final = s.final; this.joint = s.joint;
  }
  private vertical() { const v = this.game.world!.get(this.x, this.y, this.z); return FACING6[(JIGSAW_ORIENTS[metaOf(v)] ?? JIGSAW_ORIENTS[10])[0]][1] !== 0; }
  fields(): Field[] {
    const L = this.left, T = this.top;
    const row = (id: 'pool' | 'name' | 'target' | 'final', i: number): Field => ({ id, x: L, y: T + 10 + i * 34, w: 300, max: 128, get: () => this[id], set: (v) => (this[id] = v) });
    return [row('pool', 0), row('name', 1), row('target', 2), row('final', 3)];
  }
  buttons(): Button[] {
    const L = this.left, T = this.top, out: Button[] = [];
    if (this.vertical()) out.push({ id: 'joint', x: L, y: T + 140, w: 96, label: `Joint: ${this.joint === 'aligned' ? 'Aligned' : 'Rollable'}` });
    out.push({ id: 'less', x: L + 102, y: T + 140, w: 20, label: '-' });
    out.push({ id: 'more', x: L + 180, y: T + 140, w: 20, label: '+' });
    out.push({ id: 'keep', x: L + 204, y: T + 140, w: 96, label: `Keep Jigsaws: ${this.keep ? 'ON' : 'OFF'}` });
    out.push({ id: 'generate', x: L + 77, y: T + 166, w: 146, label: 'Generate' });
    out.push({ id: 'done', x: L + 46, y: T + 196, w: 100, label: 'Done' });
    out.push({ id: 'cancel', x: L + 154, y: T + 196, w: 100, label: 'Cancel' });
    return out;
  }
  press(id: string) {
    if (id === 'joint') this.joint = this.joint === 'aligned' ? 'rollable' : 'aligned';
    else if (id === 'less') this.levels = Math.max(0, this.levels - 1);
    else if (id === 'more') this.levels = Math.min(7, this.levels + 1);
    else if (id === 'keep') this.keep = !this.keep;
    else if (id === 'generate') { this.action = 'generate'; this.close(); }
  }
  override render(ctx: Ctx, mx: number, my: number) {
    this.load();
    const g = this.gui, L = this.left, T = this.top;
    ctx.fillStyle = 'rgba(16,16,16,0.75)';
    ctx.fillRect(0, 0, g.w, g.h);
    g.textCenter(ctx, 'Jigsaw Block', L + 150, T - 10);
    ['Target Pool', 'Name', 'Target Name', 'Turns into'].forEach((s, i) => g.text(ctx, s, L, T + i * 34, '#a0a0a0'));
    g.textCenter(ctx, `Levels: ${this.levels}`, L + 151, T + 146);
    this.drawFields(ctx);
    this.drawButtons(ctx, mx, my);
    super.render(ctx, mx, my);
  }
  override onClose() {
    if (!this.onServer || !this.loaded || this.cancelled) return;
    const g = this.game as unknown as Game, w = g.world!;
    if (w.getId(this.x, this.y, this.z) !== JIGSAW) return;
    const t = jigsawTile(w, this.x, this.y, this.z);
    Object.assign(t, { pool: this.pool.trim(), name: this.name.trim(), target: this.target.trim(), final: this.final.trim() || 'minecraft:air', joint: this.joint });
    w.setTile(this.x, this.y, this.z, t as never);
    if (this.action === 'generate') this.report(() => generateJigsaw(g, this.x, this.y, this.z, this.levels, this.keep));
  }
}
