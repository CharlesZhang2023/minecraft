// The Mods screen (Mod Menu style): installed mods and the ones the mod repository offers; install, update,
// enable / disable, remove, add from a file, and each mod's settings.
import { Screen, Button, Slider, TextField } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { mods, type ModListing } from '../mod/loader';
import { CONFIGS, type ConfigEntry } from '../mod/config';
import { CONFIG_SCREENS } from '../mod/hooks';
import { modState } from '../mod/state';
import { itemByName } from '../game/items';

const ROW = 36;

export class ModsScreen extends Screen {
  override touchScrolls = true;
  private list: ModListing[] = [];
  private selected = -1;
  private scroll = 0;
  private status = 'Looking for mods...';
  private busy = false;
  private btn: Record<string, Button> = {};
  private lastClick = 0;

  constructor(ui: UI, private parent: Screen) { super(ui); }

  override init() {
    const W = this.gui.w, H = this.gui.h;
    const b = (k: string, x: number, y: number, w: number, label: string | (() => string), fn: () => void) => (this.btn[k] = new Button(this.ui, x, y, w, 20, label, fn));
    this.widgets = [
      b('toggle', W / 2 - 154, H - 52, 74, () => (this.sel()?.enabled ? 'Disable' : 'Enable'), () => this.toggle()),
      b('install', W / 2 - 76, H - 52, 74, () => (this.sel()?.update ? 'Update' : this.sel()?.installed ? 'Reinstall' : 'Install'), () => this.install()),
      b('remove', W / 2 + 2, H - 52, 74, 'Remove', () => this.remove()),
      b('config', W / 2 + 80, H - 52, 74, 'Config...', () => this.config()),
      b('file', W / 2 - 154, H - 28, 150, 'Add from File...', () => this.fromFile()),
      b('done', W / 2 + 4, H - 28, 150, 'Done', () => this.ui.open(this.parent)),
    ];
    this.refresh();
  }

  private sel(): ModListing | undefined { return this.list[this.selected]; }

  private async refresh(note?: string) {
    this.list = await mods.listing(true);
    if (this.selected >= this.list.length) this.selected = this.list.length - 1;
    if (this.selected < 0 && this.list.length) this.selected = 0;
    this.status = note ?? (this.list.length ? '' : 'No mods installed, and the mod repository is unreachable or empty');
    this.update();
  }

  private update() {
    const s = this.sel(), b = this.btn;
    const free = !this.busy;
    b.toggle.enabled = free && !!s?.installed;
    b.install.enabled = free && !!s?.repo && (!s.installed || s.update || s.installed.sha256 !== s.repo.sha256);
    b.remove.enabled = free && !!s?.installed;
    b.config.enabled = !!s && s.loaded && (CONFIGS.has(s.id) || CONFIG_SCREENS.has(s.id));
    b.file.enabled = free;
  }

  private async run(label: string, fn: () => Promise<string | null | void>) {
    this.busy = true;
    this.status = label;
    this.update();
    let err: string | null | void = null;
    try { err = await fn(); } catch (e) { err = (e as Error).message; }
    this.busy = false;
    await this.refresh(err ? '§c' + err : this.inGame() ? 'Changes apply to the next world you open' : '');
  }

  private inGame() { return !!this.game.world && !this.game.panorama; }

  private toggle() {
    const s = this.sel();
    if (s?.installed) this.run(s.enabled ? 'Disabling...' : 'Enabling...', () => mods.setEnabled(s.id, !s.enabled));
  }
  private install() {
    const s = this.sel();
    if (s?.repo) this.run(`Installing ${s.manifest.name ?? s.id}...`, () => mods.installFromRepo(s.repo!));
  }
  private remove() {
    const s = this.sel();
    if (s?.installed) this.run('Removing...', async () => { await mods.remove(s.id); return s.loaded ? 'Removed (still in memory until the page reloads)' : null; });
  }
  private config() {
    const s = this.sel();
    if (!s) return;
    const own = CONFIG_SCREENS.get(s.id);
    if (own) this.ui.open(own(this));
    else if (CONFIGS.has(s.id)) this.ui.open(new ModConfigScreen(this.ui, this, s.id, s.manifest.name ?? s.id));
  }
  private fromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js,.mjs,text/javascript';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) { this.status = '§cThat file is too big for a mod'; return; }
      this.run(`Adding ${f.name}...`, async () => mods.installFile(await f.text()));
    };
    input.click();
  }

  private listBox() {
    const W = this.gui.w, H = this.gui.h;
    return { x: W / 2 - 160, y: 32, w: 320, h: H - 32 - 64 };
  }

  override render(ctx: Ctx, mx: number, my: number) {
    const W = this.gui.w;
    this.gui.dirtBackground(ctx);
    this.gui.textCenter(ctx, 'Mods', W / 2, 12, '#FFFFFF');
    if (this.status) this.gui.textCenter(ctx, this.status, W / 2, 22, '#A0A0A0');
    const L = this.listBox();
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(L.x, L.y, L.w, L.h);
    ctx.beginPath();
    ctx.rect(L.x, L.y, L.w, L.h);
    ctx.clip();
    let hover: ModListing | null = null;
    this.list.forEach((m, i) => {
      const y = L.y + 2 + i * ROW - this.scroll;
      if (y + ROW < L.y || y > L.y + L.h) return;
      if (i === this.selected) {
        ctx.strokeStyle = '#808080';
        ctx.strokeRect(L.x + 2.5, y + 0.5, L.w - 5, ROW - 2);
      }
      if (mx >= L.x && mx < L.x + L.w && my >= y && my < y + ROW && my >= L.y && my < L.y + L.h) hover = m;
      this.icon(ctx, m, L.x + 6, y + 9);
      const name = `${m.manifest.name ?? m.id} §7${m.manifest.version}`;
      this.gui.text(ctx, name, L.x + 30, y + 3, m.installed ? '#FFFFFF' : '#C0C0C0');
      this.gui.text(ctx, this.fit(m.manifest.description ?? '', L.w - 36), L.x + 30, y + 13, '#A0A0A0');
      this.gui.text(ctx, this.state(m), L.x + 30, y + 23, '#FFFFFF');
    });
    ctx.restore();
    super.render(ctx, mx, my);
    if (hover) this.gui.tooltip(ctx, this.details(hover), mx, my);
  }

  private icon(ctx: Ctx, m: ModListing, x: number, y: number) {
    const ic = m.manifest.icon ?? '';
    const item = ic.startsWith('item:') ? itemByName(ic.slice(5)) : undefined;
    if (item && !item.missing) { ctx.drawImage(this.game.icons.get(item.id), x, y, 16, 16); return; }
    ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(ic) ? ic : '#6a6a8a';
    ctx.fillRect(x, y, 16, 16);
    this.gui.textCenter(ctx, (m.manifest.name ?? m.id)[0].toUpperCase(), x + 8, y + 4, '#FFFFFF');
  }

  private state(m: ModListing): string {
    if (m.error && m.installed) return '§c' + this.fit(m.error, 270);
    if (!m.installed) return '§9Available in the mod repository';
    const parts = [m.enabled ? '§aEnabled' : '§7Disabled'];
    if (m.active) parts.push('§2in play');
    else if (m.enabled && !m.loaded) parts.push('§7not loaded');
    if (m.update) parts.push(`§eUpdate: ${m.repo!.version}`);
    if (m.manifest.environment === 'client') parts.push('§3client only');
    return parts.join('§7, ');
  }

  private details(m: ModListing): string[] {
    const out = [`§e${m.manifest.name ?? m.id}`, `§7id: ${m.id}, version ${m.manifest.version}`];
    if (m.manifest.authors?.length) out.push(`§7by ${m.manifest.authors.join(', ')}`);
    const deps = Object.entries(m.manifest.depends ?? {}).map(([d, r]) => `${d} ${r}`);
    if (deps.length) out.push(`§7needs ${deps.join(', ')}`);
    if (m.installed) out.push(`§7from ${({ repo: 'the mod repository', file: 'a file', host: 'a game host' } as const)[m.installed.source]}`);
    for (const e of (modState.errors.get(m.id) ?? []).slice(-3)) out.push('§c' + this.fit(e, 300));
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
    if (i >= 0 && i < this.list.length) {
      const now = performance.now();
      if (i === this.selected && now - this.lastClick < 300) this.config();
      this.selected = i;
      this.lastClick = now;
      this.update();
    }
    return true;
  }
  override wheel(d: number) {
    const L = this.listBox();
    const max = Math.max(0, this.list.length * ROW + 4 - L.h);
    this.scroll = Math.max(0, Math.min(max, this.scroll + d * 18));
  }
}

/** A mod's settings, laid out from its config schema. */
export class ModConfigScreen extends Screen {
  private capture: string | null = null;
  constructor(ui: UI, private parent: Screen, private mod: string, private title: string) { super(ui); }

  override init() {
    const cfg = CONFIGS.get(this.mod);
    if (!cfg) { this.widgets = []; return; }
    const W = this.gui.w, H = this.gui.h;
    const v = cfg.values;
    this.widgets = [];
    Object.entries(cfg.schema).forEach(([k, e], i) => {
      const x = W / 2 - 155 + (i % 2) * 160, y = 36 + Math.floor(i / 2) * 26;
      this.widgets.push(this.widget(k, e, x, y, v, () => cfg.save()));
    });
    this.widgets.push(
      new Button(this.ui, W / 2 - 155, H - 28, 150, 20, 'Reset to Defaults', () => { cfg.reset(); this.init(); }),
      new Button(this.ui, W / 2 + 5, H - 28, 150, 20, 'Done', () => this.ui.open(this.parent)),
    );
  }

  private widget(k: string, e: ConfigEntry, x: number, y: number, v: Record<string, unknown>, save: () => void) {
    const label = e.label ?? k;
    switch (e.type) {
      case 'boolean':
        return new Button(this.ui, x, y, 150, 20, () => `${label}: ${v[k] ? 'ON' : 'OFF'}`, () => { v[k] = !v[k]; save(); });
      case 'enum':
        return new Button(this.ui, x, y, 150, 20, () => `${label}: ${e.labels?.[e.options.indexOf(v[k] as string)] ?? v[k]}`, () => {
          v[k] = e.options[(e.options.indexOf(v[k] as string) + 1) % e.options.length];
          save();
        });
      case 'number': {
        const steps = e.step ? Math.round((e.max - e.min) / e.step) : 0;
        const val = (f: number) => { const n = e.min + (e.max - e.min) * f; return e.step ? Math.round(n / e.step) * e.step : n; };
        return new Slider(this.ui, x, y, 150, 20, ((v[k] as number) - e.min) / (e.max - e.min || 1), (f) => `${label}: ${+val(f).toFixed(2)}`, (f) => { v[k] = val(f); save(); }, steps);
      }
      case 'key':
        return new Button(this.ui, x, y, 150, 20, () => `${label}: ${this.capture === k ? '> ? <' : String(v[k]).replace(/^Key|^Digit/, '')}`, () => { this.capture = k; });
      default: {
        const t = new TextField(this.ui, x, y + 10, 150, 14, String(v[k] ?? ''), e.maxLength ?? 64);
        const char = t.char.bind(t), key = t.key.bind(t);
        t.char = (ch) => { const r = char(ch); v[k] = t.value; save(); return r; };
        t.key = (ev) => { const r = key(ev); v[k] = t.value; save(); return r; };
        return t;
      }
    }
  }

  override key(e: KeyboardEvent): boolean {
    if (this.capture) {
      const cfg = CONFIGS.get(this.mod)!;
      if (e.code !== 'Escape') { cfg.values[this.capture] = e.code; cfg.save(); }
      this.capture = null;
      return true;
    }
    return super.key(e);
  }

  override render(ctx: Ctx, mx: number, my: number) {
    if (this.game.world && !this.game.panorama) this.backgroundGradient(ctx);
    else this.gui.dirtBackground(ctx);
    this.gui.textCenter(ctx, `${this.title} Settings`, this.gui.w / 2, 14, '#FFFFFF');
    const cfg = CONFIGS.get(this.mod);
    if (cfg) Object.entries(cfg.schema).forEach(([, e], i) => {
      if (e.type !== 'string') return;
      const x = this.gui.w / 2 - 155 + (i % 2) * 160, y = 36 + Math.floor(i / 2) * 26;
      this.gui.text(ctx, e.label ?? '', x, y, '#A0A0A0');
    });
    super.render(ctx, mx, my);
    for (const [k, e] of Object.entries(cfg?.schema ?? {})) {
      const w = this.widgets.find((x) => (x as Button).label && typeof (x as Button).label === 'function' && ((x as Button).label as () => string)().startsWith((e.label ?? k) + ':'));
      if (w && e.description && mx >= w.x && my >= w.y && mx < w.x + w.w && my < w.y + w.h) this.gui.tooltip(ctx, [e.description], mx, my);
    }
  }
}
