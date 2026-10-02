// Status effect icons: HUD row (top right) and the inventory-side list.
import { device } from '../game/device';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { EFFECTS, ROMAN, formatDuration } from '../game/potiondata';
import type { ActiveEffect } from '../entity/living';

// 9x9 glyphs: x = effect colour, h = highlight, o = outline, w = white, k = black
const GLYPHS: Record<string, string[]> = {
  speed: ['.........', 'oo..oo...', '.xo..xo..', '..xo..xo.', '...xo..xo', '..xo..xo.', '.xo..xo..', 'oo..oo...', '.........'],
  slowness: ['...ooo...', '..oxxxo..', '.oxhxxxo.', '.oxxoxxo.', '.oxxxoxo.', '..oxxxo..', 'ooooooooo', 'oxxxxxxxo', 'ooooooooo'],
  haste: ['.ooooooo.', 'oxxxxxxxo', '.oo.o.oo.', '....o....', '....o....', '....o....', '....o....', '....o....', '....o....'],
  strength: ['.......oo', '......oho', '.....oho.', '....oho..', '.o.oho...', '..ooo....', '..oo.....', '.o..o....', 'o........'],
  jump_boost: ['....o....', '...oxo...', '..oxhxo..', '.oxxxxxo.', 'ooooxoooo', '...oxo...', '...oxo...', '...oxo...', '...ooo...'],
  regeneration: ['.oo...oo.', 'oxxo.oxxo', 'oxhxoxxxo', 'oxxxxxxxo', 'oxxxxxxxo', '.oxxxxxo.', '..oxxxo..', '...oxo...', '....o....'],
  resistance: ['ooooooooo', 'oxxxxxxxo', 'oxhhxxxxo', 'oxhxxxxxo', 'oxxxxxxxo', '.oxxxxxo.', '.oxxxxxo.', '..oxxxo..', '...ooo...'],
  fire_resistance: ['....o....', '...oxo...', '..oxxo...', '..oxhxo..', '.oxxhxxo.', '.oxhhhxo.', '.oxhwhxo.', '..oxxxo..', '...ooo...'],
  water_breathing: ['..ooooo..', '.oxxxxxo.', 'oxwwxxxxo', 'oxwxxxxxo', 'oxxxxxxxo', 'oxxxxxxxo', 'oxxxxxxxo', '.oxxxxxo.', '..ooooo..'],
  invisibility: ['.........', '..ooooo..', '.oxxxxxo.', 'oxxkkkxxo', 'oxxkwkxxo', 'oxxkkkxxo', '.oxxxxxo.', '..ooooo..', '.........'],
  night_vision: ['.........', '..ooooo..', '.owwwwwo.', 'owwxxxwwo', 'owwxkxwwo', 'owwxxxwwo', '.owwwwwo.', '..ooooo..', '.........'],
  hunger: ['.....oo..', '....ohho.', '...oxxho.', '..oxxxxo.', '.oxxxxxo.', 'oxxxxxo..', 'owwxxo...', 'owwoo....', '.oo......'],
  weakness: ['.......oo', '......oxo', '.....oxo.', '....oxo..', '.........', '..oxo....', '.oxo.....', 'oo.o.....', '.........'],
  poison: ['....o....', '....o....', '...oxo...', '...oxo...', '..oxhxo..', '.oxhxxxo.', '.oxxxxxo.', '..oxxxo..', '...ooo...'],
  absorption: ['.oo...oo.', 'oxxo.oxxo', 'oxhxoxxxo', 'oxxxxxxxo', 'oxxxxxxxo', '.oxxxxxo.', '..oxxxo..', '...oxo...', '....o....'],
};

const cache = new Map<string, HTMLCanvasElement>();
const hex = (c: number, f = 1) => '#' + [c >> 16, (c >> 8) & 255, c & 255].map((v) => Math.min(255, Math.round(v * f)).toString(16).padStart(2, '0')).join('');

export function effectIcon(id: string): HTMLCanvasElement {
  let c = cache.get(id);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 9;
  const ctx = c.getContext('2d')!;
  const def = EFFECTS[id];
  const col = id === 'absorption' ? 0xf0c020 : def?.color ?? 0xffffff;
  const pal: Record<string, string> = { x: hex(col), h: hex(col, 1.6), o: hex(col, 0.35), w: '#ffffff', k: '#101010' };
  (GLYPHS[id] ?? GLYPHS.speed).forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const p = pal[row[x]];
      if (!p) continue;
      ctx.fillStyle = p;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  cache.set(id, c);
  return c;
}

const sorted = (list: Iterable<ActiveEffect>) => [...list].sort((a, b) => Number(EFFECTS[a.id].bad) - Number(EFFECTS[b.id].bad) || b.dur - a.dur);

/** 1.9-style icons in the top right corner: beneficial row first, harmful row below. */
export function drawEffectsHud(ctx: Ctx, ui: UI) {
  const p = ui.game.player;
  if (!p || !p.effects.size) return;
  const gui = ui.gui;
  let good = 0, bad = 0;
  for (const e of sorted(p.effects.values())) {
    const harmful = EFFECTS[e.id].bad;
    // touch screens keep hunger and air along the top right
    const top = device.touch ? 22 : 1;
    const x = gui.w - 25 * (harmful ? ++bad : ++good), y = top + (harmful ? 26 : 0);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, 24, 24);
    ctx.fillStyle = harmful ? '#6a2020' : '#3a4a6a';
    ctx.fillRect(x, y, 24, 1); ctx.fillRect(x, y + 23, 24, 1); ctx.fillRect(x, y, 1, 24); ctx.fillRect(x + 23, y, 1, 24);
    let a = 1;
    if (e.dur < 200) a = Math.max(0, Math.min(1, e.dur / 200 + Math.cos((e.dur * Math.PI) / 5) * 0.25));
    ctx.globalAlpha = a;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(effectIcon(e.id), x + 3, y + 3, 18, 18);
    ctx.globalAlpha = 1;
  }
}

/** 1.8 inventory-side list: icon, name + level, remaining time. */
export function drawEffectList(ctx: Ctx, ui: UI, x: number, y: number) {
  const p = ui.game.player;
  if (!p || !p.effects.size) return;
  const gui = ui.gui;
  const list = sorted(p.effects.values());
  const step = list.length > 5 ? Math.floor(132 / (list.length - 1)) : 33;
  list.forEach((e, i) => {
    const yy = y + i * step;
    gui.panel(ctx, x, yy, 120, 32);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(effectIcon(e.id), x + 6, yy + 7, 18, 18);
    const name = EFFECTS[e.id].name + (e.amp > 0 ? ' ' + (ROMAN[e.amp + 1] ?? e.amp + 1) : '');
    gui.text(ctx, name, x + 28, yy + 6, '#FFFFFF');
    gui.text(ctx, e.dur > 32767 ? '**:**' : formatDuration(e.dur), x + 28, yy + 16, '#7F7F7F');
  });
}
