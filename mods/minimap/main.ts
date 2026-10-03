// Minimap: a client-only mod (environment "client"): it only draws, so it works in any game, whether or not the
// host has it. Shows a HUD hook, a key binding that the settings page can rebind, and a generated settings page.
import type { ModContext, Client } from '../sdk';

export function client(mod: ModContext) {
  const cfg = mod.config({
    shown: { type: 'boolean', default: true, label: 'Show Map' },
    size: { type: 'number', default: 80, min: 48, max: 128, step: 8, label: 'Size', description: 'Width of the map in GUI pixels' },
    zoom: { type: 'enum', default: '1', options: ['1', '2', '4'], labels: ['Far', 'Normal', 'Close'], label: 'Zoom' },
    corner: { type: 'enum', default: 'right', options: ['right', 'left'], labels: ['Top Right', 'Top Left'], label: 'Corner' },
    round: { type: 'boolean', default: false, label: 'Round' },
    coords: { type: 'boolean', default: true, label: 'Coordinates' },
    toggleKey: { type: 'key', default: 'KeyM', label: 'Toggle Key' },
  });
  // the binding's name matches the setting, so the settings page rebinds it
  mod.client.keybind('toggleKey', 'KeyM', () => { cfg.shown = !cfg.shown; });

  const { BLOCKS } = mod.mc;
  const colors = new Map<number, [number, number, number]>();
  /** A block's colour on the map: its top texture's average, tinted like the world (grass, leaves, water). */
  const colorOf = (client: Client, id: number): [number, number, number] => {
    let c = colors.get(id);
    if (c) return c;
    const def = BLOCKS[id];
    if (def.fluid) c = def.name === 'water' ? [52, 92, 196] : [210, 92, 20];
    else {
      const name = mod.mc.textureName(def.faces[3]);
      const a = client.renderer.atlas.average(name) ?? [128, 128, 128, 255];
      c = [a[0], a[1], a[2]];
      const tint = def.tint === 'grass' ? [124, 189, 107] : def.tint === 'foliage' ? [72, 181, 24] : def.tint === 'spruce' ? [97, 153, 97] : def.tint === 'birch' ? [128, 167, 85] : null;
      if (tint) c = [c[0] * tint[0] / 255, c[1] * tint[1] / 255, c[2] * tint[2] / 255];
    }
    colors.set(id, c);
    return c;
  };

  let canvas: HTMLCanvasElement | null = null;
  let last = -100, lastKey = '';
  /** Redraw the map image (a few times a second): one pixel per `step` blocks around the player. */
  const redraw = (client: Client, n: number, step: number) => {
    const w = client.world!, p = client.player!;
    canvas ??= document.createElement('canvas');
    if (canvas.width !== n) { canvas.width = canvas.height = n; }
    const g = canvas.getContext('2d')!;
    const img = g.createImageData(n, n);
    const px = Math.floor(p.x), pz = Math.floor(p.z);
    const heights = new Int16Array(n + 1);
    for (let j = -1; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = px + (i - n / 2) * step, z = pz + (j - n / 2) * step;
        const c = w.chunkAt(x, z);
        let y = -1, id = 0;
        if (c?.heightmap) {
          y = c.heightmap[(z & 15) * 16 + (x & 15)];
          id = c.blocks[(x & 15) | ((z & 15) << 4) | (y << 8)] & 0xfff;
        }
        if (j < 0) { heights[i] = y; continue; }
        const o = (j * n + i) * 4;
        if (y < 0) { img.data[o + 3] = 0; heights[i] = y; continue; }
        const col = colorOf(client, id);
        // light from the north-west like vanilla maps: higher than the row above = brighter
        const d = heights[i] < 0 ? 0 : Math.sign(y - heights[i]);
        const k = d > 0 ? 1.1 : d < 0 ? 0.8 : 0.95;
        img.data[o] = Math.min(255, col[0] * k); img.data[o + 1] = Math.min(255, col[1] * k); img.data[o + 2] = Math.min(255, col[2] * k); img.data[o + 3] = 255;
        heights[i] = y;
      }
    }
    g.putImageData(img, 0, 0);
  };

  mod.on('hudRender', ({ ctx, client, width }) => {
    const p = client.player;
    if (!cfg.shown || !p || !client.world || client.showDebug) return;
    // Far: 2 blocks a pixel; Normal: 1; Close: 1 block per 2 pixels
    const size = cfg.size, step = cfg.zoom === '1' ? 2 : 1, n = cfg.zoom === '4' ? size / 2 : size;
    const key = `${n}:${step}`;
    if (client.ticks - last >= 5 || key !== lastKey) { redraw(client, n, step); last = client.ticks; lastKey = key; }
    const x = cfg.corner === 'left' ? 4 : width - size - 4, y = 4;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    if (cfg.round) { ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2 + 2, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip(); }
    else ctx.fillRect(x - 2, y - 2, size + 4, size + 4);
    ctx.imageSmoothingEnabled = false;
    if (canvas) ctx.drawImage(canvas, x, y, size, size);
    ctx.restore();
    // the player: an arrow pointing where they look
    ctx.save();
    ctx.translate(x + size / 2, y + size / 2);
    ctx.rotate(((p.yaw + 180) * Math.PI) / 180);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(3, 3); ctx.lineTo(0, 1.5); ctx.lineTo(-3, 3); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    client.gui.text(ctx, 'N', x + size / 2 - 2, y + 1, '#ff5555');
    if (cfg.coords) client.gui.textCenter(ctx, `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`, x + size / 2, y + size + 4, '#ffffff');
  });
}
