// Touch controls for phones and tablets, laid out like the classic Pocket Edition.
//
// In the world: a D-pad bottom left (sneak toggle in the middle; forward-diagonals appear while walking
// forward; double-tap forward to sprint), a jump button bottom right (double-tap to fly in creative, and
// the pad's middle descends while flying), chat and pause buttons top centre, and a hotbar that shrinks to
// fit, ending in a "..." cell for the inventory; hold a slot to drop its stack. Drag anywhere else to look,
// tap to place / use (or hit a mob), and press and hold to mine (or eat, drink, draw a bow).
// Options > Controls swaps the D-pad for a floating joystick, and touch aiming (act on what's under the
// finger, no crosshair, the default) for crosshair aiming (act on whatever the crosshair is on).
// In menus and containers: taps are clicks, vertical drags scroll lists, and "Split" / "Shift" toggles stand
// in for right-click and shift-click. Text fields raise the soft keyboard through a hidden <input>.
//
// Everything feeds the ordinary Input object (virtual keys and synthetic mouse buttons), so gameplay and
// UI code don't care whether the player has a mouse or a finger.
import type { Client as Game } from '../client/client';
import type { UI } from './ui';
import type { Input } from '../game/input';
import { device } from '../game/device';
import * as Menus from './menus';
import { PAD_B, PAD_S, padOrigin, touchHotbar } from './touchlayout';
import { getItem, I } from '../game/items';

const LOOK_SENS = 2.2; // mouse-equivalent pixels per CSS pixel of finger travel
const HOLD_MS = 380; // long press on the look area starts mining
const DROP_MS = 800; // long press on a hotbar slot drops the stack
const STICK_R = 30; // joystick throw, GUI units
const DEAD = 0.14;
const TAP_MS = 300;
const MOVE_PX = 9; // CSS px of travel before a touch stops counting as a tap
const SENT = '​​'; // sentinel text so Backspace always produces an input event

const buzz = (ms: number) => { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(ms); };

type Role = 'pad' | 'stick' | 'look' | 'btn' | 'hotbar' | 'screen' | 'tool' | 'none';

interface Touch {
  id: number;
  role: Role;
  id2?: string; // button / tool id
  x: number; y: number; // current, device px
  sx: number; sy: number; // start
  lx: number; ly: number; // last, for deltas
  t0: number;
  moved: boolean;
  holding: boolean; // look touch turned into a mining (or eating / drawing) hold / hotbar touch dropped its stack
  hold: number; // mouse button that hold pressed
  // screen touches
  button: number;
  down: boolean; // a mouse press was already delivered
  scrolling: boolean;
  acc: number;
}

/** An on-screen control, in GUI units. */
interface Btn { id: string; x: number; y: number; w: number; h: number }
type Dir = 'up' | 'down' | 'left' | 'right' | 'upleft' | 'upright';
const DIR_KEYS: Record<Dir, string[]> = { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], upleft: ['KeyW', 'KeyA'], upright: ['KeyW', 'KeyD'] };
const PAD_CELLS: [Dir | 'sneak', number, number][] = [['up', 1, 0], ['left', 0, 1], ['sneak', 1, 1], ['right', 2, 1], ['down', 1, 2], ['upleft', 0, 0], ['upright', 2, 0]];
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

// ---------------------------------------------------------------------------------------------- controller
export class TouchControls {
  private touches = new Map<number, Touch>();
  private keyboard: SoftKeyboard;
  private wasPlaying = false;
  private wasTouch = false;
  private wasFlying = false;
  private lastScreen: unknown = null;
  private sneak = false;
  private rightTool = false;
  private shiftTool = false;
  private askedLandscape = false;
  private pulses: { button: number; until: number }[] = [];
  private aimUntil = 0; // touch aiming: keep pointing where the finger lifted until its tap has been acted on
  private canvas: HTMLCanvasElement;
  private pressed = new Set<string>();

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
  private get flying() { return !!this.game.player?.flying; }
  private get joystick() { return this.game.options.touchMove === 'joystick'; }
  /** Is the D-pad currently held forwards (which shows the diagonal buttons)? */
  private forward() {
    for (const t of this.touches.values()) if (t.role === 'pad' && (t.id2 === 'up' || t.id2 === 'upleft' || t.id2 === 'upright')) return true;
    return false;
  }
  /** Is the keyboard bridge needed after a screen change made outside a touch handler? */
  syncKeyboard() { this.keyboard.sync(); }

  // ---------------------------------------------------------------- layout (GUI units)
  private buttons(): Btn[] {
    const g = this.ui.gui, W = g.w, H = g.h;
    const [ox, oy] = padOrigin(H);
    const out: Btn[] = [];
    const jump = { id: 'jump', x: W - 12 - PAD_B, y: oy + PAD_S, w: PAD_B, h: PAD_B };
    if (this.joystick) {
      // the stick floats on the left; sneak moves next to jump
      out.push({ ...jump, id: 'sneak', x: jump.x - PAD_S - 2 });
    } else {
      const fwd = this.forward();
      for (const [id, c, r] of PAD_CELLS) {
        if ((id === 'upleft' || id === 'upright') && !fwd) continue;
        out.push({ id, x: ox + c * PAD_S, y: oy + r * PAD_S, w: PAD_B, h: PAD_B });
      }
    }
    out.push(jump);
    const mid = Math.floor(W / 2);
    out.push({ id: 'chat', x: mid - 8, y: 1, w: 16, h: 16 }, { id: 'pause', x: mid + 10, y: 1, w: 16, h: 16 });
    return out;
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
  /** Hotbar cell under a GUI point: 0..n-1 a slot, n the "..." cell, -1 none. */
  private hotbarCell(gx: number, gy: number): number {
    const g = this.ui.gui, p = this.game.player;
    if (!p || p.spectator || this.game.hideHud) return -1;
    const hb = touchHotbar(g.w, g.h);
    if (gy < hb.y - 3 || gx < hb.x || gx >= hb.x + hb.w) return -1;
    return Math.max(0, Math.min(hb.n, Math.floor((gx - hb.x - 1) / 20)));
  }
  private hitButton(gx: number, gy: number): Btn | null {
    for (const b of this.buttons()) if (gx >= b.x - 1 && gy >= b.y - 1 && gx < b.x + b.w + 1 && gy < b.y + b.h + 1) return b;
    return null;
  }
  /** Which way a finger on the D-pad points, '' over the middle or once it has wandered well off the pad. */
  private padDir(gx: number, gy: number): Dir | '' {
    const [ox, oy] = padOrigin(this.ui.gui.h);
    const fx = (gx - ox) / PAD_S, fy = (gy - oy) / PAD_S;
    if (fx < -0.6 || fx > 3.6 || fy < -0.6) return '';
    const c = Math.max(0, Math.min(2, Math.floor(fx))), r = Math.max(0, Math.min(2, Math.floor(fy)));
    for (const [id, cc, rr] of PAD_CELLS) {
      if (cc !== c || rr !== r || id === 'sneak') continue;
      if ((id === 'upleft' || id === 'upright') && !this.forward()) return '';
      return id;
    }
    return '';
  }

  // ---------------------------------------------------------------- events
  /** Pointer position in canvas device px, undoing the quarter turn when an upright phone shows landscape. */
  private pos(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect(), k = this.k;
    if (device.rotated) return [(e.clientY - r.top) * k, (r.right - e.clientX) * k];
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
    const t: Touch = { id: e.pointerId, role: 'look', x, y, sx: x, sy: y, lx: x, ly: y, t0: performance.now(), moved: false, holding: false, hold: 0, button: 0, down: false, scrolling: false, acc: 0 };
    this.touches.set(e.pointerId, t);
    if (this.isPlaying()) this.downPlay(t);
    else this.downScreen(t);
  }

  private downPlay(t: Touch) {
    const inp = this.game.input, p = this.game.player!;
    const sc = this.ui.gui.scale, gx = t.x / sc, gy = t.y / sc;
    const b = this.hitButton(gx, gy);
    if (b) {
      buzz(8);
      if (b.id in DIR_KEYS) {
        if ([...this.touches.values()].some((o) => o !== t && o.role === 'pad')) { t.role = 'none'; return; }
        t.role = 'pad';
        this.setDir(t, b.id as Dir);
        return;
      }
      t.role = 'btn';
      t.id2 = b.id;
      this.pressed.add(b.id);
      if (b.id === 'jump') { inp.virtual.add('Space'); inp.pressedQ.push('Space'); }
      else if (b.id === 'sneak' && !this.flying) {
        // riding: the middle button gets off instead of latching a sneak
        if (p.riding) p.riding.dismount();
        else this.sneak = !this.sneak;
      }
      return;
    }
    const cell = this.hotbarCell(gx, gy);
    if (cell >= 0) {
      t.role = 'hotbar';
      t.id2 = String(cell);
      if (cell < touchHotbar(this.ui.gui.w, this.ui.gui.h).n) p.inventory.selected = cell;
      return;
    }
    if (this.joystick && gx < this.ui.gui.w * 0.42 && gy > this.ui.gui.h * 0.25 && ![...this.touches.values()].some((o) => o !== t && o.role === 'stick')) {
      t.role = 'stick';
      return;
    }
    t.role = 'look';
    this.aimAt(t);
  }

  /** Touch aiming follows the finger that's looking around. */
  private aimAt(t: Touch) {
    const c = this.canvas;
    this.game.input.aim = this.game.touchAim() ? { x: t.x / c.width, y: t.y / c.height } : null;
  }

  private updateStick(t: Touch) {
    const inp = this.game.input, R = STICK_R * this.ui.gui.scale;
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

  /** Point a D-pad touch somewhere new: swap the held movement keys. Pressing forward afresh counts towards a sprint double-tap. */
  private setDir(t: Touch, d: Dir | '') {
    const old = (t.id2 ?? '') as Dir | '';
    if (old === d) return;
    const inp = this.game.input;
    const was = old ? DIR_KEYS[old] : [], now = d ? DIR_KEYS[d] : [];
    for (const k of was) if (!now.includes(k)) inp.virtual.delete(k);
    for (const k of now) if (!was.includes(k)) { inp.virtual.add(k); inp.pressedQ.push(k); }
    t.id2 = d;
  }

  private downScreen(t: Touch) {
    const inp = this.game.input, s = this.ui.screen;
    inp.mouseX = t.x;
    inp.mouseY = t.y;
    if (!s) { t.role = 'none'; return; }
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
      case 'pad': { const sc = this.ui.gui.scale; this.setDir(t, this.padDir(x / sc, y / sc)); break; }
      case 'stick': this.updateStick(t); break;
      case 'look':
        inp.dx += (dx / k) * LOOK_SENS;
        inp.dy += (dy / k) * LOOK_SENS;
        this.aimAt(t);
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

  private onUp(e: PointerEvent, cancelled: boolean) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    device.touched();
    this.touches.delete(e.pointerId);
    const inp = this.game.input;
    const x = t.x, y = t.y;
    switch (t.role) {
      case 'pad':
        this.setDir(t, '');
        break;
      case 'stick':
        inp.stick = null;
        inp.virtual.delete('ControlLeft');
        break;
      case 'look':
        if (t.holding) inp.mouseDown.delete(t.hold);
        else if (!cancelled && !t.moved && performance.now() - t.t0 < TAP_MS && this.isPlaying()) this.tap();
        this.aimUntil = this.game.ticks + 3;
        break;
      case 'btn': {
        const id = t.id2!;
        this.pressed.delete(id);
        if (id === 'jump') inp.virtual.delete('Space');
        else if (!cancelled && (id === 'chat' || id === 'pause')) {
          const sc = this.ui.gui.scale, b = this.hitButton(x / sc, y / sc);
          if (b?.id === id) this.action(id);
        }
        break;
      }
      case 'hotbar': {
        const hb = touchHotbar(this.ui.gui.w, this.ui.gui.h);
        if (!cancelled && t.id2 === String(hb.n) && !t.moved && this.isPlaying() && this.game.player && !this.game.player.dead) this.ui.openInventory();
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
    // a touch end is a user gesture: the first one asks for fullscreen + a landscape lock (Android)
    if (!cancelled && !this.askedLandscape) {
      this.askedLandscape = true;
      device.landscape();
    }
    this.keyboard.sync();
  }

  /** Tap on the world: hit a mob unless it has a use for the held item; anywhere else, use / place. */
  private tap() {
    const g = this.game;
    // a mob: the server decides (use the held item on it, or else hit it) — button 3 asks it to
    if (g.targetEntity) this.pulse(3);
    else this.pulse(2);
  }

  /** A short synthetic click that survives until the next game tick. */
  private pulse(button: number) {
    const inp = this.game.input;
    inp.mouseDown.add(button);
    inp.mousePressedQ.push(button);
    this.pulses.push({ button, until: this.game.ticks + 2 });
  }

  private action(id: string) {
    const ui = this.ui;
    if (id === 'pause') ui.open(new Menus.PauseScreen(ui));
    else if (id === 'chat') ui.open(new Menus.ChatScreen(ui, ''));
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
    // taking off ends a sneak; while flying the pad's middle is held to descend
    const flying = this.flying;
    if (flying && !this.wasFlying) this.sneak = false;
    this.wasFlying = flying;
    // sneak toggle in the world, the Shift tool in containers
    const shift = playing ? this.sneak || (flying && this.pressed.has('sneak')) : this.shiftTool;
    if (shift) inp.virtual.add('ShiftLeft');
    else inp.virtual.delete('ShiftLeft');
    if (!playing) return;
    const p = this.game.player!;
    const hb = touchHotbar(this.ui.gui.w, this.ui.gui.h);
    if (p.inventory.selected >= hb.n) p.inventory.selected = hb.n - 1;
    const now = performance.now();
    if (inp.aim && (!this.game.touchAim() || (this.game.ticks >= this.aimUntil && ![...this.touches.values()].some((t) => t.role === 'look')))) inp.aim = null;
    for (const t of this.touches.values()) {
      if (t.moved || t.holding) continue;
      if (t.role === 'look' && now - t.t0 > HOLD_MS) {
        // press and hold: mine, or eat / drink / draw the bow
        const held = p.inventory.held(), it = held ? getItem(held.id) : null;
        t.holding = true;
        t.hold = it && (it.food || it.drink || held!.id === I.BOW) ? 2 : 0;
        inp.mouseDown.add(t.hold);
        inp.mousePressedQ.push(t.hold);
        buzz(12);
      } else if (t.role === 'hotbar' && Number(t.id2) < hb.n && now - t.t0 > DROP_MS) {
        t.holding = true;
        p.inventory.selected = Number(t.id2);
        if (!p.dead) this.game.interact?.dropHeld(true);
        buzz(20);
      }
    }
    this.pulses = this.pulses.filter((q) => {
      if (this.game.ticks < q.until) return true;
      inp.mouseDown.delete(q.button);
      return false;
    });
  }

  private releaseAll() {
    const inp = this.game.input;
    this.touches.clear();
    this.pressed.clear();
    this.pulses = [];
    inp.stick = null;
    inp.aim = null;
    inp.virtual.clear();
    inp.mouseDown.delete(0);
    inp.mouseDown.delete(2);
  }

  private leaveTouch() {
    const inp = this.game.input;
    this.wasTouch = false;
    this.sneak = this.rightTool = this.shiftTool = false;
    // only let go of mouse buttons touch pressed: the click that switched modes may be a real one
    const touchMouse = this.pulses.length > 0 || [...this.touches.values()].some((t) => (t.role === 'look' && t.holding) || t.down);
    this.touches.clear();
    this.pressed.clear();
    this.pulses = [];
    inp.stick = null;
    inp.aim = null;
    inp.virtual.clear();
    if (touchMouse) { inp.mouseDown.delete(0); inp.mouseDown.delete(2); }
  }

  // ---------------------------------------------------------------- drawing
  render(ctx: CanvasRenderingContext2D) {
    if (!device.touch) return;
    const gui = this.ui.gui;
    ctx.save();
    ctx.setTransform(gui.scale, 0, 0, gui.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (this.isPlaying()) this.drawPlay(ctx);
    else for (const tool of this.tools()) this.drawTool(ctx, tool);
    ctx.restore();
  }

  private drawPlay(ctx: CanvasRenderingContext2D) {
    const g = this.game;
    if (g.hideHud) return;
    const dirs = new Set<string>();
    for (const t of this.touches.values()) if (t.role === 'pad' && t.id2) dirs.add(t.id2);
    const flying = this.flying;
    if (this.joystick) this.drawStick(ctx);
    for (const b of this.buttons()) {
      const on = this.pressed.has(b.id) || dirs.has(b.id) || (b.id === 'sneak' && this.sneak);
      drawPadButton(ctx, b, on);
      const glyph = b.id === 'sneak' ? (flying ? 'down' : 'sneak') : b.id === 'jump' ? (flying ? 'up' : 'jump') : b.id;
      drawGlyph(ctx, glyph, b.x + b.w / 2, b.y + b.h / 2);
    }
    // a hotbar slot being held fills up until its stack drops
    const now = performance.now(), hb = touchHotbar(this.ui.gui.w, this.ui.gui.h);
    for (const t of this.touches.values()) {
      if (t.role !== 'hotbar' || t.moved || t.holding || Number(t.id2) >= hb.n) continue;
      const f = Math.min(1, (now - t.t0) / DROP_MS);
      if (f < 0.15) continue;
      const h = Math.round(16 * f), sx = hb.x + 3 + Number(t.id2) * 20;
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(sx, hb.y + 3 + 16 - h, 16, h);
    }
  }

  /** The floating joystick: where the thumb went down, or a faint resting spot bottom left. */
  private drawStick(ctx: CanvasRenderingContext2D) {
    const sc = this.ui.gui.scale, H = this.ui.gui.h;
    const st = [...this.touches.values()].find((t) => t.role === 'stick');
    const bx = st ? st.sx / sc : 4 + PAD_S * 1.5, by = st ? st.sy / sc : H - PAD_S * 1.5;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(255,255,255,${st ? 0.5 : 0.25})`;
    ctx.fillStyle = `rgba(140,140,140,${st ? 0.35 : 0.2})`;
    ctx.beginPath(); ctx.arc(bx, by, STICK_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    let kx = bx, ky = by;
    if (st) {
      const dx = st.x / sc - bx, dy = st.y / sc - by, d = Math.hypot(dx, dy), c = d > STICK_R ? STICK_R / d : 1;
      kx += dx * c; ky += dy * c;
    }
    ctx.fillStyle = this.game.input.virtual.has('ControlLeft') ? 'rgba(255,230,120,0.75)' : `rgba(220,220,220,${st ? 0.6 : 0.3})`;
    ctx.beginPath(); ctx.arc(kx, ky, STICK_R * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  private drawTool(ctx: CanvasRenderingContext2D, t: Tool) {
    const gui = this.ui.gui;
    gui.button(ctx, t.x, t.y, t.w, t.h, t.label, t.on, true);
    if (t.on) {
      ctx.fillStyle = 'rgba(255,255,160,0.35)';
      ctx.fillRect(t.x, t.y, t.w, t.h);
    }
    if (t.id === 'fs') drawGlyph(ctx, 'fs', t.x + t.w / 2, t.y + t.h / 2);
  }
}

// ---------------------------------------------------------------------------------------------- pixel art
/** A translucent grey Pocket Edition button: light top-left edge, dark bottom-right, brighter while pressed. */
function drawPadButton(ctx: CanvasRenderingContext2D, b: Btn, on: boolean) {
  ctx.fillStyle = on ? 'rgba(220,220,220,0.6)' : 'rgba(140,140,140,0.42)';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = on ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.32)';
  ctx.fillRect(b.x, b.y, b.w, 1);
  ctx.fillRect(b.x, b.y + 1, 1, b.h - 1);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(b.x + 1, b.y + b.h - 1, b.w - 1, 1);
  ctx.fillRect(b.x + b.w - 1, b.y + 1, 1, b.h - 2);
}

/** Draw rows of pixels: each row is [dx, dy, width] relative to the centre, with a 1px drop shadow. */
function pixels(ctx: CanvasRenderingContext2D, cx: number, cy: number, rows: [number, number, number][], color = 'rgba(240,240,240,0.92)') {
  cx = Math.floor(cx); cy = Math.floor(cy);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (const [x, y, w] of rows) ctx.fillRect(cx + x + 1, cy + y + 1, w, 1);
  ctx.fillStyle = color;
  for (const [x, y, w] of rows) ctx.fillRect(cx + x, cy + y, w, 1);
}

/** A solid triangle pointing `dir`, 9px across. */
function arrow(dir: Dir): [number, number, number][] {
  const rows: [number, number, number][] = [];
  for (let i = 0; i < 5; i++) {
    switch (dir) {
      case 'up': rows.push([-i, i - 2, 2 * i + 1]); break;
      case 'down': rows.push([-i, 2 - i, 2 * i + 1]); break;
      case 'left': for (let j = -i; j <= i; j++) rows.push([i - 2, j, 1]); break;
      case 'right': for (let j = -i; j <= i; j++) rows.push([2 - i, j, 1]); break;
      case 'upleft': rows.push([-3, i - 3, 7 - i]); if (i === 4) rows.push([-3, 2, 2]); break;
      case 'upright': rows.push([-3 + i, i - 3, 7 - i]); if (i === 4) rows.push([2, 2, 2]); break;
    }
  }
  return rows;
}

/** A diamond outline of radius r, optionally filled in the middle. */
function diamond(r: number, core: number): [number, number, number][] {
  const rows: [number, number, number][] = [];
  for (let y = -r; y <= r; y++) {
    const w = r - Math.abs(y);
    if (w === 0) { rows.push([0, y, 1]); continue; }
    rows.push([-w, y, 1], [w, y, 1]);
    const c = core - Math.abs(y);
    if (c >= 0) rows.push([-c, y, 2 * c + 1]);
  }
  return rows;
}

function drawGlyph(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number) {
  switch (id) {
    case 'up': case 'down': case 'left': case 'right': case 'upleft': case 'upright':
      pixels(ctx, cx, cy, arrow(id));
      break;
    case 'sneak': pixels(ctx, cx, cy, diamond(5, -1)); break;
    case 'jump': pixels(ctx, cx, cy, diamond(5, 2)); break;
    case 'chat': {
      // speech bubble with two lines of text
      const rows: [number, number, number][] = [[-5, -4, 11], [-5, 2, 11], [-3, 3, 2], [-3, 4, 1]];
      for (let y = -3; y <= 1; y++) rows.push([-5, y, 1], [5, y, 1]);
      rows.push([-3, -2, 7], [-3, 0, 5]);
      pixels(ctx, cx, cy, rows);
      break;
    }
    case 'pause': {
      const rows: [number, number, number][] = [];
      for (let y = -4; y <= 4; y++) rows.push([-3, y, 2], [1, y, 2]);
      pixels(ctx, cx, cy, rows);
      break;
    }
    case 'fs': {
      const rows: [number, number, number][] = [[-5, -5, 4], [2, -5, 4], [-5, 5, 4], [2, 5, 4]];
      for (const y of [-4, -3, 3, 4]) rows.push([-5, y, 1], [5, y, 1]);
      pixels(ctx, cx, cy, rows, '#ffffff');
      break;
    }
  }
}
