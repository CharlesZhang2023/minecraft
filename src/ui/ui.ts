// UI manager: screen stack, HUD, chat, input routing, item drawing.
import type { Game } from '../game/game';
import { Gui, Ctx } from './gui';
import { Hud, drawDurability } from './hud';
import { Chat } from './chat';
import { Screen } from './screen';
import { ItemStack } from '../game/items';
import * as Menus from './menus';
import * as Containers from './containers';

export class UI {
  gui: Gui;
  screen: Screen | null = null;
  hud: Hud;
  chat: Chat;
  mx = 0;
  my = 0;
  suppressChar = false;
  previewBox: { x: number; y: number; w: number; h: number; yaw: number; pitch: number } | null = null;

  constructor(public game: Game) {
    this.gui = game.gui;
    this.hud = new Hud(this);
    this.chat = new Chat(this);
    const inp = game.input;
    inp.onKeyDown = (e) => this.keyDown(e);
    inp.onChar = (ch) => {
      // the key that opened a screen must not also be typed into it
      if (this.suppressChar) { this.suppressChar = false; return; }
      this.screen?.char(ch);
    };
    inp.onMouseDown = (x, y, b) => {
      game.audio.init();
      const [mx, my] = this.toGui(x, y);
      if (this.screen) this.screen.mouseDown(mx, my, b);
      else if (game.world && !inp.locked) inp.lock();
    };
    inp.onMouseUp = (x, y, b) => {
      const [mx, my] = this.toGui(x, y);
      this.screen?.mouseUp(mx, my, b);
    };
    inp.onWheel = (d) => this.screen?.wheel(d);
    inp.onLockChange = (locked) => {
      // Esc released the pointer while playing -> open the pause menu
      if (!locked && !this.screen && game.world && !game.panorama) this.open(new Menus.PauseScreen(this));
    };
    this.open(new Menus.TitleScreen(this));
  }

  toGui(x: number, y: number): [number, number] {
    return [x / this.gui.scale, y / this.gui.scale];
  }

  pausesGame() {
    return !!this.screen?.pausesGame;
  }

  open(s: Screen | null) {
    const prev = this.screen;
    this.screen = s;
    if (prev) prev.onClose();
    this.previewBox = null;
    if (s) {
      s.init();
      this.game.input.unlock();
    } else if (this.game.world && !this.game.panorama) {
      this.game.input.lock();
    }
  }

  close() {
    this.open(null);
  }

  tick(dt: number) {
    void dt;
    this.screen?.tick();
    const [mx, my] = this.toGui(this.game.input.mouseX, this.game.input.mouseY);
    if (mx !== this.mx || my !== this.my) {
      this.mx = mx;
      this.my = my;
      this.screen?.mouseMove(mx, my);
    }
  }

  // convenience openers used by gameplay
  openCrafting() { this.open(new Containers.CraftingScreen(this)); }
  openFurnace(x: number, y: number, z: number) { this.open(new Containers.FurnaceScreen(this, x, y, z)); }
  openChest(x: number, y: number, z: number) { this.open(new Containers.ChestScreen(this, x, y, z)); }
  openInventory() {
    const p = this.game.player!;
    this.game.achievements.unlock('openInventory');
    this.open(p.creative ? new Containers.CreativeScreen(this) : new Containers.InventoryScreen(this));
  }
  openDeath(msg: string) { this.open(new Menus.DeathScreen(this, msg)); }
  openSleep() { this.open(new Menus.SleepScreen(this)); }

  private keyDown(e: KeyboardEvent): boolean {
    const g = this.game;
    g.audio.init();
    if (this.screen) {
      if (e.code === 'F3' && g.world) { g.showDebug = !g.showDebug; return true; }
      return this.screen.key(e) || true;
    }
    if (!g.world || g.panorama) return false;
    switch (e.code) {
      case 'Escape': this.open(new Menus.PauseScreen(this)); return true;
      case 'KeyE': if (!g.player!.dead) { this.suppressChar = true; this.openInventory(); } return true;
      case 'KeyT': this.suppressChar = true; this.open(new Menus.ChatScreen(this, '')); return true;
      case 'Slash': this.suppressChar = true; this.open(new Menus.ChatScreen(this, '/')); return true;
      case 'Enter': this.open(new Menus.ChatScreen(this, '')); return true;
      case 'F1': g.hideHud = !g.hideHud; return true;
      case 'F3': g.showDebug = !g.showDebug; return true;
      case 'F5': g.thirdPerson = (g.thirdPerson + 1) % 3; return true;
      case 'F2': this.screenshot(); return true;
      case 'F11': document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); return true;
    }
    return false;
  }

  screenshot() {
    const g = this.game;
    const c = document.createElement('canvas');
    c.width = g.renderer.width;
    c.height = g.renderer.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(g.renderer.canvas, 0, 0);
    ctx.drawImage(g.ctx.canvas, 0, 0);
    const a = document.createElement('a');
    const d = new Date();
    a.download = `screenshot_${d.toISOString().replace(/[:.]/g, '-')}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
    this.chat.add(`Saved screenshot as ${a.download}`);
  }

  render(ctx: Ctx) {
    const g = this.game;
    g.icons.setScale(this.gui.scale);
    this.gui.setup(ctx, g.renderer.width, g.renderer.height, g.options.guiScale);
    const [mx, my] = this.toGui(g.input.mouseX, g.input.mouseY);
    if (g.world && g.player && !g.panorama) this.hud.render(ctx);
    if (this.screen) {
      this.screen.render(ctx, mx, my);
    }
    if (g.world && !g.panorama) g.achievements.render(ctx);
  }

  /** Draw an item icon with count / durability overlays at GUI position. */
  drawItem(ctx: Ctx, s: ItemStack, x: number, y: number, pop = 0) {
    const icon = this.game.icons.get(s.id);
    if (pop > 0) {
      const f = 1 + pop / 5;
      ctx.save();
      ctx.translate(x + 8, y + 12);
      ctx.scale(1 / f * 1, (f + 1) / 2);
      ctx.drawImage(icon, -8, -12, 16, 16);
      ctx.restore();
    } else ctx.drawImage(icon, x, y, 16, 16);
    drawDurability(ctx, s, x, y);
    if (s.count > 1) {
      const t = String(s.count);
      this.gui.text(ctx, t, x + 17 - this.gui.font.width(t), y + 9, '#FFFFFF');
    }
  }
}
