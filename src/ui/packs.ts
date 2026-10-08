// The Resource Packs and Shader Packs screens (Options): packs installed in this browser and the ones the pack
// repository offers; download, use, order (resource packs stack, the first winning), remove, add from a file, and
// each shader pack's settings.
import { Screen, Button, Slider } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { packs, type PackListing } from '../packs/packs';
import type { PackKind, ShaderSetting } from '../packs/types';
import { t } from '../i18n/i18n';

const ROW = 36;
/** Icons of packs (data: URLs), decoded once. */
const ICONS = new Map<string, HTMLImageElement>();

export class PackScreen extends Screen {
  override touchScrolls = true;
  private list: PackListing[] = [];
  private selected = 0;
  private scroll = 0;
  private status = '';
  private busy = false;
  private btn: Record<string, Button> = {};

  constructor(ui: UI, private parent: Screen, private kind: PackKind) { super(ui); }
  override pausesGame = true;

  private get title() { return this.kind === 'resource' ? 'Resource Packs' : 'Shader Packs'; }

  override init() {
    const W = this.gui.w, H = this.gui.h;
    const b = (k: string, x: number, y: number, w: number, label: string | (() => string), fn: () => void) => (this.btn[k] = new Button(this.ui, x, y, w, 20, label, fn));
    this.widgets = this.kind === 'resource' ? [
      b('use', W / 2 - 154, H - 52, 74, () => (this.sel()?.active ? 'Stop Using' : this.sel()?.installed ? 'Use' : 'Get & Use'), () => this.toggle()),
      b('up', W / 2 - 76, H - 52, 36, 'Up', () => this.move(-1)),
      b('down', W / 2 - 38, H - 52, 36, 'Down', () => this.move(1)),
      b('install', W / 2 + 2, H - 52, 74, () => (this.sel()?.update ? 'Update' : 'Download'), () => this.install()),
      b('remove', W / 2 + 80, H - 52, 74, 'Remove', () => this.remove()),
      b('file', W / 2 - 154, H - 28, 150, 'Add from File...', () => this.fromFile()),
      b('done', W / 2 + 4, H - 28, 150, 'Done', () => this.ui.open(this.parent)),
    ] : [
      b('use', W / 2 - 154, H - 52, 74, () => (this.sel()?.active ? 'Turn Off' : this.sel()?.installed || !this.sel()?.repo ? 'Use' : 'Get & Use'), () => this.toggle()),
      b('config', W / 2 - 76, H - 52, 74, 'Settings...', () => this.config()),
      b('install', W / 2 + 2, H - 52, 74, () => (this.sel()?.update ? 'Update' : 'Download'), () => this.install()),
      b('remove', W / 2 + 80, H - 52, 74, 'Remove', () => this.remove()),
      b('file', W / 2 - 154, H - 28, 150, 'Add from File...', () => this.fromFile()),
      b('done', W / 2 + 4, H - 28, 150, 'Done', () => this.ui.open(this.parent)),
    ];
    void this.refresh();
  }

  private sel(): PackListing | undefined { return this.list[this.selected]; }

  private async refresh(note?: string) {
    this.list = await packs.listing(this.kind, true);
    if (this.selected >= this.list.length) this.selected = this.list.length - 1;
    if (this.selected < 0) this.selected = 0;
    const r = this.game.renderer;
    const info = this.kind === 'shader' && r.backend !== 'webgpu' ? '§eShader packs need WebGPU (Options > More... > Graphics)'
      : this.kind === 'shader' && packs.shaderError ? '§c' + packs.shaderError.split('\n')[0]
      : this.kind === 'resource' ? packs.status : '';
    this.status = note ?? (info || (this.list.length ? '' : 'None here, and the pack repository is unreachable or empty'));
    this.update();
  }

  private update() {
    const s = this.sel(), b = this.btn, free = !this.busy;
    b.use.enabled = free && !!s && (!!s.installed || !!s.repo);
    b.install.enabled = free && !!s?.repo && (!s.installed || s.update);
    b.remove.enabled = free && !!s?.installed;
    b.file.enabled = free;
    if (b.up) {
      const order = this.game.options.resourcePacks, i = s ? order.indexOf(s.id) : -1;
      b.up.enabled = free && i > 0;
      b.down.enabled = free && i >= 0 && i < order.length - 1;
    }
    if (b.config) b.config.enabled = !!s?.installed && !!packs.shaderBundle(s.id)?.manifest.settings?.length;
  }

  private async run(label: string, fn: () => Promise<string | null | void>) {
    this.busy = true;
    this.status = label;
    this.update();
    let err: string | null | void = null;
    try { err = await fn(); } catch (e) { err = (e as Error).message; }
    this.busy = false;
    await this.refresh(err ? '§c' + err.split('\n')[0] : undefined);
  }

  /** Download it if it isn't here yet. */
  private async ensure(s: PackListing) {
    if (!s.installed && s.repo) await packs.install(s.repo, (f) => { this.status = t('Downloading {0}... {1}%', s.manifest.name ?? s.id, Math.round(f * 100)); });
  }

  private toggle() {
    const s = this.sel();
    if (!s) return;
    if (this.kind === 'resource') {
      const order = this.game.options.resourcePacks;
      this.run(s.active ? 'Taking it out...' : 'Loading textures...', async () => {
        await this.ensure(s);
        await packs.setResourcePacks(s.active ? order.filter((x) => x !== s.id) : [s.id, ...order]);
      });
    } else {
      this.run(s.active ? 'Turning it off...' : 'Compiling shaders...', async () => {
        await this.ensure(s);
        return packs.setShader(s.active ? '' : s.id);
      });
    }
  }

  private move(d: number) {
    const s = this.sel();
    if (!s) return;
    const order = [...this.game.options.resourcePacks], i = order.indexOf(s.id), j = i + d;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    this.selected += d;
    this.run('Loading textures...', () => packs.setResourcePacks(order));
  }

  private install() {
    const s = this.sel();
    if (!s?.repo) return;
    this.run(t('Downloading {0}...', s.manifest.name ?? s.id), async () => {
      await packs.install(s.repo!, (f) => { this.status = t('Downloading {0}... {1}%', s.manifest.name ?? s.id, Math.round(f * 100)); });
      // an updated pack in use: use the new version
      if (s.active) { if (this.kind === 'resource') await packs.applyResources(); else return packs.applyShader(); }
    });
  }

  private remove() {
    const s = this.sel();
    if (s?.installed) this.run('Removing...', () => packs.remove(s.id));
  }

  private config() {
    const s = this.sel();
    if (s?.installed) this.ui.open(new ShaderSettingsScreen(this.ui, this, s.id));
  }

  private fromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.json,application/zip';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 256 * 1024 * 1024) { this.status = '§cThat file is too big'; return; }
      this.run(t('Adding {0}...', f.name), async () => {
        const p = await packs.installFile(f);
        if (p.manifest.kind !== this.kind) return t(p.manifest.kind === 'resource' ? "That's a resource pack: find it under Resource Packs" : "That's a shader pack: find it under Shader Packs");
      });
    };
    input.click();
  }

  private listBox() {
    const W = this.gui.w, H = this.gui.h;
    return { x: W / 2 - 160, y: 32, w: 320, h: H - 32 - 64 };
  }

  override render(ctx: Ctx, mx: number, my: number) {
    const W = this.gui.w;
    if (this.game.world && !this.game.panorama) this.backgroundGradient(ctx);
    else this.gui.dirtBackground(ctx);
    this.gui.textCenter(ctx, this.title, W / 2, 12, '#FFFFFF');
    if (this.status) this.gui.textCenter(ctx, this.fit(this.status, W - 20), W / 2, 22, '#A0A0A0');
    const L = this.listBox();
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(L.x, L.y, L.w, L.h);
    ctx.beginPath();
    ctx.rect(L.x, L.y, L.w, L.h);
    ctx.clip();
    let hover: PackListing | null = null;
    this.list.forEach((p, i) => {
      const y = L.y + 2 + i * ROW - this.scroll;
      if (y + ROW < L.y || y > L.y + L.h) return;
      if (i === this.selected) { ctx.strokeStyle = '#808080'; ctx.strokeRect(L.x + 2.5, y + 0.5, L.w - 5, ROW - 2); }
      if (mx >= L.x && mx < L.x + L.w && my >= y && my < y + ROW && my >= L.y && my < L.y + L.h) hover = p;
      this.icon(ctx, p, L.x + 6, y + 3);
      this.gui.text(ctx, `${p.manifest.name ?? p.id} §7${p.manifest.version}`, L.x + 40, y + 3, p.installed ? '#FFFFFF' : '#C0C0C0');
      this.gui.text(ctx, this.fit(p.manifest.description ?? '', L.w - 46), L.x + 40, y + 13, '#A0A0A0');
      this.gui.text(ctx, this.state(p), L.x + 40, y + 23, '#FFFFFF');
    });
    ctx.restore();
    super.render(ctx, mx, my);
    if (hover) this.gui.tooltip(ctx, this.details(hover), mx, my);
  }

  private icon(ctx: Ctx, p: PackListing, x: number, y: number) {
    const ic = p.manifest.icon ?? '';
    if (ic.startsWith('data:image/')) {
      let img = ICONS.get(ic);
      if (!img) { img = new Image(); img.src = ic; ICONS.set(ic, img); }
      if (img.complete && img.naturalWidth) { ctx.imageSmoothingEnabled = false; ctx.drawImage(img, x, y, 28, 28); return; }
    }
    ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(ic) ? ic : this.kind === 'shader' ? '#4a6a9a' : '#6a8a4a';
    ctx.fillRect(x, y, 28, 28);
    this.gui.textCenter(ctx, (p.manifest.name ?? p.id)[0].toUpperCase(), x + 14, y + 10, '#FFFFFF');
  }

  private state(p: PackListing): string {
    if (!p.installed) return '§9' + t('In the pack repository');
    const parts: string[] = [];
    if (p.active) parts.push(this.kind === 'resource' ? '§a' + t('In use (#{0})', this.game.options.resourcePacks.indexOf(p.id) + 1) : '§a' + t('In use'));
    else parts.push('§7' + t('Downloaded'));
    if (p.update) parts.push('§e' + t('Update: {0}', p.repo!.version));
    if (p.installed.source === 'file') parts.push('§7' + t('from a file'));
    return parts.join('§7' + t(', '));
  }

  private details(p: PackListing): string[] {
    const out = [`§e${p.manifest.name ?? p.id}`, '§7' + t(p.kind === 'resource' ? 'resource pack, version {0}' : 'shader pack, version {0}', p.manifest.version)];
    if (p.manifest.authors?.length) out.push('§7' + t('by {0}', p.manifest.authors.join(', ')));
    if (p.manifest.credit) out.push('§7' + this.fit(p.manifest.credit, 300));
    if (p.repo) out.push(`§7${(p.repo.size / 1048576).toFixed(1)} MB`);
    return out;
  }

  private fit(s: string, w: number): string {
    const f = this.gui.font;
    if (f.width(s) <= w) return s;
    while (s.length > 1 && f.width(s + '...') > w) s = s.slice(0, -1);
    return s + '...';
  }

  override mouseDown(mx: number, my: number, button: number): boolean {
    if (super.mouseDown(mx, my, button)) return true;
    const L = this.listBox();
    if (mx < L.x || mx >= L.x + L.w || my < L.y || my >= L.y + L.h) return false;
    const i = Math.floor((my - L.y - 2 + this.scroll) / ROW);
    if (i >= 0 && i < this.list.length) { this.selected = i; this.update(); }
    return true;
  }
  override wheel(d: number) {
    const L = this.listBox();
    const max = Math.max(0, this.list.length * ROW + 4 - L.h);
    this.scroll = Math.max(0, Math.min(max, this.scroll + d * 18));
  }
  override key(e: KeyboardEvent) {
    if (e.code === 'Escape') { this.ui.open(this.parent); return true; }
    return super.key(e);
  }
}

/** A shader pack's settings, laid out from its manifest. They take effect (the pack is compiled again) on Done. */
export class ShaderSettingsScreen extends Screen {
  private changed = false;
  constructor(ui: UI, private parent: Screen, private id: string) { super(ui); }
  override pausesGame = true;

  override init() {
    const b = packs.shaderBundle(this.id);
    const W = this.gui.w, H = this.gui.h;
    const v = packs.shaderValues(this.id, b);
    const set = (k: string, x: boolean | number) => { packs.setShaderValue(this.id, k, x); v[k] = x; this.changed = true; };
    const list = b?.manifest.settings ?? [];
    // two columns; narrower rows when there are many
    const rows = Math.ceil(list.length / 2), gap = Math.max(21, Math.min(24, Math.floor((H - 72) / Math.max(1, rows))));
    this.widgets = list.map((s, i) => this.widget(s, W / 2 - 155 + (i % 2) * 160, 30 + Math.floor(i / 2) * gap, v, set));
    this.widgets.push(
      new Button(this.ui, W / 2 - 155, H - 28, 150, 20, 'Reset to Defaults', () => { packs.resetShaderValues(this.id); this.changed = true; this.init(); }),
      new Button(this.ui, W / 2 + 5, H - 28, 150, 20, 'Done', () => this.done()),
    );
  }

  private widget(s: ShaderSetting, x: number, y: number, v: Record<string, boolean | number>, set: (k: string, x: boolean | number) => void) {
    switch (s.type) {
      case 'bool':
        return new Button(this.ui, x, y, 150, 20, () => t('{0}: {1}', s.name, t(v[s.id] ? 'ON' : 'OFF')), () => set(s.id, !v[s.id]));
      case 'enum':
        return new Button(this.ui, x, y, 150, 20, () => t('{0}: {1}', s.name, s.labels?.[s.options.indexOf(v[s.id] as number)] ?? v[s.id]), () => {
          set(s.id, s.options[(s.options.indexOf(v[s.id] as number) + 1) % s.options.length]);
        });
      default: {
        const steps = s.step ? Math.round((s.max - s.min) / s.step) : 0;
        const val = (f: number) => { const n = s.min + (s.max - s.min) * f; return s.step ? Math.round(n / s.step) * s.step : n; };
        return new Slider(this.ui, x, y, 150, 20, ((v[s.id] as number) - s.min) / (s.max - s.min || 1), (f) => t('{0}: {1}', s.name, +val(f).toFixed(2)), (f) => set(s.id, val(f)), steps);
      }
    }
  }

  private done() {
    if (this.changed && this.game.options.shaderPack === this.id) void packs.applyShader();
    this.ui.open(this.parent);
  }

  override key(e: KeyboardEvent) {
    if (e.code === 'Escape') { this.done(); return true; }
    return super.key(e);
  }

  override render(ctx: Ctx, mx: number, my: number) {
    if (this.game.world && !this.game.panorama) this.backgroundGradient(ctx);
    else this.gui.dirtBackground(ctx);
    const b = packs.shaderBundle(this.id);
    this.gui.textCenter(ctx, t('{0} Settings', b?.manifest.name ?? this.id), this.gui.w / 2, 12, '#FFFFFF');
    super.render(ctx, mx, my);
    const list = b?.manifest.settings ?? [];
    list.forEach((s, i) => {
      const w = this.widgets[i];
      if (s.description && w && mx >= w.x && my >= w.y && mx < w.x + w.w && my < w.y + w.h) this.gui.tooltip(ctx, [s.description], mx, my);
    });
  }
}
