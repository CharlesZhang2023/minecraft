// GUI drawing primitives in Minecraft's style. All coordinates are in GUI pixels.
import { Font } from './font';
import { getTexture } from '../render/textures';

export type Ctx = CanvasRenderingContext2D;

function spriteCanvas(rows: string[], pal: Record<string, string>): HTMLCanvasElement {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

// 9x9 HUD icons
const HEART = ['.kk...kk.', 'kRRk.kRRk', 'kRWRkRRRk', 'kRRRRRRRk', 'kRRRRRRRk', '.kRRRRRk.', '..kRRRk..', '...kRk...', '....k....'];
const HEART_HALF = ['.kk......', 'kRRk.....', 'kRWRk....', 'kRRRk....', 'kRRRk....', '.kRRk....', '..kRk....', '...kk....', '....k....'];
const HEART_EMPTY = ['.kk...kk.', 'kddk.kddk', 'kdddkdddk', 'kdddddddk', 'kdddddddk', '.kdddddk.', '..kdddk..', '...kdk...', '....k....'];
const FOOD = ['.....kk..', '....kWWk.', '...kBBWk.', '..kBBBBk.', '.kBBBBBk.', 'kBBBBBk..', 'kRRBBk...', 'kWWkk....', '.kk......'];
const FOOD_HALF = ['.........', '.........', '.........', '....kk...', '...kBBk..', '..kBBBBk.', '.kRRBBk..', 'kWWkk....', '.kk......'];
const FOOD_EMPTY = ['.....kk..', '....kddk.', '...kdddk.', '..kddddk.', '.kdddddk.', 'kdddddk..', 'kdddk....', 'kddkk....', '.kk......'];
const ARMOR = ['.kkk.kkk.', 'kWWWkWWWk', 'kWLLLLLWk', 'kWLLLLLWk', '.kLLLLLk.', '.kLLLLLk.', '.kLLLLLk.', '..kLLLk..', '...kkk...'];
const ARMOR_HALF = ['.kkk.kk..', 'kWWWkd.k.', 'kWLLkddk.', 'kWLLkddk.', '.kLLkddk.', '.kLLkddk.', '.kLLkddk.', '..kLkdk..', '...kkk...'];
const ARMOR_EMPTY = ['.kkk.kkk.', 'kdddkdddk', 'kdddddddk', 'kdddddddk', '.kdddddk.', '.kdddddk.', '.kdddddk.', '..kdddk..', '...kkk...'];
const BUBBLE = ['..kkkkk..', '.kBBBBBk.', 'kBWBBBBBk', 'kBWBBBBBk', 'kBBBBBBBk', 'kBBBBBBBk', 'kBBBBBBBk', '.kBBBBBk.', '..kkkkk..'];
const BUBBLE_POP = ['.........', '..k...k..', '...k.k...', '.........', '.k.....k.', '.........', '...k.k...', '..k...k..', '.........'];

export class Gui {
  font = new Font();
  scale = 2;
  w = 320; // GUI-pixel dimensions
  h = 240;
  sprites: Record<string, HTMLCanvasElement> = {};
  dirt: HTMLCanvasElement;
  stone: HTMLCanvasElement;

  constructor() {
    const heartPal = { k: '#1c0000', R: '#d80000', W: '#ffb0b0' };
    this.sprites.heart = spriteCanvas(HEART, heartPal);
    this.sprites.heartHalf = spriteCanvas(HEART_HALF, heartPal);
    this.sprites.heartFlash = spriteCanvas(HEART, { k: '#ffffff', R: '#d80000', W: '#ffb0b0' });
    this.sprites.heartEmpty = spriteCanvas(HEART_EMPTY, { k: '#1c0000', d: '#3a0e0e' });
    this.sprites.heartEmptyFlash = spriteCanvas(HEART_EMPTY, { k: '#ffffff', d: '#3a0e0e' });
    this.sprites.heartPoison = spriteCanvas(HEART, { k: '#1c1c00', R: '#8a8a18', W: '#d0d080' });
    this.sprites.heartHardcore = spriteCanvas(HEART, { k: '#1c0000', R: '#d80000', W: '#ffffff' });
    this.sprites.heartAbsorb = spriteCanvas(HEART, { k: '#2a1c00', R: '#e0b020', W: '#fff0a0' });
    const foodPal = { k: '#2a1604', B: '#b36a25', R: '#d8321c', W: '#f0e0d0' };
    this.sprites.food = spriteCanvas(FOOD, foodPal);
    this.sprites.foodHalf = spriteCanvas(FOOD_HALF, foodPal);
    this.sprites.foodEmpty = spriteCanvas(FOOD_EMPTY, { k: '#2a1604', d: '#3e2a16' });
    this.sprites.foodHunger = spriteCanvas(FOOD, { k: '#1a2a04', B: '#6a8a24', R: '#4a6a1c', W: '#b0c8a0' });
    const armorPal = { k: '#1a1a1a', W: '#ffffff', L: '#c8c8c8', d: '#3a3a3a' };
    this.sprites.armor = spriteCanvas(ARMOR, armorPal);
    this.sprites.armorHalf = spriteCanvas(ARMOR_HALF, armorPal);
    this.sprites.armorEmpty = spriteCanvas(ARMOR_EMPTY, { k: '#1a1a1a', d: '#3a3a3a' });
    this.sprites.bubble = spriteCanvas(BUBBLE, { k: '#1a2a6a', B: '#4a7ad8', W: '#ffffff' });
    this.sprites.bubblePop = spriteCanvas(BUBBLE_POP, { k: '#4a7ad8' });
    this.dirt = this.texCanvas('dirt', 0.25);
    this.stone = this.texCanvas('stone', 1);
  }

  private texCanvas(name: string, bright: number): HTMLCanvasElement {
    const img = getTexture(name);
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d')!;
    const id = ctx.createImageData(16, 16);
    for (let i = 0; i < 256; i++) {
      id.data[i * 4] = img[i * 4] * bright;
      id.data[i * 4 + 1] = img[i * 4 + 1] * bright;
      id.data[i * 4 + 2] = img[i * 4 + 2] * bright;
      id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  setup(ctx: Ctx, screenW: number, screenH: number, pref: number) {
    let s = 1;
    while (s < (pref || 99) && screenW / (s + 1) >= 320 && screenH / (s + 1) >= 240) s++;
    this.scale = s;
    this.w = Math.ceil(screenW / s);
    this.h = Math.ceil(screenH / s);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  text(ctx: Ctx, t: string, x: number, y: number, color = '#FFFFFF', shadow = true) {
    this.font.draw(ctx, t, x, y, color, shadow);
  }
  textCenter(ctx: Ctx, t: string, cx: number, y: number, color = '#FFFFFF', shadow = true) {
    this.font.drawCentered(ctx, t, cx, y, color, shadow);
  }

  /** The classic menu background: darkened dirt tiles. */
  dirtBackground(ctx: Ctx, x = 0, y = 0, w = this.w, h = this.h) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (let ty = Math.floor(y / 32) * 32; ty < y + h; ty += 32) for (let tx = 0; tx < x + w; tx += 32) ctx.drawImage(this.dirt, tx, ty, 32, 32);
    ctx.restore();
  }

  panel(ctx: Ctx, x: number, y: number, w: number, h: number) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 1, y, w - 2, h);
    ctx.fillRect(x, y + 1, w, h - 2);
    ctx.fillStyle = '#C6C6C6';
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x + 1, y + 1, w - 3, 2);
    ctx.fillRect(x + 1, y + 1, 2, h - 3);
    ctx.fillStyle = '#555555';
    ctx.fillRect(x + 3, y + h - 3, w - 4, 2);
    ctx.fillRect(x + w - 3, y + 3, 2, h - 4);
    ctx.fillStyle = '#C6C6C6';
    ctx.fillRect(x + 2, y + h - 3, 1, 1);
    ctx.fillRect(x + w - 3, y + 2, 1, 1);
  }

  slot(ctx: Ctx, x: number, y: number, w = 18, h = 18) {
    ctx.fillStyle = '#373737';
    ctx.fillRect(x, y, w - 1, 1);
    ctx.fillRect(x, y, 1, h - 1);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x + 1, y + h - 1, w - 1, 1);
    ctx.fillRect(x + w - 1, y + 1, 1, h - 1);
    ctx.fillStyle = '#8B8B8B';
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillRect(x + w - 1, y, 1, 1);
    ctx.fillRect(x, y + h - 1, 1, 1);
  }

  button(ctx: Ctx, x: number, y: number, w: number, h: number, label: string, hover: boolean, enabled = true) {
    // stone-textured button like the classic GUI
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, w - 2, h - 2);
    ctx.clip();
    ctx.globalAlpha = 1;
    for (let tx = x + 1; tx < x + w; tx += 16) for (let ty = y + 1; ty < y + h; ty += 16) ctx.drawImage(this.stone, tx, ty, 16, 16);
    ctx.fillStyle = enabled ? (hover ? 'rgba(110,130,210,0.45)' : 'rgba(40,40,40,0.35)') : 'rgba(0,0,0,0.6)';
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.restore();
    ctx.fillStyle = enabled ? (hover ? '#bcc6ff' : '#a8a8a8') : '#5a5a5a';
    ctx.fillRect(x + 1, y + 1, w - 2, 1);
    ctx.fillRect(x + 1, y + 1, 1, h - 3);
    ctx.fillStyle = enabled ? (hover ? '#5563a8' : '#4a4a4a') : '#2a2a2a';
    ctx.fillRect(x + 1, y + h - 3, w - 2, 2);
    ctx.fillRect(x + w - 2, y + 1, 1, h - 3);
    if (hover && enabled) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
    }
    this.textCenter(ctx, label, x + w / 2, y + Math.floor((h - 8) / 2), !enabled ? '#A0A0A0' : hover ? '#FFFFA0' : '#E0E0E0');
  }

  /** Tooltip box like the item hover tooltip. */
  tooltip(ctx: Ctx, lines: string[], mx: number, my: number) {
    if (!lines.length) return;
    const w = Math.max(...lines.map((l) => this.font.width(l))) + 6;
    const h = lines.length * 10 + (lines.length > 1 ? 2 : 0) + 4;
    let x = mx + 12, y = my - 12;
    if (x + w > this.w) x = mx - w - 12;
    if (y + h > this.h) y = this.h - h;
    if (y < 0) y = 0;
    ctx.fillStyle = 'rgba(16,0,16,0.94)';
    ctx.fillRect(x + 1, y, w - 2, h);
    ctx.fillRect(x, y + 1, w, h - 2);
    ctx.fillStyle = 'rgba(80,0,255,0.35)';
    ctx.fillRect(x + 1, y + 1, w - 2, 1);
    ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
    ctx.fillRect(x + 1, y + 1, 1, h - 2);
    ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
    lines.forEach((l, i) => this.text(ctx, l, x + 3, y + 3 + i * 10 + (i > 0 ? 2 : 0), i === 0 ? '#FFFFFF' : '#AAAAAA'));
  }

  textField(ctx: Ctx, x: number, y: number, w: number, h: number, value: string, focused: boolean, placeholder = '') {
    ctx.fillStyle = focused ? '#FFFFFF' : '#A0A0A0';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, w, h);
    let t = value;
    while (this.font.width(t) > w - 8 && t.length) t = t.slice(1);
    if (!value && placeholder && !focused) this.text(ctx, placeholder, x + 4, y + (h - 8) / 2, '#707070', false);
    this.text(ctx, t, x + 4, y + (h - 8) / 2, '#E0E0E0');
    if (focused && Math.floor(performance.now() / 300) % 2 === 0) this.text(ctx, '_', x + 4 + this.font.width(t) + 1, y + (h - 8) / 2, '#E0E0E0');
  }

  slider(ctx: Ctx, x: number, y: number, w: number, h: number, label: string, frac: number, hover: boolean) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, w - 2, h - 2);
    ctx.clip();
    for (let tx = x + 1; tx < x + w; tx += 16) for (let ty = y + 1; ty < y + h; ty += 16) ctx.drawImage(this.stone, tx, ty, 16, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.restore();
    const kx = x + Math.round(frac * (w - 8));
    ctx.fillStyle = '#000000';
    ctx.fillRect(kx, y, 8, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(kx + 1, y + 1, 6, h - 2);
    ctx.clip();
    for (let ty = y; ty < y + h; ty += 16) ctx.drawImage(this.stone, kx, ty, 16, 16);
    ctx.restore();
    ctx.fillStyle = hover ? '#ffffff' : '#a8a8a8';
    ctx.fillRect(kx + 1, y + 1, 6, 1);
    ctx.fillRect(kx + 1, y + 1, 1, h - 2);
    this.textCenter(ctx, label, x + w / 2, y + Math.floor((h - 8) / 2), hover ? '#FFFFA0' : '#E0E0E0');
  }
}
