// The computer's terminal (client side): shows the screen kept in the computer's tile entity, sends typed lines
// to the server, and edits files in place (the server sends the file when you type `edit NAME`).
import type { ModContext, UI, Ctx } from '../sdk';
import type { Shared } from './main';
import { COLS, ROWS, type ComputerTile } from './shell';

const THEMES: Record<string, string> = { green: '#33ff66', amber: '#ffb000', white: '#e4e4e4', blue: '#6cb4ff' };
const CW = 6, CH = 10, PAD = 8;

interface Editor { file: string; lines: string[]; row: number; col: number; top: number; dirty: boolean; warned: boolean }

export function terminalScreen(mod: ModContext, ch: Shared, cfg: { theme: string; scanlines: boolean }) {
  return class Terminal extends mod.mc.Screen {
    private input = '';
    private history: string[] = [];
    private hpos = -1;
    private editor: Editor | null = null;
    private ticks = 0;
    override hidesSelection = true;

    constructor(ui: UI, public x: number, public y: number, public z: number) { super(ui); }

    private tile(): ComputerTile | undefined {
      return this.game.world?.getTile(this.x, this.y, this.z) as unknown as ComputerTile | undefined;
    }
    private get w() { return COLS * CW + PAD * 2; }
    private get h() { return ROWS * CH + PAD * 2 + 12; }
    private get left() { return Math.floor((this.gui.w - this.w) / 2); }
    private get top() { return Math.floor((this.gui.h - this.h) / 2); }

    override wantsKeyboard() { return true; }

    override tick() {
      if (this.onServer) return;
      this.ticks++;
      // the computer was broken (or we walked off and its chunk unloaded)
      if (!this.tile()) this.close();
    }

    /** The server sent a file to edit (we typed `edit NAME`). */
    openEditor(file: string, text: string, x: number, y: number, z: number) {
      if (x !== this.x || y !== this.y || z !== this.z) return;
      this.editor = { file, lines: text.split('\n'), row: 0, col: 0, top: 0, dirty: false, warned: false };
    }

    private send(d: { cmd?: string; stop?: boolean }) {
      ch.run.toServer({ x: this.x, y: this.y, z: this.z, ...d });
    }

    override key(e: KeyboardEvent): boolean {
      const ctrl = e.ctrlKey || e.metaKey;
      if (this.editor) return this.editorKey(e, ctrl);
      if (ctrl && e.code === 'KeyT') { this.send({ stop: true }); return true; }
      switch (e.code) {
        case 'Escape': this.close(); return true;
        case 'Enter': case 'NumpadEnter':
          this.send({ cmd: this.input });
          if (this.input.trim()) this.history.push(this.input);
          this.input = '';
          this.hpos = -1;
          return true;
        case 'Backspace': this.input = this.input.slice(0, -1); return true;
        case 'ArrowUp': case 'ArrowDown': {
          if (!this.history.length) return true;
          if (this.hpos < 0) this.hpos = this.history.length;
          this.hpos = Math.max(0, Math.min(this.history.length, this.hpos + (e.code === 'ArrowUp' ? -1 : 1)));
          this.input = this.history[this.hpos] ?? '';
          return true;
        }
        case 'KeyV':
          if (ctrl) navigator.clipboard?.readText().then((t) => (this.input = (this.input + t.split('\n')[0]).slice(0, 200))).catch(() => {});
          return ctrl;
      }
      return true;
    }

    override char(c: string) {
      if (c < ' ' || c === '§') return;
      const ed = this.editor;
      if (ed) {
        const l = ed.lines[ed.row];
        ed.lines[ed.row] = l.slice(0, ed.col) + c + l.slice(ed.col);
        ed.col++;
        ed.dirty = true;
        return;
      }
      if (this.input.length < 200) this.input += c;
    }

    private editorKey(e: KeyboardEvent, ctrl: boolean): boolean {
      const ed = this.editor!;
      const line = () => ed.lines[ed.row];
      const clamp = () => { ed.col = Math.min(ed.col, line().length); };
      if (ctrl && e.code === 'KeyS') {
        e.preventDefault();
        ch.save.toServer({ x: this.x, y: this.y, z: this.z, file: ed.file, text: ed.lines.join('\n') });
        ed.dirty = false;
        ed.warned = false;
        return true;
      }
      switch (e.code) {
        case 'Escape':
          if (ed.dirty && !ed.warned) { ed.warned = true; return true; }
          this.editor = null;
          return true;
        case 'Enter': case 'NumpadEnter': {
          const l = line(), indent = /^\s*/.exec(l)![0];
          ed.lines.splice(ed.row + 1, 0, indent + l.slice(ed.col));
          ed.lines[ed.row] = l.slice(0, ed.col);
          ed.row++;
          ed.col = indent.length;
          ed.dirty = true;
          break;
        }
        case 'Backspace':
          if (ed.col > 0) { const l = line(); ed.lines[ed.row] = l.slice(0, ed.col - 1) + l.slice(ed.col); ed.col--; }
          else if (ed.row > 0) { const l = ed.lines.splice(ed.row, 1)[0]; ed.row--; ed.col = line().length; ed.lines[ed.row] += l; }
          ed.dirty = true;
          break;
        case 'Delete':
          if (ed.col < line().length) ed.lines[ed.row] = line().slice(0, ed.col) + line().slice(ed.col + 1);
          else if (ed.row < ed.lines.length - 1) ed.lines[ed.row] += ed.lines.splice(ed.row + 1, 1)[0];
          ed.dirty = true;
          break;
        case 'Tab': e.preventDefault(); this.char(' '); this.char(' '); break;
        case 'ArrowLeft': if (ed.col > 0) ed.col--; else if (ed.row > 0) { ed.row--; ed.col = line().length; } break;
        case 'ArrowRight': if (ed.col < line().length) ed.col++; else if (ed.row < ed.lines.length - 1) { ed.row++; ed.col = 0; } break;
        case 'ArrowUp': if (ed.row > 0) { ed.row--; clamp(); } break;
        case 'ArrowDown': if (ed.row < ed.lines.length - 1) { ed.row++; clamp(); } break;
        case 'Home': ed.col = 0; break;
        case 'End': ed.col = line().length; break;
      }
      const rows = ROWS - 1;
      if (ed.row < ed.top) ed.top = ed.row;
      if (ed.row >= ed.top + rows) ed.top = ed.row - rows + 1;
      return true;
    }

    override render(ctx: Ctx, mx: number, my: number) {
      this.backgroundGradient(ctx);
      const L = this.left, T = this.top, W = this.w, H = this.h, gui = this.gui;
      const t = this.tile();
      gui.panel(ctx, L, T, W, H);
      gui.text(ctx, t ? `Computer #${t.id}${t.label ? ' - ' + t.label : ''}` : 'Computer', L + PAD, T + 6, '#404040', false);
      const sx = L + PAD, sy = T + 16;
      ctx.fillStyle = '#0b0f0b';
      ctx.fillRect(sx - 3, sy - 3, COLS * CW + 6, ROWS * CH + 4);
      const col = THEMES[cfg.theme] ?? THEMES.green;
      const blink = Math.floor(this.ticks / 8) % 2 === 0;
      const put = (s: string, row: number, color = col) => {
        for (let i = 0; i < Math.min(COLS, s.length); i++) {
          const c = s[i];
          if (c === ' ') continue;
          const cw = gui.font.width(c);
          gui.text(ctx, c, sx + i * CW + Math.floor((CW - cw) / 2), sy + row * CH, color, false);
        }
      };
      const cursor = (row: number, c: number) => { if (blink) { ctx.fillStyle = col; ctx.fillRect(sx + c * CW, sy + row * CH + 8, CW - 1, 1); } };
      const ed = this.editor;
      if (ed) {
        put(`${ed.file}${ed.dirty ? ' *' : ''}`.padEnd(COLS - 18) + 'Ctrl+S save, Esc', 0, '#9a9a9a');
        for (let r = 0; r < ROWS - 1; r++) {
          const l = ed.lines[ed.top + r];
          if (l === undefined) break;
          const scroll = ed.row === ed.top + r ? Math.max(0, ed.col - COLS + 1) : 0;
          put(l.slice(scroll), r + 1);
        }
        cursor(ed.row - ed.top + 1, Math.min(ed.col, COLS - 1));
        if (ed.warned) put('Unsaved! Esc again to discard'.padEnd(COLS), ROWS - 1, '#ff6060');
      } else {
        const lines = t?.lines ?? [];
        lines.forEach((l, i) => put(l, i));
        const row = Math.min(lines.length, ROWS - 1);
        if (t?.prog) put(`[running ${t.prog.file}: Ctrl+T stops]`, row, '#9a9a9a');
        else {
          const shown = ('> ' + this.input).slice(-(COLS - 1));
          put(shown, row);
          cursor(row, shown.length);
        }
      }
      if (cfg.scanlines) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        for (let y = sy - 3; y < sy + ROWS * CH; y += 2) ctx.fillRect(sx - 3, y, COLS * CW + 6, 1);
      }
      super.render(ctx, mx, my);
    }
  };
}
