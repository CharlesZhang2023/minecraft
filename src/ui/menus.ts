// Menu screens: title, world selection/creation, loading, pause, options, death, chat, sleep.
import { session } from '../mod/hooks';
import { device } from '../game/device';
import { Screen, Button, Slider, TextField } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { Storage, WorldMeta } from '../game/storage';
import { hashString } from '../noise';
import { getTexture } from '../render/textures';
import { MultiplayerScreen, HostScreen } from './multiplayer';
import { GENERATOR_VERSION } from '../world/worldgen';
import { SkinScreen } from './skinscreen';

const SPLASHES = [
  'Now in JavaScript!', 'Also try Terraria!', '100% procedural!', 'Punching trees!', 'Blocky!', 'Made with WebGL 2!', 'Now with caves!',
  'Creepers, aw man!', 'Diamonds are rare!', 'No textures were harmed!', 'Pixel perfect!', 'Synthesized sounds!', 'Works offline!',
  '20 ticks per second!', 'Infinite worlds!', 'Watch out for skeletons!', 'Sheep go baa!', 'Zombies burn at dawn!', 'Look behind you!',
  'Contains 0 bytes of original assets!', 'Fancy leaves!', 'Smooth lighting!', 'Also try the Nether... someday!', 'Kind of like the real thing!',
];

// ------------------------------------------------------------------ logo
let logoCanvas: HTMLCanvasElement | null = null;
const LOGO_FONT: Record<string, string[]> = {
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  E: ['####', '#...', '###.', '#...', '####'],
  C: ['.###', '#...', '#...', '#...', '.###'],
  R: ['###.', '#..#', '###.', '#.#.', '#..#'],
  A: ['.##.', '#..#', '####', '#..#', '#..#'],
  F: ['####', '#...', '###.', '#...', '#...'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
};
function makeLogo(): HTMLCanvasElement {
  const word = 'MINECRAFT';
  const cell = 8; // pixels per logo cell (texture resolution)
  let cols = 0;
  for (const ch of word) cols += LOGO_FONT[ch][0].length + 1;
  cols -= 1;
  const depth = 3;
  const c = document.createElement('canvas');
  c.width = cols * cell + depth * 2 + 4;
  c.height = 5 * cell + depth * 2 + 4;
  const ctx = c.getContext('2d')!;
  const stone = getTexture('stone');
  const px = (x: number, y: number) => {
    const i = (((y % 16) + 16) % 16 * 16 + (((x % 16) + 16) % 16)) * 4;
    return [stone[i], stone[i + 1], stone[i + 2]];
  };
  let ox = 2;
  const cells: [number, number][] = [];
  for (const ch of word) {
    const g = LOGO_FONT[ch];
    for (let y = 0; y < 5; y++) for (let x = 0; x < g[y].length; x++) if (g[y][x] === '#') cells.push([ox / cell + x, y]);
    ox += (g[0].length + 1) * cell;
  }
  const filled = new Set(cells.map(([x, y]) => x + ',' + y));
  // extrusion (dark sides)
  for (let d = depth; d >= 1; d--)
    for (const [x, y] of cells) {
      ctx.fillStyle = d === depth ? '#1a1a1a' : '#3a3a3a';
      ctx.fillRect(x * cell + d + 1, y * cell + d + 2, cell, cell);
    }
  // faces with stone texture and bevel
  for (const [x, y] of cells) {
    for (let yy = 0; yy < cell; yy++)
      for (let xx = 0; xx < cell; xx++) {
        const [r, g, b] = px(x * cell + xx, y * cell + yy);
        let f = 1.15;
        const top = yy === 0 && !filled.has(x + ',' + (y - 1));
        const left = xx === 0 && !filled.has(x - 1 + ',' + y);
        const bottom = yy === cell - 1 && !filled.has(x + ',' + (y + 1));
        const right = xx === cell - 1 && !filled.has(x + 1 + ',' + y);
        if (top || left) f = 1.6;
        if (bottom || right) f = 0.7;
        ctx.fillStyle = `rgb(${Math.min(255, r * f)},${Math.min(255, g * f)},${Math.min(255, b * f)})`;
        ctx.fillRect(x * cell + xx + 1, y * cell + yy + 2, 1, 1);
      }
  }
  return c;
}

// ------------------------------------------------------------------ title
const HANGER = [
  '.....##.....',
  '....#..#....',
  '.......#....',
  '......#.....',
  '.....##.....',
  '...##..##...',
  '.##......##.',
  '############',
];

/** A square button with a little picture instead of words. */
class IconButton extends Button {
  constructor(ui: UI, x: number, y: number, w: number, h: number, private icon: string[], onClick: () => void) { super(ui, x, y, w, h, '', onClick); }
  override render(ctx: Ctx, mx: number, my: number) {
    super.render(ctx, mx, my);
    const ox = Math.round(this.x + this.w / 2 - this.icon[0].length / 2), oy = Math.round(this.y + this.h / 2 - this.icon.length / 2);
    for (const [color, d] of [['#3f3f3f', 1], ['#FFFFFF', 0]] as const) {
      ctx.fillStyle = color;
      this.icon.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') ctx.fillRect(ox + x + d, oy + y + d, 1, 1); });
    }
  }
}

export class TitleScreen extends Screen {
  splash = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
  override darkens = false;
  private started = performance.now();
  override init() {
    const W = this.gui.w, H = this.gui.h;
    const x = W / 2 - 100, y = H / 4 + 48;
    this.widgets = [
      new Button(this.ui, x, y, 200, 20, 'Singleplayer', () => this.ui.open(new SelectWorldScreen(this.ui))),
      new Button(this.ui, x, y + 24, 200, 20, 'Multiplayer', () => this.ui.open(new MultiplayerScreen(this.ui, this))),
      new Button(this.ui, x, y + 48, 98, 20, 'Quick Play', () => quickPlay(this.ui)),
      new Button(this.ui, x + 102, y + 48, 98, 20, 'Mods', () => openMods(this.ui, this)),
      new Button(this.ui, x, y + 84, 98, 20, 'Options...', () => this.ui.open(new OptionsScreen(this.ui, this))),
      new Button(this.ui, x + 102, y + 84, 98, 20, 'Controls', () => this.ui.open(new ControlsScreen(this.ui, this))),
      // the Pocket Edition's coat hanger: skins
      new IconButton(this.ui, x - 24, y + 84, 20, 20, HANGER, () => this.ui.open(new SkinScreen(this.ui, this))),
    ];
    if (!this.game.world) startPanorama(this.ui);
  }
  override render(ctx: Ctx, mx: number, my: number) {
    const W = this.gui.w, H = this.gui.h;
    if (!this.game.world) this.gui.dirtBackground(ctx);
    else {
      // soft vignette over the panorama
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H);
      g.addColorStop(0, 'rgba(0,0,0,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (!logoCanvas) logoCanvas = makeLogo();
    const lw = 274, lh = Math.round((logoCanvas.height / logoCanvas.width) * lw);
    ctx.drawImage(logoCanvas, Math.round(W / 2 - lw / 2), 30, lw, lh);
    ctx.save();
    const t = (performance.now() - this.started) / 1000;
    const s = (1.8 - Math.abs(Math.sin((t % 1) * Math.PI * 2) * 0.1)) * 100 / (this.gui.font.width(this.splash) + 32);
    ctx.translate(W / 2 + 110, 30 + lh - 8);
    ctx.rotate(-20 * Math.PI / 180);
    ctx.scale(s, s);
    this.gui.font.drawCentered(ctx, this.splash, 0, -4, '#FFFF00');
    ctx.restore();
    this.gui.text(ctx, 'Minecraft Web Edition 1.0', 2, H - 10, '#FFFFFF');
    const note = 'Fan-made recreation. Not an official Minecraft product.';
    this.gui.text(ctx, note, W - this.gui.font.width(note) - 2, H - 10, '#FFFFFF');
    super.render(ctx, mx, my);
    if (!this.game.loadProgress() && this.game.world) this.gui.textCenter(ctx, '', W / 2, H - 30);
  }
  override key(e: KeyboardEvent) {
    if (e.code === 'Escape') return true;
    return super.key(e);
  }
}

async function startPanorama(ui: UI) {
  const g = ui.game;
  if (g.world || (ui as unknown as { _pano?: boolean })._pano) return;
  (ui as unknown as { _pano?: boolean })._pano = true;
  const seeds = [8675309, 42, 1337, 20090517];
  const seed = seeds[Math.floor(Math.random() * seeds.length)];
  await g.openWorld({ id: '__panorama__', name: 'panorama', seed, seedText: String(seed), gameMode: 1, hardcore: false, created: 0, lastPlayed: 0, time: 3000 + Math.floor(Math.random() * 6000) }, true);
  (ui as unknown as { _pano?: boolean })._pano = false;
}

async function quickPlay(ui: UI) {
  const now = Date.now();
  const seed = (Math.random() * 2 ** 31) | 0;
  const meta: WorldMeta = { id: 'w' + now.toString(36), name: 'New World', seed, seedText: String(seed), gameMode: 0, hardcore: false, created: now, lastPlayed: now, time: 0, generatorVersion: GENERATOR_VERSION };
  await Storage.saveWorld(meta);
  await playWorld(ui, meta);
}

/** The Mods screen (loaded on demand: the mod loader pulls in the whole game). */
export function openMods(ui: UI, parent: Screen) {
  import('./mods').then((m) => ui.open(new m.ModsScreen(ui, parent)));
}

export async function playWorld(ui: UI, meta: WorldMeta) {
  // a world saved with mods that aren't installed / enabled now: their blocks and items would show as missing
  const missing = session.missingFor(meta);
  if (missing.length && !(await new Promise<boolean>((resolve) => ui.open(new ConfirmScreen(ui, 'This world was played with mods you don\'t have enabled:',
    `${missing.join(', ')}. Their blocks and items will show as missing until you enable them again.`, 'Play Anyway', resolve))))) {
    ui.open(new SelectWorldScreen(ui));
    return;
  }
  const loading = new LoadingScreen(ui, 'Loading world');
  ui.open(loading);
  meta.lastPlayed = Date.now();
  await ui.game.openWorld(meta, false);
  loading.ready = true;
}

// ------------------------------------------------------------------ world selection
export class SelectWorldScreen extends Screen {
  override touchScrolls = true;
  worlds: WorldMeta[] = [];
  selected = -1;
  scroll = 0;
  private lastClick = 0;
  private play!: Button;
  private del!: Button;
  override init() {
    const W = this.gui.w, H = this.gui.h;
    Storage.listWorlds().then((w) => { this.worlds = w; if (w.length && this.selected < 0) this.selected = 0; this.update(); });
    this.play = new Button(this.ui, W / 2 - 154, H - 52, 150, 20, 'Play Selected World', () => this.playSel());
    this.del = new Button(this.ui, W / 2 - 154, H - 28, 72, 20, 'Delete', () => {
      const w = this.worlds[this.selected];
      if (w) this.ui.open(new ConfirmScreen(this.ui, `Are you sure you want to delete this world?`, `'${w.name}' will be lost forever! (A long time!)`, 'Delete', async (ok) => {
        if (ok) { await Storage.deleteWorld(w.id); this.selected = -1; }
        this.ui.open(this);
      }));
    });
    this.widgets = [
      this.play,
      new Button(this.ui, W / 2 + 4, H - 52, 150, 20, 'Create New World', () => this.ui.open(new CreateWorldScreen(this.ui, this))),
      this.del,
      Object.assign(new Button(this.ui, W / 2 - 76, H - 28, 72, 20, 'Edit', () => {}), { enabled: false }),
      new Button(this.ui, W / 2 + 4, H - 28, 150, 20, 'Cancel', () => this.ui.open(new TitleScreen(this.ui))),
    ];
    this.update();
  }
  update() {
    if (!this.play) return;
    this.play.enabled = this.del.enabled = this.selected >= 0 && this.selected < this.worlds.length;
  }
  playSel() {
    const w = this.worlds[this.selected];
    if (w) playWorld(this.ui, w);
  }
  override render(ctx: Ctx, mx: number, my: number) {
    const W = this.gui.w, H = this.gui.h;
    this.gui.dirtBackground(ctx);
    // list area (darker dirt)
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 32, W, H - 96);
    this.gui.textCenter(ctx, 'Select World', W / 2, 16, '#FFFFFF');
    const top = 36;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 32, W, H - 96);
    ctx.clip();
    this.worlds.forEach((w, i) => {
      const y = top + i * 36 - this.scroll;
      const x = W / 2 - 110;
      if (i === this.selected) {
        ctx.fillStyle = '#808080';
        ctx.fillRect(x - 2, y - 2, 224, 36);
        ctx.fillStyle = '#000000';
        ctx.fillRect(x - 1, y - 1, 222, 34);
      }
      // world icon: a grass block
      ctx.drawImage(this.game.icons.get(2), x + 2, y + 1, 30, 30);
      this.gui.text(ctx, w.name, x + 36, y + 1, '#FFFFFF');
      const d = new Date(w.lastPlayed);
      this.gui.text(ctx, `${w.id} (${d.toLocaleDateString()} ${d.toLocaleTimeString().slice(0, 5)})`, x + 36, y + 12, '#808080');
      const mode = w.hardcore ? '§cHardcore Mode!' : ['Survival Mode', 'Creative Mode', 'Adventure Mode', 'Spectator Mode'][w.player ? (w.player as { gameMode: number }).gameMode ?? w.gameMode : w.gameMode];
      this.gui.text(ctx, mode, x + 36, y + 22, '#808080');
    });
    ctx.restore();
    if (!this.worlds.length) this.gui.textCenter(ctx, 'No worlds yet. Create one!', W / 2, H / 2 - 20, '#A0A0A0');
    super.render(ctx, mx, my);
  }
  override mouseDown(mx: number, my: number, b: number) {
    if (super.mouseDown(mx, my, b)) return true;
    const W = this.gui.w, H = this.gui.h;
    if (my > 32 && my < H - 64 && Math.abs(mx - W / 2) < 112) {
      const i = Math.floor((my - 36 + this.scroll) / 36);
      if (i >= 0 && i < this.worlds.length) {
        const now = performance.now();
        if (i === this.selected && now - this.lastClick < 300) this.playSel();
        this.selected = i;
        this.lastClick = now;
        this.update();
        return true;
      }
    }
    return false;
  }
  override wheel(d: number) {
    const max = Math.max(0, this.worlds.length * 36 - (this.gui.h - 100));
    this.scroll = Math.max(0, Math.min(max, this.scroll + d * 18));
  }
  override key(e: KeyboardEvent) {
    if (e.code === 'Escape') { this.ui.open(new TitleScreen(this.ui)); return true; }
    if (e.code === 'Enter') { this.playSel(); return true; }
    return super.key(e);
  }
}

export class ConfirmScreen extends Screen {
  constructor(ui: UI, public title: string, public msg: string, public yes: string, public cb: (ok: boolean) => void) { super(ui); }
  override init() {
    const W = this.gui.w, H = this.gui.h;
    this.widgets = [
      new Button(this.ui, W / 2 - 155, H / 6 + 96, 150, 20, this.yes, () => this.cb(true)),
      new Button(this.ui, W / 2 + 5, H / 6 + 96, 150, 20, 'Cancel', () => this.cb(false)),
    ];
  }
  override render(ctx: Ctx, mx: number, my: number) {
    this.gui.dirtBackground(ctx);
    this.gui.textCenter(ctx, this.title, this.gui.w / 2, 70, '#FFFFFF');
    this.gui.textCenter(ctx, this.msg, this.gui.w / 2, 90, '#FFFFFF');
    super.render(ctx, mx, my);
  }
}

export class CreateWorldScreen extends Screen {
  name!: TextField;
  seed!: TextField;
  mode = 0; // 0 survival, 1 hardcore, 2 creative
  keepInventory = false;
  constructor(ui: UI, public parent: Screen) { super(ui); }
  override init() {
    const W = this.gui.w, H = this.gui.h;
    this.name = new TextField(this.ui, W / 2 - 100, 60, 200, 20, this.name?.value ?? 'New World', 32);
    this.name.focused = true;
    this.seed = new TextField(this.ui, W / 2 - 100, 110, 200, 20, this.seed?.value ?? '', 32, 'Leave blank for a random seed');
    const modes = ['Survival', 'Hardcore', 'Creative'];
    const modeBtn = new Button(this.ui, W / 2 - 75, 145, 150, 20, () => `Game Mode: ${modes[this.mode]}`, () => (this.mode = (this.mode + 1) % 3));
    const keepBtn = new Button(this.ui, W / 2 - 75, 182, 150, 20, () => `Keep Inventory: ${this.keepInventory ? 'ON' : 'OFF'}`, () => (this.keepInventory = !this.keepInventory));
    this.widgets = [
      this.name, this.seed, modeBtn, keepBtn,
      new Button(this.ui, W / 2 - 155, H - 28, 150, 20, 'Create New World', () => this.create()),
      new Button(this.ui, W / 2 + 5, H - 28, 150, 20, 'Cancel', () => this.ui.open(this.parent)),
    ];
  }
  async create() {
    const now = Date.now();
    const text = this.seed.value.trim();
    const seed = text ? hashString(text) : (Math.random() * 2 ** 31) | 0;
    const meta: WorldMeta = {
      id: 'w' + now.toString(36), name: this.name.value.trim() || 'New World', seed, seedText: text || String(seed),
      gameMode: this.mode === 2 ? 1 : 0, hardcore: this.mode === 1, created: now, lastPlayed: now, time: 0, generatorVersion: GENERATOR_VERSION,
      keepInventory: this.keepInventory,
    };
    await Storage.saveWorld(meta);
    await playWorld(this.ui, meta);
  }
  override render(ctx: Ctx, mx: number, my: number) {
    const W = this.gui.w;
    this.gui.dirtBackground(ctx);
    this.gui.textCenter(ctx, 'Create New World', W / 2, 20, '#FFFFFF');
    this.gui.text(ctx, 'World Name', W / 2 - 100, 47, '#A0A0A0');
    this.gui.text(ctx, 'Seed for the World Generator', W / 2 - 100, 97, '#A0A0A0');
    const desc = ['Search for resources, craft, gain levels, health and hunger', 'Same as survival mode, locked at hardest difficulty, and one life only', 'Unlimited resources, free flying and destroy blocks instantly'][this.mode];
    this.gui.textCenter(ctx, desc, W / 2, 170, '#A0A0A0');
    super.render(ctx, mx, my);
  }
  override key(e: KeyboardEvent) {
    if (e.code === 'Tab') { const f = this.name.focused; this.name.focused = !f; this.seed.focused = f; return true; }
    if (e.code === 'Enter') { this.create(); return true; }
    if (e.code === 'Escape') { this.ui.open(this.parent); return true; }
    return super.key(e);
  }
  override mouseDown(mx: number, my: number, b: number) {
    this.name.focused = this.seed.focused = false;
    return super.mouseDown(mx, my, b);
  }
}

export class LoadingScreen extends Screen {
  ready = false;
  private shown = 0;
  constructor(ui: UI, public title: string) { super(ui); }
  override tick() {
    const g = this.game;
    if (!this.ready || g.panorama) return;
    const p = g.loadProgress();
    this.shown = Math.max(this.shown, p);
    if (p >= 0.99 && g.player && g.arrived) {
      const first = this.title === 'Loading world';
      this.ui.close();
      if (first) this.ui.chat.add(`§eWelcome! Press §fE§e for inventory, §fT§e to chat, §f/help§e for commands.`);
    }
  }
  override render(ctx: Ctx) {
    const W = this.gui.w, H = this.gui.h;
    this.gui.dirtBackground(ctx);
    this.gui.textCenter(ctx, this.ready ? 'Loading terrain' : this.title, W / 2, H / 2 - 30, '#FFFFFF');
    this.gui.textCenter(ctx, this.ready ? 'Building terrain' : 'Preparing spawn area', W / 2, H / 2 - 12, '#FFFFFF');
    const p = this.ready ? this.shown : 0;
    ctx.fillStyle = '#808080';
    ctx.fillRect(W / 2 - 50, H / 2 + 6, 100, 2);
    ctx.fillStyle = '#80FF80';
    ctx.fillRect(W / 2 - 50, H / 2 + 6, Math.floor(100 * p), 2);
  }
  override key() { return true; }
}

// ------------------------------------------------------------------ in-game menus
export class PauseScreen extends Screen {
  override pausesGame = true;
  override init() {
    const W = this.gui.w, H = this.gui.h;
    const y = H / 4 + 8;
    this.widgets = [
      new Button(this.ui, W / 2 - 100, y + 16, 200, 20, 'Back to Game', () => this.ui.close()),
      // your own world: let others in (the real game's "Open to LAN"); in someone else's, nothing to open
      Object.assign(new Button(this.ui, W / 2 - 100, y + 40, 98, 20, this.game.room || this.game.guests().length ? 'Players...' : 'Open to LAN', () => this.ui.open(new HostScreen(this.ui, this))), { enabled: !!this.game.server && !this.game.remote }),
      // phones have no F5: the camera toggle takes the Statistics slot
      device.touch
        ? new Button(this.ui, W / 2 + 2, y + 40, 98, 20, () => ['First Person', 'Back View', 'Front View'][this.game.thirdPerson], () => { this.game.thirdPerson = (this.game.thirdPerson + 1) % 3; })
        : new Button(this.ui, W / 2 + 2, y + 40, 98, 20, 'Mods...', () => openMods(this.ui, this)),
      new Button(this.ui, W / 2 - 100, y + 64, 98, 20, 'Options...', () => this.ui.open(new OptionsScreen(this.ui, this))),
      new Button(this.ui, W / 2 + 2, y + 64, 98, 20, 'Controls', () => this.ui.open(new ControlsScreen(this.ui, this))),
      new Button(this.ui, W / 2 - 100, y + 104, 200, 20, this.game.remote ? 'Disconnect' : 'Save and Quit to Title', () => this.quit()),
    ];
  }
  async quit() {
    const g = this.game;
    this.ui.open(new LoadingScreen(this.ui, g.remote ? 'Disconnecting' : 'Saving world'));
    await g.closeWorld(true);
    this.ui.open(new TitleScreen(this.ui));
  }
  override render(ctx: Ctx, mx: number, my: number) {
    this.backgroundGradient(ctx);
    this.gui.textCenter(ctx, 'Game Menu', this.gui.w / 2, 40, '#FFFFFF');
    super.render(ctx, mx, my);
  }
}

export class OptionsScreen extends Screen {
  constructor(ui: UI, public parent: Screen) { super(ui); }
  override pausesGame = true;
  override init() {
    const W = this.gui.w, H = this.gui.h;
    const o = this.game.options;
    const save = () => this.game.saveOptions();
    const x0 = W / 2 - 155, x1 = W / 2 + 5;
    let y = H / 6 - 12;
    const row = () => { const r = y; y += 24; return r; };
    const onoff = (b: boolean) => (b ? 'ON' : 'OFF');
    const r1 = row(), r2 = row(), r3 = row(), r4 = row(), r5 = row(), r6 = row(), r7 = row();
    const host = this.game.world && !this.game.panorama && !this.game.remote ? this.game.server : null;
    this.widgets = [
      new Slider(this.ui, x0, r1, 150, 20, (o.fov - 30) / 80, (v) => `FOV: ${Math.round(30 + v * 80) === 70 ? 'Normal' : Math.round(30 + v * 80) === 110 ? 'Quake Pro' : Math.round(30 + v * 80)}`, (v) => { o.fov = Math.round(30 + v * 80); save(); }),
      new Button(this.ui, x1, r1, 150, 20, () => `Difficulty: ${['Peaceful', 'Easy', 'Normal', 'Hard'][o.difficulty]}`, () => { if (this.game.meta?.hardcore) return; o.difficulty = (o.difficulty + 1) % 4; save(); }),
      new Slider(this.ui, x0, r2, 150, 20, (o.renderDistance - 2) / 14, (v) => `Render Distance: ${Math.round(2 + v * 14)} chunks`, (v) => { o.renderDistance = Math.round(2 + v * 14); save(); }, 14),
      new Slider(this.ui, x1, r2, 150, 20, o.gamma, (v) => `Brightness: ${v === 0 ? 'Moody' : v === 1 ? 'Bright' : '+' + Math.round(v * 100) + '%'}`, (v) => { o.gamma = v; save(); }),
      new Slider(this.ui, x0, r3, 150, 20, o.sensitivity, (v) => `${device.touch ? 'Mouse ' : ''}Sensitivity: ${Math.round(v * 200)}%`, (v) => { o.sensitivity = v; save(); }),
      new Button(this.ui, x1, r3, 150, 20, () => `GUI Scale: ${o.guiScale === 0 ? 'Auto' : o.guiScale}`, () => { o.guiScale = (o.guiScale + 1) % 5; save(); this.init(); }),
      new Button(this.ui, x0, r4, 150, 20, () => `View Bobbing: ${onoff(o.viewBobbing)}`, () => { o.viewBobbing = !o.viewBobbing; save(); }),
      new Button(this.ui, x1, r4, 150, 20, () => `Clouds: ${o.clouds ? 'Fancy' : 'OFF'}`, () => { o.clouds = !o.clouds; save(); }),
      new Slider(this.ui, x0, r5, 150, 20, o.volume, (v) => `Master Volume: ${v === 0 ? 'OFF' : Math.round(v * 100) + '%'}`, (v) => { o.volume = v; save(); }),
      new Slider(this.ui, x1, r5, 150, 20, o.music, (v) => `Music: ${v === 0 ? 'OFF' : Math.round(v * 100) + '%'}`, (v) => { o.music = v; save(); }),
      new Button(this.ui, x0, r6, 150, 20, () => `Particles: ${['All', 'Decreased', 'Minimal'][o.particles]}`, () => { o.particles = (o.particles + 1) % 3; save(); }),
      new Button(this.ui, x1, r6, 150, 20, () => `Invert Mouse: ${onoff(o.invertY)}`, () => { o.invertY = !o.invertY; save(); }),
      new Button(this.ui, x0, r7, 150, 20, () => `Show FPS: ${onoff(o.showFps)}`, () => { o.showFps = !o.showFps; save(); }),
      // in your own world the last slot is the keepInventory rule (items stay with you when you die)
      host
        ? new Button(this.ui, x1, r7, 150, 20, () => `Keep Inventory: ${onoff(host.keepInventory)}`, () => { host.keepInventory = !host.keepInventory; })
        : new Button(this.ui, x1, r7, 150, 20, 'Play Music Now', () => { this.game.audio.init(); this.game.audio.playPiece(); }),
      new Button(this.ui, x0, H - 28, 98, 20, 'Skin...', () => this.ui.open(new SkinScreen(this.ui, this))),
      new Button(this.ui, W / 2 - 51, H - 28, 102, 20, 'Distant Terrain...', () => this.ui.open(new DistantTerrainScreen(this.ui, this))),
      new Button(this.ui, W / 2 + 57, H - 28, 98, 20, 'Done', () => this.ui.open(this.parent)),
    ];
  }
  override render(ctx: Ctx, mx: number, my: number) {
    if (this.game.world && !this.game.panorama) this.backgroundGradient(ctx);
    else this.gui.dirtBackground(ctx);
    this.gui.textCenter(ctx, 'Options', this.gui.w / 2, 15, '#FFFFFF');
    super.render(ctx, mx, my);
  }
  override key(e: KeyboardEvent) {
    if (e.code === 'Escape') { this.ui.open(this.parent); return true; }
    return super.key(e);
  }
}

/** Distant terrain: low-detail land past the render distance, made from the world seed (like the Distant Horizons mod). */
export class DistantTerrainScreen extends Screen {
  constructor(ui: UI, public parent: Screen) { super(ui); }
  override pausesGame = true;
  override init() {
    const W = this.gui.w, H = this.gui.h, x = W / 2 - 100;
    const o = this.game.options;
    const save = () => this.game.saveOptions();
    const STEPS = [16, 24, 32, 48, 64, 96, 128, 192, 256];
    const n = STEPS.length - 1;
    const at = Math.max(0, STEPS.findIndex((s) => s >= o.lodDistance));
    let y = Math.max(40, H / 4);
    const row = () => { const r = y; y += 24; return r; };
    this.widgets = [
      new Button(this.ui, x, row(), 200, 20, () => `Distant Terrain: ${o.lod ? 'ON' : 'OFF'}`, () => { o.lod = !o.lod; save(); }),
      new Slider(this.ui, x, row(), 200, 20, at / n, (v) => `Distance: ${STEPS[Math.round(v * n)]} chunks`, (v) => { o.lodDistance = STEPS[Math.round(v * n)]; save(); }, n),
      new Button(this.ui, x, row(), 200, 20, () => `Detail: ${['Low', 'Medium', 'High'][o.lodQuality] ?? 'Medium'}`, () => { o.lodQuality = (o.lodQuality + 1) % 3; save(); }),
      new Button(this.ui, x, H - 28, 200, 20, 'Done', () => this.ui.open(this.parent)),
    ];
  }
  override render(ctx: Ctx, mx: number, my: number) {
    if (this.game.world && !this.game.panorama) this.backgroundGradient(ctx);
    else this.gui.dirtBackground(ctx);
    const W = this.gui.w;
    this.gui.textCenter(ctx, 'Distant Terrain', W / 2, 15, '#FFFFFF');
    const lines = ['Low-detail land out past your render distance,', 'made on this device from the world seed.', 'Changes to far-away land are not shown in it.'];
    const y0 = Math.max(40, this.gui.h / 4) + 76;
    lines.forEach((l, i) => this.gui.textCenter(ctx, l, W / 2, y0 + i * 10, '#A0A0A0'));
    super.render(ctx, mx, my);
  }
  override key(e: KeyboardEvent) {
    if (e.code === 'Escape') { this.ui.open(this.parent); return true; }
    return super.key(e);
  }
}

export class ControlsScreen extends Screen {
  constructor(ui: UI, public parent: Screen) { super(ui); }
  override pausesGame = true;
  override init() {
    const W = this.gui.w, o = this.game.options;
    this.widgets = [new Button(this.ui, W / 2 - 100, this.gui.h - 28, 200, 20, 'Done', () => this.ui.open(this.parent))];
    if (device.touch) {
      const save = () => this.game.saveOptions();
      this.widgets.push(
        new Button(this.ui, W / 2 - 155, 30, 150, 20, () => `Movement: ${o.touchMove === 'joystick' ? 'Joystick' : 'D-Pad'}`, () => { o.touchMove = o.touchMove === 'joystick' ? 'dpad' : 'joystick'; save(); }),
        new Button(this.ui, W / 2 + 5, 30, 150, 20, () => `Aim: ${o.touchAim === 'crosshair' ? 'Crosshair' : 'Touch'}`, () => { o.touchAim = o.touchAim === 'crosshair' ? 'touch' : 'crosshair'; save(); }),
        new Slider(this.ui, W / 2 - 155, 54, 150, 20, o.touchSensX, (v) => `Look Across: ${Math.round(v * 200)}%`, (v) => { o.touchSensX = v; save(); }),
        new Slider(this.ui, W / 2 + 5, 54, 150, 20, o.touchSensY, (v) => `Look Up/Down: ${Math.round(v * 200)}%`, (v) => { o.touchSensY = v; save(); }),
        new Button(this.ui, W / 2 - 155, 78, 150, 20, () => `Swipe Up: ${o.touchSwipeDown ? 'Look Down' : 'Look Up'}`, () => { o.touchSwipeDown = !o.touchSwipeDown; save(); }),
      );
    }
  }
  override render(ctx: Ctx, mx: number, my: number) {
    if (this.game.world && !this.game.panorama) this.backgroundGradient(ctx);
    else this.gui.dirtBackground(ctx);
    const W = this.gui.w;
    this.gui.textCenter(ctx, 'Controls', W / 2, 15, '#FFFFFF');
    if (device.touch) { this.renderTouch(ctx); super.render(ctx, mx, my); return; }
    const rows: [string, string][] = [
      ['Walk', 'W A S D'], ['Jump / Swim up', 'Space'], ['Sneak / Fly down', 'Shift'], ['Sprint', 'Ctrl or double-tap W'],
      ['Break / Attack', 'Left Mouse'], ['Place / Use', 'Right Mouse'], ['Pick Block', 'Middle Mouse'], ['Hotbar', '1-9 / Scroll'],
      ['Inventory', 'E'], ['Drop Item', 'Q (Ctrl+Q for stack)'], ['Chat / Command', 'T  /  /'], ['Toggle Fly (creative)', 'Double-tap Space'],
      ['Perspective', 'F5'], ['Debug Screen', 'F3'], ['Hide HUD', 'F1'], ['Screenshot', 'F2'], ['Fullscreen', 'F11'],
    ];
    rows.forEach(([a, b], i) => {
      const y = 36 + i * 11;
      this.gui.text(ctx, a, W / 2 - 150, y, '#FFFFFF');
      this.gui.text(ctx, b, W / 2 + 20, y, '#FFFF55');
    });
    super.render(ctx, mx, my);
  }
  /** Phones: the two control styles, then what each gesture does with them. */
  private renderTouch(ctx: Ctx) {
    const W = this.gui.w, o = this.game.options;
    const stick = o.touchMove === 'joystick', aim = o.touchAim !== 'crosshair';
    const rows: [string, string][] = [
      ['Walk', stick ? 'Drag the joystick (left side)' : 'D-pad'],
      ['Sprint', stick ? 'Push the joystick past its edge' : 'Double-tap forward'],
      ['Jump / Swim up', 'Jump button'], ['Sneak', stick ? 'Sneak button' : 'Middle of the D-pad'],
      ['Fly (creative)', 'Double-tap jump'], ['Look around', 'Drag on the screen'],
      ['Place / Use', aim ? 'Tap the block' : 'Tap anywhere (crosshair)'],
      ['Break', aim ? 'Hold on the block' : 'Hold anywhere (crosshair)'],
      ['Attack', aim ? 'Tap the mob' : 'Tap with a mob in the crosshair'],
      ['Ride / Trade / Feed', 'The button above the hotbar'], ['Get off', 'Middle of the D-pad / sneak'],
      ['Eat / Draw bow', 'Hold'], ['Drop Item', 'Hold a hotbar slot'], ['Inventory', '... on the hotbar'],
    ];
    const top = 104, step = Math.min(11, (this.gui.h - 34 - top) / rows.length);
    rows.forEach(([a, b], i) => {
      const y = top + i * step;
      this.gui.text(ctx, a, W / 2 - 150, y, '#FFFFFF');
      this.gui.text(ctx, b, W / 2 - 20, y, '#FFFF55');
    });
  }
  override key(e: KeyboardEvent) {
    if (e.code === 'Escape') { this.ui.open(this.parent); return true; }
    return super.key(e);
  }
}

export class DeathScreen extends Screen {
  private t = 0;
  constructor(ui: UI, public msg: string) { super(ui); }
  override init() {
    const W = this.gui.w, H = this.gui.h;
    const hardcore = !!this.game.meta?.hardcore;
    // the server brings us back (and moves us home from another dimension)
    const respawn = new Button(this.ui, W / 2 - 100, H / 4 + 72, 200, 20, hardcore ? 'Spectate World' : 'Respawn', () => {
      this.game.conn?.send({ t: 'respawn' });
      this.ui.close();
    });
    const title = new Button(this.ui, W / 2 - 100, H / 4 + 96, 200, 20, this.game.remote ? 'Disconnect' : 'Title Screen', async () => {
      this.game.conn?.send({ t: 'respawn' });
      if (this.game.server) this.game.server.tick();
      this.ui.open(new LoadingScreen(this.ui, this.game.remote ? 'Disconnecting' : 'Saving world'));
      await this.game.closeWorld(true);
      this.ui.open(new TitleScreen(this.ui));
    });
    // a short delay so a click meant for the game doesn't respawn instantly (init also runs again on relayout)
    respawn.enabled = title.enabled = this.t >= 20;
    this.widgets = [respawn, title];
  }
  override tick() {
    if (++this.t === 20) for (const w of this.widgets) (w as Button).enabled = true;
  }
  override render(ctx: Ctx, mx: number, my: number) {
    const W = this.gui.w, H = this.gui.h;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(80,0,0,0.38)');
    g.addColorStop(1, 'rgba(160,48,48,0.62)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, 30);
    ctx.scale(2, 2);
    this.gui.font.drawCentered(ctx, this.game.meta?.hardcore ? 'Game over!' : 'You died!', 0, 0, '#FFFFFF');
    ctx.restore();
    this.gui.textCenter(ctx, this.msg, W / 2, 85, '#FFFFFF');
    this.gui.textCenter(ctx, `Score: §e${this.game.player?.xpTotal ?? 0}`, W / 2, 100, '#FFFFFF');
    super.render(ctx, mx, my);
  }
  override key() { return true; }
}

/** In bed: the screen fades while the server waits for everyone in the world to be asleep. */
export class SleepScreen extends Screen {
  override darkens = false;
  private t = 0;
  override init() {
    this.widgets = [new Button(this.ui, this.gui.w / 2 - 100, this.gui.h - 40, 200, 20, 'Leave Bed', () => this.wake())];
    this.game.player!.sleeping = true;
  }
  wake() {
    this.game.player!.sleeping = false;
    this.game.sleepFade = 0;
    this.game.conn?.send({ t: 'wake' });
    this.ui.close();
  }
  override tick() {
    const g = this.game;
    this.t++;
    g.sleepFade = Math.min(1, this.t / 100);
  }
  override render(ctx: Ctx, mx: number, my: number) {
    const others = this.game.server ? this.game.server.players.length > 1 : this.game.remote;
    if (others && this.t > 100) this.gui.textCenter(ctx, 'Waiting for everyone to sleep...', this.gui.w / 2, this.gui.h - 60, '#FFFFFF');
    super.render(ctx, mx, my);
  }
  override key(e: KeyboardEvent) {
    if (e.code === 'Escape') { this.wake(); return true; }
    return true;
  }
}

/** The connection to someone else's game ended. */
export class DisconnectedScreen extends Screen {
  constructor(ui: UI, public reason: string) { super(ui); }
  override init() {
    const W = this.gui.w, H = this.gui.h;
    this.widgets = [new Button(this.ui, W / 2 - 100, H / 2 + 20, 200, 20, 'Back to Title Screen', () => this.ui.open(new TitleScreen(this.ui)))];
  }
  override render(ctx: Ctx, mx: number, my: number) {
    this.gui.dirtBackground(ctx);
    this.gui.textCenter(ctx, 'Disconnected', this.gui.w / 2, this.gui.h / 2 - 30, '#AAAAAA');
    this.gui.textCenter(ctx, this.reason, this.gui.w / 2, this.gui.h / 2 - 10, '#FFFFFF');
    super.render(ctx, mx, my);
  }
}

export class ChatScreen extends Screen {
  override showsChat = true;
  input: TextField;
  histIndex = -1;
  override hidesSelection = false;
  override darkens = false;
  constructor(ui: UI, initial: string) {
    super(ui);
    this.input = new TextField(ui, 2, 0, 320, 12, initial, 256);
    this.input.focused = true;
  }
  override init() {
    this.input.x = 2;
    this.input.y = this.gui.h - 14;
    this.input.w = this.gui.w - 4;
    this.widgets = [this.input];
  }
  override render(ctx: Ctx) {
    this.ui.chat.render(ctx, true);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(2, this.gui.h - 14, this.gui.w - 4, 12);
    let t = this.input.value;
    while (this.gui.font.width(t) > this.gui.w - 12 && t.length) t = t.slice(1);
    this.gui.text(ctx, t + (Math.floor(performance.now() / 300) % 2 ? '_' : ''), 4, this.gui.h - 12, '#FFFFFF');
  }
  override key(e: KeyboardEvent) {
    const cmds = this.game.chatHistory;
    if (e.code === 'Enter') {
      const v = this.input.value.trim();
      if (v) {
        cmds.history.push(v);
        // commands and messages both go to the server (it answers in the chat)
        this.game.conn?.send({ t: 'chat', msg: v });
      }
      this.ui.close();
      return true;
    }
    if (e.code === 'Escape') { this.ui.close(); return true; }
    if (e.code === 'ArrowUp' && cmds.history.length) {
      this.histIndex = this.histIndex < 0 ? cmds.history.length - 1 : Math.max(0, this.histIndex - 1);
      this.input.value = cmds.history[this.histIndex];
      return true;
    }
    if (e.code === 'ArrowDown' && this.histIndex >= 0) {
      this.histIndex = Math.min(cmds.history.length, this.histIndex + 1);
      this.input.value = cmds.history[this.histIndex] ?? '';
      return true;
    }
    if (e.code === 'Tab' && this.input.value.startsWith('/')) {
      const all = ['help', 'gamemode', 'time', 'weather', 'tp', 'give', 'summon', 'kill', 'difficulty', 'seed', 'spawnpoint', 'setblock', 'fill', 'clear', 'xp', 'gamerule', 'heal'];
      const m = all.find((c) => c.startsWith(this.input.value.slice(1)));
      if (m) this.input.value = '/' + m + ' ';
      return true;
    }
    return super.key(e);
  }
  override wheel(d: number) {
    this.ui.chat.scroll = Math.max(0, Math.min(this.ui.chat.lines.length - 1, this.ui.chat.scroll - d));
  }
  override mouseDown(mx: number, my: number, b: number) {
    if (device.touch && my < this.gui.h - 16) { this.ui.close(); return true; } // tap the world to dismiss
    this.input.focused = true;
    return super.mouseDown(mx, my, b);
  }
  override onClose() { this.ui.chat.scroll = 0; }
}

// ------------------------------------------------------------------ credits (after the first trip home from the End)
const CREDITS: string[] = [
  '#',
  'You did it.',
  '',
  'The dragon is quiet now, and the island hangs',
  'in the dark the way it always has, patient,',
  'lit by a handful of torches you carried in.',
  '',
  'Everything here was made out of nothing:',
  'a seed, some noise, a little arithmetic.',
  'Every stone, every star, every shadow',
  'was computed the moment you looked at it',
  'and forgotten the moment you looked away.',
  '',
  'That is not a small thing to be given.',
  'Somewhere a world is waiting to be',
  'dug into, built upon, lost in, found again.',
  '',
  'Go back. Plant something.',
  '',
  '#',
  '',
  '=THE END',
  '',
  '',
  '=Made with',
  'TypeScript, WebGL 2 and WebAudio',
  'Every texture, model, sound and song',
  'generated by code, at runtime',
  '',
  '=Thanks for playing',
  '',
  'This is a fan-made recreation.',
  'It is not an official Minecraft product.',
  '',
  '',
  '(press any key or tap to return)',
];

export class CreditsScreen extends Screen {
  override pausesGame = true;
  override darkens = false;
  private t = 0;
  private finished = false;
  constructor(ui: UI, private done: () => void) { super(ui); }
  override init() { this.game.audio.init(); }
  private total() { return CREDITS.length * 12 + this.gui.h; }
  override tick() {
    this.t++;
    if (this.t * 0.55 > this.total() + 40) this.finish();
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    this.ui.close();
    this.done();
  }
  override render(ctx: Ctx) {
    const W = this.gui.w, H = this.gui.h;
    ctx.fillStyle = '#05030a';
    ctx.fillRect(0, 0, W, H);
    // drifting stars
    for (let i = 0; i < 70; i++) {
      const x = (i * 97 + 13) % W, y = (i * 53 + (this.t * (0.05 + (i % 5) * 0.03))) % H;
      const a = 0.25 + 0.5 * ((i * 31) % 7) / 7;
      ctx.fillStyle = `rgba(200,170,255,${a})`;
      ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
    const scroll = this.t * 0.55;
    CREDITS.forEach((line, i) => {
      const y = H - scroll + i * 12;
      if (y < -12 || y > H + 12 || !line || line === '#') return;
      if (line.startsWith('=')) this.gui.textCenter(ctx, line.slice(1), W / 2, y, '#e0b0ff');
      else this.gui.textCenter(ctx, line, W / 2, y, line.startsWith('(') ? '#7f7f7f' : '#d8d0e8');
    });
  }
  override key(e: KeyboardEvent) {
    if (this.t > 20 && e.code !== 'F3') this.finish();
    return true;
  }
  override mouseDown() {
    if (this.t > 20) this.finish();
    return true;
  }
}
