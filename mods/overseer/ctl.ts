// The client side of the overseer: the 2.5D views (god: no body, commanding units; hero: walking your own
// character under the same camera), mouse, keyboard and touch input, selection, orders and building placement.
// Everything that changes the world is a request to the server (server.ts), which checks it.
import type { ModContext, Client, ClientView, ViewPointer, MoveInput, ViewAim, Entity, Channel, Mc } from '../sdk';
import { RtsCam, pick, project, ZOOM_MAX, ZOOM_MIN, type Hit } from './cam';
import { BUILDINGS, UNITS, BUILD_ORDER, RAIDERS, resourceOf, canAfford, footprint, type FactionId } from './defs';
import { checkPlace, groundY, rect, distToRect, type Placed } from './place';
import { isUnit, type UnitEntity } from './units';
import type { BInfo, Mode, SInfo, ToClient, ToServer } from './state';

export interface UiRect { x: number; y: number; w: number; h: number; id: string; run?: () => void; tip?: string[]; key?: string; off?: boolean }
export interface FeedMsg { m: string; t: number; x?: number; z?: number; alert?: boolean }
export interface Marker { x: number; y: number; z: number; t: number; col: number }
type Pending = 'amove' | 'attack' | 'move' | 'rally' | null;
interface Finger { id: number; x: number; y: number; sx: number; sy: number; t0: number; moved: boolean; box: boolean; hold: boolean }

const MOVE_GUI = 5; // GUI units a finger travels before a tap becomes a drag
const LONG_MS = 380;

export class Ctl {
  mode: Mode = 'off';
  cam = new RtsCam();
  st: SInfo | null = null;
  buildings: BInfo[] = [];
  sel: number[] = [];
  selB: number | null = null;
  groups = new Map<number, { u: number[]; b: number | null }>();
  hover: Hit | null = null;
  mouse = { x: 0, y: 0 };
  /** A selection box being dragged (GUI units). */
  box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  placing: { type: string; rot: number; x: number; z: number; y: number; ok: boolean; why?: string; set: boolean } | null = null;
  /** The placing was started for the free town hall (not by the player). */
  private autoPlacing = false;
  pending: Pending = null;
  feed: FeedMsg[] = [];
  markers: Marker[] = [];
  /** HUD areas this frame (hud.ts fills them in as it draws). */
  ui: UiRect[] = [];
  panels: { x: number; y: number; w: number; h: number }[] = [];
  help = false;
  buildMenu = false;
  private rmb: { x: number; y: number; moved: boolean; yaw: number } | null = null;
  private mmb: { x: number; y: number } | null = null;
  private lastClick = { t: 0, id: -1 };
  private fingers = new Map<number, Finger>();
  private pinch: { d: number; a: number; zoom: number; yaw: number; mx: number; my: number } | null = null;
  private heroHeld = new Set<number>();
  private heroPressed: number[] = [];
  private heroAimAt: { x: number; y: number } | null = null;
  private heroUntil = 0;
  private lastAlert: FeedMsg | null = null;
  views: { god: ClientView; hero: ClientView };

  constructor(public mod: ModContext, public ch: Channel<ToServer | ToClient>) {
    const camera = (cam: Parameters<NonNullable<ClientView['camera']>>[0], c: Client) => this.camera(cam, c);
    const onPointer = (e: ViewPointer, c: Client) => this.pointer(e, c);
    const key = (e: KeyboardEvent, c: Client) => this.key(e, c);
    this.views = {
      god: { freePointer: true, showSelf: false, hud: 'none', touchPad: false, brightness: 0.45, camera, onPointer, key, move: () => ({ forward: 0, strafe: 0, jump: false, sneak: false, sprint: false }), aim: () => null },
      hero: { freePointer: true, showSelf: true, hud: 'normal', touchPad: true, camera, onPointer, key, move: (i, c) => this.heroMove(i, c), aim: (c) => this.heroAim(c) },
    };
  }
  get mc(): Mc { return this.mod.mc; }
  get me() { return this.st?.me ?? ''; }
  get faction(): FactionId { return this.st?.faction ?? 'villagers'; }

  // ------------------------------------------------------------------------------------------------ modes
  /** Ask for a mode; the view switches now and the server's answer settles it. */
  request(m: Mode, client: Client) {
    if (m === this.mode) return;
    this.apply(m, client);
    this.ch.toServer({ t: 'mode', m });
  }
  apply(m: Mode, client: Client) {
    const was = this.mode;
    this.mode = m;
    const p = client.player;
    if (m !== 'off' && was === 'off' && p) {
      this.cam.jump(p.x, p.z, p.y + 1);
      this.cam.zoom = this.cam.zoomTo = m === 'hero' ? 12 : 18;
    }
    if (m === 'god' && was === 'hero' && p) this.cam.jump(p.x, p.z);
    this.box = null; this.rmb = null; this.mmb = null; this.pinch = null;
    this.fingers.clear();
    this.heroHeld.clear();
    this.placing = null; this.pending = null; this.buildMenu = false;
    this.mod.client.setView(m === 'god' ? this.views.god : m === 'hero' ? this.views.hero : null);
    // first time looking down: pick a side, then place the free town hall
    if (m === 'god' && this.st && this.st.faction && !this.st.started) { this.startPlacing('town_centre'); this.autoPlacing = true; }
  }
  /** The server says which mode we're really in. */
  fromServer(m: Mode, client: Client) {
    if (m !== this.mode) this.apply(m, client);
  }

  receive(d: ToClient, client: Client) {
    switch (d.t) {
      case 'st': {
        const had = this.st;
        this.st = d.s;
        if (d.s.mode !== this.mode && (!had || had.mode !== d.s.mode)) this.fromServer(d.s.mode, client);
        if (this.mode === 'god' && d.s.faction && !d.s.started && !this.placing && !this.buildings.some((b) => b.owner === this.me)) { this.startPlacing('town_centre'); this.autoPlacing = true; }
        // the free town hall went down (maybe from another of our windows): stop offering it
        if (d.s.started && this.autoPlacing) { if (this.placing?.type === 'town_centre') this.placing = null; this.autoPlacing = false; }
        break;
      }
      case 'b': this.buildings = d.list; if (this.selB !== null && !this.buildings.some((b) => b.id === this.selB)) this.selB = null; break;
      case 'msg': this.note(d.m, d.x, d.z, d.alert); break;
      case 'mode': this.fromServer(d.m, client); break;
    }
  }
  note(m: string, x?: number, z?: number, alert = false) {
    const f: FeedMsg = { m, t: performance.now(), x, z, alert };
    this.feed.push(f);
    if (this.feed.length > 6) this.feed.shift();
    if (alert && x !== undefined) this.lastAlert = f;
  }
  reset() {
    this.st = null; this.buildings = []; this.sel = []; this.selB = null; this.groups.clear();
    this.feed = []; this.markers = []; this.mode = 'off'; this.placing = null; this.pending = null;
  }

  // ------------------------------------------------------------------------------------------------ per tick / frame
  tick(client: Client) {
    const p = client.player;
    if (!p || this.mode === 'off') return;
    // forget what's gone
    const alive = new Set(client.entities.filter((e) => isUnit(e) && !e.dead && !e.removed && e.owner === this.me).map((e) => e.id));
    this.sel = this.sel.filter((id) => alive.has(id));
    if (this.mode === 'god') {
      // the (invisible, spectating) body rides along under the camera so the world loads where we look
      const tx = this.cam.x, ty = this.cam.y + 3, tz = this.cam.z;
      const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z, d = Math.hypot(dx, dy, dz);
      const k = d > 28 ? 28 / d : 1;
      p.setPos(p.x + dx * k, p.y + dy * k, p.z + dz * k);
      p.vx = p.vy = p.vz = 0;
    }
    const now = performance.now();
    this.markers = this.markers.filter((m) => now - m.t < 1200);
    this.feed = this.feed.filter((f) => now - f.t < 9000);
    if (this.placing && !this.placing.set && !this.mc.device.touch) this.ghostAt(client, this.mouse.x, this.mouse.y);
  }

  private camera(cam: Parameters<NonNullable<ClientView['camera']>>[0], client: Client) {
    const dt = this.cam.dt(), inp = client.input, gui = client.ui.gui;
    const w = client.world!, p = client.player!;
    if (this.mode === 'god' && !client.ui.screen) {
      // keys and the screen edge pan, faster when zoomed out
      const sp = (this.cam.zoom / 16) * 22 * dt * (inp.isDown('ShiftLeft') ? 2.2 : 1);
      let rx = 0, uy = 0;
      if (inp.isDown('KeyW') || inp.isDown('ArrowUp')) uy += 1;
      if (inp.isDown('KeyS') || inp.isDown('ArrowDown')) uy -= 1;
      if (inp.isDown('KeyD') || inp.isDown('ArrowRight')) rx += 1;
      if (inp.isDown('KeyA') || inp.isDown('ArrowLeft')) rx -= 1;
      if (!this.mc.device.touch && inp.mouseInside && document.hasFocus() && !this.rmb && !this.mmb && !this.box) {
        const mx = inp.mouseX / Math.max(1, client.renderer.width), my = inp.mouseY / Math.max(1, client.renderer.height);
        if (mx <= 0.004) rx -= 1; else if (mx >= 0.996) rx += 1;
        if (my <= 0.006) uy += 1; else if (my >= 0.994) uy -= 1;
      }
      if (rx || uy) this.cam.pan(rx * sp, uy * sp / Math.sin((this.cam.pitch * Math.PI) / 180));
    }
    const t = client.partial;
    const follow = this.mode === 'hero' ? { x: p.lerpX(t), y: p.lerpY(t) + 1, z: p.lerpZ(t) } : null;
    this.cam.update(w, this.mc, follow, dt);
    this.cam.apply(cam);
    // what's under the pointer (desktop: for the cursor feedback and the HUD)
    if (!this.mc.device.touch && !client.ui.screen) this.hover = this.pickAt(client, this.mouse.x, this.mouse.y, gui.w, gui.h);
    void w;
  }

  pickAt(client: Client, gx: number, gy: number, gw = client.ui.gui.w, gh = client.ui.gui.h): Hit | null {
    if (!client.world) return null;
    const me = client.player;
    return pick(client, this.mc, this.cam, gx / gw, gy / gh, {
      entities: (e) => e !== me && !(e instanceof this.mc.Player && (e as unknown as { spectator: boolean }).spectator) && e instanceof this.mc.LivingEntity && !(e as unknown as { dead: boolean }).dead,
    });
  }

  // ------------------------------------------------------------------------------------------------ hero
  private heroMove(inp: MoveInput, client: Client): MoveInput {
    const p = client.player!;
    const { fwd } = this.cam.axes();
    const right = { x: -fwd.z, z: fwd.x };
    // the keys move relative to the screen: up is away from the camera
    const mx = fwd.x * inp.forward - right.x * inp.strafe, mz = fwd.z * inp.forward - right.z * inp.strafe;
    const moving = Math.hypot(mx, mz) > 0.05;
    const aiming = this.heroHeld.size > 0 || this.heroPressed.length > 0 || performance.now() < this.heroUntil;
    let face = p.yaw;
    const tgt = this.heroTarget(client);
    if ((aiming || !moving) && tgt) {
      const eye = client.eyePos(1);
      face = (Math.atan2(tgt.z - p.z, tgt.x - p.x) * 180) / Math.PI - 90;
      if (aiming || !moving) p.pitch = p.ppitch = Math.max(-80, Math.min(80, (-Math.atan2(tgt.y - eye.y, Math.hypot(tgt.x - eye.x, tgt.z - eye.z)) * 180) / Math.PI));
    } else if (moving) {
      face = (Math.atan2(mz, mx) * 180) / Math.PI - 90;
      p.pitch = p.pitch * 0.8;
    }
    // turn (quickly) to face
    let d = (face - p.yaw) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    p.yaw += aiming ? d : d * 0.5;
    const r = (p.yaw * Math.PI) / 180;
    const pf = { x: -Math.sin(r), z: Math.cos(r) }, ps = { x: Math.cos(r), z: Math.sin(r) };
    return { ...inp, forward: mx * pf.x + mz * pf.z, strafe: mx * ps.x + mz * ps.z };
  }
  private heroTarget(client: Client) {
    const a = this.heroAimAt ?? (this.mc.device.touch ? null : this.mouse);
    if (!a || client.ui.screen) return null;
    return this.pickAt(client, a.x, a.y)?.point ?? null;
  }
  private heroAim(client: Client): ViewAim | null {
    const a = this.heroAimAt ?? (this.mc.device.touch ? null : this.mouse);
    const pressed = this.heroPressed.splice(0);
    if (!a) return { dir: null, down: [], pressed: [] };
    const h = this.pickAt(client, a.x, a.y);
    if (!h || (!h.block && !h.entity)) return { dir: null, down: [...this.heroHeld], pressed };
    const eye = client.eyePos(1);
    // aim at the middle of an entity, or just inside the block face that was hit
    const pt = h.entity ? { x: h.entity.x, y: h.entity.y + h.entity.height * 0.6, z: h.entity.z } : { x: h.block!.x + 0.5, y: h.block!.y + 0.5, z: h.block!.z + 0.5 };
    const dx = pt.x - eye.x, dy = pt.y - eye.y, dz = pt.z - eye.z, l = Math.hypot(dx, dy, dz) || 1;
    return { dir: { x: dx / l, y: dy / l, z: dz / l }, down: [...this.heroHeld], pressed };
  }

  // ------------------------------------------------------------------------------------------------ input
  private hudAt(x: number, y: number): UiRect | null {
    for (let i = this.ui.length - 1; i >= 0; i--) {
      const r = this.ui[i];
      if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return r;
    }
    return null;
  }
  private overPanel(x: number, y: number) {
    return this.panels.some((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
  }

  private pointer(e: ViewPointer, client: Client) {
    if (e.touch !== null) { this.touch(e, client); return; }
    this.mouse = { x: e.x, y: e.y };
    const shift = client.input.isDown('ShiftLeft') || client.input.isDown('ShiftRight');
    const alt = client.input.isDown('AltLeft') || client.input.isDown('AltRight');
    switch (e.type) {
      case 'wheel': this.zoomBy(e.d); return;
      case 'down': {
        const r = this.hudAt(e.x, e.y);
        if (r) { if (!r.off) r.run?.(); return; }
        if (this.overPanel(e.x, e.y)) return;
        if (e.button === 1) { this.mmb = { x: e.x, y: e.y }; return; }
        if (this.mode === 'hero' && !alt && !this.placing && !this.pending) {
          // walking the hero: the mouse attacks and uses at the pointer
          if (this.hotbarClick(client, e.x, e.y)) return;
          this.heroHeld.add(e.button);
          this.heroPressed.push(e.button);
          this.heroUntil = performance.now() + 400;
          return;
        }
        if (e.button === 2) { this.rmb = { x: e.x, y: e.y, moved: false, yaw: this.cam.yawTo }; return; }
        if (e.button === 0) {
          if (this.placing) { this.ghostAt(client, e.x, e.y); this.place(shift); return; }
          if (this.pending) { this.target(client, e.x, e.y, shift); return; }
          this.box = { x0: e.x, y0: e.y, x1: e.x, y1: e.y };
        }
        return;
      }
      case 'move': {
        if (this.mmb) {
          const k = (2 * this.cam.zoom) / client.ui.gui.h;
          this.cam.pan(-(e.x - this.mmb.x) * k, (e.y - this.mmb.y) * k / Math.sin((this.cam.pitch * Math.PI) / 180));
          this.mmb = { x: e.x, y: e.y };
        }
        if (this.rmb) {
          if (Math.abs(e.x - this.rmb.x) > 4) this.rmb.moved = true;
          if (this.rmb.moved) { this.cam.yawTo = this.rmb.yaw - (e.x - this.rmb.x) * 0.6; this.cam.yaw = this.cam.yawTo; }
        }
        if (this.box) { this.box.x1 = e.x; this.box.y1 = e.y; }
        return;
      }
      case 'up': case 'cancel': {
        if (e.button === 1) this.mmb = null;
        if (this.heroHeld.has(e.button)) { this.heroHeld.delete(e.button); return; }
        if (e.button === 2 && this.rmb) {
          const r = this.rmb;
          this.rmb = null;
          if (r.moved) { this.cam.turn(0, false); return; }
          if (e.type === 'cancel') return;
          if (this.placing || this.pending) { this.placing = null; this.pending = null; return; }
          this.smart(client, e.x, e.y, shift);
          return;
        }
        if (e.button === 0 && this.box) {
          const b = this.box;
          this.box = null;
          if (e.type === 'cancel') return;
          this.selectBox(client, b, shift, client.input.isDown('ControlLeft') || client.input.isDown('MetaLeft'));
        }
        return;
      }
    }
  }

  /** Clicking the vanilla hotbar picks a slot (the pointer is free in the hero view). */
  private hotbarClick(client: Client, x: number, y: number) {
    if (this.mc.device.touch) return false;
    const gui = client.ui.gui, hx = Math.floor(gui.w / 2) - 91, hy = gui.h - 22;
    if (y < hy || y > hy + 22 || x < hx || x > hx + 182) return false;
    client.player!.inventory.selected = Math.max(0, Math.min(8, Math.floor((x - hx - 1) / 20)));
    return true;
  }

  private zoomBy(d: number) {
    this.cam.zoomTo = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.cam.zoomTo * Math.pow(1.15, d)));
  }

  /** Fingers: tap to select or order, drag to pan, hold and drag to box-select, two fingers to zoom and turn. */
  private touch(e: ViewPointer, client: Client) {
    const id = e.touch!;
    if (e.type === 'down') {
      const r = this.hudAt(e.x, e.y);
      if (r) { if (!r.off) r.run?.(); return; }
      if (this.overPanel(e.x, e.y)) return;
      this.fingers.set(id, { id, x: e.x, y: e.y, sx: e.x, sy: e.y, t0: performance.now(), moved: false, box: false, hold: false });
      if (this.fingers.size === 2) {
        const [a, b] = [...this.fingers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x), zoom: this.cam.zoomTo, yaw: this.cam.yawTo, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        this.box = null;
        this.heroAimAt = null;
        this.heroHeld.clear();
      } else if (this.mode === 'hero') this.heroAimAt = { x: e.x, y: e.y };
      return;
    }
    const f = this.fingers.get(id);
    if (!f) return;
    if (e.type === 'move') {
      const dx = e.x - f.x, dy = e.y - f.y;
      f.x = e.x; f.y = e.y;
      if (!f.moved && Math.hypot(f.x - f.sx, f.y - f.sy) > MOVE_GUI) f.moved = true;
      if (this.pinch && this.fingers.size >= 2) {
        const [a, b] = [...this.fingers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, ang = Math.atan2(b.y - a.y, b.x - a.x);
        this.cam.zoomTo = this.cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (this.pinch.zoom * this.pinch.d) / d));
        this.cam.yawTo = this.cam.yaw = this.pinch.yaw - ((ang - this.pinch.a) * 180) / Math.PI;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (this.mode === 'god') {
          const k = (2 * this.cam.zoom) / client.ui.gui.h;
          this.cam.pan(-(mx - this.pinch.mx) * k, ((my - this.pinch.my) * k) / Math.sin((this.cam.pitch * Math.PI) / 180));
        }
        this.pinch.mx = mx; this.pinch.my = my;
        return;
      }
      if (this.mode === 'hero') {
        // the hero aims where the finger is; a sideways drag turns the camera
        if (f.hold) this.heroAimAt = { x: e.x, y: e.y };
        else if (f.moved) { this.cam.yawTo = this.cam.yaw = this.cam.yaw - dx * 0.5; }
        return;
      }
      if (f.box && this.box) { this.box.x1 = e.x; this.box.y1 = e.y; return; }
      if (f.moved && !this.placing) {
        const k = (2 * this.cam.zoom) / client.ui.gui.h;
        this.cam.pan(-dx * k, (dy * k) / Math.sin((this.cam.pitch * Math.PI) / 180));
      } else if (f.moved && this.placing) this.ghostAt(client, e.x, e.y);
      return;
    }
    // up / cancel
    this.fingers.delete(id);
    if (this.pinch) { if (this.fingers.size < 2) { this.pinch = null; this.cam.turn(0, false); } return; }
    if (this.mode === 'hero') {
      if (f.hold) { this.heroHeld.delete(0); this.heroHeld.delete(2); }
      else if (!f.moved && e.type === 'up') {
        // a tap: hit the mob there, or use / place on the block
        this.heroAimAt = { x: e.x, y: e.y };
        const h = this.pickAt(client, e.x, e.y);
        const b = h?.entity ? 0 : 2;
        this.heroPressed.push(b);
        this.heroUntil = performance.now() + 400;
      }
      return;
    }
    if (e.type === 'cancel') { if (f.box) this.box = null; return; }
    if (f.box && this.box) { const b = this.box; this.box = null; this.selectBox(client, b, false, false); return; }
    if (f.moved) return;
    this.tap(client, e.x, e.y);
  }

  /** Per frame on phones: a finger held still turns into a box selection (god) or a mining hold (hero). */
  touchFrame() {
    const now = performance.now();
    for (const f of this.fingers.values()) {
      if (f.moved || f.box || f.hold || this.pinch || now - f.t0 < LONG_MS) continue;
      if (this.mode === 'hero') {
        f.hold = true;
        this.heroAimAt = { x: f.x, y: f.y };
        this.heroHeld.add(0);
        this.heroPressed.push(0);
      } else if (!this.placing && !this.pending) {
        f.box = true;
        this.box = { x0: f.x, y0: f.y, x1: f.x, y1: f.y };
      }
      try { navigator.vibrate?.(12); } catch { /* ignore */ }
    }
  }

  private tap(client: Client, x: number, y: number) {
    if (this.placing) { this.ghostAt(client, x, y); this.placing.set = true; return; }
    if (this.pending) { this.target(client, x, y, false); return; }
    const h = this.pickAt(client, x, y);
    const e = h?.entity;
    const now = performance.now();
    if (e && isUnit(e) && e.owner === this.me) {
      // tap a unit: select it (a second tap: all of its kind on screen)
      if (this.lastClick.id === e.id && now - this.lastClick.t < 400) this.selectKind(client, e.kind);
      else { this.sel = [e.id]; this.selB = null; }
      this.lastClick = { t: now, id: e.id };
      return;
    }
    const b = h ? this.buildingAt(h) : null;
    if (b && b.owner === this.me && (!this.sel.length || b.built && b.hp >= b.max && !BUILDINGS[b.type].farm)) { this.sel = []; this.selB = b.id; return; }
    if (this.sel.length) { this.smart(client, x, y, false); return; }
    if (this.selB !== null) {
      const own = this.buildings.find((q) => q.id === this.selB && q.owner === this.me);
      if (own && BUILDINGS[own.type].trains && h) { this.ch.toServer({ t: 'rally', b: own.id, x: h.point.x, y: h.point.y, z: h.point.z }); this.mark(h.point, 0xffd040); return; }
    }
    this.selB = b ? b.id : null;
  }

  private key(e: KeyboardEvent, client: Client): boolean {
    const code = e.code;
    const ctrl = e.ctrlKey || e.metaKey;
    if (code === this.toggleKey()) { this.request('off', client); return true; }
    if (code === 'Tab') { this.request(this.mode === 'god' ? 'hero' : 'god', client); return true; }
    if (code === 'KeyZ') { this.cam.turn(-90); return true; }
    if (code === 'KeyX') { this.cam.turn(90); return true; }
    if (code === 'Equal' || code === 'NumpadAdd') { this.zoomBy(-1); return true; }
    if (code === 'Minus' || code === 'NumpadSubtract') { this.zoomBy(1); return true; }
    if (code === 'Escape' && (this.placing || this.pending || this.buildMenu || this.help)) { this.placing = null; this.pending = null; this.buildMenu = false; this.help = false; return true; }
    if (this.mode !== 'god') return false;
    // the god view's own keys (the hero view leaves the rest to the game)
    if (code === 'Escape') return false;
    if (code === 'Home' || code === 'Space') { this.centre(client); return true; }
    if (code === 'KeyR' && this.placing) { this.placing.rot = (this.placing.rot + 1) & 3; this.ghostAt(client, this.mouse.x, this.mouse.y); return true; }
    if (code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      if (ctrl) { this.groups.set(n, { u: [...this.sel], b: this.selB }); this.note(`Group ${n} set`); }
      else {
        const g = this.groups.get(n);
        if (g) {
          const again = this.sel.join() === g.u.join() && this.selB === g.b;
          this.sel = [...g.u]; this.selB = g.b;
          if (again) this.centre(client);
        }
      }
      return true;
    }
    if (code === 'Backquote') { this.sel = []; this.selB = null; return true; }
    if (code === 'KeyH' && e.shiftKey) { this.help = !this.help; return true; }
    // the command card's hotkeys
    for (const r of this.ui) if (r.key === code && !r.off) { r.run?.(); return true; }
    return code === 'KeyE' || code === 'KeyQ' || code === 'KeyF' || code.startsWith('Digit');
  }
  toggleKey() { return this.cfgKey ?? 'KeyV'; }
  cfgKey: string | null = null;

  // ------------------------------------------------------------------------------------------------ selecting
  private myUnits(client: Client): UnitEntity[] {
    return client.entities.filter((e) => isUnit(e) && !e.dead && !e.removed && e.owner === this.me) as UnitEntity[];
  }
  selected(client: Client): UnitEntity[] {
    const ids = new Set(this.sel);
    return this.myUnits(client).filter((u) => ids.has(u.id));
  }
  private onScreen(client: Client, u: Entity) {
    const g = client.ui.gui, p = project(client, u.x, u.y + u.height / 2, u.z, g.w, g.h);
    return p && p[0] >= 0 && p[1] >= 0 && p[0] <= g.w && p[1] <= g.h ? p : null;
  }
  private selectKind(client: Client, kind: string) {
    this.sel = this.myUnits(client).filter((u) => u.kind === kind && this.onScreen(client, u)).map((u) => u.id);
    this.selB = null;
  }
  private selectBox(client: Client, b: { x0: number; y0: number; x1: number; y1: number }, add: boolean, kind: boolean) {
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    if (x1 - x0 < 4 && y1 - y0 < 4) {
      // a click
      const h = this.pickAt(client, b.x1, b.y1);
      const e = h?.entity;
      const now = performance.now();
      if (e && isUnit(e) && e.owner === this.me) {
        if (kind || (this.lastClick.id === e.id && now - this.lastClick.t < 350)) this.selectKind(client, e.kind);
        else if (add) this.sel = this.sel.includes(e.id) ? this.sel.filter((i) => i !== e.id) : [...this.sel, e.id];
        else { this.sel = [e.id]; this.selB = null; }
        this.lastClick = { t: now, id: e.id };
        return;
      }
      const bl = h ? this.buildingAt(h) : null;
      if (!add) { this.sel = []; this.selB = bl ? bl.id : null; }
      return;
    }
    const picked = this.myUnits(client).filter((u) => {
      const p = this.onScreen(client, u);
      return p && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
    });
    // a box with soldiers in it picks just the soldiers
    const army = picked.filter((u) => !u.def().worker);
    const ids = (army.length ? army : picked).map((u) => u.id);
    this.sel = add ? [...new Set([...this.sel, ...ids])] : ids;
    if (ids.length || !add) this.selB = null;
  }
  /** Look at the selection (or our town hall, or the hero). */
  centre(client: Client) {
    const us = this.selected(client);
    if (us.length) { this.cam.jump(us.reduce((s, u) => s + u.x, 0) / us.length, us.reduce((s, u) => s + u.z, 0) / us.length); return; }
    const b = this.buildings.find((q) => q.id === this.selB) ?? (this.lastAlert && performance.now() - this.lastAlert.t < 15000 ? null : this.buildings.find((q) => q.owner === this.me && q.type === 'town_centre'));
    if (b) { const r = rect(b); this.cam.jump((r[0] + r[2] + 1) / 2, (r[1] + r[3] + 1) / 2); return; }
    if (this.lastAlert?.x !== undefined) { this.cam.jump(this.lastAlert.x, this.lastAlert.z!); this.lastAlert = null; }
  }

  /** The building a hit landed on (a block within its footprint and height). */
  buildingAt(h: Hit): BInfo | null {
    const p = h.block ?? { x: Math.floor(h.point.x), y: Math.floor(h.point.y), z: Math.floor(h.point.z) };
    for (const b of this.buildings) {
      const [x0, z0, x1, z1] = rect(b);
      if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1 && p.y >= b.y - 1 && p.y < b.y + BUILDINGS[b.type].blueprint.h) return b;
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------------ orders
  private mark(p: { x: number; y: number; z: number }, col: number) {
    this.markers.push({ x: p.x, y: p.y, z: p.z, t: performance.now(), col });
  }
  cmd(c: Extract<ToServer, { t: 'cmd' }>['c'], extra: Partial<Extract<ToServer, { t: 'cmd' }>>, queue = false, units?: number[]) {
    const u = units ?? this.sel;
    if (!u.length) return;
    this.ch.toServer({ t: 'cmd', u, c, q: queue || undefined, ...extra });
  }
  /** A right-click (or a tap with units selected): do the obvious thing with what's there. */
  smart(client: Client, x: number, y: number, queue: boolean) {
    const h = this.pickAt(client, x, y);
    if (!h) return;
    const us = this.selected(client);
    if (!us.length) {
      const own = this.buildings.find((q) => q.id === this.selB && q.owner === this.me);
      if (own && BUILDINGS[own.type].trains) { this.ch.toServer({ t: 'rally', b: own.id, x: h.point.x, y: h.point.y, z: h.point.z }); this.mark(h.point, 0xffd040); }
      return;
    }
    const workers = us.some((u) => u.def().worker);
    const mc = this.mc;
    if (h.entity) {
      const e = h.entity;
      if (isUnit(e) && e.owner === this.me) { this.cmd('follow', { e: e.id }, queue); this.mark(h.point, 0x50ff50); return; }
      this.cmd('attack', { e: e.id }, queue);
      this.mark(h.point, 0xff4040);
      return;
    }
    const b = this.buildingAt(h);
    if (b) {
      if (b.owner !== this.me) { this.cmd('attack', { b: b.id }, queue); this.mark(h.point, 0xff4040); return; }
      const def = BUILDINGS[b.type];
      if (workers && (!b.built || b.hp < b.max)) { this.cmd('build', { b: b.id }, queue); this.mark(h.point, 0xffd040); return; }
      if (workers && def.farm) { this.cmd('farm', { b: b.id }, queue); this.mark(h.point, 0xffd040); return; }
      if (workers && def.dropoff && us.some((u) => u.carry > 0)) { this.cmd('return', {}, queue); this.mark(h.point, 0xffd040); return; }
    }
    if (h.block && workers) {
      const w = client.world!;
      let bl: { x: number; y: number; z: number } | null = h.block;
      const name = mc.BLOCKS[w.getId(bl.x, bl.y, bl.z)].name;
      // leaves stand for their tree: the nearest log
      if (name.endsWith('_leaves')) bl = this.nearLog(client, bl.x, bl.y, bl.z);
      if (bl && resourceOf(mc.BLOCKS[w.getId(bl.x, bl.y, bl.z)].name)) {
        this.cmd('gather', { x: bl.x, y: bl.y, z: bl.z }, queue);
        this.mark({ x: bl.x + 0.5, y: bl.y + 1, z: bl.z + 0.5 }, 0xffd040);
        return;
      }
    }
    const p = h.point;
    this.cmd(this.pending === 'amove' ? 'amove' : 'move', { x: p.x, y: p.y, z: p.z }, queue);
    this.mark(p, 0x50ff50);
  }
  private nearLog(client: Client, x: number, y: number, z: number) {
    const w = client.world!;
    let best: { x: number; y: number; z: number } | null = null, bd = Infinity;
    for (let dy = -5; dy <= 1; dy++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      if (!this.mc.BLOCKS[w.getId(x + dx, y + dy, z + dz)].name.endsWith('_log')) continue;
      const d = dx * dx + dz * dz + Math.abs(dy) * 0.5;
      if (d < bd) { bd = d; best = { x: x + dx, y: y + dy, z: z + dz }; }
    }
    // the bottom of that trunk
    if (best) while (this.mc.BLOCKS[w.getId(best.x, best.y - 1, best.z)].name.endsWith('_log')) best.y--;
    return best;
  }
  /** A command waiting for a target (attack-move, rally...): this click is it. */
  private target(client: Client, x: number, y: number, queue: boolean) {
    const h = this.pickAt(client, x, y);
    const p = this.pending;
    this.pending = queue ? p : null;
    if (!h) return;
    if (p === 'rally') {
      if (this.selB !== null) { this.ch.toServer({ t: 'rally', b: this.selB, x: h.point.x, y: h.point.y, z: h.point.z }); this.mark(h.point, 0xffd040); }
      return;
    }
    if (p === 'attack' || p === 'amove') {
      if (h.entity && !(isUnit(h.entity) && h.entity.owner === this.me)) { this.cmd('attack', { e: h.entity.id }, queue); this.mark(h.point, 0xff4040); return; }
      const b = this.buildingAt(h);
      if (b && b.owner !== this.me) { this.cmd('attack', { b: b.id }, queue); this.mark(h.point, 0xff4040); return; }
      this.cmd('amove', { x: h.point.x, y: h.point.y, z: h.point.z }, queue);
      this.mark(h.point, 0xff4040);
      return;
    }
    this.cmd('move', { x: h.point.x, y: h.point.y, z: h.point.z }, queue);
    this.mark(h.point, 0x50ff50);
  }

  // ------------------------------------------------------------------------------------------------ building
  startPlacing(type: string) {
    this.placing = { type, rot: 0, x: 0, z: 0, y: 0, ok: false, set: false };
    this.pending = null;
    this.buildMenu = false;
    const c = this.mc.client;
    if (c && this.mc.device.touch) {
      // phones: the ghost starts in the middle of the view
      this.ghostAt(c, c.ui.gui.w / 2, c.ui.gui.h / 2);
    }
  }
  /** Move the ghost under a screen point and judge the spot. */
  ghostAt(client: Client, gx: number, gy: number) {
    const pl = this.placing;
    if (!pl || !client.world) return;
    const h = this.pickAt(client, gx, gy);
    if (!h) return;
    const def = BUILDINGS[pl.type];
    const [fw, fd] = footprint(def.blueprint, pl.rot);
    pl.x = Math.floor(h.point.x - fw / 2 + 0.5);
    pl.z = Math.floor(h.point.z - fd / 2 + 0.5);
    const own = this.buildings.filter((b) => b.owner === this.me) as unknown as Placed[];
    const first = !own.length;
    const chk = checkPlace(this.mc, client.world, pl.type, pl.x, pl.z, pl.rot, this.buildings as unknown as Placed[], own, first);
    const free = first && pl.type === 'town_centre' && !this.st?.started;
    pl.y = chk.ok ? chk.y : groundY(this.mc, client.world, pl.x, pl.z);
    pl.ok = chk.ok && (free || canAfford(this.st?.res ?? { food: 0, wood: 0, ore: 0 }, def.cost));
    pl.why = !chk.ok ? chk.why : pl.ok ? undefined : 'Not enough resources';
  }
  place(keep: boolean) {
    const pl = this.placing;
    if (!pl) return;
    if (!pl.ok) { this.note(pl.why ?? 'Can\'t build there'); return; }
    const workers = this.mc.client ? this.selected(this.mc.client).filter((u) => u.def().worker).map((u) => u.id) : [];
    this.ch.toServer({ t: 'place', type: pl.type, x: pl.x, z: pl.z, rot: pl.rot, u: workers, q: keep || undefined });
    if (!keep) this.placing = null;
  }

  /** The buttons the selection offers (the command card), for hud.ts to draw. */
  card(client: Client): { id: string; label: string; icon?: string; key: string; tip: string[]; run: () => void; off?: boolean; on?: boolean }[] {
    const out: ReturnType<Ctl['card']> = [];
    const keys = ['KeyQ', 'KeyE', 'KeyR', 'KeyT', 'KeyF', 'KeyG', 'KeyC', 'KeyB'];
    const add = (o: Omit<ReturnType<Ctl['card']>[number], 'key'>) => out.push({ ...o, key: keys[out.length] ?? '' });
    const res = this.st?.res ?? { food: 0, wood: 0, ore: 0 };
    if (this.buildMenu) {
      for (const id of BUILD_ORDER) {
        const d = BUILDINGS[id];
        add({ id: 'b:' + id, label: d.names[this.faction], icon: d.icon, tip: [d.names[this.faction], costLine(d.cost), d.desc], run: () => this.startPlacing(id), off: !canAfford(res, d.cost) });
      }
      add({ id: 'back', label: 'Back', tip: ['Back'], run: () => { this.buildMenu = false; } });
      return out;
    }
    const us = this.selected(client);
    if (us.length) {
      const workers = us.some((u) => u.def().worker);
      add({ id: 'amove', label: 'Attack', icon: 'iron_sword', tip: ['Attack-move', 'Walk there, fighting anything on the way. Or click an enemy.'], run: () => { this.pending = 'amove'; }, on: this.pending === 'amove' });
      add({ id: 'stop', label: 'Stop', icon: '#stop', tip: ['Stop'], run: () => this.cmd('stop', {}) });
      add({ id: 'hold', label: 'Hold', icon: 'iron_chestplate', tip: ['Hold position', 'Stay put, fighting only what comes in reach.'], run: () => this.cmd('hold', {}) });
      add({ id: 'move', label: 'Move', icon: 'leather_boots', tip: ['Move', 'Walk there and ignore enemies.'], run: () => { this.pending = 'move'; }, on: this.pending === 'move' });
      if (workers) {
        add({ id: 'build', label: 'Build', icon: 'oak_planks', tip: ['Build', 'Choose a building to put up.'], run: () => { this.buildMenu = true; } });
        add({ id: 'return', label: 'Return', icon: 'chest', tip: ['Return cargo', 'Take what they carry to the nearest drop-off.'], run: () => this.cmd('return', {}) });
      }
      return out;
    }
    const b = this.buildings.find((q) => q.id === this.selB);
    if (b && b.owner === this.me) {
      const def = BUILDINGS[b.type];
      if (b.built) for (const k of def.trains?.[b.faction] ?? []) {
        const u = UNITS[k];
        add({ id: 't:' + k, label: u.name, icon: u.held ?? (u.worker ? 'wooden_hoe' : 'bone'), tip: [`Train ${u.name}`, costLine(u.cost), u.desc, `${u.hp} health, ${u.damage} damage`], run: () => this.ch.toServer({ t: 'train', b: b.id, u: k }), off: !canAfford(res, u.cost) });
      }
      if (def.trains) add({ id: 'rally', label: 'Rally', icon: '#flag', tip: ['Rally point', 'Where new units go. Right-click or tap the ground.'], run: () => { this.pending = 'rally'; }, on: this.pending === 'rally' });
      add({ id: 'demolish', label: b.built ? 'Demolish' : 'Cancel', icon: 'tnt', tip: [b.built ? 'Demolish' : 'Cancel construction', b.built ? 'Tear it down.' : 'Refunds what it cost.'], run: () => { this.ch.toServer({ t: 'demolish', b: b.id }); this.selB = null; } });
    }
    return out;
  }

  /** Units and their numbers for the HUD, and whether any are enemies. */
  isEnemyEntity(e: Entity) {
    if (isUnit(e)) return e.owner !== this.me && (e.owner === RAIDERS || !!this.st?.pvp);
    return e instanceof this.mc.Monster;
  }
  /** The nearest own building to a point, for distance checks in the HUD. */
  nearOwn(x: number, z: number) {
    let best = Infinity;
    for (const b of this.buildings) if (b.owner === this.me) best = Math.min(best, distToRect(b, x, z));
    return best;
  }
}

export function costLine(c: { food?: number; wood?: number; ore?: number }) {
  const parts: string[] = [];
  if (c.food) parts.push(`§e${c.food} food`);
  if (c.wood) parts.push(`§6${c.wood} wood`);
  if (c.ore) parts.push(`§7${c.ore} ore`);
  return parts.join('  ') || 'Free';
}
