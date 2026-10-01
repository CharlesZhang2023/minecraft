// Touch controls for phones and tablets.
//
// In the world: a floating movement stick on the left, drag-to-look on the right, a tap uses/places, a long
// press mines, plus Jump / Sneak / Attack / Use buttons, a tappable hotbar and a row of menu buttons.
// In menus and containers: taps are clicks, vertical drags scroll lists, and "Split" / "Shift" toggles stand
// in for right-click and shift-click. Text fields raise the soft keyboard through a hidden <input>.
//
// Everything feeds the ordinary Input object (virtual keys, analog stick, synthetic mouse buttons), so
// gameplay and UI code don't care whether the player has a mouse or a finger.
import type { Game } from '../game/game';
import type { UI } from './ui';
import type { Input } from '../game/input';
import { device } from '../game/device';
import * as Menus from './menus';

const LOOK_SENS = 2.2; // mouse-equivalent pixels per CSS pixel of finger travel
const HOLD_MS = 380; // long press on the look area starts mining
const TAP_MS = 300;
const MOVE_PX = 9; // CSS px of travel before a touch stops counting as a tap
const STICK_R = 52; // CSS px
const DEAD = 0.14;
const SENT = '​​'; // sentinel text so Backspace always produces an input event

const buzz = (ms: number) => { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(ms); };

type Role = 'stick' | 'look' | 'btn' | 'hotbar' | 'screen' | 'tool';

interface Touch {
  id: number;
  role: Role;
  id2?: string; // button / tool id
  x: number; y: number; // current, device px
  sx: number; sy: number; // start
  lx: number; ly: number; // last, for deltas
  t0: number;
  moved: boolean;
  holding: boolean; // look touch turned into a mining hold
  // screen touches
  button: number;
  down: boolean; // a mouse press was already delivered
  scrolling: boolean;
  acc: number;
}

interface Btn { id: string; x: number; y: number; r: number }
interface Tool { id: string; x: number; y: number; w: number; h: number; label: string; on: boolean }

// ---------------------------------------------------------------------------------------------- soft keyboard
class SoftKeyboard {
  private el: HTMLInputElement;
  private prev = SENT;
  private composing = false;

  constructor(private input: Input, private wants: () => boolean) {
    const el = (this.el = document.createElement('input'));
    el.id = 'hidden-input';
    el.type = 'text';
    el.autocomplete = 'off';
    el.spellcheck = false;
    for (const [k, v] of [['autocorrect', 'off'], ['autocapitalize', 'off'], ['enterkeyhint', 'done'], ['name', 'mc-text'], ['aria-hidden', 'true']]) el.setAttribute(k, v);
    el.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;margin:0;font-size:16px;pointer-events:none;z-index:-1;user-select:text;-webkit-user-select:text';
    el.value = SENT;
    document.body.appendChild(el);
    el.addEventListener('compositionstart', () => (this.composing = true));
    el.addEventListener('compositionend', () => { this.composing = false; this.flush(); });
    el.addEventListener('input', () => this.flush());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault();
        this.input.synthKey('Enter', 'Enter');
        this.sync();
      }
    });
  }

  /** Turn the hidden field's edits into key events: common prefix vs. the last seen text -> backspaces + characters. */
  private flush() {
    const el = this.el, v = el.value;
    let i = 0;
    while (i < this.prev.length && i < v.length && this.prev[i] === v[i]) i++;
    for (let k = i; k < this.prev.length; k++) this.input.synthKey('Backspace', 'Backspace');
    for (const ch of v.slice(i)) this.input.onChar(ch);
    this.prev = v;
    if (!this.composing) this.reset();
  }
  private reset() {
    this.el.value = SENT;
    this.prev = SENT;
    try { this.el.setSelectionRange(SENT.length, SENT.length); } catch { /* ignore */ }
  }

  /** Show or hide the keyboard to match the open screen. Focus only sticks when called from a user gesture. */
  sync() {
    const want = device.touch && this.wants();
    const el = this.el;
    if (want) {
      if (document.activeElement !== el) {
        this.reset();
        try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
        this.reset();
      }
    } else if (document.activeElement === el) el.blur();
  }
}

// ---------------------------------------------------------------------------------------------- icons
type Icon = (c: CanvasRenderingContext2D, s: number) => void;
const ICONS: Record<string, Icon> = {
  jump: (c, s) => { chev(c, s, -1, -0.35); chev(c, s, -1, 0.3); },
  sneak: (c, s) => { chev(c, s, 1, -0.3); chev(c, s, 1, 0.35); },
  attack: (c, s) => {
    c.beginPath(); c.moveTo(-s * 0.7, s * 0.7); c.lineTo(s * 0.55, -s * 0.55); c.stroke(); // blade
    c.beginPath(); c.moveTo(-s * 0.1, s * 0.5); c.lineTo(s * 0.5, -s * 0.1); c.stroke(); // guard
    c.beginPath(); c.moveTo(-s * 0.7, s * 0.7); c.lineTo(-s * 0.95, s * 0.95); c.stroke(); // grip
  },
  use: (c, s) => {
    const a = s * 0.78, b = s * 0.45;
    c.beginPath(); c.moveTo(0, -a); c.lineTo(a, -b); c.lineTo(a, b); c.lineTo(0, a); c.lineTo(-a, b); c.lineTo(-a, -b); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(-a, -b); c.lineTo(0, 0); c.lineTo(a, -b); c.moveTo(0, 0); c.lineTo(0, a); c.stroke();
  },
  pause: (c, s) => { c.fillRect(-s * 0.55, -s * 0.6, s * 0.38, s * 1.2); c.fillRect(s * 0.17, -s * 0.6, s * 0.38, s * 1.2); },
  chat: (c, s) => {
    c.beginPath(); c.rect(-s * 0.8, -s * 0.6, s * 1.6, s * 1.05); c.moveTo(-s * 0.35, s * 0.45); c.lineTo(-s * 0.5, s * 0.85); c.lineTo(0, s * 0.45); c.stroke();
    c.fillRect(-s * 0.5, -s * 0.3, s, s * 0.14); c.fillRect(-s * 0.5, 0, s * 0.65, s * 0.14);
  },
  inv: (c, s) => {
    c.beginPath(); c.rect(-s * 0.8, -s * 0.45, s * 1.6, s * 1.15); c.moveTo(-s * 0.8, -s * 0.05); c.lineTo(s * 0.8, -s * 0.05); c.stroke();
    c.fillRect(-s * 0.14, -s * 0.2, s * 0.28, s * 0.3);
    c.beginPath(); c.moveTo(-s * 0.4, -s * 0.45); c.lineTo(-s * 0.4, -s * 0.8); c.lineTo(s * 0.4, -s * 0.8); c.lineTo(s * 0.4, -s * 0.45); c.stroke();
  },
  drop: (c, s) => {
    c.beginPath(); c.moveTo(0, -s * 0.8); c.lineTo(0, s * 0.3); c.moveTo(-s * 0.45, -s * 0.15); c.lineTo(0, s * 0.3); c.lineTo(s * 0.45, -s * 0.15); c.stroke();
    c.beginPath(); c.moveTo(-s * 0.7, s * 0.75); c.lineTo(s * 0.7, s * 0.75); c.stroke();
  },
  view: (c, s) => {
    c.beginPath(); c.moveTo(-s * 0.95, 0); c.quadraticCurveTo(0, -s * 1.1, s * 0.95, 0); c.quadraticCurveTo(0, s * 1.1, -s * 0.95, 0); c.stroke();
    c.beginPath(); c.arc(0, 0, s * 0.3, 0, Math.PI * 2); c.fill();
  },
  fs: (c, s) => {
    const a = s * 0.8, b = s * 0.35;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      c.beginPath(); c.moveTo(sx * a, sy * (a - b)); c.lineTo(sx * a, sy * a); c.lineTo(sx * (a - b), sy * a); c.stroke();
    }
  },
};
function chev(c: CanvasRenderingContext2D, s: number, dir: number, off: number) {
  c.beginPath(); c.moveTo(-s * 0.7, -dir * s * 0.25 + off * s); c.lineTo(0, dir * s * 0.25 + off * s); c.lineTo(s * 0.7, -dir * s * 0.25 + off * s);
  // chevron pointing up when dir = -1: apex above the arms
  c.stroke();
}

// ---------------------------------------------------------------------------------------------- controller
export class TouchControls {
  private touches = new Map<number, Touch>();
  private keyboard: SoftKeyboard;
  private wasPlaying = false;
  private wasTouch = false;
  private lastScreen: unknown = null;
  private sneak = false;
  private rightTool = false;
  private shiftTool = false;
  private pulses: { button: number; until: number }[] = [];
  private canvas: HTMLCanvasElement;
  private pressed = new Set<string>();
  private hintStick = { x: 0, y: 0 };

  constructor(private game: Game, private ui: UI, canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const input = game.input;
    input.touchPlaying = () => this.isPlaying();
    this.keyboard = new SoftKeyboard(input, () => !!ui.screen?.wantsKeyboard());
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e, false));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('click', () => { if (device.touch) this.keyboard.sync(); });
    // iOS: block pinch-zoom and the long-press callout
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if (device.touch) e.preventDefault(); }, { passive: false });
  }

  private get k() { return this.canvas.width / Math.max(1, this.canvas.clientWidth || window.innerWidth); }
  private isPlaying() {
    const g = this.game;
    return !!g.world && !!g.player && !g.panorama && !this.ui.screen;
  }
  /** Is the keyboard bridge needed after a screen change made outside a touch handler? */
  syncKeyboard() { this.keyboard.sync(); }

  // ---------------------------------------------------------------- layout (device px)
  private buttons(): Btn[] {
    const c = this.canvas, W = c.width, H = c.height, k = this.k;
    const R = (v: number) => v * k;
    const L = this.lift();
    const out: Btn[] = [
      { id: 'jump', x: W - R(66), y: H - R(66) - L, r: R(36) },
      { id: 'attack', x: W - R(152), y: H - R(52) - L, r: R(34) },
      { id: 'use', x: W - R(62), y: H - R(148) - L, r: R(30) },
      { id: 'sneak', x: W - R(148), y: H - R(124) - L, r: R(26) },
    ];
    const row = ['pause', 'chat', 'inv', 'drop', 'view'];
    if (document.fullscreenEnabled) row.push('fs');
    row.forEach((id, i) => out.push({ id, x: W / 2 + (i - (row.length - 1) / 2) * R(46), y: R(26), r: R(19) }));
    return out;
  }
  /** Portrait: the hotbar spans most of the width, so the buttons ride above the status bars. */
  private lift() {
    return this.canvas.width < this.canvas.height ? 90 * this.k : 0;
  }
  private tools(): Tool[] {
    const g = this.ui.gui, s = this.ui.screen;
    if (!s) return [];
    if (s.touchTools) {
      return [
        { id: 'close', x: 4, y: 4, w: 20, h: 20, label: 'X', on: false },
        { id: 'split', x: 4, y: g.h / 2 - 24, w: 40, h: 20, label: 'Split', on: this.rightTool },
        { id: 'shift', x: 4, y: g.h / 2, w: 40, h: 20, label: 'Shift', on: this.shiftTool },
      ];
    }
    if (document.fullscreenEnabled && (s instanceof Menus.TitleScreen || s instanceof Menus.PauseScreen)) return [{ id: 'fs', x: g.w - 24, y: 4, w: 20, h: 20, label: '', on: !!document.fullscreenElement }];
    return [];
  }
  private hotbarSlot(x: number, y: number): number {
    const g = this.ui.gui, p = this.game.player;
    if (!p || p.spectator || this.game.hideHud) return -1;
    const gx = x / g.scale, gy = y / g.scale;
    const hx = Math.floor(g.w / 2) - 91, hy = g.h - 22;
    if (gy < hy - 4 || gx < hx || gx >= hx + 182) return -1;
    return Math.min(8, Math.floor((gx - hx - 1) / 20));
  }
  private hitButton(x: number, y: number): Btn | null {
    for (const b of this.buttons()) if (Math.hypot(x - b.x, y - b.y) <= b.r * 1.12) return b;
    return null;
  }

  // ---------------------------------------------------------------- events
  private pos(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect(), k = this.k;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
  }
  private onDown(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    device.touch = true;
    device.touched();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.game.audio.init();
    const [x, y] = this.pos(e);
    const t: Touch = { id: e.pointerId, role: 'look', x, y, sx: x, sy: y, lx: x, ly: y, t0: performance.now(), moved: false, holding: false, button: 0, down: false, scrolling: false, acc: 0 };
    this.touches.set(e.pointerId, t);
    if (this.isPlaying()) this.downPlay(t);
    else this.downScreen(t);
  }

  private downPlay(t: Touch) {
    const inp = this.game.input, p = this.game.player!;
    const b = this.hitButton(t.x, t.y);
    if (b) {
      t.role = 'btn';
      t.id2 = b.id;
      this.pressed.add(b.id);
      buzz(8);
      switch (b.id) {
        case 'jump': inp.virtual.add('Space'); inp.pressedQ.push('Space'); break;
        case 'sneak': this.sneak = !this.sneak; break;
        case 'attack': inp.mouseDown.add(0); inp.mousePressedQ.push(0); break;
        case 'use': inp.mouseDown.add(2); inp.mousePressedQ.push(2); break;
      }
      return;
    }
    const slot = this.hotbarSlot(t.x, t.y);
    if (slot >= 0) {
      t.role = 'hotbar';
      p.inventory.selected = slot;
      return;
    }
    const W = this.canvas.width, H = this.canvas.height;
    const hasStick = [...this.touches.values()].some((o) => o !== t && o.role === 'stick');
    if (t.x < W * 0.42 && t.y > H * 0.2 && !hasStick) {
      t.role = 'stick';
      return;
    }
    t.role = 'look';
  }

  private downScreen(t: Touch) {
    const inp = this.game.input, s = this.ui.screen;
    inp.mouseX = t.x;
    inp.mouseY = t.y;
    if (!s) { t.role = 'look'; return; }
    const sc = this.ui.gui.scale, gx = t.x / sc, gy = t.y / sc;
    for (const tool of this.tools()) {
      if (gx >= tool.x && gy >= tool.y && gx < tool.x + tool.w && gy < tool.y + tool.h) {
        t.role = 'tool';
        t.id2 = tool.id;
        return;
      }
    }
    t.role = 'screen';
    t.button = this.rightTool ? 2 : 0;
    if (!s.touchScrolls || s.touchImmediate(gx, gy)) {
      t.down = true;
      inp.touchDown(t.x, t.y, t.button);
    }
  }

  private onMove(e: PointerEvent) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    device.touched();
    const [x, y] = this.pos(e);
    const k = this.k, inp = this.game.input;
    const dx = x - t.lx, dy = y - t.ly;
    t.lx = x; t.ly = y; t.x = x; t.y = y;
    if (!t.moved && Math.hypot(x - t.sx, y - t.sy) > MOVE_PX * k) t.moved = true;
    switch (t.role) {
      case 'stick': this.updateStick(t); break;
      case 'look': case 'btn':
        if (t.role === 'look' || t.id2 === 'attack' || t.id2 === 'use') {
          inp.dx += (dx / k) * LOOK_SENS;
          inp.dy += (dy / k) * LOOK_SENS;
        }
        break;
      case 'screen': {
        inp.mouseX = x;
        inp.mouseY = y;
        if (!t.down && !t.scrolling && t.moved) {
          // a deferred press that moves becomes a scroll (vertical) or is cancelled (anything else)
          if (Math.abs(y - t.sy) > Math.abs(x - t.sx)) { t.scrolling = true; t.acc = 0; }
          else t.button = -1;
        }
        if (t.scrolling) {
          t.acc += dy;
          const step = 18 * this.ui.gui.scale;
          while (Math.abs(t.acc) >= step) {
            const d = t.acc > 0 ? -1 : 1; // finger down = content up = wheel up
            inp.onWheel(d);
            t.acc -= Math.sign(t.acc) * step;
          }
        }
        break;
      }
    }
  }

  private updateStick(t: Touch) {
    const inp = this.game.input, R = STICK_R * this.k;
    const vx = (t.x - t.sx) / R, vy = (t.y - t.sy) / R;
    const raw = Math.hypot(vx, vy);
    if (raw < DEAD) {
      inp.stick = null;
      inp.virtual.delete('ControlLeft');
      return;
    }
    const m = Math.min(1, (raw - DEAD) / (0.85 - DEAD));
    inp.stick = { x: (vx / raw) * m, y: (vy / raw) * m };
    // push past the rim, forwards, to sprint
    if (raw > 1.25 && -vy / raw > 0.55) inp.virtual.add('ControlLeft');
    else inp.virtual.delete('ControlLeft');
  }

  private onUp(e: PointerEvent, cancelled: boolean) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    device.touched();
    this.touches.delete(e.pointerId);
    const inp = this.game.input;
    const x = t.x, y = t.y;
    switch (t.role) {
      case 'stick':
        inp.stick = null;
        inp.virtual.delete('ControlLeft');
        break;
      case 'look':
        if (t.holding) inp.mouseDown.delete(0);
        else if (!cancelled && !t.moved && performance.now() - t.t0 < TAP_MS && this.isPlaying()) this.pulse(2);
        break;
      case 'btn': {
        const id = t.id2!;
        this.pressed.delete(id);
        if (id === 'jump') inp.virtual.delete('Space');
        else if (id === 'attack') inp.mouseDown.delete(0);
        else if (id === 'use') inp.mouseDown.delete(2);
        else if (!cancelled) {
          const b = this.buttons().find((o) => o.id === id);
          if (b && Math.hypot(x - b.x, y - b.y) <= b.r * 1.5) this.action(id);
        }
        break;
      }
      case 'tool': {
        if (cancelled) break;
        const id = t.id2!;
        if (id === 'split') this.rightTool = !this.rightTool;
        else if (id === 'shift') this.shiftTool = !this.shiftTool;
        else if (id === 'fs') this.ui.toggleFullscreen();
        else if (id === 'close') this.ui.screen?.close();
        break;
      }
      case 'screen':
        if (t.down) inp.touchUp(x, y, t.button);
        else if (!cancelled && !t.scrolling && t.button >= 0 && !t.moved) {
          inp.touchDown(x, y, t.button);
          inp.touchUp(x, y, t.button);
        }
        break;
    }
    this.keyboard.sync();
  }

  /** Tap on the world: a short synthetic click that survives until the next game tick. */
  private pulse(button: number) {
    const inp = this.game.input;
    inp.mouseDown.add(button);
    inp.mousePressedQ.push(button);
    this.pulses.push({ button, until: this.game.ticks + 2 });
  }

  private action(id: string) {
    const ui = this.ui, g = this.game;
    switch (id) {
      case 'pause': ui.open(new Menus.PauseScreen(ui)); break;
      case 'chat': ui.open(new Menus.ChatScreen(ui, '')); break;
      case 'inv': if (g.player && !g.player.dead) ui.openInventory(); break;
      case 'drop': g.input.pressedQ.push('KeyQ'); break;
      case 'view': g.thirdPerson = (g.thirdPerson + 1) % 3; break;
      case 'fs': ui.toggleFullscreen(); break;
    }
  }

  // ---------------------------------------------------------------- per-frame
  update() {
    const inp = this.game.input;
    if (!device.touch) {
      // switched to mouse and keyboard: drop everything touch was holding, including the sneak and Shift toggles
      if (this.wasTouch) this.leaveTouch();
      return;
    }
    this.wasTouch = true;
    const playing = this.isPlaying();
    if (playing !== this.wasPlaying || this.ui.screen !== this.lastScreen) {
      if (playing !== this.wasPlaying) this.releaseAll();
      if (this.ui.screen !== this.lastScreen) { this.rightTool = this.shiftTool = false; }
      this.wasPlaying = playing;
      this.lastScreen = this.ui.screen;
    }
    // sneak toggle in the world, the Shift tool in containers
    const shift = playing ? this.sneak : this.shiftTool;
    if (shift) inp.virtual.add('ShiftLeft');
    else inp.virtual.delete('ShiftLeft');
    if (!playing) return;
    const now = performance.now();
    for (const t of this.touches.values()) {
      if (t.role === 'look' && !t.moved && !t.holding && now - t.t0 > HOLD_MS) {
        t.holding = true;
        inp.mouseDown.add(0);
        inp.mousePressedQ.push(0);
        buzz(12);
      }
    }
    this.pulses = this.pulses.filter((p) => {
      if (this.game.ticks < p.until) return true;
      inp.mouseDown.delete(p.button);
      return false;
    });
  }

  private releaseAll() {
    const inp = this.game.input;
    this.touches.clear();
    this.pressed.clear();
    this.pulses = [];
    inp.stick = null;
    inp.virtual.clear();
    inp.mouseDown.delete(0);
    inp.mouseDown.delete(2);
  }

  private leaveTouch() {
    const inp = this.game.input;
    this.wasTouch = false;
    this.sneak = this.rightTool = this.shiftTool = false;
    // only let go of mouse buttons touch pressed: the click that switched modes may be a real one
    const touchMouse = this.pulses.length > 0 || [...this.touches.values()].some((t) => t.holding || t.down || (t.role === 'btn' && (t.id2 === 'attack' || t.id2 === 'use')));
    this.touches.clear();
    this.pressed.clear();
    this.pulses = [];
    inp.stick = null;
    inp.virtual.clear();
    if (touchMouse) { inp.mouseDown.delete(0); inp.mouseDown.delete(2); }
  }

  // ---------------------------------------------------------------- drawing
  render(ctx: CanvasRenderingContext2D) {
    if (!device.touch) return;
    const k = this.k, W = this.canvas.width, H = this.canvas.height, gui = this.ui.gui;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.isPlaying()) this.drawPlay(ctx, k, W, H);
    else {
      ctx.setTransform(gui.scale, 0, 0, gui.scale, 0, 0);
      for (const tool of this.tools()) this.drawTool(ctx, tool);
    }
    if (device.portrait && !this.game.world) {
      ctx.setTransform(gui.scale, 0, 0, gui.scale, 0, 0);
      const txt = 'Rotate your device for a bigger view';
      const w = gui.font.width(txt) + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(gui.w / 2 - w / 2, gui.h - 16, w, 12);
      gui.textCenter(ctx, txt, gui.w / 2, gui.h - 14, '#FFFFFF');
    }
    ctx.restore();
  }

  private drawPlay(ctx: CanvasRenderingContext2D, k: number, W: number, H: number) {
    const R = STICK_R * k;
    // movement stick: floating base where the thumb went down, a faint hint when idle
    const st = [...this.touches.values()].find((t) => t.role === 'stick');
    const bx = st ? st.sx : (this.hintStick.x = 112 * k), by = st ? st.sy : (this.hintStick.y = H - 100 * k - this.lift());
    ctx.lineWidth = 2 * k;
    ctx.strokeStyle = `rgba(255,255,255,${st ? 0.5 : 0.22})`;
    ctx.fillStyle = `rgba(0,0,0,${st ? 0.25 : 0.12})`;
    ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (st) {
      const dx = st.x - st.sx, dy = st.y - st.sy, d = Math.hypot(dx, dy), c = d > R ? R / d : 1;
      const sprint = this.game.input.virtual.has('ControlLeft');
      ctx.fillStyle = sprint ? 'rgba(255,230,120,0.7)' : 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(bx + dx * c, by + dy * c, R * 0.42, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(bx, by, R * 0.42, 0, Math.PI * 2); ctx.fill();
    }
    for (const b of this.buttons()) {
      const on = this.pressed.has(b.id) || (b.id === 'sneak' && this.sneak);
      this.drawButton(ctx, b, on, k);
    }
  }

  private drawButton(ctx: CanvasRenderingContext2D, b: Btn, on: boolean, k: number) {
    ctx.fillStyle = on ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)';
    ctx.strokeStyle = on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2 * k;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const icon = ICONS[b.id];
    if (!icon) return;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.strokeStyle = ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = Math.max(2, b.r * 0.1);
    ctx.lineCap = ctx.lineJoin = 'round';
    icon(ctx, b.r * 0.55);
    ctx.restore();
  }

  private drawTool(ctx: CanvasRenderingContext2D, t: Tool) {
    const gui = this.ui.gui;
    gui.button(ctx, t.x, t.y, t.w, t.h, t.label, t.on, true);
    if (t.on) {
      ctx.fillStyle = 'rgba(255,255,160,0.35)';
      ctx.fillRect(t.x, t.y, t.w, t.h);
    }
    if (t.id === 'fs') {
      ctx.save();
      ctx.translate(t.x + t.w / 2, t.y + t.h / 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ICONS.fs(ctx, 5);
      ctx.restore();
    }
  }
}
