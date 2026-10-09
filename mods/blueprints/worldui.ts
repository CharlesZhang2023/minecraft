// The world list's Import Java World and Export to Java screens (Singleplayer, More...).
import type { ModContext, UI, Ctx } from '../sdk';
import { openZip, folderArchive, type Archive } from './zip';
import { scanWorld, importWorld, exportWorld, type Scan } from './worldio';
import { versionName } from './vanilla';
import { WORLD_VERSION_NAME, type Dim } from './javaworld';

type WorldMeta = Awaited<ReturnType<ModContext['mc']['storage']['listWorlds']>>[number];
const IMPORT_AREAS: (number | null)[] = [16, 32, 64, 128, null];
const EXPORT_AREAS = [0, 8, 16, 32, 64];

export function worldScreens(mod: ModContext) {
  const { Screen, Button, TextField } = mod.mc;

  abstract class Base extends Screen {
    override pausesGame = false;
    status = '';
    error = '';
    progress = -1;
    constructor(ui: UI, protected back: () => void) { super(ui); }
    btn(x: number, y: number, w: number, label: string | (() => string), fn: () => void, enabled: () => boolean = () => true) {
      const b = new Button(this.ui, x, y, w, 20, label, fn);
      const base = b.render.bind(b);
      b.render = (ctx: Ctx, mx: number, my: number) => { b.enabled = enabled() && this.progress < 0; base(ctx, mx, my); };
      this.widgets.push(b);
      return b;
    }
    drawCommon(ctx: Ctx, title: string) {
      this.gui.dirtBackground(ctx);
      this.gui.textCenter(ctx, title, this.gui.w / 2, 12, '#ffffff');
      const W = this.gui.w, H = this.gui.h;
      if (this.progress >= 0) {
        const w = Math.min(240, W - 40), x = W / 2 - w / 2, y = H - 64;
        ctx.fillStyle = '#202020'; ctx.fillRect(x, y, w, 6);
        ctx.fillStyle = '#80ff80'; ctx.fillRect(x, y, w * Math.min(1, this.progress), 6);
      }
      if (this.status) this.gui.textCenter(ctx, this.status.slice(0, 80), W / 2, H - 54, '#c0c0c0');
      if (this.error) this.gui.textCenter(ctx, this.error.slice(0, 90), W / 2, H - 44, '#ff8080');
    }
    override key(e: KeyboardEvent) {
      if (e.code === 'Escape' && this.progress < 0) { this.back(); return true; }
      return super.key(e);
    }
  }

  class ImportScreen extends Base {
    archive: Archive | null = null;
    scan: Scan | null = null;
    name!: InstanceType<typeof TextField>;
    area = 1;
    dims: Record<Dim, boolean> = { overworld: true, nether: true, end: true };
    result = '';
    override init() {
      this.widgets = [];
      const W = this.gui.w, H = this.gui.h, cx = Math.floor(W / 2);
      if (this.result) {
        this.btn(cx - 100, H - 28, 200, 'Done', () => this.back());
        return;
      }
      if (!this.scan) {
        this.btn(cx - 100, 60, 200, 'Choose a .zip of the World...', () => this.pick(false));
        this.btn(cx - 100, 84, 200, 'Choose the World Folder...', () => this.pick(true), () => !mod.mc.device.touch);
        this.btn(cx - 100, H - 28, 200, 'Cancel', () => this.back());
        return;
      }
      this.name = new TextField(this.ui, cx - 100, 78, 200, 20, this.name?.value ?? this.scan.level.name, 40, 'World name');
      this.widgets.push(this.name);
      const areaLabel = () => { const a = IMPORT_AREAS[this.area]; return a === null ? 'Area: Everything' : `Area: ${a} chunks around you`; };
      this.btn(cx - 100, 104, 200, areaLabel, () => { this.area = (this.area + 1) % IMPORT_AREAS.length; });
      this.btn(cx - 100, 128, 98, () => `Nether: ${this.dims.nether ? 'Yes' : 'No'}`, () => { this.dims.nether = !this.dims.nether; }, () => !!this.scan?.regions.nether.length);
      this.btn(cx + 2, 128, 98, () => `The End: ${this.dims.end ? 'Yes' : 'No'}`, () => { this.dims.end = !this.dims.end; }, () => !!this.scan?.regions.end.length);
      this.btn(cx - 100, H - 28, 98, 'Import', () => this.run());
      this.btn(cx + 2, H - 28, 98, 'Cancel', () => this.back());
    }
    pick(folder: boolean) {
      const inp = document.createElement('input');
      inp.type = 'file';
      if (folder) inp.webkitdirectory = true;
      else inp.accept = '.zip';
      inp.onchange = async () => {
        const files = [...(inp.files ?? [])];
        if (!files.length) return;
        this.error = '';
        this.status = 'Looking at the world...';
        try {
          this.archive = folder ? folderArchive(files) : await openZip(files[0]);
          this.scan = await scanWorld(this.archive);
          this.status = '';
        } catch (e) { this.error = (e as Error).message; this.status = ''; }
        this.init();
      };
      inp.click();
    }
    async run() {
      if (!this.scan || !this.archive) return;
      this.error = '';
      this.progress = 0;
      try {
        const dims = (Object.keys(this.dims) as Dim[]).filter((d) => this.dims[d] && (d === 'overworld' || this.scan!.regions[d].length));
        const r = await importWorld(this.archive, this.scan, { name: this.name.value.trim(), radius: IMPORT_AREAS[this.area], dims }, (done, total, what) => { this.progress = total ? done / total : 0; this.status = what; });
        this.result = `Imported ${r.chunks.toLocaleString()} chunks and ${r.mobs} mobs.`;
        this.status = r.substituted.length ? `${r.substituted.length} kinds of newer blocks got stand-ins (deepslate as stone and so on).` : '';
      } catch (e) { this.error = 'Import failed: ' + (e as Error).message; }
      this.progress = -1;
      this.init();
    }
    override render(ctx: Ctx, mx: number, my: number) {
      this.drawCommon(ctx, 'Import Java World');
      const cx = this.gui.w / 2;
      if (this.result) {
        this.gui.textCenter(ctx, this.result, cx, 60, '#80ff80');
        this.gui.textCenter(ctx, 'It is in the world list now.', cx, 74, '#c0c0c0');
      } else if (!this.scan) {
        this.gui.textCenter(ctx, 'A world from Java Edition 1.13 or newer: its folder in .minecraft/saves,', cx, 30, '#c0c0c0');
        this.gui.textCenter(ctx, 'or a .zip of that folder (on phones, the .zip).', cx, 42, '#c0c0c0');
      } else {
        const s = this.scan, p = s.player;
        this.gui.textCenter(ctx, `${s.level.name}: Java ${versionName(s.level.dataVersion)}, ${s.regions.overworld.length + s.regions.nether.length + s.regions.end.length} region files`, cx, 30, '#ffffff');
        this.gui.textCenter(ctx, p ? `You: ${Math.floor(p.data.x as number)}, ${Math.floor(p.data.y as number)}, ${Math.floor(p.data.z as number)} in the ${p.dim === 'overworld' ? 'Overworld' : p.dim === 'nether' ? 'Nether' : 'End'}` : `Spawn: ${s.level.spawn.join(', ')}`, cx, 42, '#c0c0c0');
        this.gui.textCenter(ctx, 'Heights 0-255 come over (this game\'s range); land beyond the area is this game\'s own.', cx, 56, '#a0a0a0');
        this.gui.text(ctx, 'Name', cx - 100, 68, '#a0a0a0');
      }
      super.render(ctx, mx, my);
    }
  }

  class ExportScreen extends Base {
    area = 2;
    result = '';
    constructor(ui: UI, back: () => void, private world: WorldMeta) { super(ui, back); }
    override init() {
      this.widgets = [];
      const W = this.gui.w, H = this.gui.h, cx = Math.floor(W / 2);
      if (this.result) { this.btn(cx - 100, H - 28, 200, 'Done', () => this.back()); return; }
      this.btn(cx - 100, 80, 200, () => (EXPORT_AREAS[this.area] ? `Area: ${EXPORT_AREAS[this.area]} chunks around you` : 'Area: only changed chunks'), () => { this.area = (this.area + 1) % EXPORT_AREAS.length; });
      this.btn(cx - 100, H - 28, 98, 'Export', () => this.run());
      this.btn(cx + 2, H - 28, 98, 'Cancel', () => this.back());
    }
    async run() {
      this.error = '';
      this.progress = 0;
      try {
        const r = await exportWorld(this.world, { radius: EXPORT_AREAS[this.area] }, (done, total, what) => { this.progress = total ? done / total : 0; this.status = what; });
        const url = URL.createObjectURL(r.zip);
        const a = document.createElement('a');
        a.href = url;
        a.download = r.file;
        a.click();
        this.result = `Saved ${r.file}: ${r.chunks.toLocaleString()} chunks, ${r.mobs} mobs.`;
        this.status = 'Unzip it into .minecraft/saves and open it in Java Edition.';
      } catch (e) { this.error = 'Export failed: ' + (e as Error).message; }
      this.progress = -1;
      this.init();
    }
    override render(ctx: Ctx, mx: number, my: number) {
      this.drawCommon(ctx, 'Export to Java Edition');
      const cx = this.gui.w / 2;
      if (this.result) this.gui.textCenter(ctx, this.result, cx, 60, '#80ff80');
      else {
        this.gui.textCenter(ctx, this.world.name, cx, 30, '#ffffff');
        this.gui.textCenter(ctx, `A Java ${WORLD_VERSION_NAME} world (newer versions upgrade it when they open it).`, cx, 44, '#c0c0c0');
        this.gui.textCenter(ctx, 'Every changed chunk goes, and the area around you. Java makes its own land beyond.', cx, 56, '#a0a0a0');
      }
      super.render(ctx, mx, my);
    }
  }

  mod.client.worldAction({ label: 'Import Java World...', run: (ui, _w, back) => ui.open(new ImportScreen(ui, back)) });
  mod.client.worldAction({ label: 'Export to Java...', needsWorld: true, run: (ui, w, back) => { if (w) ui.open(new ExportScreen(ui, back, w)); } });
  return { ImportScreen, ExportScreen };
}
