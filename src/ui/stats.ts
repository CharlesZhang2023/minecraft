// The statistics screen (game menu): general counters (time played, distances by how you moved, jumps, damage,
// deaths, kills...), per-item counts (mined, crafted, used, picked up, dropped) and per-mob (killed, killed by).
// The server keeps them; opening the screen asks it for the current numbers.
import { Screen } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { itemByName, stack } from '../game/items';
import { blockByName } from '../world/blocks';

type Tab = 'general' | 'items' | 'mobs';
const GENERAL: [string, string, 'time' | 'cm' | 'dmg' | 'n'][] = [
  ['play_time', 'Time Played', 'time'], ['time_since_death', 'Time Since Last Death', 'time'], ['walk_one_cm', 'Distance Walked', 'cm'],
  ['sprint_one_cm', 'Distance Sprinted', 'cm'], ['crouch_one_cm', 'Distance Crouched', 'cm'], ['swim_one_cm', 'Distance Swum', 'cm'],
  ['fall_one_cm', 'Distance Fallen', 'cm'], ['climb_one_cm', 'Distance Climbed', 'cm'], ['fly_one_cm', 'Distance Flown', 'cm'],
  ['aviate_one_cm', 'Distance by Elytra', 'cm'], ['boat_one_cm', 'Distance by Boat', 'cm'], ['minecart_one_cm', 'Distance by Minecart', 'cm'],
  ['horse_one_cm', 'Distance by Horse', 'cm'], ['pig_one_cm', 'Distance by Pig', 'cm'], ['strider_one_cm', 'Distance by Strider', 'cm'],
  ['jump', 'Jumps', 'n'], ['damage_dealt', 'Damage Dealt', 'dmg'], ['damage_taken', 'Damage Taken', 'dmg'], ['deaths', 'Number of Deaths', 'n'],
  ['mob_kills', 'Mob Kills', 'n'], ['player_kills', 'Player Kills', 'n'], ['animals_bred', 'Animals Bred', 'n'], ['animals_tamed', 'Animals Tamed', 'n'],
  ['fish_caught', 'Fish Caught', 'n'], ['traded_with_villager', 'Traded with Villagers', 'n'], ['enchant_item', 'Items Enchanted', 'n'],
  ['brew_potion', 'Potions Brewed', 'n'], ['eat_cake_slice', 'Cake Slices Eaten', 'n'], ['seeds_planted', 'Seeds Planted', 'n'],
  ['shield_blocks', 'Projectiles Deflected', 'n'], ['totems_used', 'Totems Used', 'n'],
];
const COLS = ['mined', 'crafted', 'used', 'picked_up', 'dropped'] as const;

export class StatsScreen extends Screen {
  tab: Tab = 'general';
  scroll = 0;
  constructor(ui: UI, private parent: Screen | null) { super(ui); }
  override init() { (this.game as unknown as { conn?: { send(m: unknown): void } }).conn?.send({ t: 'stats' }); }
  private data(): Record<string, number> { return (this.game as unknown as { statsData?: Record<string, number> }).statsData ?? {}; }
  private rows(): string[][] {
    const s = this.data();
    if (this.tab === 'general') return GENERAL.map(([k, name, kind]) => [name, fmt(s[k] ?? 0, kind)]);
    if (this.tab === 'mobs') {
      const types = new Set(Object.keys(s).filter((k) => k.startsWith('killed:') || k.startsWith('killed_by:')).map((k) => k.slice(k.indexOf(':') + 1)));
      return [...types].sort().map((t) => [t, `${s['killed:' + t] ?? 0}`, `${s['killed_by:' + t] ?? 0}`]);
    }
    const names = new Set(Object.keys(s).filter((k) => COLS.some((c) => k.startsWith(c + ':'))).map((k) => k.slice(k.indexOf(':') + 1)));
    return [...names].sort().map((n) => [n, ...COLS.map((c) => `${s[c + ':' + n] ?? ''}`)]);
  }
  override render(ctx: Ctx, mx: number, my: number) {
    this.backgroundGradient(ctx);
    const g = this.gui, W = g.w, H = g.h;
    g.textCenter(ctx, 'Statistics', W / 2, 12);
    const tabs: [Tab, string][] = [['general', 'General'], ['items', 'Items'], ['mobs', 'Mobs']];
    tabs.forEach(([t, name], i) => {
      const x = W / 2 - 150 + i * 102, y = 26, hover = mx >= x && my >= y && mx < x + 98 && my < y + 20;
      g.button(ctx, x, y, 98, 20, name, hover, t !== this.tab);
    });
    const top = 54, bottom = H - 34, rowH = this.tab === 'items' ? 18 : 11;
    const rows = this.rows();
    const fit = Math.floor((bottom - top) / rowH);
    this.scroll = Math.max(0, Math.min(this.scroll, rows.length - fit));
    ctx.save(); ctx.beginPath(); ctx.rect(0, top - 2, W, bottom - top + 2); ctx.clip();
    if (this.tab === 'items') {
      const heads = ['Mined', 'Crafted', 'Used', 'Picked Up', 'Dropped'];
      heads.forEach((h, i) => g.text(ctx, h, W / 2 - 60 + i * 44, top - 12, '#c0c0c0'));
    }
    if (this.tab === 'mobs') { g.text(ctx, 'Killed', W / 2 + 30, top - 12, '#c0c0c0'); g.text(ctx, 'Killed By', W / 2 + 90, top - 12, '#c0c0c0'); }
    rows.slice(this.scroll, this.scroll + fit).forEach((r, i) => {
      const y = top + i * rowH;
      if (i % 2) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(W / 2 - 150, y - 1, 300, rowH); }
      if (this.tab === 'general') { g.text(ctx, r[0], W / 2 - 140, y); g.text(ctx, r[1], W / 2 + 140 - g.font.width(r[1]), y); }
      else if (this.tab === 'mobs') { g.text(ctx, r[0], W / 2 - 140, y); g.text(ctx, r[1], W / 2 + 30, y); g.text(ctx, r[2], W / 2 + 90, y); }
      else {
        const id = itemByName(r[0])?.id ?? blockByName(r[0])?.id;
        if (id !== undefined) this.ui.drawItem(ctx, stack(id), W / 2 - 145, y);
        r.slice(1).forEach((v, k) => g.text(ctx, v, W / 2 - 60 + k * 44, y + 4));
      }
    });
    ctx.restore();
    if (!rows.length) g.textCenter(ctx, this.tab === 'general' ? 'Loading...' : 'Nothing yet', W / 2, top + 20, '#a0a0a0');
    const done = { x: W / 2 - 100, y: H - 26, w: 200, h: 20 };
    g.button(ctx, done.x, done.y, done.w, done.h, 'Done', mx >= done.x && my >= done.y && mx < done.x + done.w && my < done.y + done.h, true);
    super.render(ctx, mx, my);
  }
  override mouseDown(mx: number, my: number, button: number): boolean {
    const W = this.gui.w, H = this.gui.h;
    const tabs: Tab[] = ['general', 'items', 'mobs'];
    for (let i = 0; i < 3; i++) { const x = W / 2 - 150 + i * 102; if (mx >= x && my >= 26 && mx < x + 98 && my < 46) { this.tab = tabs[i]; this.scroll = 0; this.game.audio.play('click', null, 0.3, 1); return true; } }
    if (mx >= W / 2 - 100 && my >= H - 26 && mx < W / 2 + 100 && my < H - 6) { this.close(); return true; }
    return super.mouseDown(mx, my, button);
  }
  override wheel(d: number) { this.scroll += d > 0 ? 3 : -3; }
  override close() { this.ui.open(this.parent); }
}
function fmt(v: number, kind: 'time' | 'cm' | 'dmg' | 'n'): string {
  if (kind === 'time') {
    const s = v / 20;
    return s >= 86400 ? `${(s / 86400).toFixed(2)} d` : s >= 3600 ? `${(s / 3600).toFixed(2)} h` : s >= 60 ? `${(s / 60).toFixed(2)} min` : `${s.toFixed(1)} s`;
  }
  if (kind === 'cm') return v >= 100000 ? `${(v / 100000).toFixed(2)} km` : `${(v / 100).toFixed(2)} m`;
  if (kind === 'dmg') return `${(v / 20).toFixed(1)} hearts`;
  return String(v);
}
