// Resource and shader packs: what's installed in this browser, what the repository offers, which are in use, and
// putting them to use (textures into the atlas, a shader pack into the renderer). Packs only change how this
// player's game looks: nothing is sent to other players.
import { Storage } from '../game/storage';
import type { Options } from '../game/options';
import type { Client } from '../client/client';
import { TEXTURES } from '../world/blocks';
import { itemSpriteNames } from '../render/itemsprites';
import { setOverrides } from '../render/overrides';
import { fetchPackIndex, downloadPack, importPackFile, parseBundle } from './repo';
import { loadResourcePacks } from './resource';
import type { PackKind, PackPackage, PackRepoEntry, ShaderBundle, ShaderPackSource, SettingValue } from './types';

export interface PackListing {
  id: string;
  kind: PackKind;
  manifest: PackPackage['manifest'];
  installed?: PackPackage;
  repo?: PackRepoEntry;
  /** The repository has another version than the one installed. */
  update: boolean;
  active: boolean;
}

class Packs {
  private installed = new Map<string, PackPackage>();
  private options: Options | null = null;
  private client: Client | null = null;
  /** What the last resource pack load did (for the screen). */
  status = '';
  shaderError = '';

  /** At start-up, before the atlas is built: the chosen resource packs' textures. */
  async boot(options: Options) {
    this.options = options;
    for (const p of await Storage.listPacks()) this.keep(p);
    try { await this.loadResources(); } catch (e) { console.error('resource packs', e); this.status = '§c' + (e as Error).message; }
  }

  /** Once the client exists: the chosen shader pack. */
  async attach(client: Client) {
    this.client = client;
    this.options = client.options;
    await this.applyShader();
  }

  private keep(p: PackPackage) {
    const have = this.installed.get(p.manifest.id);
    if (!have || have.added <= p.added) this.installed.set(p.manifest.id, p);
  }

  private get opts(): Options { return (this.client?.options ?? this.options)!; }

  /** Installed and repository packs of a kind (resource packs in use first, in their order). */
  async listing(kind: PackKind, refresh = false): Promise<PackListing[]> {
    const idx = await fetchPackIndex(refresh);
    const out = new Map<string, PackListing>();
    for (const [id, p] of this.installed) if (p.manifest.kind === kind) out.set(id, { id, kind, manifest: p.manifest, installed: p, update: false, active: false });
    for (const e of idx?.packs ?? []) {
      if (e.kind !== kind) continue;
      const have = out.get(e.id);
      if (have) { have.repo = e; have.update = have.installed!.sha256 !== e.sha256 && have.installed!.source === 'repo'; }
      else out.set(e.id, { id: e.id, kind, manifest: e, repo: e, update: false, active: false });
    }
    const o = this.opts;
    for (const l of out.values()) l.active = kind === 'resource' ? o.resourcePacks.includes(l.id) : o.shaderPack === l.id;
    const order = (l: PackListing) => (kind === 'resource' && l.active ? o.resourcePacks.indexOf(l.id) : 1000);
    return [...out.values()].sort((a, b) => order(a) - order(b) || (a.manifest.name ?? a.id).localeCompare(b.manifest.name ?? b.id));
  }

  /** Download (or update) a pack from the repository. */
  async install(e: PackRepoEntry, onProgress?: (f: number) => void) {
    const old = this.installed.get(e.id);
    const p = await downloadPack(e, onProgress);
    this.installed.set(e.id, p);
    if (old && old.sha256 !== p.sha256) await Storage.deletePack(old.sha256);
    return p;
  }

  async installFile(file: File) {
    const p = await importPackFile(file);
    const old = this.installed.get(p.manifest.id);
    this.installed.set(p.manifest.id, p);
    if (old && old.sha256 !== p.sha256) await Storage.deletePack(old.sha256);
    return p;
  }

  async remove(id: string) {
    const p = this.installed.get(id);
    if (!p) return;
    this.installed.delete(id);
    await Storage.deletePack(p.sha256);
    const o = this.opts;
    if (o.resourcePacks.includes(id)) { o.resourcePacks = o.resourcePacks.filter((x) => x !== id); this.save(); await this.applyResources(); }
    if (o.shaderPack === id) { o.shaderPack = ''; this.save(); await this.applyShader(); }
  }

  private save() { if (this.client) this.client.saveOptions(); }

  // ------------------------------------------------------------------ resource packs
  /** Use these resource packs (highest priority first), downloading any that aren't here yet. */
  async setResourcePacks(ids: string[]) {
    this.opts.resourcePacks = ids.filter((id) => this.installed.get(id)?.manifest.kind === 'resource');
    this.save();
    await this.applyResources();
  }

  private async loadResources() {
    const pkgs = this.opts.resourcePacks.map((id) => this.installed.get(id)).filter((p): p is PackPackage => !!p && p.manifest.kind === 'resource');
    const t0 = performance.now();
    const r = await loadResourcePacks(pkgs, TEXTURES.slice(), itemSpriteNames());
    setOverrides(r);
    this.status = pkgs.length ? `${r.replaced} textures from ${pkgs.length} pack${pkgs.length > 1 ? 's' : ''} (${r.res}x, ${Math.round(performance.now() - t0)} ms)` : '';
  }

  /** Read the chosen resource packs again and rebuild the textures. */
  async applyResources() {
    try { await this.loadResources(); } catch (e) { this.status = '§c' + (e as Error).message; setOverrides({ blocks: new Map(), items: new Map(), sky: new Map() }); }
    this.client?.rebuildAtlas();
  }

  // ------------------------------------------------------------------ shader packs
  shaderBundle(id: string): ShaderBundle | null {
    const p = this.installed.get(id);
    return p && p.manifest.kind === 'shader' ? parseBundle(p.data) : null;
  }

  /** A shader pack's settings as chosen (defaults for the rest). */
  shaderValues(id: string, bundle = this.shaderBundle(id)): Record<string, SettingValue> {
    const saved = this.opts.shaderSettings[id] ?? {}, out: Record<string, SettingValue> = {};
    for (const s of bundle?.manifest.settings ?? []) out[s.id] = saved[s.id] ?? s.default;
    return out;
  }

  setShaderValue(id: string, key: string, v: SettingValue) {
    (this.opts.shaderSettings[id] ??= {})[key] = v;
    this.save();
  }

  resetShaderValues(id: string) {
    delete this.opts.shaderSettings[id];
    this.save();
  }

  /** Use a shader pack ('' for none). Resolves with an error message, or '' when it's running. */
  async setShader(id: string): Promise<string> {
    this.opts.shaderPack = id;
    this.save();
    return this.applyShader();
  }

  async applyShader(): Promise<string> {
    const r = this.client?.renderer;
    if (!r) return '';
    const id = this.opts.shaderPack;
    const bundle = id ? this.shaderBundle(id) : null;
    const src: ShaderPackSource | null = bundle ? { bundle, values: this.shaderValues(id, bundle) } : null;
    this.shaderError = await r.setShaderPack(src);
    if (this.shaderError) console.warn('shader pack:', this.shaderError);
    return this.shaderError;
  }
}

export const packs = new Packs();
