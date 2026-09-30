import type { UI } from './ui';
import type { Ctx } from './gui';

export interface Widget {
  x: number; y: number; w: number; h: number;
  visible?: boolean;
  render(ctx: Ctx, mx: number, my: number): void;
  mouseDown?(mx: number, my: number, button: number): boolean;
  mouseUp?(mx: number, my: number): void;
  mouseMove?(mx: number, my: number): void;
  key?(e: KeyboardEvent): boolean;
  char?(ch: string): boolean;
}

const inside = (w: { x: number; y: number; w: number; h: number }, mx: number, my: number) => mx >= w.x && my >= w.y && mx < w.x + w.w && my < w.y + w.h;

export class Button implements Widget {
  enabled = true;
  visible = true;
  tooltip = '';
  constructor(public ui: UI, public x: number, public y: number, public w: number, public h: number, public label: string | (() => string), public onClick: () => void) {}
  render(ctx: Ctx, mx: number, my: number) {
    const lbl = typeof this.label === 'function' ? this.label() : this.label;
    this.ui.gui.button(ctx, this.x, this.y, this.w, this.h, lbl, inside(this, mx, my), this.enabled);
  }
  mouseDown(mx: number, my: number, button: number) {
    if (button !== 0 || !this.enabled || !inside(this, mx, my)) return false;
    this.ui.game.audio.play('click', null, 0.6, 1);
    this.onClick();
    return true;
  }
}

export class Slider implements Widget {
  dragging = false;
  visible = true;
  constructor(public ui: UI, public x: number, public y: number, public w: number, public h: number, public value: number, public label: (v: number) => string, public onChange: (v: number) => void, public steps = 0) {}
  render(ctx: Ctx, mx: number, my: number) {
    this.ui.gui.slider(ctx, this.x, this.y, this.w, this.h, this.label(this.value), this.value, inside(this, mx, my) || this.dragging);
  }
  private set(mx: number) {
    let v = Math.max(0, Math.min(1, (mx - this.x - 4) / (this.w - 8)));
    if (this.steps > 0) v = Math.round(v * this.steps) / this.steps;
    this.value = v;
    this.onChange(v);
  }
  mouseDown(mx: number, my: number, button: number) {
    if (button !== 0 || !inside(this, mx, my)) return false;
    this.dragging = true;
    this.set(mx);
    this.ui.game.audio.play('click', null, 0.6, 1);
    return true;
  }
  mouseMove(mx: number) { if (this.dragging) this.set(mx); }
  mouseUp() { this.dragging = false; }
}

export class TextField implements Widget {
  focused = false;
  visible = true;
  constructor(public ui: UI, public x: number, public y: number, public w: number, public h: number, public value = '', public maxLen = 32, public placeholder = '') {}
  render(ctx: Ctx) {
    this.ui.gui.textField(ctx, this.x, this.y, this.w, this.h, this.value, this.focused, this.placeholder);
  }
  mouseDown(mx: number, my: number) {
    this.focused = inside(this, mx, my);
    return this.focused;
  }
  key(e: KeyboardEvent) {
    if (!this.focused) return false;
    if (e.code === 'Backspace') { this.value = this.value.slice(0, -1); return true; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
      navigator.clipboard?.readText().then((t) => (this.value = (this.value + t).slice(0, this.maxLen))).catch(() => {});
      return true;
    }
    return e.key.length === 1;
  }
  char(ch: string) {
    if (!this.focused) return false;
    if (this.value.length < this.maxLen && ch >= ' ' && ch !== '§') this.value += ch;
    return true;
  }
}

export abstract class Screen {
  pausesGame = false;
  hidesSelection = true;
  darkens = true;
  widgets: Widget[] = [];
  constructor(public ui: UI) {}
  get game() { return this.ui.game; }
  get gui() { return this.ui.gui; }
  init() {}
  tick() {}
  onClose() {}
  render(ctx: Ctx, mx: number, my: number) {
    for (const w of this.widgets) if (w.visible !== false) w.render(ctx, mx, my);
  }
  mouseDown(mx: number, my: number, button: number): boolean {
    for (const w of this.widgets) if (w.visible !== false && w.mouseDown?.(mx, my, button)) return true;
    return false;
  }
  mouseUp(mx: number, my: number, _button: number) {
    for (const w of this.widgets) w.mouseUp?.(mx, my);
  }
  mouseMove(mx: number, my: number) {
    for (const w of this.widgets) w.mouseMove?.(mx, my);
  }
  wheel(_d: number) {}
  key(e: KeyboardEvent): boolean {
    for (const w of this.widgets) if (w.key?.(e)) return true;
    if (e.code === 'Escape') { this.close(); return true; }
    return false;
  }
  char(ch: string) {
    for (const w of this.widgets) if (w.char?.(ch)) return;
  }
  close() {
    this.ui.close();
  }
  /** MC's container-screen background: a vertical dark gradient over the world. */
  backgroundGradient(ctx: Ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.gui.h);
    g.addColorStop(0, 'rgba(16,16,16,0.75)');
    g.addColorStop(1, 'rgba(16,16,16,0.82)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.gui.w, this.gui.h);
  }
}
