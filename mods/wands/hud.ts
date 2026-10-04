// What a wand shows while you hold it (top left, like Noita): mana, the wait for the next cast or the recharge,
// and the wand's spells with the next one marked. Plus damage numbers over what your spells hit, and the target
// dummy's damage per second over the dummy.
import type { Client, Ctx, ItemStack } from '../sdk';
import { wandOf, type WandData } from './wand';
import type { SpellFx } from './fx';

/** The held wand as the server last described it. */
export interface WandState { s: number; m: number; mm: number; d: number; dt: number; r: number; rt: number; dk: number[]; inf: number }

export interface HudDeps {
  fx: SpellFx;
  state: () => WandState | null;
  spellItem: (id: string) => number | undefined;
  cfg: { hudStrip: boolean; damageNumbers: boolean };
  isDummy: (e: unknown) => boolean;
  touch: () => boolean;
}

const BAR_W = 64;

export function drawWandHud(ctx: Ctx, client: Client, W: number, H: number, partial: number, d: HudDeps) {
  void W;
  const p = client.player;
  if (!p || client.ui.screen) { drawWorldText(ctx, client, W, H, partial, d); return; }
  const held: ItemStack | null = p.inventory.held();
  const w = wandOf(held);
  const st = d.state();
  if (w && st && st.s === p.inventory.selected) {
    const touch = d.touch();
    // under the hearts on touch screens (they're along the top there)
    const x = 3, y = touch ? (p.creative ? 20 : 13) : 3;
    drawBars(ctx, client, x, y, st, w);
    if (d.cfg.hudStrip) drawStrip(ctx, client, x, y + 15, st, w, d);
  }
  drawWorldText(ctx, client, W, H, partial, d);
}

function drawBars(ctx: Ctx, client: Client, x: number, y: number, st: WandState, w: WandData) {
  const gui = client.ui.gui;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x - 1, y - 1, BAR_W + 32, 13);
  // mana
  const mf = st.inf ? 1 : Math.max(0, Math.min(1, st.m / Math.max(1, st.mm)));
  ctx.fillStyle = '#10183a';
  ctx.fillRect(x + 8, y + 1, BAR_W, 4);
  ctx.fillStyle = '#3a78ff';
  ctx.fillRect(x + 8, y + 1, Math.round(BAR_W * mf), 4);
  ctx.fillStyle = '#9cc4ff';
  ctx.fillRect(x + 8, y + 1, Math.round(BAR_W * mf), 1);
  manaIcon(ctx, x, y);
  gui.text(ctx, st.inf ? 'INF' : String(st.m), x + BAR_W + 11, y - 1, '#9cc4ff');
  // the wait: recharge (grey) or cast delay (orange)
  const reloading = st.r > 0;
  const f = reloading ? st.r / Math.max(1, st.rt) : st.d > 0 ? st.d / Math.max(1, st.dt) : 0;
  ctx.fillStyle = '#202020';
  ctx.fillRect(x + 8, y + 7, BAR_W, 3);
  ctx.fillStyle = reloading ? '#c0c0c0' : '#ff9a30';
  ctx.fillRect(x + 8, y + 7, Math.round(BAR_W * (1 - f)), 3);
  clockIcon(ctx, x, y + 6, reloading ? '#c0c0c0' : '#ff9a30');
  void w;
}

function manaIcon(ctx: Ctx, x: number, y: number) {
  ctx.fillStyle = '#3a78ff';
  ctx.fillRect(x + 2, y, 2, 1); ctx.fillRect(x + 1, y + 1, 4, 2); ctx.fillRect(x, y + 3, 6, 2); ctx.fillRect(x + 1, y + 5, 4, 1);
  ctx.fillStyle = '#c8e0ff';
  ctx.fillRect(x + 1, y + 3, 1, 1);
}
function clockIcon(ctx: Ctx, x: number, y: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x + 1, y, 4, 1); ctx.fillRect(x, y + 1, 1, 3); ctx.fillRect(x + 5, y + 1, 1, 3); ctx.fillRect(x + 1, y + 4, 4, 1);
  ctx.fillRect(x + 3, y + 1, 1, 2); ctx.fillRect(x + 3, y + 2, 1, 1);
}

/** The wand's spells, small: spent ones dim until the recharge, the next one underlined. */
function drawStrip(ctx: Ctx, client: Client, x: number, y: number, st: WandState, w: WandData, d: HudDeps) {
  const S = 9, max = Math.min(w.spells.length, Math.floor((client.ui.gui.w * 0.45) / S));
  const deck = new Set(st.dk), next = st.r > 0 ? -1 : st.dk[0] ?? -1;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x - 1, y - 1, max * S + 1, S + 2);
  const icons = (client as unknown as { icons: { get(id: number): HTMLCanvasElement } }).icons;
  for (let i = 0; i < max; i++) {
    const id = w.spells[i];
    const sx = x + i * S;
    ctx.fillStyle = 'rgba(60,60,80,0.6)';
    ctx.fillRect(sx, y, S - 1, S - 1);
    if (!id) continue;
    const item = d.spellItem(id);
    if (item === undefined) continue;
    // spent this round (until the recharge), or out of uses: dimmed
    const u = w.uses?.[i];
    ctx.globalAlpha = (deck.has(i) || st.r > 0) && u !== 0 ? 1 : 0.3;
    ctx.drawImage(icons.get(item), sx, y, S - 1, S - 1);
    ctx.globalAlpha = 1;
    if (u === 0) { ctx.fillStyle = '#ff4040'; ctx.fillRect(sx, y, S - 1, 1); }
    if (i === next) { ctx.fillStyle = '#ffffff'; ctx.fillRect(sx, y + S - 1, S - 1, 1); }
  }
  if (w.spells.length > max) client.ui.gui.text(ctx, '..', x + max * S + 1, y, '#a0a0a0');
}

/** Project a world point to GUI units (null if behind the camera). */
export function project(client: Client, W: number, H: number, x: number, y: number, z: number): [number, number] | null {
  const r = client.renderer as unknown as { viewProj: Float32Array; cam: { x: number; y: number; z: number } };
  const m = r.viewProj, X = x - r.cam.x, Y = y - r.cam.y, Z = z - r.cam.z;
  const cw = m[3] * X + m[7] * Y + m[11] * Z + m[15];
  if (cw <= 0.05) return null;
  const cx = (m[0] * X + m[4] * Y + m[8] * Z + m[12]) / cw, cy = (m[1] * X + m[5] * Y + m[9] * Z + m[13]) / cw;
  if (cx < -1.2 || cx > 1.2 || cy < -1.2 || cy > 1.2) return null;
  return [(cx * 0.5 + 0.5) * W, (1 - (cy * 0.5 + 0.5)) * H];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Damage numbers, and the dummies' damage per second. */
function drawWorldText(ctx: Ctx, client: Client, W: number, H: number, partial: number, d: HudDeps) {
  const gui = client.ui.gui;
  if (d.cfg.damageNumbers) {
    for (const n of d.fx.nums) {
      const f = (n.age + partial) / 28;
      const at = project(client, W, H, n.x + n.dx * f, n.y + f * 0.9, n.z);
      if (!at) continue;
      const t = (n.crit ? '!' : '') + fmt(n.a);
      ctx.globalAlpha = Math.max(0, Math.min(1, (1 - f) * 2));
      gui.text(ctx, t, Math.round(at[0] - gui.font.width(t) / 2), Math.round(at[1]), n.crit ? '#ffd040' : '#ffffff');
      ctx.globalAlpha = 1;
    }
  }
  const p = client.player;
  if (!p) return;
  // the dummy nearest the middle of the view gets the full readout, others just their damage per second
  let focus: unknown = null, fd = 70;
  for (const e of client.entities) {
    if (!d.isDummy(e) || !(e as unknown as { total: number }).total) continue;
    const at = project(client, W, H, e.x, e.y + 1, e.z);
    const dd = at ? Math.hypot(at[0] - W / 2, at[1] - H / 2) : Infinity;
    if (dd < fd) { fd = dd; focus = e; }
  }
  for (const e of client.entities) {
    if (!d.isDummy(e)) continue;
    const dist = Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z);
    if (dist > 20) continue;
    const dm = e as unknown as { dps: number; total: number; peak: number };
    if (!dm.total) continue;
    const at = project(client, W, H, e.lerpX(partial), e.lerpY(partial) + e.height + 0.55, e.lerpZ(partial));
    if (!at) continue;
    const lines: [string, string][] = e === focus ? [[`${fmt(dm.dps)}/s`, '#ffffff'], [`total ${fmt(dm.total)}`, '#c0c0c0'], [`peak ${fmt(dm.peak)}/s`, '#ffd060']] : [[`${fmt(dm.dps)}/s`, '#d0d0d0']];
    let y = Math.round(at[1]) - lines.length * 9 + 5;
    for (const [t, c] of lines) {
      const tw = gui.font.width(t);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(Math.round(at[0] - tw / 2) - 1, y - 1, tw + 2, 9);
      gui.text(ctx, t, Math.round(at[0] - tw / 2), y, c);
      y += 9;
    }
  }
}
