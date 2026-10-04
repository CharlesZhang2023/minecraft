// What the overseer draws: in the world (rings under units, the ghost of a building being placed, order markers,
// rally flags, frames around buildings going up) and on the HUD (resources, the selection, the command card,
// health bars, a minimap, messages, help).
import type { ModContext, Client, RenderContext, Ctx, Entity, Mc } from '../sdk';
import { project } from './cam';
import { BUILDINGS, UNITS, TEAMS, RAIDER_HEX, FACTIONS, FACTION_NAMES, cellsOf } from './defs';
import { blockFor, rect } from './place';
import { isUnit, type UnitEntity } from './units';
import type { Ctl, UiRect } from './ctl';
import type { BInfo } from './state';

const hexNum = (h: string) => parseInt(h.slice(1), 16);
const teamHex = (t: number) => (t < 0 ? RAIDER_HEX : TEAMS[t % TEAMS.length].hex);

export function paintTextures(mod: ModContext) {
  const px = mod.mc.pixels;
  const ring = (inner: number, outer: number) => () => {
    const img = px.newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (d >= inner && d <= outer) px.set(img, x, y, px.hex('#ffffff'));
    }
    return img;
  };
  mod.client.texture('overseer:ring', ring(6.2, 7.6));
  mod.client.texture('overseer:ring2', ring(5.2, 7.9));
  mod.client.texture('overseer:white', () => { const img = px.newImg(); for (let i = 0; i < 256; i++) px.set(img, i & 15, i >> 4, px.hex('#ffffff')); return img; });
}

// ------------------------------------------------------------------------------------------------- in the world
export function drawWorld(ctl: Ctl, r: RenderContext) {
  if (ctl.mode === 'off') return;
  const client = r.client, mc = ctl.mod.mc, t = r.partial;
  const ring = r.tex('overseer:ring'), ring2 = r.tex('overseer:ring2'), white = r.tex('overseer:white');
  const full: [number, number] = [15, 15];
  const flat = (x: number, y: number, z: number, s: number, layer: number, col: number) =>
    r.quad([x - s, y, z - s, x - s, y, z + s, x + s, y, z + s, x + s, y, z - s], layer, [0, 0, 1, 1], col, 1, full);
  const sel = new Set(ctl.sel);
  const hoverE = ctl.hover?.entity ?? null;
  for (const e of client.entities) {
    if (!isUnit(e) || e.dead) continue;
    const u = e as UnitEntity;
    const x = u.lerpX(t), y = u.lerpY(t) + 0.03, z = u.lerpZ(t), s = Math.max(0.45, u.width * 0.75);
    if (sel.has(u.id)) flat(x, y, z, s + 0.1, ring2, 0x40ff40);
    else if (u === hoverE) flat(x, y, z, s + 0.05, ring2, 0xffffff);
    flat(x, y + 0.005, z, s - 0.08, ring, hexNum(teamHex(u.team)));
  }
  // order markers: a ring that shrinks away
  const now = performance.now();
  for (const m of ctl.markers) {
    const f = (now - m.t) / 1200;
    flat(m.x, m.y + 0.06, m.z, 0.9 * (1 - f) + 0.15, ring2, m.col);
  }
  // buildings: frames around those going up, an outline round the selected one, its rally flag
  for (const b of ctl.buildings) {
    const def = BUILDINGS[b.type];
    const [x0, z0, x1, z1] = rect(b);
    const h = def.blueprint.h;
    const selected = b.id === ctl.selB;
    if (!b.built) frame(r, x0, b.y + 1, z0, x1 + 1, b.y + h, z1 + 1, 0xc8a060, white);
    if (selected) frame(r, x0 - 0.05, b.y + 1.02, z0 - 0.05, x1 + 1.05, b.y + 1.02, z1 + 1.05, 0x40ff40, white, true);
    if (selected && b.rally) {
      const [rx, ry, rz] = b.rally;
      r.boxes([mc.box(7.5, 0, 7.5, 8.5, 28, 8.5, white)], Math.floor(rx), Math.floor(ry) + 1, Math.floor(rz), null, full, 0x8a6a3a);
      r.boxes([mc.box(8.5, 18, 7.8, 16, 27, 8.2, white)], Math.floor(rx), Math.floor(ry) + 1, Math.floor(rz), null, full, hexNum(teamHex(b.team)));
    }
  }
  // the ghost of a building being placed
  const pl = ctl.placing;
  if (pl && (pl.set || !mc.device.touch || pl.x || pl.z)) {
    const def = BUILDINGS[pl.type];
    const col = pl.ok ? 0x60ff60 : 0xff4040;
    for (const c of cellsOf(def.blueprint, pl.rot)) {
      if (c.c === '.') continue;
      const v = blockFor(mc, c.c, ctl.faction, ctl.st?.team ?? 0);
      const bd = mc.BLOCKS[mc.idOf(v)];
      if (!bd) continue;
      const tx = bd.faces;
      r.boxes([mc.box(2.5, 2.5, 2.5, 13.5, 13.5, 13.5, [tx[0], tx[1], tx[2], tx[3], tx[4], tx[5]])], pl.x + c.dx, pl.y + c.dy, pl.z + c.dz, null, full, col);
    }
  }
}

/** The edges of a box, as thin bars (or just its top rectangle). */
function frame(r: RenderContext, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: number, layer: number, top = false) {
  const w = 0.06, full: [number, number] = [15, 15];
  const bar = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const p = [Math.min(ax, bx) - w, Math.min(ay, by) - w, Math.min(az, bz) - w, Math.max(ax, bx) + w, Math.max(ay, by) + w, Math.max(az, bz) + w];
    const cx = Math.floor(p[0]), cy = Math.floor(p[1]), cz = Math.floor(p[2]);
    r.boxes([{ x0: (p[0] - cx) * 16, y0: (p[1] - cy) * 16, z0: (p[2] - cz) * 16, x1: (p[3] - cx) * 16, y1: (p[4] - cy) * 16, z1: (p[5] - cz) * 16, tex: [layer, layer, layer, layer, layer, layer] }], cx, cy, cz, null, full, col);
  };
  for (const y of top ? [y0] : [y0, y1]) {
    bar(x0, y, z0, x1, y, z0); bar(x0, y, z1, x1, y, z1); bar(x0, y, z0, x0, y, z1); bar(x1, y, z0, x1, y, z1);
  }
  if (!top) for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) bar(x, y0, z, x, y1, z);
}

// ------------------------------------------------------------------------------------------------- the HUD
interface Btn { x: number; y: number; w: number; h: number; label?: string; icon?: string; on?: boolean; off?: boolean; key?: string; tip?: string[]; run?: () => void; id: string }

export class Hud {
  private mini: { canvas: HTMLCanvasElement; at: number; cx: number; cz: number; yaw: number } | null = null;
  private colours = new Map<number, string>();
  constructor(private ctl: Ctl, private mod: ModContext) {}
  get mc(): Mc { return this.mod.mc; }

  render(ctx: Ctx, client: Client, W: number, H: number) {
    const ctl = this.ctl;
    ctl.ui = [];
    ctl.panels = [];
    if (ctl.mode === 'off') return;
    if (client.ui.screen) return;
    if (this.mc.device.touch) ctl.touchFrame();
    const gui = client.ui.gui;
    this.bars(ctx, client, W, H);
    if (ctl.box) {
      const b = ctl.box, x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1);
      ctx.strokeStyle = '#60ff60';
      ctx.lineWidth = 1 / gui.scale;
      ctx.strokeRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.fillStyle = 'rgba(80,255,80,0.08)';
      ctx.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }
    this.topBar(ctx, client, W);
    this.messages(ctx, client, W);
    if (ctl.mode === 'god') {
      if (!ctl.st?.faction) { this.factionPicker(ctx, client, W, H); this.tooltipAt(ctx, client); return; }
      this.bottom(ctx, client, W, H);
    } else this.heroBar(ctx, client, W, H);
    this.hints(ctx, client, W, H);
    if (ctl.help) this.helpPanel(ctx, client, W, H);
    this.tooltipAt(ctx, client);
  }

  private button(ctx: Ctx, client: Client, b: Btn) {
    const gui = client.ui.gui, ctl = this.ctl;
    const hover = !this.mc.device.touch && ctl.mouse.x >= b.x && ctl.mouse.y >= b.y && ctl.mouse.x < b.x + b.w && ctl.mouse.y < b.y + b.h;
    ctx.fillStyle = b.on ? 'rgba(80,140,60,0.9)' : hover && !b.off ? 'rgba(90,100,150,0.9)' : 'rgba(30,30,30,0.85)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.on ? '#b0ff90' : hover ? '#c0c8ff' : '#6a6a6a';
    ctx.fillRect(b.x, b.y, b.w, 1); ctx.fillRect(b.x, b.y, 1, b.h);
    ctx.fillStyle = '#101010';
    ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1); ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
    const it = b.icon && b.icon[0] !== '#' ? this.mc.itemByName(b.icon) : undefined;
    if (b.icon?.[0] === '#') glyph(ctx, b.icon.slice(1), b.x + b.w / 2, b.y + b.h / 2, b.off ? 0.4 : 1);
    else if (it) {
      ctx.globalAlpha = b.off ? 0.4 : 1;
      client.ui.drawItem(ctx, { id: it.id, count: 1 }, b.x + Math.floor((b.w - 16) / 2), b.y + Math.floor((b.h - 16) / 2) - (b.label && b.h > 24 ? 3 : 0));
      ctx.globalAlpha = 1;
    } else if (b.label) gui.textCenter(ctx, b.label, b.x + b.w / 2, b.y + Math.floor((b.h - 8) / 2), b.off ? '#707070' : '#ffffff');
    if (b.key && !this.mc.device.touch) {
      const k = b.key.replace(/^Key|^Digit/, '');
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(b.x + 1, b.y + 1, gui.font.width(k) + 2, 9);
      gui.text(ctx, k, b.x + 2, b.y + 1, '#ffff80', false);
    }
    ctl.ui.push({ x: b.x, y: b.y, w: b.w, h: b.h, id: b.id, run: b.run, tip: b.tip, key: b.key, off: b.off } as UiRect);
  }

  private topBar(ctx: Ctx, client: Client, W: number) {
    const ctl = this.ctl, gui = client.ui.gui, st = ctl.st;
    const touch = this.mc.device.touch;
    // phones walking the hero: the game's hearts and food sit along the top, so go under them
    const y0 = touch && ctl.mode === 'hero' ? 12 : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, y0, W, 16);
    ctl.panels.push({ x: 0, y: y0, w: W, h: 16 });
    let x = 3;
    const item = (name: string, text: string, col: string) => {
      const it = this.mc.itemByName(name);
      if (it) client.ui.drawItem(ctx, { id: it.id, count: 1 }, x, y0);
      gui.text(ctx, text, x + 17, y0 + 4, col);
      x += 19 + gui.font.width(text) + 6;
    };
    if (st) {
      item('wheat', String(Math.floor(st.res.food)), '#ffe080');
      item('oak_log', String(Math.floor(st.res.wood)), '#e0b070');
      item('iron_ingot', String(Math.floor(st.res.ore)), '#d8d8d8');
      glyph(ctx, 'person', x + 8, y0 + 8, 1);
      x -= 0;
      gui.text(ctx, `${st.pop}/${st.popMax}`, x + 17, y0 + 4, st.pop >= st.popMax ? '#ff8080' : '#ffffff');
    }
    // the mode buttons, right; on phones the chat and pause buttons sit top centre, so stay clear of them
    const bw = 30, y = y0 + 1;
    let bx = W - (bw + 2) * 4;
    if (touch && bx < W / 2 + 30) bx = W / 2 + 30;
    const mk = (id: string, label: string, on: boolean, run: () => void, tip: string[]) => { this.button(ctx, client, { id, x: bx, y, w: bw, h: 14, label, on, run, tip }); bx += bw + 2; };
    mk('god', 'God', ctl.mode === 'god', () => ctl.request('god', client), ['Overseer', 'Look down on the world with no body of your own and command your units. (Tab)']);
    mk('hero', 'Hero', ctl.mode === 'hero', () => ctl.request('hero', client), ['Hero', 'Walk your own character in this view. (Tab)']);
    mk('help', '?', ctl.help, () => { ctl.help = !ctl.help; }, ['Help (Shift+H)']);
    mk('exit', 'Exit', false, () => ctl.request('off', client), ['Back to first person (V)']);
  }

  private messages(ctx: Ctx, client: Client, W: number) {
    const gui = client.ui.gui, now = performance.now();
    // under the hint line (and under the phones' hero bar)
    let y = 35 + (this.mc.device.touch && this.ctl.mode === 'hero' ? 12 : 0);
    for (const f of this.ctl.feed) {
      const a = Math.min(1, (9000 - (now - f.t)) / 1000);
      ctx.globalAlpha = Math.max(0, a);
      const w = gui.font.width(f.m) + 6;
      ctx.fillStyle = f.alert ? 'rgba(90,0,0,0.6)' : 'rgba(0,0,0,0.5)';
      ctx.fillRect(2, y - 1, w, 10);
      gui.text(ctx, f.m, 5, y, f.alert ? '#ff9090' : '#ffffff');
      ctx.globalAlpha = 1;
      y += 11;
    }
    void W;
  }

  /** Health bars over units that are selected, pointed at or hurt, and over buildings going up or hurt. */
  private bars(ctx: Ctx, client: Client, W: number, H: number) {
    const ctl = this.ctl, t = client.partial;
    const sel = new Set(ctl.sel);
    const k = Math.max(0.6, Math.min(1.2, 16 / ctl.cam.zoom));
    for (const e of client.entities) {
      if (!(e instanceof this.mc.LivingEntity)) continue;
      const l = e as unknown as { health: number; maxHealth: number; dead: boolean; height: number };
      if (l.dead) continue;
      const u = isUnit(e);
      const show = sel.has(e.id) || ctl.hover?.entity === e || (l.health < l.maxHealth && (u || ctl.isEnemyEntity(e)));
      if (!show && !u) continue;
      const p = project(client, e.lerpX(t), e.lerpY(t) + l.height + 0.35, e.lerpZ(t), W, H);
      if (!p) continue;
      if (!show) {
        // every unit keeps a small team-coloured marker, so ones under trees can still be found
        ctx.fillStyle = '#000000';
        ctx.fillRect(Math.round(p[0]) - 2, Math.round(p[1]) - 1, 4, 4);
        ctx.fillStyle = teamHex((e as unknown as UnitEntity).team);
        ctx.fillRect(Math.round(p[0]) - 1, Math.round(p[1]), 2, 2);
        continue;
      }
      const w = Math.round(14 * k), f = Math.max(0, Math.min(1, l.health / l.maxHealth));
      const x = Math.round(p[0] - w / 2), y = Math.round(p[1]);
      ctx.fillStyle = '#000000';
      ctx.fillRect(x - 1, y - 1, w + 2, 4);
      ctx.fillStyle = u && (e as UnitEntity).owner === ctl.me ? (f > 0.5 ? '#40e040' : f > 0.25 ? '#e0d040' : '#e04040') : '#e04040';
      ctx.fillRect(x, y, Math.max(1, Math.round(w * f)), 2);
      if (u) { ctx.fillStyle = teamHex((e as UnitEntity).team); ctx.fillRect(x - 1, y + 2, 2, 1); }
    }
    for (const b of ctl.buildings) {
      const [x0, z0, x1, z1] = rect(b);
      if (b.built && b.hp >= b.max && b.id !== ctl.selB) continue;
      const p = project(client, (x0 + x1 + 1) / 2, b.y + BUILDINGS[b.type].blueprint.h + 0.5, (z0 + z1 + 1) / 2, W, H);
      if (!p) continue;
      const w = 30, f = b.max ? b.hp / b.max : 0;
      const x = Math.round(p[0] - w / 2), y = Math.round(p[1]);
      ctx.fillStyle = '#000000';
      ctx.fillRect(x - 1, y - 1, w + 2, 5);
      ctx.fillStyle = b.built ? (b.owner === ctl.me ? '#40e040' : '#e04040') : '#d8b060';
      ctx.fillRect(x, y, Math.max(1, Math.round(w * f)), 3);
      if (!b.built) client.ui.gui.textCenter(ctx, `${Math.round(f * 100)}%`, p[0], y - 10, '#ffe0a0');
    }
  }

  /** The god view's bottom: minimap, the selection, the command card. */
  private bottom(ctx: Ctx, client: Client, W: number, H: number) {
    const ctl = this.ctl, gui = client.ui.gui;
    const ph = 56, py = H - ph;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, py, W, ph);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, py, W, 1);
    ctl.panels.push({ x: 0, y: py, w: W, h: ph });
    // minimap
    const ms = ph - 4;
    this.minimap(ctx, client, 2, py + 2, ms);
    // command card, right
    const card = ctl.card(client);
    const bs = 24, cols = 4, cw = cols * (bs + 2);
    card.forEach((c, i) => {
      const x = W - cw - 2 + (i % cols) * (bs + 2), y = py + 3 + Math.floor(i / cols) * (bs + 2);
      this.button(ctx, client, { id: c.id, x, y, w: bs, h: bs, icon: c.icon, label: c.label.slice(0, 3), on: c.on, off: c.off, key: c.key, tip: c.tip, run: c.run });
    });
    // the selection, between
    const sx = ms + 8, sw = W - cw - 8 - sx;
    const us = ctl.selected(client);
    if (us.length === 1) this.oneUnit(ctx, client, us[0], sx, py + 4, sw);
    else if (us.length > 1) this.manyUnits(ctx, client, us, sx, py + 3, sw);
    else {
      const b = ctl.buildings.find((q) => q.id === ctl.selB);
      if (b) this.oneBuilding(ctx, client, b, sx, py + 4, sw);
      else {
        gui.text(ctx, this.mc.device.touch ? 'Tap a unit to select it; hold and drag to box-select.' : 'Click or drag to select. Right-click to give orders.', sx, py + 6, '#a0a0a0');
        gui.text(ctx, this.mc.device.touch ? 'Drag to look around, pinch to zoom and turn.' : 'WASD / arrows / screen edge: pan. Wheel: zoom. Z X: turn.', sx, py + 18, '#808080');
        const idle = ctl.mod.mc.client ? this.idleWorkers(client) : [];
        if (idle.length) this.button(ctx, client, { id: 'idle', x: sx, y: py + 32, w: 90, h: 16, label: `Idle workers: ${idle.length}`, run: () => { ctl.sel = idle.map((u) => u.id); ctl.selB = null; ctl.centre(client); }, tip: ['Select the workers doing nothing'] });
      }
    }
  }
  private idleWorkers(client: Client) {
    return client.entities.filter((e) => isUnit(e) && !e.dead && e.owner === this.ctl.me && e.def().worker && e.task === 'Idle') as UnitEntity[];
  }

  private portrait(ctx: Ctx, client: Client, u: UnitEntity, x: number, y: number, s: number) {
    const d = u.def();
    ctx.fillStyle = teamHex(u.team);
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#202020';
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    const icon = d.held ?? (d.worker ? (u.carry ? null : 'wooden_hoe') : null);
    const it = this.mc.itemByName(u.carry ? (u.carryRes === 'wood' ? 'oak_log' : u.carryRes === 'ore' ? 'cobblestone' : 'wheat') : icon ?? 'bone');
    if (it) client.ui.drawItem(ctx, { id: it.id, count: 1 }, x + Math.floor((s - 16) / 2), y + Math.floor((s - 16) / 2));
    const f = Math.max(0, u.health / u.maxHealth);
    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 1, y + s - 3, s - 2, 2);
    ctx.fillStyle = f > 0.5 ? '#40e040' : f > 0.25 ? '#e0d040' : '#e04040';
    ctx.fillRect(x + 1, y + s - 3, Math.round((s - 2) * f), 2);
  }
  private oneUnit(ctx: Ctx, client: Client, u: UnitEntity, x: number, y: number, w: number) {
    const gui = client.ui.gui, d = u.def();
    this.portrait(ctx, client, u, x, y, 26);
    gui.text(ctx, d.name, x + 30, y, '#ffffff');
    gui.text(ctx, `${Math.ceil(u.health)}/${u.maxHealth} health  ${d.damage} dmg${d.range ? `  range ${d.range}` : ''}`, x + 30, y + 10, '#c0c0c0');
    gui.text(ctx, u.task || 'Idle', x + 30, y + 20, '#ffe080');
    if (u.carry) gui.text(ctx, `Carrying ${u.carry} ${u.carryRes}`, x + 30, y + 30, '#a0e0ff');
    void w;
  }
  private manyUnits(ctx: Ctx, client: Client, us: UnitEntity[], x: number, y: number, w: number) {
    const s = 17, per = Math.max(1, Math.floor(w / (s + 1)));
    us.slice(0, per * 3).forEach((u, i) => {
      const px = x + (i % per) * (s + 1), py = y + Math.floor(i / per) * (s + 1);
      this.portrait(ctx, client, u, px, py, s);
      this.ctl.ui.push({ x: px, y: py, w: s, h: s, id: 'pick' + u.id, run: () => { this.ctl.sel = [u.id]; }, tip: [u.def().name, u.task] });
    });
  }
  private oneBuilding(ctx: Ctx, client: Client, b: BInfo, x: number, y: number, w: number) {
    const gui = client.ui.gui, def = BUILDINGS[b.type];
    const it = this.mc.itemByName(def.icon);
    ctx.fillStyle = teamHex(b.team);
    ctx.fillRect(x, y, 26, 26);
    ctx.fillStyle = '#202020';
    ctx.fillRect(x + 1, y + 1, 24, 24);
    if (it) client.ui.drawItem(ctx, { id: it.id, count: 1 }, x + 5, y + 5);
    gui.text(ctx, def.names[b.faction], x + 30, y, '#ffffff');
    gui.text(ctx, b.built ? `${b.hp}/${b.max} blocks standing` : `Under construction: ${Math.round(b.prog * 100)}%`, x + 30, y + 10, '#c0c0c0');
    if (b.owner !== this.ctl.me) { gui.text(ctx, `Belongs to ${b.owner === '#raiders' ? 'raiders' : b.owner}`, x + 30, y + 20, '#ff9090'); return; }
    if (!b.built) { gui.text(ctx, 'Workers build it: select them, right-click it.', x + 30, y + 20, '#ffe080'); return; }
    // the training queue
    let qx = x + 30;
    b.queue.forEach((q, i) => {
      const u = UNITS[q.u];
      const s = 18;
      ctx.fillStyle = '#303030';
      ctx.fillRect(qx, y + 20, s, s);
      const ic = this.mc.itemByName(u.held ?? (u.worker ? 'wooden_hoe' : 'bone'));
      if (ic) client.ui.drawItem(ctx, { id: ic.id, count: 1 }, qx + 1, y + 21);
      ctx.fillStyle = b.stalled && i === 0 ? '#e04040' : '#60c0ff';
      ctx.fillRect(qx, y + 20 + s - 2, Math.round(s * q.f), 2);
      this.ctl.ui.push({ x: qx, y: y + 20, w: s, h: s, id: 'q' + i, run: () => this.ctl.ch.toServer({ t: 'untrain', b: b.id, i }), tip: [`${u.name} (${Math.round(q.f * 100)}%)`, 'Click to cancel (refunds)'] });
      qx += s + 2;
    });
    if (!b.queue.length) gui.text(ctx, def.trains ? 'Nothing in training.' : def.desc, x + 30, y + 22, '#909090');
    else if (b.stalled) gui.text(ctx, 'Need houses', qx + 2, y + 25, '#ff8080');
    void w;
  }

  /** The hero view's strip: just the selection (if any) above the hotbar. */
  private heroBar(ctx: Ctx, client: Client, W: number, H: number) {
    const ctl = this.ctl, gui = client.ui.gui;
    const us = ctl.selected(client);
    const touch = this.mc.device.touch;
    // just under the top bar, clear of the chat and the hotbar
    const y = touch ? 32 : 20;
    if (!us.length) {
      if (!touch && ctl.feed.length === 0) gui.textCenter(ctx, 'Hero: WASD walks, the mouse fights and builds. Alt+click: command units.', W / 2, y, '#c0c0c0');
      return;
    }
    gui.textCenter(ctx, `${us.length} unit${us.length > 1 ? 's' : ''} selected: ${touch ? 'switch to God to order them' : 'Alt+right-click to order them'}`, W / 2, y, '#c0ffc0');
  }

  private hints(ctx: Ctx, client: Client, W: number, H: number) {
    const ctl = this.ctl, gui = client.ui.gui, touch = this.mc.device.touch;
    let line = '';
    const pl = ctl.placing;
    if (pl) {
      const name = BUILDINGS[pl.type].names[ctl.faction];
      line = pl.why ? `${name}: ${pl.why}` : touch ? `${name}: tap where it goes, then Build` : `${name}: click to build (Shift: more). R: turn. Right-click: cancel.`;
      if (touch) {
        const y = H - 80, cx = W / 2;
        this.button(ctx, client, { id: 'pl-rot', x: cx - 76, y, w: 48, h: 20, label: 'Turn', run: () => { pl.rot = (pl.rot + 1) & 3; ctl.ghostAt(client, W / 2, H / 2); pl.set = true; } });
        this.button(ctx, client, { id: 'pl-ok', x: cx - 24, y, w: 48, h: 20, label: 'Build', off: !pl.ok, run: () => ctl.place(false) });
        this.button(ctx, client, { id: 'pl-no', x: cx + 28, y, w: 48, h: 20, label: 'Cancel', run: () => { ctl.placing = null; } });
      }
    } else if (ctl.pending) {
      line = ctl.pending === 'rally' ? 'Choose the rally point' : ctl.pending === 'move' ? 'Choose where to move' : 'Choose a target or a place to attack-move to';
      if (touch) this.button(ctx, client, { id: 'pend-no', x: W / 2 - 24, y: H - 80, w: 48, h: 20, label: 'Cancel', run: () => { ctl.pending = null; } });
    } else if (ctl.mode === 'god' && ctl.st?.faction && !ctl.st.started) line = 'Place your town hall to begin';
    if (line) {
      const w = gui.font.width(line) + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(W / 2 - w / 2, 20, w, 12);
      gui.textCenter(ctx, line, W / 2, 22, pl && !pl.ok ? '#ff9090' : '#ffffa0');
    }
    if (touch && ctl.mode === 'god' && (ctl.sel.length || ctl.selB !== null) && !pl) {
      this.button(ctx, client, { id: 'desel', x: 2, y: H - 76, w: 54, h: 16, label: 'Deselect', run: () => { ctl.sel = []; ctl.selB = null; } });
    }
  }

  private factionPicker(ctx: Ctx, client: Client, W: number, H: number) {
    const ctl = this.ctl, gui = client.ui.gui;
    const pw = 220, ph = 92, x = Math.floor(W / 2 - pw / 2), y = Math.floor(H / 2 - ph / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x, y, pw, ph);
    ctl.panels.push({ x, y, w: pw, h: ph });
    gui.textCenter(ctx, 'Choose your side', W / 2, y + 6, '#ffffff');
    FACTIONS.forEach((f, i) => {
      const bx = x + 10 + i * 105;
      this.button(ctx, client, { id: 'f:' + f, x: bx, y: y + 22, w: 95, h: 44, label: FACTION_NAMES[f], run: () => ctl.ch.toServer({ t: 'faction', f }), tip: [FACTION_NAMES[f], f === 'villagers' ? 'Peasants, militia, knights and archers.' : 'Ghouls, zombies, creepers, skeletons and spiders.'] });
    });
    gui.textCenter(ctx, 'Your first town hall is free.', W / 2, y + 74, '#a0a0a0');
  }

  private helpPanel(ctx: Ctx, client: Client, W: number, H: number) {
    const gui = client.ui.gui;
    const touch = this.mc.device.touch;
    const lines = touch ? [
      '§eOverseer view',
      'Drag: look around.  Pinch: zoom and turn.',
      'Tap a unit: select. Tap it again: all of its kind.',
      'Hold and drag: select several.',
      'Tap the ground, a tree, ore, a building or an enemy',
      'with units selected: they go, gather, build or attack.',
      'The buttons bottom right are the selection\'s orders.',
      '§eHero view',
      'The pad walks your character. Tap: hit or use.',
      'Hold: mine. Drag sideways: turn the camera.',
    ] : [
      '§eOverseer view (no body: you command units)',
      'WASD / arrows / screen edge / middle-drag: pan.  Wheel: zoom.',
      'Z X: turn the camera.  Right-drag: turn freely.',
      'Left-click or drag: select.  Shift: add.  Double-click: all of a kind.',
      'Right-click: move, gather (trees, ore, crops), build, attack.',
      'Shift+right-click: queue orders.  Ctrl+1..9: group, 1..9: recall.',
      'Space: look at the selection.  ` : deselect.',
      'Command card: the letter keys on its buttons.',
      '§eHero view (Tab)',
      'WASD walks your character relative to the screen; it faces the',
      'pointer when you click. Left: hit and mine. Right: use and place.',
      'Alt+click / Alt+right-click: select and order units.  V: leave.',
    ];
    const w = Math.max(...lines.map((l) => gui.font.width(l))) + 12, h = lines.length * 10 + 10;
    const x = Math.floor(W / 2 - w / 2), y = Math.floor(H / 2 - h / 2) - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(x, y, w, h);
    this.ctl.panels.push({ x, y, w, h });
    lines.forEach((l, i) => gui.text(ctx, l, x + 6, y + 6 + i * 10, '#e0e0e0'));
  }

  private tooltipAt(ctx: Ctx, client: Client) {
    if (this.mc.device.touch) return;
    const m = this.ctl.mouse;
    for (let i = this.ctl.ui.length - 1; i >= 0; i--) {
      const r = this.ctl.ui[i];
      if (m.x >= r.x && m.y >= r.y && m.x < r.x + r.w && m.y < r.y + r.h) { if (r.tip?.length) client.ui.gui.tooltip(ctx, r.tip, m.x, m.y); return; }
    }
    // what the pointer is over in the world
    const h = this.ctl.hover;
    if (!h || this.ctl.mode !== 'god') return;
    const e = h.entity;
    if (e && isUnit(e)) client.ui.gui.tooltip(ctx, [`${e.def().name}${e.owner === this.ctl.me ? '' : e.owner === '#raiders' ? ' (raider)' : ` (${e.owner})`}`, e.task], m.x, m.y);
    else if (e) client.ui.gui.tooltip(ctx, [(e as unknown as { typeName?: string }).typeName ?? 'Creature'], m.x, m.y);
  }

  // ---------------------------------------------------------------------------------------------- minimap
  private colourOf(client: Client, id: number): string {
    let c = this.colours.get(id);
    if (c) return c;
    const mc = this.mc, d = mc.BLOCKS[id];
    let rgb = [110, 110, 110];
    const avg = d ? (client.renderer as unknown as { atlas: { average(n: string): number[] | undefined } }).atlas.average(mc.textureName(d.faces[3])) : undefined;
    if (avg) rgb = [avg[0], avg[1], avg[2]];
    const tint = (d as unknown as { tint?: string })?.tint;
    if (tint === 'grass' || tint === 'foliage' || tint === 'birch' || tint === 'spruce') rgb = [rgb[0] * 0.55, rgb[1] * 0.85, rgb[2] * 0.4];
    if (d?.name === 'water') rgb = [50, 80, 200];
    c = `rgb(${rgb.map((v) => Math.round(v)).join(',')})`;
    this.colours.set(id, c);
    return c;
  }
  private minimap(ctx: Ctx, client: Client, x: number, y: number, s: number) {
    const ctl = this.ctl, w = client.world!, now = performance.now();
    const R = 64; // blocks from the middle to the edge
    let m = this.mini;
    if (!m || now - m.at > 1000 || Math.hypot(m.cx - ctl.cam.x, m.cz - ctl.cam.z) > 8) {
      const cv = m?.canvas ?? document.createElement('canvas');
      cv.width = cv.height = 64;
      const g = cv.getContext('2d')!;
      const cx = Math.floor(ctl.cam.x), cz = Math.floor(ctl.cam.z);
      for (let py = 0; py < 64; py++) for (let px = 0; px < 64; px++) {
        const bx = cx - R + px * 2, bz = cz - R + py * 2;
        const ty = w.topSolidY(bx, bz);
        g.fillStyle = ty < 0 ? '#000000' : this.colourOf(client, w.getId(bx, ty, bz));
        g.fillRect(px, py, 1, 1);
      }
      m = this.mini = { canvas: cv, at: now, cx, cz, yaw: 0 };
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 1, y - 1, s + 2, s + 2);
    ctx.drawImage(m.canvas, x, y, s, s);
    const toMap = (wx: number, wz: number): [number, number] => [x + ((wx - (m!.cx - R)) / (2 * R)) * s, y + ((wz - (m!.cz - R)) / (2 * R)) * s];
    const inside = (p: [number, number]) => p[0] >= x && p[1] >= y && p[0] < x + s && p[1] < y + s;
    for (const b of ctl.buildings) {
      const [x0, z0, x1, z1] = rect(b);
      const a = toMap(x0, z0), c = toMap(x1 + 1, z1 + 1);
      if (!inside(a) && !inside(c)) continue;
      ctx.fillStyle = teamHex(b.team);
      ctx.fillRect(Math.max(x, a[0]), Math.max(y, a[1]), Math.max(1, c[0] - a[0]), Math.max(1, c[1] - a[1]));
    }
    for (const e of client.entities) {
      if (!(e instanceof this.mc.LivingEntity) || (e as unknown as { dead: boolean }).dead) continue;
      const u = isUnit(e);
      if (!u && !(e instanceof this.mc.Monster) && !(e instanceof this.mc.Player)) continue;
      const p = toMap(e.x, e.z);
      if (!inside(p)) continue;
      ctx.fillStyle = u ? teamHex((e as UnitEntity).team) : e instanceof this.mc.Player ? '#ffffff' : '#ff3030';
      ctx.fillRect(Math.floor(p[0]), Math.floor(p[1]), 1, 1);
    }
    // the view's footprint
    const c = toMap(ctl.cam.x, ctl.cam.z);
    const { fwd } = ctl.cam.axes();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1 / client.ui.gui.scale;
    const half = (ctl.cam.zoom * client.renderer.width) / client.renderer.height, deep = ctl.cam.zoom / Math.sin((ctl.cam.pitch * Math.PI) / 180);
    const k = s / (2 * R);
    const rx = -fwd.z, rz = fwd.x;
    const pts = [[-half, deep], [half, deep], [half, -deep], [-half, -deep]].map(([a, b]) => [c[0] + (rx * a + fwd.x * b) * k, c[1] + (rz * a + fwd.z * b) * k] as [number, number]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, s, s);
    ctx.clip();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    // a click on the map looks there
    ctl.ui.push({ x, y, w: s, h: s, id: 'minimap', run: () => {
      const mm = ctl.mouse;
      const wx = m!.cx - R + ((mm.x - x) / s) * 2 * R, wz = m!.cz - R + ((mm.y - y) / s) * 2 * R;
      ctl.cam.jump(wx, wz);
    }, tip: ['Minimap: click to look there'] });
  }
}

/** Small pixel icons for commands that have no fitting item. */
function glyph(ctx: Ctx, name: string, cx: number, cy: number, alpha: number) {
  cx = Math.round(cx); cy = Math.round(cy);
  ctx.globalAlpha = alpha;
  const r = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(cx + x, cy + y, w, h); };
  if (name === 'stop') {
    r(-5, -3, 10, 6, '#200000'); r(-3, -5, 6, 10, '#200000'); r(-4, -3, 8, 6, '#d02020'); r(-3, -4, 6, 8, '#d02020'); r(-3, -1, 6, 2, '#ffffff');
  } else if (name === 'flag') {
    r(-4, -6, 1, 12, '#8a6a3a'); r(-3, -6, 7, 5, '#3c6cff'); r(-3, -6, 7, 1, '#7aa0ff');
  } else if (name === 'person') {
    r(-2, -6, 4, 4, '#e0b090'); r(-3, -2, 6, 5, '#3c6cff'); r(-3, 3, 2, 3, '#404070'); r(1, 3, 2, 3, '#404070');
  }
  ctx.globalAlpha = 1;
}

/** Which entity is this (for messages). */
export function describe(e: Entity) {
  return isUnit(e) ? e.def().name : (e as unknown as { typeName?: string }).typeName ?? 'creature';
}
