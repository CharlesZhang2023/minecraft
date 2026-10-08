import { Events } from '../mod/events';
import { attackStrength } from '../game/combat';
import { drawEffectsHud } from './effects';
// In-game HUD: hotbar, health/food/armor/air, XP bar, crosshair, item names, debug overlay.
import type { UI } from './ui';
import type { Ctx } from './gui';
import { getItem, ItemStack } from '../game/items';
import { mapIdOf, mapRGB, MAP_SIZE, drawMapMarks } from '../game/maps';
import { B } from '../world/blocks';
import { EnderDragon } from '../entity/dragon';
import { LivingEntity } from '../entity/living';
import { device } from '../game/device';
import { touchHotbar } from './touchlayout';
import { t } from '../i18n/i18n';

export class Hud {
  private itemNameTimer = 0;
  private itemName = '';
  private lastSelected = -1;
  private lastHeldId = -1;
  private actionText = '';
  private actionTimer = 0;
  private ticks = 0;
  private heartJitter: number[] = new Array(10).fill(0);
  private regenWave = -1;
  private lastHealth = 20;
  private healthBlink = 0;
  private displayedHealth = 20;
  pickupPop = new Map<number, number>();

  constructor(private ui: UI) {}

  tick() {
    this.ticks++;
    const p = this.ui.game.player;
    if (!p) return;
    const held = p.inventory.held();
    if (p.inventory.selected !== this.lastSelected || (held?.id ?? -1) !== this.lastHeldId) {
      this.lastSelected = p.inventory.selected;
      this.lastHeldId = held?.id ?? -1;
      this.itemName = held ? held.name ?? getItem(held.id).display : '';
      this.itemNameTimer = held ? 40 : 0;
    } else if (this.itemNameTimer > 0) this.itemNameTimer--;
    if (this.actionTimer > 0) this.actionTimer--;
    if (p.health < this.lastHealth) { this.healthBlink = 20; this.displayedHealth = this.lastHealth; }
    else if (p.health > this.lastHealth) this.healthBlink = 10;
    if (this.healthBlink > 0) this.healthBlink--;
    else this.displayedHealth = p.health;
    this.lastHealth = p.health;
    if (p.foodTimer === 1 || (p.health < p.maxHealth && this.ticks % 80 === 0 && p.food >= 18)) this.regenWave = 0;
    if (this.regenWave >= 0) this.regenWave++;
    if (this.regenWave > 15) this.regenWave = -1;
    for (const [k, v] of this.pickupPop) { if (v <= 1) this.pickupPop.delete(k); else this.pickupPop.set(k, v - 1); }
  }

  private mapCanvases = new Map<number, { ver: number; cv: HTMLCanvasElement }>();
  private heldMaps(ctx: Ctx, W: number, H: number) {
    const g = this.ui.game, p = g.player!;
    const hands: [ItemStack | null, boolean][] = [[p.inventory.held(), true], [p.inventory.offhand, false]];
    for (const [s, main] of hands) {
      const id = mapIdOf(s);
      if (id === null) continue;
      const size = Math.min(112, Math.floor(H * 0.42)), x = main ? W - size - 10 : 10, y = H - size - 44;
      // the paper
      ctx.fillStyle = '#d8c8a0';
      ctx.fillRect(x - 4, y - 4, size + 8, size + 8);
      ctx.fillStyle = '#b8a47a';
      ctx.fillRect(x - 4, y + size + 3, size + 8, 1); ctx.fillRect(x + size + 3, y - 4, 1, size + 8);
      const d = g.maps.get(id);
      if (!d) continue;
      let c = this.mapCanvases.get(id);
      if (!c || c.ver !== d.ver) {
        const cv = c?.cv ?? document.createElement('canvas');
        cv.width = cv.height = MAP_SIZE;
        const img = new ImageData(MAP_SIZE, MAP_SIZE);
        for (let i = 0; i < d.colors.length; i++) {
          const rgb = mapRGB(d.colors[i]);
          if (rgb < 0) continue;
          img.data[i * 4] = rgb >> 16; img.data[i * 4 + 1] = (rgb >> 8) & 255; img.data[i * 4 + 2] = rgb & 255; img.data[i * 4 + 3] = 255;
        }
        cv.getContext('2d')!.putImageData(img, 0, 0);
        c = { ver: d.ver, cv };
        this.mapCanvases.set(id, c);
      }
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c.cv, x, y, size, size);
      drawMapMarks(ctx as never, d, x, y, size / MAP_SIZE);
      // the player's marker: a white pointer (on the edge, smaller, when they're off the map)
      if (d.dim === (g.world?.dimension ?? '')) {
        const k = size / MAP_SIZE, sc = 1 << d.scale;
        let mx = (p.x - d.x) / sc + 64, mz = (p.z - d.z) / sc + 64;
        const off = mx < 0 || mz < 0 || mx > MAP_SIZE || mz > MAP_SIZE;
        mx = Math.max(0, Math.min(MAP_SIZE, mx)); mz = Math.max(0, Math.min(MAP_SIZE, mz));
        ctx.translate(x + mx * k, y + mz * k);
        if (!off) ctx.rotate((p.yaw * Math.PI) / 180 + Math.PI);
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#000000'; ctx.lineWidth = 1;
        ctx.beginPath();
        if (off) ctx.arc(0, 0, 2, 0, Math.PI * 2);
        else { ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(0, 2); ctx.lineTo(-3.5, 4); ctx.closePath(); }
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
  }

  actionBar(text: string) {
    this.actionText = text;
    this.actionTimer = 60;
  }

  pickupAnim(id: number) {
    const p = this.ui.game.player;
    if (!p) return;
    for (let i = 0; i < 9; i++) if (p.inventory.main[i]?.id === id) this.pickupPop.set(i, 5);
  }

  render(ctx: Ctx) {
    const g = this.ui.game, gui = this.ui.gui, p = g.player!;
    const W = gui.w, H = gui.h;
    if (g.hideHud) return;
    const cx = Math.floor(W / 2);
    // a mod's view: no crosshair with a free pointer, and maybe no HUD at all (chat and messages stay)
    const view = g.view;
    if (view?.hud === 'none') { this.modsAndChat(ctx); return; }
    if (view?.freePointer) { /* the pointer is the crosshair */ }
    // crosshair (inverted colours), with the attack charge under it while a swing recharges (1.9)
    else if (!g.showDebug && g.thirdPerson === 0 && !device.touch) { this.crosshair(ctx); this.attackIndicator(ctx, cx, Math.floor(H / 2)); }
    else if (!g.showDebug && g.thirdPerson === 0 && !g.touchAim()) {
      ctx.save();
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#ffffff';
      const cy = Math.floor(H / 2);
      ctx.fillRect(cx - 4, cy, 9, 1);
      ctx.fillRect(cx, cy - 4, 1, 4);
      ctx.fillRect(cx, cy + 1, 1, 4);
      ctx.restore();
    } else if (g.showDebug && g.thirdPerson === 0) this.debugAxes(ctx, cx, Math.floor(H / 2));
    if (p.spectator) {
      this.modsAndChat(ctx);
      return;
    }
    // a map in hand: drawn in the corner of its hand, with where you are on it
    if (!view?.freePointer) this.heldMaps(ctx, W, H);
    // hotbar; on touch screens the Pocket Edition one: only the slots that fit, then "..." for the inventory
    const touch = device.touch;
    const tb = touch ? touchHotbar(W, H) : null;
    const hx = cx - 91, hy = H - 22;
    const slots = tb ? tb.n : 9, bx = tb ? tb.x : hx;
    this.hotbarFrame(ctx, bx, hy, slots, !!tb);
    // the off hand: its own slot left of the hotbar when it holds something
    if (p.inventory.offhand && !tb) {
      const ox = hx - 29;
      ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(ox, hy, 24, 22);
      ctx.fillStyle = 'rgba(92,92,92,0.75)'; ctx.fillRect(ox + 1, hy + 1, 22, 20);
      ctx.fillStyle = 'rgba(58,58,58,0.8)'; ctx.fillRect(ox + 3, hy + 3, 18, 16);
      this.ui.drawItem(ctx, p.inventory.offhand, ox + 4, hy + 3);
    }
    for (let i = 0; i < slots; i++) {
      const s = p.inventory.main[i];
      if (s) {
        const pop = this.pickupPop.get(i) ?? 0;
        this.ui.drawItem(ctx, s, bx + 3 + i * 20, hy + 3, pop);
      }
    }
    const survival = !p.creative;
    // riding something alive (a horse): its jump bar takes the XP bar's place, its health the food bar's
    const mount = p.riding as (LivingEntity & { jumpBar?: number; controllable?: boolean }) | null;
    const mountLiving = mount instanceof LivingEntity ? mount : null;
    if (mountLiving && mountLiving.controllable) {
      const xy = H - 29, f = mountLiving.jumpBar ?? 0;
      ctx.fillStyle = '#000000';
      ctx.fillRect(hx, xy, 182, 5);
      ctx.fillStyle = '#3a3a52';
      ctx.fillRect(hx + 1, xy + 1, 180, 3);
      ctx.fillStyle = '#9fb4ff';
      ctx.fillRect(hx + 1, xy + 1, Math.floor(180 * f), 3);
      ctx.fillStyle = '#5a6ad0';
      ctx.fillRect(hx + 1, xy + 3, Math.floor(180 * f), 1);
    }
    if (survival) {
      // XP bar
      const xy = H - 29;
      if (!mountLiving?.controllable) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(hx, xy, 182, 5);
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(hx + 1, xy + 1, 180, 3);
      ctx.fillStyle = '#80ff20';
      ctx.fillRect(hx + 1, xy + 1, Math.floor(180 * p.xpProgress), 3);
      ctx.fillStyle = '#4a8a10';
      ctx.fillRect(hx + 1, xy + 3, Math.floor(180 * p.xpProgress), 1);
      if (p.xpLevel > 0) {
        const t = String(p.xpLevel);
        const tx = cx - gui.font.width(t) / 2, ty = H - 35;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) gui.font.draw(ctx, t, tx + ox, ty + oy, '#000000', false);
        gui.font.draw(ctx, t, tx, ty, '#80FF20', false);
      }
      }
      // hearts: above the hotbar's left half, or along the top left on touch screens (food top right),
      // with the extra rows stacking up from the hotbar, or down from the top edge
      const lowHealth = p.health <= 4;
      const hardcore = !!g.meta?.hardcore;
      const heartsY = touch ? 2 : H - 39, rowDir = touch ? 1 : -1;
      const heartsX = touch ? 2 : hx, foodX = touch ? W - 11 : hx + 182 - 9;
      const blink = this.healthBlink > 0 && Math.floor(this.healthBlink / 3) % 2 === 1;
      for (let i = 0; i < 10; i++) {
        let y = heartsY;
        if (lowHealth) y += ((i * 31 + this.ticks * 7) % 3) - 1;
        if (this.regenWave === i) y -= 2;
        const x = heartsX + i * 8;
        ctx.drawImage(blink ? gui.sprites.heartEmptyFlash : gui.sprites.heartEmpty, x, y);
        const hp = p.health - i * 2;
        if (blink) {
          const dh = this.displayedHealth - i * 2;
          if (dh >= 2) ctx.drawImage(gui.sprites.heartFlash, x, y);
          else if (dh === 1) ctx.drawImage(gui.sprites.heartFlash, 0, 0, 5, 9, x, y, 5, 9);
        }
        const heart = p.effects.has('poison') ? gui.sprites.heartPoison : hardcore ? gui.sprites.heartHardcore : gui.sprites.heart;
        if (hp >= 2) ctx.drawImage(heart, x, y);
        else if (hp >= 1) ctx.drawImage(heart, 0, 0, 5, 9, x, y, 5, 9);
      }
      // absorption (golden) hearts on the row above
      const abs = Math.ceil(p.absorption);
      for (let i = 0; i < Math.ceil(abs / 2); i++) {
        const x = heartsX + (i % 10) * 8, y = heartsY + rowDir * (10 + Math.floor(i / 10) * 10);
        ctx.drawImage(gui.sprites.heartEmpty, x, y);
        if (abs - i * 2 >= 2) ctx.drawImage(gui.sprites.heartAbsorb, x, y);
        else ctx.drawImage(gui.sprites.heartAbsorb, 0, 0, 5, 9, x, y, 5, 9);
      }
      const rowUp = abs > 0 ? 10 * Math.ceil(abs / 20) : 0;
      // armor
      const armor = p.inventory.armorPoints();
      if (armor > 0) {
        for (let i = 0; i < 10; i++) {
          const x = heartsX + i * 8, y = heartsY + rowDir * (10 + rowUp);
          const a = armor - i * 2;
          ctx.drawImage(a >= 2 ? gui.sprites.armor : a === 1 ? gui.sprites.armorHalf : gui.sprites.armorEmpty, x, y);
        }
      }
      // a mount's hearts (rows of ten, stacking away from the hotbar) replace the food bar
      if (mountLiving) {
        const hearts = Math.ceil(mountLiving.maxHealth / 2);
        for (let i = 0; i < hearts; i++) {
          const x = foodX - (i % 10) * 8, y = heartsY + rowDir * Math.floor(i / 10) * 10;
          ctx.drawImage(gui.sprites.heartEmpty, x, y);
          const hp = Math.ceil(mountLiving.health) - i * 2;
          if (hp >= 2) ctx.drawImage(gui.sprites.heart, x, y);
          else if (hp === 1) ctx.drawImage(gui.sprites.heart, 0, 0, 5, 9, x, y, 5, 9);
        }
      }
      // food
      for (let i = 0; i < 10 && !mountLiving; i++) {
        const x = foodX - i * 8;
        let y = heartsY;
        if (p.saturation <= 0 && this.ticks % (p.food * 3 + 1) === 0) y += ((i * 13 + this.ticks) % 3) - 1;
        ctx.drawImage(gui.sprites.foodEmpty, x, y);
        const f = p.food - i * 2;
        const hungry = p.effects.has('hunger');
        if (f >= 2) ctx.drawImage(hungry ? gui.sprites.foodHunger : gui.sprites.food, x, y);
        else if (f === 1) ctx.drawImage(hungry ? gui.sprites.foodHunger : gui.sprites.foodHalf, 0, 0, hungry ? 5 : 9, 9, x, y, hungry ? 5 : 9, 9);
      }
      // air
      const eyeId = g.world!.getId(Math.floor(p.x), Math.floor(p.y + p.eyeHeight()), Math.floor(p.z));
      if (eyeId === B.WATER || p.air < 300) {
        const full = Math.ceil(((p.air - 2) * 10) / 300);
        const pop = Math.ceil((p.air * 10) / 300) - full;
        for (let i = 0; i < full + pop; i++) {
          const x = foodX - i * 8;
          ctx.drawImage(i < full ? gui.sprites.bubble : gui.sprites.bubblePop, x, heartsY + rowDir * 10);
        }
      }
    }
    // held item name
    if (this.itemNameTimer > 0 && this.itemName) {
      const a = Math.min(1, (this.itemNameTimer * 256) / 10 / 255);
      ctx.globalAlpha = a;
      gui.textCenter(ctx, this.itemName, cx, (touch ? H - 45 : H - 59) + (survival ? 0 : 14), '#FFFFFF');
      ctx.globalAlpha = 1;
    }
    if (this.actionTimer > 0) {
      ctx.globalAlpha = Math.min(1, this.actionTimer / 10);
      gui.textCenter(ctx, this.actionText, cx, (touch ? H - 58 : H - 72) + (survival ? 0 : 14), '#FFFFFF');
      ctx.globalAlpha = 1;
    }
    if (!this.ui.screen && !g.hideHud) drawEffectsHud(ctx, this.ui);
    this.bossBar(ctx);
    this.modsAndChat(ctx);
  }

  /** Mods' HUD, then the chat over it. */
  private modsAndChat(ctx: Ctx) {
    const g = this.ui.game, gui = this.ui.gui;
    if (Events.hudRender.any) {
      ctx.save();
      Events.hudRender.fire({ ctx, client: g, width: gui.w, height: gui.h, partial: g.partial });
      ctx.restore();
    }
    this.renderChatAndText(ctx);
  }

  /**
   * Mouse play: the crosshair in device pixels, so its middle pixel sits on the exact centre of the view
   * (the ray the game picks blocks with) instead of up to half a GUI pixel right of and below it.
   */
  private crosshair(ctx: Ctx) {
    const s = this.ui.gui.scale, c = ctx.canvas;
    const x = Math.round(c.width / 2 - s / 2), y = Math.round(c.height / 2 - s / 2);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 4 * s, y, 9 * s, s);
    ctx.fillRect(x, y - 4 * s, s, 4 * s);
    ctx.fillRect(x, y + s, s, 4 * s);
    ctx.restore();
  }

  /** The attack charge (vanilla's crosshair indicator): a bar under the crosshair until the next swing is ready. */
  private attackIndicator(ctx: Ctx, cx: number, cy: number) {
    const p = this.ui.game.player!;
    const f = attackStrength(p, 0);
    if (f >= 1) return;
    ctx.save();
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(cx - 8, cy + 9, 16, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 8, cy + 9, Math.round(16 * f), 2);
    ctx.restore();
  }

  /** The boss's health bar across the top of the screen: the Ender Dragon in the End, or a Wither within 64 blocks. */
  private bossBar(ctx: Ctx) {
    const g = this.ui.game, gui = this.ui.gui;
    if (g.hideHud || !g.world) return;
    const p = g.player!;
    const wither = g.entities.find((e) => (e as unknown as { typeName?: string }).typeName === 'Wither' && !e.removed && e.distanceTo(p) < 64) as (LivingEntity & { invul?: number }) | undefined;
    if (wither) { this.drawBossBar(ctx, 'Wither', wither.health / wither.maxHealth, '#5a1a6a', '#c040ff'); return; }
    // a raid: the health left in the raiders nearby
    const raiders = g.entities.filter((e) => ((e as unknown as { raid?: number }).raid ?? 0) > 0 && !(e as LivingEntity).dead && e.distanceTo(p) < 96) as LivingEntity[];
    if (raiders.length) {
      const hp = raiders.reduce((a, e) => a + e.health, 0), max = raiders.reduce((a, e) => a + e.maxHealth, 0);
      this.drawBossBar(ctx, t('Raid - Raiders Remaining: {0}', raiders.length), hp / max, '#4a1010', '#c02020');
      return;
    }
    if (g.world.dimension !== 'end') return;
    const d = g.entities.find((e) => e instanceof EnderDragon && !e.removed) as EnderDragon | undefined;
    if (!d) return;
    const x = Math.floor(gui.w / 2) - 91;
    // on touch screens the chat and pause buttons sit along the top edge
    const y = device.touch ? 30 : 12;
    gui.textCenter(ctx, 'Ender Dragon', gui.w / 2, y - 9, '#FFFFFF');
    ctx.fillStyle = '#000000';
    ctx.fillRect(x - 1, y - 1, 184, 7);
    ctx.fillStyle = '#4a2060';
    ctx.fillRect(x, y, 182, 5);
    const f = Math.max(0, d.health / d.maxHealth);
    ctx.fillStyle = '#c040ff';
    ctx.fillRect(x, y, Math.round(182 * f), 5);
    ctx.fillStyle = '#e8a0ff';
    ctx.fillRect(x, y, Math.round(182 * f), 1);
  }

  private drawBossBar(ctx: Ctx, name: string, f: number, dark: string, light: string) {
    const gui = this.ui.gui;
    const x = Math.floor(gui.w / 2) - 91;
    const y = device.touch ? 30 : 12;
    gui.textCenter(ctx, name, gui.w / 2, y - 9, '#FFFFFF');
    ctx.fillStyle = '#000000';
    ctx.fillRect(x - 1, y - 1, 184, 7);
    ctx.fillStyle = dark;
    ctx.fillRect(x, y, 182, 5);
    ctx.fillStyle = light;
    ctx.fillRect(x, y, Math.round(182 * Math.max(0, Math.min(1, f))), 5);
  }

  private renderChatAndText(ctx: Ctx) {
    const g = this.ui.game, gui = this.ui.gui;
    if (g.showDebug) this.debug(ctx);
    else if (g.options.showFps) gui.text(ctx, `${g.fps} fps`, 2, 2, '#FFFFFF');
    if (!this.ui.screen?.showsChat) this.ui.chat.render(ctx, false);
  }

  private hotbarFrame(ctx: Ctx, x: number, y: number, slots: number, more: boolean) {
    const p = this.ui.game.player!;
    const cells = slots + (more ? 1 : 0), w = cells * 20 + 2;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(x, y, w, 22);
    ctx.fillStyle = 'rgba(92,92,92,0.75)';
    ctx.fillRect(x + 1, y + 1, w - 2, 20);
    for (let i = 0; i < cells; i++) {
      const sx = x + 1 + i * 20;
      ctx.fillStyle = 'rgba(58,58,58,0.8)';
      ctx.fillRect(sx + 1, y + 2, 18, 18);
      ctx.fillStyle = 'rgba(140,140,140,0.8)';
      ctx.fillRect(sx + 1, y + 19, 18, 1);
      ctx.fillRect(sx + 18, y + 2, 1, 18);
      ctx.fillStyle = 'rgba(20,20,20,0.8)';
      ctx.fillRect(sx + 1, y + 2, 18, 1);
      ctx.fillRect(sx + 1, y + 2, 1, 18);
    }
    if (more) {
      // the "..." cell that opens the inventory
      const dx = x + 1 + slots * 20;
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(dx + 5 + i * 4, y + 11, 2, 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(dx + 4 + i * 4, y + 10, 2, 2);
      }
    }
    // selection frame
    const sx = x - 1 + Math.min(p.inventory.selected, slots - 1) * 20;
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx, y - 1, 24, 24);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 1, y, 22, 22);
    ctx.fillStyle = '#a0a0a0';
    ctx.fillRect(sx + 2, y + 1, 20, 20);
    ctx.clearRect(sx + 3, y + 2, 18, 18);
    ctx.fillStyle = 'rgba(58,58,58,0.55)';
    ctx.fillRect(sx + 3, y + 2, 18, 18);
  }

  private debugAxes(ctx: Ctx, cx: number, cy: number) {
    const p = this.ui.game.player!;
    const yaw = (p.yaw * Math.PI) / 180, pitch = (p.pitch * Math.PI) / 180;
    const axes: [number, number, number, string][] = [[1, 0, 0, '#ff3030'], [0, 1, 0, '#30ff30'], [0, 0, 1, '#3060ff']];
    for (const [x, y, z, col] of axes) {
      // rotate world axis into view space
      const vx = x * Math.cos(yaw + Math.PI) - z * Math.sin(yaw + Math.PI);
      const vz0 = x * Math.sin(yaw + Math.PI) + z * Math.cos(yaw + Math.PI);
      const vy = y * Math.cos(pitch) - vz0 * Math.sin(pitch);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 0.5, cy + 0.5);
      ctx.lineTo(cx + 0.5 + vx * 10, cy + 0.5 - vy * 10);
      ctx.stroke();
    }
  }

  private debug(ctx: Ctx) {
    const g = this.ui.game, gui = this.ui.gui;
    const lines = g.debugLines();
    let y = 2;
    for (const l of lines) {
      if (l) {
        ctx.fillStyle = 'rgba(80,80,80,0.56)';
        ctx.fillRect(1, y - 1, gui.font.width(l) + 2, 9);
        gui.font.draw(ctx, l, 2, y, '#E0E0E0', false);
      }
      y += 9;
    }
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    const right = [
      `JS: ${navigator.userAgent.includes('Chrome') ? 'V8' : 'JS'} ${navigator.hardwareConcurrency} threads`,
      mem ? `Mem: ${Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100)}% ${Math.round(mem.usedJSHeapSize / 1048576)}/${Math.round(mem.jsHeapSizeLimit / 1048576)}MB` : '',
      `Display: ${g.renderer.width}x${g.renderer.height} (GUI x${gui.scale})`,
      g.renderer.describe(),
    ];
    y = 2;
    for (const l of right) {
      if (l) {
        const w = gui.font.width(l);
        ctx.fillStyle = 'rgba(80,80,80,0.56)';
        ctx.fillRect(gui.w - w - 3, y - 1, w + 2, 9);
        gui.font.draw(ctx, l, gui.w - w - 2, y, '#E0E0E0', false);
      }
      y += 9;
    }
  }
}

export function drawDurability(ctx: Ctx, s: ItemStack, x: number, y: number) {
  const d = getItem(s.id);
  if (!d.durability || !s.damage) return;
  const f = 1 - s.damage / d.durability;
  const w = Math.round(13 * f);
  ctx.fillStyle = '#000000';
  ctx.fillRect(x + 2, y + 13, 13, 2);
  const hue = f * 120;
  ctx.fillStyle = `hsl(${hue},100%,50%)`;
  ctx.fillRect(x + 2, y + 13, w, 1);
}
