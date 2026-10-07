// Editing a command block (creative): the command, then three switches (Impulse / Chain / Repeat, Unconditional /
// Conditional, Needs Redstone / Always Active) and Done. Like a sign, the server keeps a twin fed the same keys and
// clicks, and its copy writes the block.
import { Screen } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { COMMAND_BLOCKS, idOf, metaOf, pack } from '../world/blocks';
import { commandKick, type CommandTile } from '../game/commandblocks';
import type { Game } from '../game/game';

const MODES = ['Impulse', 'Chain', 'Repeat'];
export class CommandBlockScreen extends Screen {
  override twin = true;
  cmd = '';
  mode = 0;
  conditional = false;
  auto = false;
  last = '';
  private loaded = false;
  private blink = 0;
  constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }
  /** Laid out from a corner the server's copy shares (clicks reach it relative to this). */
  get left() { return this.onServer ? 0 : Math.floor(this.gui.w / 2) - 150; }
  get top() { return this.onServer ? 0 : Math.max(10, Math.floor(this.gui.h / 2) - 80); }
  private load() {
    if (this.loaded) return;
    const w = this.game.world!, v = w.get(this.x, this.y, this.z);
    const t = w.getTile(this.x, this.y, this.z) as unknown as CommandTile | undefined;
    if (!COMMAND_BLOCKS.includes(idOf(v))) return;
    this.loaded = true;
    this.cmd = t?.cmd ?? '';
    this.auto = !!t?.auto;
    this.last = t?.last ?? '';
    this.mode = COMMAND_BLOCKS.indexOf(idOf(v));
    this.conditional = (metaOf(v) & 8) !== 0;
  }
  override init() { this.load(); }
  override tick() { this.blink++; this.load(); }
  private buttons() {
    const L = this.left, T = this.top;
    return [
      { id: 'mode', x: L, y: T + 70, w: 96, label: MODES[this.mode] },
      { id: 'cond', x: L + 102, y: T + 70, w: 96, label: this.conditional ? 'Conditional' : 'Unconditional' },
      { id: 'auto', x: L + 204, y: T + 70, w: 96, label: this.auto ? 'Always Active' : 'Needs Redstone' },
      { id: 'done', x: L + 50, y: T + 130, w: 200, label: 'Done' },
    ];
  }
  override render(ctx: Ctx, mx: number, my: number) {
    this.load();
    const g = this.gui, L = this.left, T = this.top;
    ctx.fillStyle = 'rgba(16,16,16,0.75)';
    ctx.fillRect(0, 0, g.w, g.h);
    g.textCenter(ctx, 'Set Console Command', L + 150, T - 4);
    g.text(ctx, 'Console Command', L, T + 14, '#a0a0a0');
    const cur = Math.floor(this.blink / 6) % 2 === 0 ? '_' : '';
    g.textField(ctx, L, T + 26, 300, 20, this.cmd + cur, true);
    g.text(ctx, 'Previous Output', L, T + 96, '#a0a0a0');
    g.text(ctx, this.last || '-', L, T + 108, '#ffffff');
    for (const b of this.buttons()) g.button(ctx, b.x, b.y, b.w, 20, b.label, mx >= b.x && my >= b.y && mx < b.x + b.w && my < b.y + 20, true);
    super.render(ctx, mx, my);
  }
  override mouseDown(mx: number, my: number, button: number): boolean {
    for (const b of this.buttons()) {
      if (mx < b.x || my < b.y || mx >= b.x + b.w || my >= b.y + 20) continue;
      if (b.id === 'mode') this.mode = (this.mode + 1) % 3;
      if (b.id === 'cond') this.conditional = !this.conditional;
      if (b.id === 'auto') this.auto = !this.auto;
      if (b.id === 'done') this.close();
      this.game.audio.play('click', null, 0.3, 1);
      return true;
    }
    return super.mouseDown(mx, my, button);
  }
  override key(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') { this.close(); return true; }
    if (e.code === 'Enter') { this.close(); return true; }
    if (e.code === 'Backspace') { this.cmd = this.cmd.slice(0, -1); return true; }
    return e.key.length === 1;
  }
  override char(ch: string) { if (ch >= ' ' && ch !== '§' && this.cmd.length < 256) this.cmd += ch; }
  /** The server's copy writes the block: its kind, conditional bit and tile. */
  override onClose() {
    if (!this.onServer || !this.loaded) return;
    const w = this.game.world!, v = w.get(this.x, this.y, this.z);
    if (!COMMAND_BLOCKS.includes(idOf(v))) return;
    const t = (w.getTile(this.x, this.y, this.z) as unknown as CommandTile | undefined) ?? { type: 'command', cmd: '', auto: false, powered: false, success: 0, last: '' };
    const nv = pack(COMMAND_BLOCKS[this.mode], (metaOf(v) & 7) | (this.conditional ? 8 : 0));
    if (nv !== v) w.set(this.x, this.y, this.z, nv);
    w.setTile(this.x, this.y, this.z, { ...t, cmd: this.cmd, auto: this.auto } as never);
    commandKick(this.game as unknown as Game, this.x, this.y, this.z);
  }
}
