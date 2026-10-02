// UI manager: screen stack, HUD, chat, input routing, item drawing.
import type { Horse } from '../entity/horse';
import type { Entity } from '../entity/entity';
import type { Game } from '../game/game';
import { Gui, Ctx } from './gui';
import { Hud, drawDurability } from './hud';
import { Chat } from './chat';
import { Screen } from './screen';
import { ItemStack } from '../game/items';
import * as Menus from './menus';
import * as Containers from './containers';
import { TradeScreen } from './trade';
import { EnchantScreen } from './enchant';
import { HopperScreen, DispenserScreen, BrewingScreen, AnvilScreen } from './devices';
import type { Villager } from '../entity/mobs';
import { TouchControls } from './touch';
import { device } from '../game/device';

export class UI {
  gui: Gui;
  screen: Screen | null = null;
  hud: Hud;
  chat: Chat;
  mx = 0;
  my = 0;
  suppressChar = false;
  touch: TouchControls;
  private lastGuiW = 0;
  private lastGuiH = 0;
  previewBox: { x: number; y: number; w: number; h: number; yaw: number; pitch: number; entity?: Entity } | null = null;

  constructor(public game: Game) {
    this.gui = game.gui;
    this.hud = new Hud(this);
    this.chat = new Chat(this);
    const inp = game.input;
    this.touch = new TouchControls(game, this, inp.el);
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
      if (device.touch) this.touch.syncKeyboard();
    } else if (this.game.world && !this.game.panorama) {
      this.game.input.lock();
    }
    if (!s && device.touch) this.touch.syncKeyboard();
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
  openEnderChest(x: number, y: number, z: number) { this.open(new Containers.EnderChestScreen(this, x, y, z)); }
  openHorse(h: Horse) { this.open(new Containers.HorseScreen(this, h)); }
  openInventory() {
    const p = this.game.player!;
    // on a tame horse, E opens the horse's inventory
    const h = p.riding as Horse | null;
    if (h && (h as Partial<Horse>).chestItems && h.tame) { this.openHorse(h); return; }
    this.game.achievements.unlock('openInventory');
    this.open(p.creative ? new Containers.CreativeScreen(this) : new Containers.InventoryScreen(this));
  }
  openDeath(msg: string) { this.open(new Menus.DeathScreen(this, msg)); }
  openTrade(v: Villager) { this.open(new TradeScreen(this, v)); }
  openEnchant(x: number, y: number, z: number) { this.open(new EnchantScreen(this, x, y, z)); }
  openSleep() { this.open(new Menus.SleepScreen(this)); }
  openHopper(x: number, y: number, z: number) { this.open(new HopperScreen(this, x, y, z)); }
  openDispenser(x: number, y: number, z: number, dropper: boolean) { this.open(new DispenserScreen(this, x, y, z, dropper)); }
  openBrewing(x: number, y: number, z: number) { this.open(new BrewingScreen(this, x, y, z)); }
  openAnvil(x: number, y: number, z: number) { this.open(new AnvilScreen(this, x, y, z)); }
  /** A container's contents changed outside the UI (hoppers, droppers): open screens read tiles live. */
  containerChanged(_x: number, _y: number, _z: number) {}

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
      case 'F11': this.toggleFullscreen(); return true;
    }
    return false;
  }

  toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }
    document.documentElement.requestFullscreen().then(() => {
      // lets Ctrl+W sprint without closing the tab (Chromium keyboard lock)
      (navigator as unknown as { keyboard?: { lock?: (k: string[]) => Promise<void> } }).keyboard?.lock?.(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ']).catch(() => {});
      // phones: the game wants landscape
      if (device.touch) device.landscape();
    }).catch(() => {});
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
    // touch, in the world: a bigger HUD with thumb-sized controls, like the Pocket Edition (screens keep room for chests)
    const big = device.touch && !!g.world && !g.panorama && !this.screen;
    this.gui.setup(ctx, g.renderer.width, g.renderer.height, g.options.guiScale, big ? 300 : 320, big ? 180 : 240);
    if (this.gui.w !== this.lastGuiW || this.gui.h !== this.lastGuiH) {
      // rotation, window resize or the soft keyboard changed the GUI size: lay the open screen out again
      const first = this.lastGuiW === 0;
      this.lastGuiW = this.gui.w;
      this.lastGuiH = this.gui.h;
      if (this.screen) this.screen.relayout();
      if (!first) this.previewBox = null;
    }
    const [mx, my] = this.toGui(g.input.mouseX, g.input.mouseY);
    if (g.world && g.player && !g.panorama) this.hud.render(ctx);
    if (g.world && !g.panorama && !this.screen && !g.input.locked && !g.hideHud) {
      const t = 'Click to play';
      const w = this.gui.font.width(t) + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(this.gui.w / 2 - w / 2, this.gui.h / 2 + 12, w, 12);
      this.gui.textCenter(ctx, t, this.gui.w / 2, this.gui.h / 2 + 14, '#FFFFFF');
    }
    if (this.screen) {
      this.screen.render(ctx, mx, my);
    }
    if (g.world && !g.panorama) g.achievements.render(ctx);
    this.touch.render(ctx);
  }

  /** Draw an item icon with count / durability overlays at GUI position. */
  private glintCanvas = document.createElement('canvas');
  private glinted(icon: HTMLCanvasElement): HTMLCanvasElement {
    const c = this.glintCanvas;
    if (c.width !== icon.width) { c.width = icon.width; c.height = icon.height; }
    const g = c.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(icon, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    const t = (performance.now() / 3000) % 1;
    const grad = g.createLinearGradient(-c.width + t * c.width * 3, 0, t * c.width * 3, c.height);
    grad.addColorStop(0, 'rgba(128,64,255,0.15)');
    grad.addColorStop(0.5, 'rgba(190,120,255,0.55)');
    grad.addColorStop(1, 'rgba(128,64,255,0.15)');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  drawItem(ctx: Ctx, s: ItemStack, x: number, y: number, pop = 0) {
    let icon = this.game.icons.get(s.id);
    if (s.ench) icon = this.glinted(icon);
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
