// The mod loader (the page's Fabric Loader): finds the installed mods, checks their dependencies, loads them in
// dependency order and runs their entrypoints, decides which mods are in play (your own in your worlds, the host's
// when you join someone), and keeps workers and guests in step.
//
// Mods are ES modules kept in IndexedDB and imported from blob URLs. Loaded code can't be unloaded, so "disabled"
// only means inactive: its content isn't bound and its hooks don't run; a page reload drops it for good.
import { Storage, type WorldMeta } from '../game/storage';
import { rebuildModRecipes } from '../game/recipes';
import { createContext, commonMc, type Mc, type ModContext } from './api';
import { pageMc, clientApi, pendingAssets } from './page';
import { bind, onBind, workerRegistry, currentMap } from './registry';
import { modState, isActive, reportError } from './state';
import { satisfies, compareVersions } from './semver';
import { session, live, CREATIVE_TABS, MOD_NAMES, type HostModInfo } from './hooks';
import { allConfigValues } from './config';
import { fetchIndex, download, importFile, checkManifest, sha256, type RepoEntry } from './repo';
import type { ModManifest, ModModule, ModPackage } from './types';

/** The game's own version, for mods' `depends: { minecraft: ... }`. */
export const GAME_VERSION = '1.0.0';
/** Biggest mod a host sends a guest over the game connection. */
export const MAX_MOD_TRANSFER = 4 * 1024 * 1024;

export interface LoadedMod { manifest: ModManifest; pkg: ModPackage; module: ModModule; ctx: ModContext }
/** A mod as the Mods screen lists it. */
export interface ModListing {
  id: string;
  manifest: ModManifest;
  installed: ModPackage | null;
  repo: RepoEntry | null;
  enabled: boolean;
  loaded: boolean;
  active: boolean;
  error: string | null;
  update: boolean;
}

interface Settings { installed: Record<string, string>; disabled: string[] }
const SETTINGS = 'mcw.mods';
function readSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS) ?? '{}');
    return { installed: s.installed && typeof s.installed === 'object' ? s.installed : {}, disabled: Array.isArray(s.disabled) ? s.disabled : [] };
  } catch {
    return { installed: {}, disabled: [] };
  }
}

const isClientOnly = (m: ModManifest) => m.environment === 'client';

export class ModLoader {
  /** Mods whose code runs in this page, by id. */
  loaded = new Map<string, LoadedMod>();
  /** Why a mod couldn't be loaded, by id. */
  failed = new Map<string, string>();
  private settings = readSettings();
  private packages = new Map<string, ModPackage>();
  /** Joined a host: its mods are in play instead of ours. */
  private hosted: Set<string> | null = null;

  // ------------------------------------------------------------------ start-up
  /** Load the installed, enabled mods (before the game's client exists, so their textures make the first atlas). */
  async boot() {
    modState.realm = 'page';
    onBind.push(() => {
      rebuildModRecipes((m) => isActive(m));
      live.client?.icons.clear();
    });
    this.installSession();
    const pkgs: ModPackage[] = [];
    for (const [id, sha] of Object.entries(this.settings.installed)) {
      const p = await Storage.getMod(sha);
      if (!p) { this.failed.set(id, 'Missing from this browser\'s storage: install it again'); continue; }
      this.packages.set(id, p);
      if (!this.settings.disabled.includes(id)) pkgs.push(p);
    }
    await this.loadAll(pkgs);
    this.activateOwn();
    bind(null);
  }

  /** Our own mods, the ones enabled in the Mods screen (and loaded). */
  enabledIds(): string[] {
    return [...this.loaded.keys()].filter((id) => this.settings.installed[id] && !this.settings.disabled.includes(id));
  }

  private activateOwn() {
    this.hosted = null;
    modState.active = new Set(this.enabledIds());
  }

  // ------------------------------------------------------------------ loading
  /** Check dependencies across `pkgs` plus what's already loaded; load the ones that can run, in order. */
  async loadAll(pkgs: ModPackage[]) {
    const want = new Map<string, ModPackage>();
    for (const p of pkgs) if (!this.loaded.has(p.manifest.id)) want.set(p.manifest.id, p);
    const version = (id: string) => (id === 'minecraft' ? GAME_VERSION : (want.get(id)?.manifest.version ?? this.loaded.get(id)?.manifest.version));
    // drop mods with unmet dependencies (repeat: dropping one can break another)
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, p] of want) {
        const why = this.problem(p.manifest, version, (d) => want.has(d) || this.loaded.has(d) || d === 'minecraft');
        if (why) { this.failed.set(id, why); want.delete(id); changed = true; }
      }
    }
    // dependencies first
    const order: ModPackage[] = [];
    const state = new Map<string, number>();
    const visit = (id: string, path: string[]): boolean => {
      const s = state.get(id);
      if (s === 2) return true;
      if (s === 1) { this.failed.set(id, `Circular dependency: ${[...path, id].join(' -> ')}`); return false; }
      const p = want.get(id);
      if (!p) return this.loaded.has(id) || id === 'minecraft';
      state.set(id, 1);
      for (const d of Object.keys(p.manifest.depends ?? {})) if (!visit(d, [...path, id])) { state.set(id, 2); want.delete(id); return false; }
      state.set(id, 2);
      order.push(p);
      return true;
    };
    for (const id of [...want.keys()].sort()) visit(id, []);
    for (const p of order) await this.load(p);
    // textures and sprites given as images decode in the background: the atlas needs them
    await Promise.allSettled(pendingAssets.splice(0));
    if (order.length && live.client) live.client.rebuildAtlas();
  }

  private problem(m: ModManifest, version: (id: string) => string | undefined, present: (id: string) => boolean): string | null {
    for (const [d, range] of Object.entries(m.depends ?? {})) {
      if (!present(d)) return `Needs ${d} ${range}`;
      const v = version(d);
      if (v && !satisfies(v, range)) return `Needs ${d} ${range} (found ${v})`;
    }
    for (const [d, range] of Object.entries(m.breaks ?? {})) {
      const v = version(d);
      if (present(d) && v && satisfies(v, range)) return `Can't run with ${d} ${v}`;
    }
    return null;
  }

  /** Import a mod's module and run its entrypoints. */
  private async load(pkg: ModPackage) {
    const m = pkg.manifest;
    const url = URL.createObjectURL(new Blob([pkg.code + `\n//# sourceURL=mod:${m.id}@${m.version}.js`], { type: 'text/javascript' }));
    try {
      const module = (await import(/* @vite-ignore */ url)) as ModModule;
      // (defineProperties, not a spread: the spread would read `client` and `game` once, here, instead of live)
      const mc = Object.defineProperties({ ...commonMc }, Object.getOwnPropertyDescriptors(pageMc));
      const ctx = createContext(m, mc as unknown as Mc, clientApi(m.id));
      this.loaded.set(m.id, { manifest: m, pkg, module, ctx });
      MOD_NAMES.set(m.id, m.name ?? m.id);
      this.failed.delete(m.id);
      // the mod's content counts as active while it registers (its hooks may check)
      const main = module[m.entrypoints?.main ?? 'main'] as ModModule['main'];
      const client = module[m.entrypoints?.client ?? 'client'] as ModModule['client'];
      if (main) await main(ctx);
      if (client) await client(ctx);
      // every mod with items gets a creative tab unless it made its own
      if (!CREATIVE_TABS.some((t) => t.mod === m.id)) ctx.client.creativeTab('items', m.name ?? m.id, () => firstItemOf(m.id));
    } catch (e) {
      reportError(m.id, 'loading', e);
      this.failed.set(m.id, (e as Error).message ?? String(e));
      this.loaded.delete(m.id);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ------------------------------------------------------------------ the Mods screen
  async listing(online = true): Promise<ModListing[]> {
    const idx = online ? await fetchIndex(true) : null;
    const repo = new Map<string, RepoEntry>();
    for (const e of idx?.mods ?? []) {
      const have = repo.get(e.id);
      if (!have || compareVersions(e.version, have.version) > 0) repo.set(e.id, e);
    }
    const ids = new Set([...Object.keys(this.settings.installed), ...repo.keys()]);
    const out: ModListing[] = [];
    for (const id of ids) {
      const installed = this.packages.get(id) ?? null;
      const r = repo.get(id) ?? null;
      const manifest = installed?.manifest ?? r!;
      if (!manifest) continue;
      out.push({
        id, manifest, installed, repo: r,
        enabled: !!installed && !this.settings.disabled.includes(id),
        loaded: this.loaded.has(id),
        active: modState.active.has(id),
        error: this.failed.get(id) ?? modState.errors.get(id)?.at(-1) ?? null,
        update: !!installed && !!r && r.sha256 !== installed.sha256 && compareVersions(r.version, installed.manifest.version) >= 0,
      });
    }
    return out.sort((a, b) => (a.manifest.name ?? a.id).localeCompare(b.manifest.name ?? b.id));
  }

  private save() {
    try { localStorage.setItem(SETTINGS, JSON.stringify(this.settings)); } catch { /* private mode */ }
  }

  /** Install (or update to) a package and enable it; loads it right away when possible. */
  async install(pkg: ModPackage): Promise<string | null> {
    const id = pkg.manifest.id;
    const was = this.loaded.get(id);
    this.packages.set(id, pkg);
    this.settings.installed[id] = pkg.sha256;
    this.settings.disabled = this.settings.disabled.filter((d) => d !== id);
    this.save();
    if (was && was.pkg.sha256 !== pkg.sha256) return 'Reload the page to switch to the new version';
    if (!was) {
      // its dependencies may be installed but disabled: they come along
      await this.loadAll([pkg, ...this.dependenciesOf(pkg.manifest)]);
    }
    this.refreshOwn();
    return this.failed.get(id) ?? null;
  }

  private dependenciesOf(m: ModManifest): ModPackage[] {
    const out: ModPackage[] = [];
    for (const d of Object.keys(m.depends ?? {})) {
      const p = this.packages.get(d);
      if (p && !this.loaded.has(d)) out.push(p, ...this.dependenciesOf(p.manifest));
    }
    return out;
  }

  async installFromRepo(e: RepoEntry): Promise<string | null> {
    try {
      // dependencies from the repository too
      const idx = await fetchIndex();
      for (const d of Object.keys(e.depends ?? {})) {
        if (d === 'minecraft' || this.settings.installed[d]) continue;
        const de = idx?.mods.find((x) => x.id === d && satisfies(x.version, e.depends![d]));
        if (de) await this.installFromRepo(de);
      }
      return await this.install(await download(e));
    } catch (err) {
      return (err as Error).message;
    }
  }

  async installFile(code: string): Promise<string | null> {
    try {
      return await this.install(await importFile(code));
    } catch (err) {
      return (err as Error).message;
    }
  }

  async setEnabled(id: string, on: boolean) {
    const dis = new Set(this.settings.disabled);
    if (on) dis.delete(id);
    else dis.add(id);
    this.settings.disabled = [...dis];
    this.save();
    if (on && !this.loaded.has(id)) {
      const p = this.packages.get(id);
      if (p) await this.loadAll([p, ...this.dependenciesOf(p.manifest)]);
    }
    this.refreshOwn();
  }

  async remove(id: string) {
    const sha = this.settings.installed[id];
    delete this.settings.installed[id];
    this.settings.disabled = this.settings.disabled.filter((d) => d !== id);
    this.save();
    this.packages.delete(id);
    if (sha) await Storage.deleteMod(sha);
    this.refreshOwn();
  }

  /** Our mod choices changed: outside anyone else's game, they're in play from now on (rebinding the menus' ids). */
  private refreshOwn() {
    if (this.hosted || live.game || live.client?.remote) return;
    this.activateOwn();
    bind(null);
  }

  // ------------------------------------------------------------------ multiplayer and workers
  /** Mods every player must run: ours that change the game itself. */
  hostMods(): HostModInfo[] {
    return [...modState.active].map((id) => this.loaded.get(id)!).filter((l) => l && !isClientOnly(l.manifest))
      .map((l) => ({ id: l.manifest.id, version: l.manifest.version, sha256: l.pkg.sha256, name: l.manifest.name }));
  }

  /** Make the host's set of mods ours for this game: from this browser, the repository, or the host itself. */
  async syncWithHost(list: HostModInfo[], request: (id: string) => Promise<{ manifest: unknown; code: string } | null>, confirm: (names: string[]) => Promise<boolean>): Promise<string | null> {
    if (!Array.isArray(list) || list.length > 64) return 'Bad mod list from the host';
    const need: ModPackage[] = [];
    const fromHost: { info: HostModInfo; get: () => Promise<ModPackage> }[] = [];
    let idx: Awaited<ReturnType<typeof fetchIndex>> | undefined;
    for (const info of list) {
      if (typeof info?.id !== 'string' || typeof info.sha256 !== 'string') return 'Bad mod list from the host';
      const have = this.loaded.get(info.id);
      if (have) {
        if (have.pkg.sha256 === info.sha256) continue;
        return `The host runs ${info.name ?? info.id} ${info.version}, but this page has ${have.manifest.version} loaded: reload the page and join again`;
      }
      const stored = await Storage.getMod(info.sha256);
      if (stored) { need.push(stored); continue; }
      idx ??= await fetchIndex();
      const e = idx?.mods.find((m) => m.sha256 === info.sha256);
      if (e) {
        try { need.push(await download(e)); continue; } catch { /* fall back to the host */ }
      }
      fromHost.push({
        info,
        get: async () => {
          const got = await request(info.id);
          if (!got || typeof got.code !== 'string') throw new Error(`The host couldn't send ${info.name ?? info.id}`);
          if ((await sha256(got.code)) !== info.sha256) throw new Error(`${info.name ?? info.id} arrived damaged`);
          const pkg: ModPackage = { manifest: checkManifest(got.manifest), code: got.code, sha256: info.sha256, source: 'host', added: Date.now() };
          await Storage.putMod(pkg);
          return pkg;
        },
      });
    }
    if (fromHost.length) {
      // code from another player's browser: only with the player's say-so
      if (!(await confirm(fromHost.map((f) => `${f.info.name ?? f.info.id} ${f.info.version}`)))) return 'Declined the host\'s mods';
      try {
        for (const f of fromHost) need.push(await f.get());
      } catch (e) {
        return (e as Error).message;
      }
    }
    await this.loadAll(need);
    for (const info of list) if (!this.loaded.has(info.id)) return `Couldn't load ${info.name ?? info.id}: ${this.failed.get(info.id) ?? 'unknown error'}`;
    // the host's mods, plus our own that only change what we see
    const ids = new Set(list.map((m) => m.id));
    for (const id of this.enabledIds()) if (isClientOnly(this.loaded.get(id)!.manifest)) ids.add(id);
    this.hosted = ids;
    modState.active = ids;
    return null;
  }

  async packageFor(id: string) {
    const l = this.loaded.get(id);
    if (!l || !modState.active.has(id) || l.pkg.code.length > MAX_MOD_TRANSFER) return null;
    return { manifest: l.manifest, code: l.pkg.code, sha256: l.pkg.sha256 };
  }

  /** First message for a new worker: the texture numbering, the active mods' code and the id numbering. */
  workerInit() {
    const mods = [...modState.active].map((id) => this.loaded.get(id)).filter((l): l is LoadedMod => !!l)
      .map((l) => ({ manifest: l.manifest, code: l.pkg.code }));
    return { type: 'mods', mods, registry: workerRegistry(), configs: allConfigValues() };
  }

  private installSession() {
    // workers need the numbering too when a world only has placeholders for missing mods
    session.workerInit = () => (modState.active.size || Object.keys(currentMap().blocks).length ? this.workerInit() : null);
    session.hostMods = () => this.hostMods();
    session.offered = () => this.hostMods();
    session.packageFor = (id) => this.packageFor(id);
    session.syncWithHost = (list, request, confirm) => this.syncWithHost(list, request, confirm);
    session.restore = () => { if (this.hosted) { this.activateOwn(); bind(null); } };
    session.missingFor = (meta) => this.missingFor(meta);
    session.beginWorld = (meta: WorldMeta) => {
      this.activateOwn();
      meta.registry = bind(meta.registry);
      const mods: Record<string, string> = {};
      for (const id of modState.active) mods[id] = this.loaded.get(id)!.manifest.version;
      meta.mods = mods;
    };
  }

  /** Mods a saved world used that aren't in play now. */
  missingFor(meta: WorldMeta): string[] {
    const enabled = new Set(this.enabledIds());
    return Object.keys(meta.mods ?? {}).filter((id) => !enabled.has(id));
  }
}

function firstItemOf(mod: string): number {
  for (const [id, d] of commonMc.ITEMS) if (d.mod === mod && !d.missing) return id;
  return 0;
}

export const mods = new ModLoader();
