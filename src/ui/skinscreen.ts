// Choosing a skin: the built-in characters, or one imported from a PNG file. A spinning model shows the
// choice (drag it to turn it), and the change reaches everyone in the world straight away.
import { Screen, Button } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { SKIN_PRESETS, presetSkin, skinFront, decodeSkin, importSkinFile } from '../render/skins';

interface Cell { id: string; x: number; y: number; w: number; h: number }

const THUMB_W = 20, THUMB_H = 40, PAD = 3;

export class SkinScreen extends Screen {
  override pausesGame = true;
  private cells: Cell[] = [];
  private view = { x: 0, y: 0, w: 0, h: 0 };
  private thumbs = new Map<string, HTMLCanvasElement>();
  private customFor = '';
  private error = '';
  private angle = 0.5;
  private drag: { x: number; angle: number } | null = null;
  private armsButton: Button | null = null;

  constructor(ui: UI, public parent: Screen) { super(ui); }

  private get o() { return this.game.options; }

  override init() {
    const W = this.gui.w, H = this.gui.h;
    // the model on the left, the skins in a grid on the right
    const top = 30, bottom = H - 54;
    const vw = Math.min(90, Math.floor(W * 0.28)), vh = Math.min(bottom - top - 12, vw * 1.75);
    const n = SKIN_PRESETS.length + 1, cw = THUMB_W + PAD * 2 + 2, ch = THUMB_H + PAD * 2 + 2;
    const gridW = Math.min(W - vw - 40, 9 * cw);
    const cols = Math.max(3, Math.floor(gridW / cw)), rows = Math.ceil(n / cols);
    const totalW = vw + 16 + cols * cw;
    const x0 = Math.floor(W / 2 - totalW / 2);
    this.view = { x: x0, y: top + Math.max(0, Math.floor((rows * ch - vh) / 2)), w: vw, h: vh };
    const gx = x0 + vw + 16, gy = top;
    this.cells = [...SKIN_PRESETS.map((p) => p.id), 'custom'].map((id, i) => ({ id, x: gx + (i % cols) * cw, y: gy + Math.floor(i / cols) * ch, w: cw - 2, h: ch - 2 }));
    const by = H - 50;
    this.armsButton = new Button(this.ui, W / 2 + 5, by, 150, 20, () => `Arms: ${this.o.customSlim ? 'Slim' : 'Classic'}`, () => {
      this.o.customSlim = !this.o.customSlim;
      this.thumbs.delete('custom');
      this.customFor = '';
      this.changed();
    });
    this.widgets = [
      new Button(this.ui, W / 2 - 155, by, 150, 20, 'Import Skin...', () => this.pick()),
      this.armsButton,
      new Button(this.ui, W / 2 - 100, H - 26, 200, 20, 'Done', () => this.ui.open(this.parent)),
    ];
  }

  override tick() {
    if (!this.drag) this.angle += 0.025;
    if (this.armsButton) this.armsButton.enabled = this.o.skin === 'custom' && !!this.o.customSkin;
  }

  /** Save the choice and put it on (which tells the server, in a world). */
  private changed() {
    this.game.saveOptions();
    this.game.wearSkin();
  }

  private select(id: string) {
    if (id === 'custom' && !this.o.customSkin) { this.pick(); return; }
    this.o.skin = id;
    this.error = '';
    this.changed();
  }

  /** Ask for a PNG file. */
  private pick() {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'image/png,.png';
    el.style.display = 'none';
    document.body.appendChild(el);
    el.addEventListener('change', async () => {
      const f = el.files?.[0];
      el.remove();
      if (!f) return;
      try {
        const { url, slim } = await importSkinFile(f);
        Object.assign(this.o, { customSkin: url, customSlim: slim, skin: 'custom' });
        this.thumbs.delete('custom');
        this.customFor = '';
        this.error = '';
        this.changed();
      } catch (e) {
        this.error = (e as Error).message || "That file isn't a skin";
      }
    });
    el.click();
  }

  private thumb(id: string): HTMLCanvasElement | null {
    if (id !== 'custom') {
      let t = this.thumbs.get(id);
      if (!t) {
        const p = SKIN_PRESETS.find((q) => q.id === id)!;
        t = skinFront(presetSkin(id).data, p.slim);
        this.thumbs.set(id, t);
      }
      return t;
    }
    const url = this.o.customSkin;
    if (!url) return null;
    const key = url.length + ':' + this.o.customSlim;
    if (this.customFor !== key) {
      this.customFor = key;
      const slim = this.o.customSlim;
      decodeSkin(url).then(({ data }) => { if (this.customFor === key) this.thumbs.set('custom', skinFront(data, slim)); }).catch(() => {});
    }
    return this.thumbs.get('custom') ?? null;
  }

  override render(ctx: Ctx, mx: number, my: number) {
    const W = this.gui.w, gui = this.gui;
    if (this.game.world && !this.game.panorama) this.backgroundGradient(ctx);
    else gui.dirtBackground(ctx);
    gui.textCenter(ctx, 'Skin', W / 2, 12, '#FFFFFF');
    ctx.imageSmoothingEnabled = false;
    // the model: a hole in the menu that the 3D view shows through
    const v = this.view;
    ctx.fillStyle = '#000000';
    ctx.fillRect(v.x - 1, v.y - 1, v.w + 2, v.h + 2);
    ctx.fillStyle = '#8B8B8B';
    ctx.fillRect(v.x - 1, v.y + v.h, v.w + 2, 1);
    ctx.fillRect(v.x + v.w, v.y - 1, 1, v.h + 2);
    ctx.clearRect(v.x, v.y, v.w, v.h);
    const { look, slim } = this.current();
    this.ui.previewBox = { x: v.x, y: v.y, w: v.w, h: v.h, yaw: -this.angle / 0.7, pitch: -0.15, look, slim };
    const name = this.o.skin === 'custom' ? 'Your Skin' : SKIN_PRESETS.find((p) => p.id === this.o.skin)?.name ?? 'Steve';
    gui.textCenter(ctx, name, v.x + v.w / 2, v.y + v.h + 4, '#FFFFFF');
    // the choices
    for (const c of this.cells) {
      const on = c.id === (this.o.skin === 'custom' && !this.o.customSkin ? 'steve' : this.o.skin);
      const hover = mx >= c.x && my >= c.y && mx < c.x + c.w && my < c.y + c.h;
      ctx.fillStyle = on ? 'rgba(255,255,255,0.28)' : hover ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.35)';
      ctx.fillRect(c.x, c.y, c.w, c.h);
      if (on) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(c.x, c.y, c.w, 1); ctx.fillRect(c.x, c.y + c.h - 1, c.w, 1);
        ctx.fillRect(c.x, c.y, 1, c.h); ctx.fillRect(c.x + c.w - 1, c.y, 1, c.h);
      }
      const t = this.thumb(c.id);
      if (t) ctx.drawImage(t, c.x + PAD + 1, c.y + PAD + 1, THUMB_W, THUMB_H);
      else {
        gui.textCenter(ctx, '+', c.x + c.w / 2, c.y + c.h / 2 - 10, '#FFFFFF');
        gui.textCenter(ctx, 'PNG', c.x + c.w / 2, c.y + c.h / 2 + 2, '#A0A0A0');
      }
      if (hover && !this.drag) this.hoverName = c.id === 'custom' ? (this.o.customSkin ? 'Your Skin' : 'Import a skin') : SKIN_PRESETS.find((p) => p.id === c.id)!.name;
    }
    const gridBottom = Math.max(...this.cells.map((c) => c.y + c.h));
    const label = this.error || this.hoverName;
    if (label) gui.textCenter(ctx, label, (this.cells[0].x + Math.max(...this.cells.map((c) => c.x + c.w))) / 2, gridBottom + 4, this.error ? '#FF5555' : '#A0A0A0');
    this.hoverName = '';
    super.render(ctx, mx, my);
  }
  private hoverName = '';

  private current() {
    if (this.o.skin === 'custom' && this.o.customSkin) return { look: this.o.customSkin, slim: this.o.customSlim };
    return { look: this.o.skin === 'custom' ? 'steve' : this.o.skin, slim: false };
  }

  override mouseDown(mx: number, my: number, button: number) {
    if (super.mouseDown(mx, my, button)) return true;
    for (const c of this.cells) {
      if (mx >= c.x && my >= c.y && mx < c.x + c.w && my < c.y + c.h) {
        this.game.audio.play('click', null, 0.6, 1);
        this.select(c.id);
        return true;
      }
    }
    const v = this.view;
    if (mx >= v.x && my >= v.y && mx < v.x + v.w && my < v.y + v.h) { this.drag = { x: mx, angle: this.angle }; return true; }
    return false;
  }
  override mouseMove(mx: number, my: number) {
    super.mouseMove(mx, my);
    if (this.drag) this.angle = this.drag.angle + (mx - this.drag.x) * 0.04;
  }
  override mouseUp(mx: number, my: number, button: number) {
    super.mouseUp(mx, my, button);
    this.drag = null;
  }
  override onClose() { this.ui.previewBox = null; }
  override key(e: KeyboardEvent) {
    if (e.code === 'Escape') { this.ui.open(this.parent); return true; }
    return super.key(e);
  }
}
