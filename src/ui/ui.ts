// UI manager: screen stack, HUD, chat, input routing, item drawing.
import type { Horse } from '../entity/horse';
import type { Entity } from '../entity/entity';
import type { Client } from '../client/client';
import { Gui, Ctx } from './gui';
import { Hud, drawDurability } from './hud';
import { Chat } from './chat';
import { Screen } from './screen';
import { ItemStack, starTint, I7 } from '../game/items';
import { BANNERS } from '../world/blocks';
import * as Menus from './menus';
import * as Containers from './containers';
import { TradeScreen } from './trade';
import { EnchantScreen } from './enchant';
import { HopperScreen, DispenserScreen, BrewingScreen, AnvilScreen } from './devices';
import { BookScreen } from './book';
import { AdvancementsScreen } from './advancements';
import { bannerCanvas } from './stations';
import { SmithingScreen, StonecutterScreen, BeaconScreen, GrindstoneScreen, CartScreen, SignScreen, LoomScreen, CartographyScreen } from './stations';
import type { Villager } from '../entity/mobs';
import { TouchControls } from './touch';
import { device } from '../game/device';
import { SCREENS } from '../mod/hooks';
import { isActive, guard } from '../mod/state';
import { Events } from '../mod/events';

export class UI {
  /** The client's own UI (the server keeps twins of container screens: ServerUI). */
  readonly isServer: boolean = false;
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
  /** A hole in the GUI where a model is drawn: the player (or `look`, a skin being picked), or a horse. */
  previewBox: { x: number; y: number; w: number; h: number; yaw: number; pitch: number; entity?: Entity; look?: string; slim?: boolean } | null = null;

  private buttons = 0;

  constructor(public game: Client) {
    this.gui = game.gui;
    this.hud = new Hud(this);
    this.chat = new Chat(this);
    const inp = game.input;
    this.touch = new TouchControls(game, this, inp.el);
    inp.onKeyDown = (e) => this.keyDown(e);
    inp.onChar = (ch) => {
      // the key that opened a screen must not also be typed into it
      if (this.suppressChar) { this.suppressChar = false; return; }
      this.forward('char', { ch });
      this.screen?.char(ch);
    };
    inp.onMouseDown = (x, y, b) => {
      game.audio.init();
      const [mx, my] = this.toGui(x, y);
      this.mx = mx;
      this.my = my;
      this.buttons++;
      if (this.screen) {
        this.forward('down', { b });
        this.screen.mouseDown(mx, my, b);
      } else if (this.viewPointer()) this.toView('down', mx, my, b, 0);
      else if (game.world && !inp.locked) inp.lock();
    };
    inp.onMouseUp = (x, y, b) => {
      const [mx, my] = this.toGui(x, y);
      this.mx = mx;
      this.my = my;
      this.buttons = Math.max(0, this.buttons - 1);
      this.forward('up', { b });
      if (this.screen) this.screen.mouseUp(mx, my, b);
      else if (this.viewPointer()) this.toView('up', mx, my, b, 0);
    };
    inp.onWheel = (d) => {
      this.forward('wheel', { d });
      if (this.screen) this.screen.wheel(d);
      else if (this.viewPointer()) this.toView('wheel', this.mx, this.my, 0, d);
    };
    inp.onLockChange = (locked) => {
      // Esc released the pointer while playing -> open the pause menu (a view with a free pointer never holds it)
      if (!locked && !this.screen && game.world && !game.panorama && !this.viewPointer()) this.open(new Menus.PauseScreen(this));
    };
    this.open(new Menus.TitleScreen(this));
  }

  /** Is a mod's view taking the mouse in the world (no screen open)? */
  viewPointer() {
    const g = this.game;
    return !this.screen && !!g.world && !g.panorama && !!g.view?.freePointer;
  }
  /** Mouse or finger activity in the world, for the view. */
  toView(type: 'down' | 'move' | 'up' | 'wheel' | 'cancel', x: number, y: number, button: number, d: number, touch: number | null = null) {
    const g = this.game;
    g.viewDo('pointer', (v) => v.onPointer?.({ type, x, y, button, d, touch }, g), undefined);
  }

  toGui(x: number, y: number): [number, number] {
    return [x / this.gui.scale, y / this.gui.scale];
  }

  /** Clock for double-click detection (the server's copy of a window uses the client's). */
  now() { return performance.now(); }

  pausesGame() {
    return !!this.screen?.pausesGame;
  }

  /**
   * Container windows also exist on the server, which replays our clicks and keys on its copy (in coordinates
   * relative to the window, so screen size doesn't matter) and sends back what really happened.
   */
  private forward(e: string, extra: Record<string, unknown>) {
    const s = this.screen, conn = this.game.conn;
    if (!(s instanceof Containers.ContainerScreen || s?.twin) || !conn) return;
    const inp = this.game.input;
    const kd = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'MetaLeft'].filter((k) => inp.isDown(k));
    const box = s as unknown as { left?: number; top?: number };
    conn.send({ t: 'ui', e, x: this.mx - (box.left ?? 0), y: this.my - (box.top ?? 0), kd, ms: Math.round(performance.now()), ...extra });
  }

  open(s: Screen | null) {
    const prev = this.screen;
    // our window closed (or another replaced it): the server's copy closes too
    if ((prev instanceof Containers.ContainerScreen || prev?.twin || prev?.fromServer) && prev !== s && !this.game.serverOpening) this.game.conn?.send({ t: 'close' });
    if (s && this.game.serverOpening) s.fromServer = true;
    this.screen = s;
    if (prev) prev.onClose();
    this.previewBox = null;
    if (Events.screenOpen.any) Events.screenOpen.fire({ screen: s });
    if (s) {
      s.init();
      this.game.input.unlock();
      if (device.touch) this.touch.syncKeyboard();
    } else if (this.game.world && !this.game.panorama && !this.game.view?.freePointer) {
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
      // only drags matter to the server's copy of a window
      if (this.buttons > 0) this.forward('move', {});
      if (this.screen) this.screen.mouseMove(mx, my);
      else if (this.viewPointer() && !device.touch) this.toView('move', mx, my, 0, 0);
    }
  }

  // convenience openers used by gameplay
  openCrafting() { this.open(new Containers.CraftingScreen(this)); }
  openFurnace(x: number, y: number, z: number) { this.open(new Containers.FurnaceScreen(this, x, y, z)); }
  openChest(x: number, y: number, z: number) { this.open(new Containers.ChestScreen(this, x, y, z)); }
  openEnderChest(x: number, y: number, z: number) { this.open(new Containers.EnderChestScreen(this, x, y, z)); }
  openHorse(h: Horse) { this.open(new Containers.HorseScreen(this, h)); }
  /** A mod's screen by id (the server opens it for a player with PlayerBlockCtx.openScreen). */
  openMod(id: string, ...args: unknown[]) {
    const s = SCREENS.get(String(id));
    if (!s || !isActive(s.mod)) return;
    const screen = guard(s.mod, `screen ${id}`, () => s.make(this, ...args), null);
    if (screen) this.open(screen);
  }
  openInventory() {
    const p = this.game.player!;
    // on a tame horse, E opens the horse's inventory
    const h = p.riding as Horse | null;
    if (h && (h as Partial<Horse>).chestItems && h.tame) {
      this.openHorse(h);
      if (!this.game.serverOpening) this.game.conn?.send({ t: 'open', m: 'openInventory' });
      return;
    }
    this.game.achievements.unlock('openInventory');
    this.open(p.creative ? new Containers.CreativeScreen(this) : new Containers.InventoryScreen(this));
    // opened from our side: the server opens its copy (it decides the same way: creative or not, on a horse or not)
    if (!this.game.serverOpening) this.game.conn?.send({ t: 'open', m: 'openInventory' });
  }
  openDeath(msg: string) { this.open(new Menus.DeathScreen(this, msg)); }
  openTrade(v: Villager) { this.open(new TradeScreen(this, v)); }
  openEnchant(x: number, y: number, z: number) { this.open(new EnchantScreen(this, x, y, z)); }
  openSleep() { this.open(new Menus.SleepScreen(this)); }
  openHopper(x: number, y: number, z: number) { this.open(new HopperScreen(this, x, y, z)); }
  openDispenser(x: number, y: number, z: number, dropper: boolean) { this.open(new DispenserScreen(this, x, y, z, dropper)); }
  openBrewing(x: number, y: number, z: number) { this.open(new BrewingScreen(this, x, y, z)); }
  openAnvil(x: number, y: number, z: number) { this.open(new AnvilScreen(this, x, y, z)); }
  openSmithing(x: number, y: number, z: number) { this.open(new SmithingScreen(this, x, y, z)); }
  openStonecutter(x: number, y: number, z: number) { this.open(new StonecutterScreen(this, x, y, z)); }
  openBeacon(x: number, y: number, z: number) { this.open(new BeaconScreen(this, x, y, z)); }
  openSign(x: number, y: number, z: number) { this.open(new SignScreen(this, x, y, z)); }
  openCart(c: { items: (import('../game/items').ItemStack | null)[]; kind: string; typeName: string }) { this.open(new CartScreen(this, c)); }
  openGrindstone(x: number, y: number, z: number) { this.open(new GrindstoneScreen(this, x, y, z)); }
  openLoom(x: number, y: number, z: number) { this.open(new LoomScreen(this, x, y, z)); }
  openBook(slot: number) { this.open(new BookScreen(this, { slot })); }
  openLectern(x: number, y: number, z: number) { this.open(new BookScreen(this, { lectern: [x, y, z] })); }
  openCartography(x: number, y: number, z: number) { this.open(new CartographyScreen(this, x, y, z)); }
  /** A container's contents changed outside the UI (hoppers, droppers): open screens read tiles live. */
  containerChanged(_x: number, _y: number, _z: number) {}

  private keyDown(e: KeyboardEvent): boolean {
    const g = this.game;
    g.audio.init();
    if (this.screen) {
      if (e.code === 'F3' && g.world) { g.showDebug = !g.showDebug; return true; }
      if (e.code !== 'Escape') this.forward('key', { code: e.code, key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey });
      return this.screen.key(e) || true;
    }
    if (!g.world || g.panorama) return false;
    // a mod's view sees keys first (a strategy view's hotkeys)
    if (g.view?.key && g.viewDo('key', (v) => v.key!(e, g), false)) return true;
    switch (e.code) {
      case 'Escape': this.open(new Menus.PauseScreen(this)); return true;
      case 'KeyE': if (!g.player!.dead) { this.suppressChar = true; this.openInventory(); } return true;
      case 'KeyT': this.suppressChar = true; this.open(new Menus.ChatScreen(this, '')); return true;
      case 'KeyL': this.open(new AdvancementsScreen(this)); return true;
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
    if (g.world && g.player && !g.panorama && !g.hideHud) g.nameTags(ctx);
    if (g.world && g.player && !g.panorama) this.hud.render(ctx);
    if (g.world && !g.panorama && !this.screen && !g.input.locked && !g.hideHud && !g.view?.freePointer) {
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
    let icon = this.game.icons.get(s.id, starTint(s));
    if (s.ench) icon = this.glinted(icon);
    if (pop > 0) {
      const f = 1 + pop / 5;
      ctx.save();
      ctx.translate(x + 8, y + 12);
      ctx.scale(1 / f * 1, (f + 1) / 2);
      ctx.drawImage(icon, -8, -12, 16, 16);
      ctx.restore();
    } else ctx.drawImage(icon, x, y, 16, 16);
    // a patterned banner shows its design on the cloth; a decorated shield on its face (the banner's upper part)
    const shieldBase = s.tag?.shieldBase as number | undefined;
    if (s.banner?.length && BANNERS.includes(s.id)) ctx.drawImage(bannerCanvas(BANNERS.indexOf(s.id), s.banner), x + 4, y + 2, 8, 12);
    else if (shieldBase !== undefined && s.id === I7.SHIELD) ctx.drawImage(bannerCanvas(shieldBase, s.banner ?? []), 0, 0, 20, 22, x + 4, y + 3, 8, 8);
    drawDurability(ctx, s, x, y);
    if (s.count > 1) {
      const t = String(s.count);
      this.gui.text(ctx, t, x + 17 - this.gui.font.width(t), y + 9, '#FFFFFF');
    }
  }
}
