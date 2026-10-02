// The simulation (an "integrated server"): worlds, entities, block ticks, redstone and every player's actions.
// It never draws anything. Each player is a ServerPlayer talking to a client over a connection; single-player is
// the same thing with the client in this page on a loopback connection.
//
// Gameplay code reaches for `game.player`, `game.world`, `game.input`, `game.ui`... as if there were one player.
// Those follow the current context: the dimension being simulated and, while a player's own action runs (mining,
// using an item, a click in their chest), that player.
import { World, Dimension, Chunk } from '../world/world';
import { Player, GameMode } from './player';
import { findPortal, buildPortal } from './portal';
import { raycastBlocks, BlockHit } from './raycast';
import { BLOCKS, B } from '../world/blocks';
import { ItemStack, stack, I, getItem } from './items';
import { Storage, WorldMeta } from './storage';
import { Entity } from '../entity/entity';
import { LivingEntity } from '../entity/living';
import { ItemEntity, Fireball } from '../entity/item';
import { Boat } from '../entity/boat';
import { Minecart } from '../entity/minecart';
import { buildPending, enterGateway } from './gateways';
import { BlockTicker } from './blockticks';
import { Interaction } from './interact';
import { Spawner } from '../entity/spawner';
import { Weather } from './weather';
import { createEntity } from '../entity/registry';
import { rayAABB } from '../math';
import { Random } from '../noise';
import { BIOMES } from '../world/biomes';
import { Commands } from './commands';
import { Achievements } from './achievements';
import { Redstone } from './redstone';
import { Pistons } from './pistons';
import { Devices } from './devices';
import { Brewing } from './brewing';
import { END_PLATFORM } from '../world/endgen';
import { EnderDragon, buildExitPortal } from '../entity/dragon';
import { tickFurnaces } from './furnace';
import { SOUND_FOR } from './audio';
import type { Conn, Msg } from '../net/conn';
import { ServerPlayer, NetPlayer } from '../server/splayer';
import { ServerAudio, BroadcastUI, fxSink, VirtualInput } from '../server/sui';
import { captureState, sig, encodeValue, State } from '../net/replicate';
import type { Particles } from './particles';

export const TICK_MS = 50;

/** One loaded dimension: its world, entities (players included) and the systems that run it. */
export class Dim {
  entities: Entity[] = [];
  ticker: BlockTicker;
  redstone: Redstone;
  pistons: Pistons;
  devices: Devices;
  brewing: Brewing;
  spawner: Spawner;
  /** Interaction for world-made events (explosions, falling blocks) that no player is behind. */
  interact: Interaction;
  emptyTicks = 0;
  /** Replication: each entity's encoded fields this tick, what changed since the last, and comparable copies. */
  states = new Map<number, State>();
  deltas = new Map<number, State>();
  sigs = new Map<number, Map<string, unknown>>();
  pistonsWere = false;
  constructor(public world: World, g: Game) {
    this.ticker = new BlockTicker(g, world);
    this.redstone = new Redstone(g);
    this.pistons = new Pistons(g);
    this.devices = new Devices(g);
    this.brewing = new Brewing(g);
    this.spawner = new Spawner(g);
    this.interact = new Interaction(g);
  }
}

const NO_INPUT = new VirtualInput();

export class Game {
  meta: WorldMeta | null = null;
  dims = new Map<Dimension, Dim>();
  /** The dimension being simulated right now (gameplay code's `world`, `entities`, `ticker`...). */
  dim: Dim | null = null;
  players: ServerPlayer[] = [];
  /** The player whose action is running right now. */
  ctx: ServerPlayer | null = null;
  time = 0;
  ticks = 0;
  doDaylightCycle = true;
  weather: Weather;
  commands: Commands;
  audio: ServerAudio;
  particles: Particles;
  options = { difficulty: 2 };
  readonly panorama = false;
  rng = new Random(Date.now() & 0xffffff);
  /** Single-player pause (the pause menu stops the world unless other people are playing). */
  paused = false;
  /** Sounds without a position made while replaying a player's clicks are their client's own business. */
  muteUi = false;
  /** Largest view distance a player can ask for. */
  maxViewDistance = 12;
  /**
   * How far around each player the world is loaded and simulated (mobs, crops, redstone). Beyond it, clients draw
   * terrain they generated themselves, plus any changed chunks read from disk.
   */
  simDistance = 6;
  lastSave = 0;
  saving = false;
  closed = false;
  private broadcast = new BroadcastUI(this);
  private loading = new Map<Dimension, Promise<Dim>>();
  private noAchievements: Achievements;
  /** Called when someone joins or leaves (the host's player list). */
  onPlayersChanged: () => void = () => {};

  constructor() {
    this.audio = new ServerAudio(this);
    this.particles = fxSink(this);
    this.weather = new Weather(this);
    this.commands = new Commands(this);
    this.noAchievements = new Achievements(this);
    this.noAchievements.passive = true;
  }

  // ------------------------------------------------------------------ context (what "the" world / player means)
  get world(): World | null { return this.dim?.world ?? null; }
  get entities(): Entity[] { return this.dim?.entities ?? []; }
  get ticker() { return this.dim?.ticker ?? null; }
  get redstone() { return this.dim!.redstone; }
  get pistons() { return this.dim!.pistons; }
  get devices() { return this.dim!.devices; }
  get brewing() { return this.dim!.brewing; }
  get spawner() { return this.dim?.spawner ?? null; }
  get dimension(): Dimension { return this.dim?.world.dimension ?? 'overworld'; }
  /** The acting player; outside any player's action, the first player in this dimension. */
  get player(): Player | null {
    if (this.ctx) return this.ctx.entity;
    return this.playersHere()[0]?.entity ?? null;
  }
  get interact(): Interaction | null { return this.ctx?.interact ?? this.dim?.interact ?? null; }
  get input() { return this.ctx?.input ?? NO_INPUT; }
  get target(): BlockHit | null { return this.ctx?.target ?? null; }
  set target(t: BlockHit | null) { if (this.ctx) this.ctx.target = t; }
  get targetEntity(): Entity | null { return this.ctx?.targetEntity ?? null; }
  set targetEntity(e: Entity | null) { if (this.ctx) this.ctx.targetEntity = e; }
  get targetPart(): string | null { return this.ctx?.targetPart ?? null; }
  get ui() { return (this.ctx?.ui ?? this.broadcast) as unknown as import('../ui/ui').UI; }
  get achievements(): Achievements { return this.ctx?.achievements ?? this.noAchievements; }
  get portalCooldown() { return this.ctx?.portalCooldown ?? 0; }
  set portalCooldown(n: number) { if (this.ctx) this.ctx.portalCooldown = n; }
  set gatewayBeam(b: { x: number; y: number; z: number; until: number }) {
    for (const p of this.playersHere()) p.event(['beam', b.x, b.y, b.z, b.until - this.ticks]);
  }

  /** Players in the dimension being simulated (everyone, outside any dimension). */
  playersHere(): ServerPlayer[] {
    const d = this.dim;
    return d ? this.players.filter((p) => p.dim === d.world.dimension && p.entity.world === d.world) : this.players;
  }
  /** Player entities in the current dimension (mobs pick targets from these). */
  playerEntities(): Player[] {
    return this.playersHere().map((p) => p.entity);
  }
  /** The ServerPlayer behind a player entity. */
  playerOf(e: Entity | null | undefined): ServerPlayer | null {
    return e instanceof NetPlayer ? e.sp : null;
  }
  /** Nearest living player within `range` of `e` (ignores creative / spectator unless asked). */
  nearestPlayer(e: { x: number; y: number; z: number }, range: number, includeCreative = false): Player | null {
    let best: Player | null = null, bd = range;
    for (const p of this.playerEntities()) {
      if (p.dead || p.spectator || (!includeCreative && p.creative)) continue;
      const d = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Run `fn` as player `sp` (their dimension, input, screen, achievements). */
  asActor<T>(sp: ServerPlayer, fn: () => T): T {
    const pc = this.ctx, pd = this.dim;
    this.ctx = sp;
    this.dim = this.dims.get(sp.dim) ?? pd;
    try {
      return fn();
    } finally {
      this.ctx = pc;
      this.dim = pd;
    }
  }
  inDim<T>(d: Dim, fn: () => T): T {
    const pd = this.dim, pc = this.ctx;
    this.dim = d;
    if (pc && pc.dim !== d.world.dimension) this.ctx = null;
    try {
      return fn();
    } finally {
      this.dim = pd;
      this.ctx = pc;
    }
  }

  // ------------------------------------------------------------------ world lifecycle
  async openWorld(meta: WorldMeta) {
    this.meta = meta;
    this.time = meta.time ?? 0;
    this.ticks = 0;
    this.options.difficulty = meta.difficulty ?? 2;
    this.lastSave = performance.now();
    await this.loadDim('overworld');
  }

  /** Load a dimension (once, even if several players arrive together). */
  loadDim(d: Dimension): Promise<Dim> {
    const have = this.dims.get(d);
    if (have) return Promise.resolve(have);
    let p = this.loading.get(d);
    if (!p) {
      p = this.createDim(d);
      this.loading.set(d, p);
      p.finally(() => this.loading.delete(d));
    }
    return p;
  }

  private async createDim(d: Dimension): Promise<Dim> {
    const meta = this.meta!;
    const world = new World(meta.seed, d === 'overworld' ? meta.id : meta.id + '~' + d, d, 'server');
    await world.init();
    const dim = new Dim(world, this);
    world.onBlockChange = (x, y, z, old, v) => {
      this.inDim(dim, () => dim.ticker.onChange(x, y, z, old, v));
      for (const p of this.players) if (p.dim === d) p.blockChanged(x, y, z, v);
    };
    world.onTileChange = (x, y, z) => { for (const p of this.players) if (p.dim === d) p.tileChanged(x, y, z); };
    world.canUnload = (c: Chunk) => !this.players.some((p) => p.dim === d && p.holdsChunk(((c.cx + 0x8000) * 0x10000) + (c.cz + 0x8000)));
    world.onChunkLoaded = (c, spawns) => this.inDim(dim, () => {
      dim.ticker.onChunkLoaded(c);
      dim.pistons.scanChunk(c.cx, c.cz);
      if (spawns) for (const sp of spawns) {
        const e = createEntity(sp.type, world, this);
        if (!e) continue;
        e.setPos(sp.x, sp.y, sp.z);
        if (sp.data) Object.assign(e, sp.data);
        dim.entities.push(e);
      }
    });
    world.renderDistance = this.simDistance;
    this.dims.set(d, dim);
    this.inDim(dim, () => {
      for (const e of (this.entitiesOf(meta, d) ?? []) as { type: string }[]) {
        const ent = createEntity(e.type, world, this);
        if (ent) { (ent as unknown as { load(d: unknown): void }).load(e); dim.entities.push(ent); }
      }
      if (d === 'end') this.ensureDragon();
    });
    return dim;
  }

  private entitiesOf(meta: WorldMeta, dim: Dimension) {
    return dim === 'nether' ? meta.netherEntities : dim === 'end' ? meta.endEntities : meta.entities;
  }
  private storeEntities(dim: Dim) {
    const list = dim.entities.filter((e) => (e as unknown as { persist?: boolean }).persist && !e.removed).map((e) => (e as unknown as { toJSON(): unknown }).toJSON());
    const meta = this.meta!, d = dim.world.dimension;
    if (d === 'nether') meta.netherEntities = list;
    else if (d === 'end') meta.endEntities = list;
    else meta.entities = list;
  }

  private async unloadDim(d: Dimension) {
    const dim = this.dims.get(d);
    if (!dim) return;
    this.dims.delete(d);
    this.storeEntities(dim);
    await dim.world.saveAll();
    dim.world.destroy();
  }

  async saveWorld() {
    const meta = this.meta;
    if (!meta || this.saving) return;
    this.saving = true;
    meta.time = this.time;
    meta.lastPlayed = Date.now();
    meta.difficulty = this.options.difficulty;
    const players = (meta.players ??= {});
    for (const sp of this.players) {
      if (sp.owner) {
        meta.player = sp.entity.toJSON();
        meta.gameMode = sp.entity.gameMode;
        meta.dimension = sp.dim;
        meta.achievements = sp.achievements.toJSON();
      } else players[sp.name] = sp.save();
    }
    for (const dim of this.dims.values()) this.storeEntities(dim);
    try {
      for (const dim of this.dims.values()) await dim.world.saveAll();
      await Storage.saveWorld(meta);
    } finally {
      this.saving = false;
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const sp of [...this.players]) sp.conn.close('Server closed');
    await this.saveWorld();
    for (const d of [...this.dims.keys()]) await this.unloadDim(d);
  }

  // ------------------------------------------------------------------ players
  /** A client connected. The owner is the person whose world this is (their data lives in meta.player). */
  async addPlayer(conn: Conn, name: string, owner: boolean): Promise<ServerPlayer> {
    const meta = this.meta!;
    const over = await this.loadDim('overworld');
    const sp = new ServerPlayer(this, conn, name, owner);
    const p = sp.entity;
    p.sp = sp;
    const saved = owner ? (meta.player as Record<string, unknown> | undefined) : meta.players?.[name];
    let dimName: Dimension = 'overworld';
    if (saved) {
      p.load(saved);
      dimName = (owner ? meta.dimension : (saved as { dim?: Dimension }).dim) ?? 'overworld';
      sp.achievements.load(owner ? meta.achievements : (saved as { achievements?: string[] }).achievements);
    } else {
      p.setGameMode(meta.gameMode);
      const sp0 = meta.spawn;
      p.spawnX = sp0?.[0] ?? 0; p.spawnY = sp0?.[1] ?? -1; p.spawnZ = sp0?.[2] ?? 0;
      p.setPos(p.spawnX + 0.5, 200, p.spawnZ + 0.5);
      sp.pendingArrival = { x: p.spawnX + 0.5, y: p.spawnY, z: p.spawnZ + 0.5, toSpawn: true };
    }
    const dim = dimName === 'overworld' ? over : await this.loadDim(dimName);
    sp.dim = dimName;
    p.world = dim.world;
    p.difficulty = this.options.difficulty;
    this.hookPlayer(sp);
    dim.entities.push(p);
    this.players.push(sp);
    sp.send({ t: 'join', id: p.id, name, dim: dimName, seed: meta.seed, worldName: meta.name, hardcore: meta.hardcore, time: this.timeState(), owner });
    sp.teleported();
    if (!owner) this.say(`§e${name} joined the game`);
    this.onPlayersChanged();
    return sp;
  }

  private hookPlayer(sp: ServerPlayer) {
    const p = sp.entity;
    p.onDamaged = () => {
      sp.event(['hurt', p.lastHurtDirection]);
    };
    p.onDeath = (msg) => {
      const named = msg.replace(/^Player\b/, sp.name);
      this.say(named);
      sp.send({ t: 'death', msg });
      this.inDim(this.dims.get(sp.dim)!, () => {
        if (this.meta?.hardcore) p.setGameMode(GameMode.Spectator);
        if (!p.creative) {
          for (const s of [...p.inventory.main, ...p.inventory.armor]) if (s) this.dropItem(p.x, p.y + 1, p.z, s, true);
          p.inventory.clear();
        }
      });
    };
  }

  removePlayer(sp: ServerPlayer, reason = 'left the game') {
    const i = this.players.indexOf(sp);
    if (i < 0) return;
    // close their window (returns crafting-grid items) and get off any mount
    this.asActor(sp, () => {
      if (sp.ui.screen) { sp.ui.fromClient = true; sp.ui.open(null); sp.ui.fromClient = false; }
      sp.entity.riding?.dismount();
    });
    if (!sp.owner && this.meta) (this.meta.players ??= {})[sp.name] = sp.save();
    else if (sp.owner && this.meta) { this.meta.player = sp.entity.toJSON(); this.meta.dimension = sp.dim; this.meta.achievements = sp.achievements.toJSON(); }
    this.players.splice(i, 1);
    const dim = this.dims.get(sp.dim);
    if (dim) { const k = dim.entities.indexOf(sp.entity); if (k >= 0) dim.entities.splice(k, 1); }
    if (!sp.conn.closed) sp.conn.close(reason);
    if (!sp.owner) this.say(`§e${sp.name} ${reason}`);
    this.onPlayersChanged();
  }

  /** Chat from a player: a command or a message to everyone. */
  chat(sp: ServerPlayer, msg: string) {
    msg = msg.trim();
    if (!msg) return;
    if (msg.startsWith('/')) {
      if (!sp.owner && !this.meta?.cheatsForAll) { sp.send({ t: 'chat', msg: '§cOnly the host can use commands' }); return; }
      for (const line of this.asActor(sp, () => this.commands.run(msg))) sp.send({ t: 'chat', msg: line });
      return;
    }
    this.say(`<${sp.name}> ${msg}`);
  }

  say(msg: string) {
    for (const p of this.players) p.send({ t: 'chat', msg });
  }

  respawn(sp: ServerPlayer) {
    const p = sp.entity;
    if (!p.dead) return;
    if (this.meta?.hardcore) {
      p.dead = false;
      p.health = 20;
      p.setGameMode(GameMode.Spectator);
      return;
    }
    p.respawn();
    if (sp.dim !== 'overworld') this.travel(sp, 'overworld', true);
    else sp.pendingArrival = { x: p.x, y: p.y, z: p.z, toSpawn: true };
  }

  // ------------------------------------------------------------------ dimensions
  /** Send a player to another dimension through a portal (or back to spawn after death / leaving the End). */
  async travel(sp: ServerPlayer, to: Dimension, toSpawn = false) {
    if (sp.traveling || this.closed) return;
    sp.traveling = true;
    const p = sp.entity;
    const fromDim = sp.dim;
    p.riding?.dismount();
    this.asActor(sp, () => { if (sp.ui.screen) sp.ui.open(null); });
    const from = this.dims.get(fromDim);
    if (from) { const k = from.entities.indexOf(p); if (k >= 0) from.entities.splice(k, 1); }
    const dim = await this.loadDim(to);
    sp.resetView();
    sp.dim = to;
    p.world = dim.world;
    dim.entities.push(p);
    let nx: number, nz: number, ny = 70;
    if (to === 'end') {
      nx = END_PLATFORM.x + 0.5; nz = END_PLATFORM.z + 0.5; ny = END_PLATFORM.y + 1;
    } else {
      const scale = fromDim === 'end' ? 1 : to === 'nether' ? 1 / 8 : 8;
      nx = p.x * scale; nz = p.z * scale;
      if (toSpawn) { nx = p.spawnX + 0.5; nz = p.spawnZ + 0.5; }
    }
    const title = to === 'nether' ? 'Entering the Nether' : to === 'end' ? 'Entering the End' : fromDim === 'end' ? 'Leaving the End' : 'Leaving the Nether';
    sp.send({ t: 'dim', dim: to, title });
    p.setPos(nx, toSpawn ? p.spawnY : ny, nz);
    p.vx = p.vy = p.vz = 0;
    sp.pendingArrival = { x: nx, y: p.y, z: nz, toSpawn };
    if (to === 'nether' && !toSpawn) sp.achievements.unlock('portal');
    if (to === 'end') sp.achievements.unlock('theEnd');
    sp.portalTime = 0;
    sp.portalCooldown = to === 'end' || fromDim === 'end' ? 60 : 200;
    sp.traveling = false;
  }

  /** Place a player who's waiting for the ground under them to load. */
  resolveArrival(sp: ServerPlayer) {
    const a = sp.pendingArrival!, w = this.dims.get(sp.dim)?.world, p = sp.entity;
    if (!w) return false;
    if (a.toSpawn && sp.dim === 'overworld' && !this.meta?.spawn && !this.resolveWorldSpawn(w)) return false;
    if (a.toSpawn && p.spawnY < 0 && this.meta?.spawn) {
      [p.spawnX, p.spawnY, p.spawnZ] = this.meta.spawn;
      a.x = p.spawnX + 0.5; a.z = p.spawnZ + 0.5;
    }
    if (!w.chunkAt(Math.floor(a.x), Math.floor(a.z))) return false;
    if (w.loadProgress(a.x, a.z, 2) < 0.99) return false;
    sp.pendingArrival = null;
    if (w.dimension === 'end') {
      // the obsidian arrival platform (rebuilt every time, like the real game)
      const c: [number, number, number, number][] = [];
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) {
          c.push([END_PLATFORM.x + dx, END_PLATFORM.y, END_PLATFORM.z + dz, B.OBSIDIAN]);
          for (let h = 1; h <= 3; h++) c.push([END_PLATFORM.x + dx, END_PLATFORM.y + h, END_PLATFORM.z + dz, B.AIR]);
        }
      this.interact!.setAll(c);
      p.yaw = p.pyaw = 90; p.pitch = p.ppitch = 0;
      p.setPos(END_PLATFORM.x + 0.5, END_PLATFORM.y + 1, END_PLATFORM.z + 0.5);
      this.audio.play('portalTravel', null, 0.6, 1);
      this.ensureDragon();
    } else if (a.toSpawn) {
      const y = w.topSolidY(Math.floor(a.x), Math.floor(a.z)) + 1;
      p.setPos(a.x, Math.max(a.y, y), a.z);
    } else {
      const nether = w.dimension === 'nether';
      const found = findPortal(w, a.x, a.z, nether ? 16 : 128);
      if (found) p.setPos(found[0] + 0.5, found[1], found[2] + 0.5);
      else {
        const [x, y, z] = buildPortal(w, Math.floor(a.x), nether ? 70 : Math.max(64, w.topSolidY(Math.floor(a.x), Math.floor(a.z)) + 1), Math.floor(a.z), nether ? 34 : 60, nether ? 100 : 180, (c) => this.interact!.setAll(c));
        p.setPos(x, y, z);
      }
      this.audio.play('portalTravel', null, 0.6, 1);
    }
    if (!sp.ready) { sp.ready = true; sp.send({ t: 'ready' }); }
    return true;
  }

  /** Find the world spawn: a dry grass/sand column near the origin (once, when its chunks have loaded). */
  private resolveWorldSpawn(w: World) {
    const meta = this.meta!;
    for (let r = 0; r < 64; r += 4) {
      for (let a = 0; a < Math.max(1, r * 2); a++) {
        const ang = (a / Math.max(1, r * 2)) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
        if (!w.chunkAt(x, z)) return false;
        const y = w.topSolidY(x, z);
        const id = w.getId(x, y, z);
        if (id === B.GRASS || id === B.SAND || id === B.SNOW || id === B.PODZOL) {
          meta.spawn = [x, y + 1, z];
          return true;
        }
      }
    }
    meta.spawn = [0, w.topSolidY(0, 0) + 1, 0];
    return true;
  }

  /** The Ender Dragon lives in the End until it has been killed. */
  ensureDragon() {
    if (!this.world || this.world.dimension !== 'end' || this.meta?.dragonKilled) return;
    if (this.entities.some((e) => e instanceof EnderDragon && !e.removed)) return;
    const d = new EnderDragon(this.world, this);
    d.setPos(0.5, 100, 0.5);
    this.addEntity(d);
  }

  /** Walking into the exit portal: the first time, the credits roll before returning to the overworld. */
  leaveEnd(sp: ServerPlayer) {
    if (sp.traveling || sp.pendingArrival) return;
    if (this.meta && this.meta.dragonKilled && !(sp.owner ? this.meta.endPoemSeen : (sp.entity as unknown as { endPoemSeen?: boolean }).endPoemSeen)) {
      if (sp.owner) this.meta.endPoemSeen = true;
      sp.send({ t: 'credits' });
    }
    this.travel(sp, 'overworld', true);
  }

  /** Nether / End portals and End gateways under a player. */
  portalTick(sp: ServerPlayer) {
    const p = sp.entity, w = this.world!;
    if (sp.portalCooldown > 0) sp.portalCooldown--;
    if (sp.pendingArrival || sp.traveling) return;
    const b = p.box;
    let inPortal = false, inEndPortal = false;
    const dim = sp.dim;
    for (let x = Math.floor(b.x0); x <= Math.floor(b.x1); x++)
      for (let y = Math.floor(b.y0); y <= Math.floor(b.y1); y++)
        for (let z = Math.floor(b.z0); z <= Math.floor(b.z1); z++) {
          const id = w.getId(x, y, z);
          if (id === B.NETHER_PORTAL) inPortal = true;
          else if (id === B.END_PORTAL && dim !== 'nether' && sp.portalCooldown === 0 && !p.dead) inEndPortal = true;
          else if (id === B.END_GATEWAY && dim === 'end' && sp.portalCooldown === 0 && !p.dead) { enterGateway(this, x, y, z); return; }
        }
    if (inEndPortal) {
      sp.portalCooldown = 60;
      if (dim === 'overworld') this.travel(sp, 'end');
      else this.leaveEnd(sp);
      return;
    }
    if (inPortal && !p.dead && dim !== 'end') {
      if (sp.portalTime === 0 && sp.portalCooldown === 0) this.audio.play('portalTrigger', null, 0.5, 0.8 + Math.random() * 0.4);
      sp.portalTime = Math.min(90, sp.portalTime + 1);
      if (sp.portalCooldown === 0 && (sp.portalTime >= 80 || (p.creative && sp.portalTime >= 2))) this.travel(sp, dim === 'nether' ? 'overworld' : 'nether');
    } else {
      sp.portalTime = Math.max(0, sp.portalTime - 5);
      if (!inPortal && sp.portalCooldown > 0 && sp.portalCooldown < 190) sp.portalCooldown = 0;
    }
  }

  // ------------------------------------------------------------------ main loop
  tick() {
    if (this.closed) return;
    for (const sp of [...this.players]) {
      if (sp.conn.closed) { this.removePlayer(sp, sp.conn.closeReason === 'kicked' ? 'was kicked' : 'left the game'); continue; }
      for (const m of sp.conn.poll()) sp.receive(m);
    }
    if (this.paused) {
      for (const sp of this.players) sp.flush();
      return;
    }
    this.ticks++;
    if (this.doDaylightCycle) this.time++;
    const over = this.dims.get('overworld');
    if (over) this.inDim(over, () => this.weather.tick());
    for (const dim of this.dims.values()) this.inDim(dim, () => this.tickDim(dim));
    this.sleepCheck();
    for (const dim of this.dims.values()) this.replicate(dim);
    for (const sp of this.players) sp.flush();
    for (const dim of this.dims.values()) dim.deltas.clear();
    // autosave every 60 s
    if (performance.now() - this.lastSave > 60000) {
      this.lastSave = performance.now();
      this.saveWorld();
    }
    // dimensions nobody is in unload after half a minute (the overworld stays while anyone is connected)
    for (const [d, dim] of this.dims) {
      if (d === 'overworld' || this.players.some((p) => p.dim === d) || this.loading.has(d)) { dim.emptyTicks = 0; continue; }
      if (++dim.emptyTicks > 600) this.unloadDim(d);
    }
  }

  private tickDim(dim: Dim) {
    const w = dim.world;
    const here = this.players.filter((p) => p.dim === w.dimension);
    w.renderDistance = this.simDistance;
    w.updateCenters(here.map((p) => ({ x: p.entity.x, z: p.entity.z, r: p.simRadius() })));
    if (!here.length) return;
    if (w.dimension === 'end' && this.meta?.dragonKilled && this.ticks % 20 === 0) buildExitPortal(this);
    if (w.dimension === 'end') buildPending(this);
    const list = dim.entities;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e) continue;
      if (!w.isLoaded(e.x, e.z)) {
        e.preTick();
        // a player waiting for their ground still runs their input (portals, respawn placement)
        if (e instanceof NetPlayer) e.sp?.tickInput();
        continue;
      }
      e.preTick();
      e.tick();
      // items, arrows, orbs and falling blocks that drop into the void (living things take void damage instead)
      if (e.y < -64 && !(e instanceof LivingEntity)) e.removed = true;
      if (e.removed && !(e instanceof NetPlayer)) { const k = list.indexOf(e); if (k >= 0) list.splice(k, 1); }
    }
    dim.ticker.tick();
    dim.redstone.tick();
    dim.pistons.tick();
    dim.devices.tick();
    dim.brewing.tick();
    tickFurnaces(this);
    dim.spawner.tick();
  }

  /** Night passes once everybody in the overworld has been in bed for a few seconds. */
  private sleepCheck() {
    const over = this.players.filter((p) => p.dim === 'overworld' && !p.entity.dead);
    for (const p of over) if (p.entity.sleeping) p.sleepTicks++;
    if (!over.length || !over.every((p) => p.entity.sleeping && p.sleepTicks >= 100)) return;
    this.time = Math.ceil(this.time / 24000) * 24000;
    this.weather.setWeather('clear', 12000 + Math.floor(Math.random() * 100000));
    for (const p of over) p.wake();
  }

  /** Work out every entity's fields and what changed since last tick (shared by all the players watching). */
  private replicate(dim: Dim) {
    if (!this.players.some((p) => p.dim === dim.world.dimension)) { dim.states.clear(); dim.sigs.clear(); return; }
    const alive = new Set<number>();
    for (const e of dim.entities) {
      if (e.removed) continue;
      alive.add(e.id);
      const s = captureState(e);
      let prev = dim.sigs.get(e.id);
      const first = !prev;
      if (!prev) dim.sigs.set(e.id, (prev = new Map()));
      let delta: State | null = null;
      for (const [k, v] of Object.entries(s)) {
        const g = sig(v);
        if (prev.get(k) === g) continue;
        prev.set(k, g);
        if (!first) (delta ??= {})[k] = v;
      }
      dim.states.set(e.id, s);
      if (delta) dim.deltas.set(e.id, delta);
    }
    for (const id of dim.states.keys()) if (!alive.has(id)) { dim.states.delete(id); dim.sigs.delete(id); }
    dim.pistonsWere = dim.pistons.snapshot().length > 0;
  }

  timeState() {
    const w = this.weather;
    return { time: this.time, dl: this.doDaylightCycle, raining: w.raining, thundering: w.thundering, rain: w.rain, thunder: w.thunder };
  }

  // ------------------------------------------------------------------ targeting (for the acting player)
  eyePos(_t = 1) {
    const p = this.ctx?.entity ?? this.player!;
    return { x: p.x, y: p.y + p.eyeOffset, z: p.z };
  }
  lookVec(yawDeg: number, pitchDeg: number) {
    const y = (yawDeg * Math.PI) / 180, pi = (pitchDeg * Math.PI) / 180;
    return { x: -Math.sin(y) * Math.cos(pi), y: -Math.sin(pi), z: Math.cos(y) * Math.cos(pi) };
  }
  reach() {
    return this.player?.creative ? 5 : 4.5;
  }
  touchAim() { return false; }

  /** What the acting player is pointing at, along the direction their client reports. */
  updateTarget(sp: ServerPlayer) {
    const p = sp.entity;
    sp.target = null; sp.targetEntity = null; sp.targetPart = null;
    if (p.spectator || p.dead || !sp.dir) return;
    let [dx, dy, dz] = sp.dir;
    const l = Math.hypot(dx, dy, dz);
    if (!(l > 0.5 && l < 2)) return;
    dx /= l; dy /= l; dz /= l;
    const eye = this.eyePos();
    const reach = this.reach();
    sp.target = raycastBlocks(this.world!, eye.x, eye.y, eye.z, dx, dy, dz, reach);
    let best: Entity | null = null, bestPart: string | null = null;
    let bestT = sp.target ? sp.target.t : Math.min(reach, 3.5);
    for (const e of this.entities) {
      if (e === p || e === (p.riding as unknown as Entity)) continue;
      if (!(e instanceof LivingEntity) || e.dead) { if (!(e instanceof Fireball) && !(e instanceof Boat) && !(e instanceof Minecart)) continue; }
      if (e instanceof Player && e.spectator) continue;
      for (const b of e.hitBoxes()) {
        const g = 0.1;
        const r = rayAABB(eye.x, eye.y, eye.z, dx, dy, dz, { x0: b.x0 - g, y0: b.y0 - g, z0: b.z0 - g, x1: b.x1 + g, y1: b.y1 + g, z1: b.z1 + g }, bestT);
        if (r && r.t < bestT && r.t <= 3.5) { bestT = r.t; best = e; bestPart = b.part ?? null; }
      }
    }
    sp.targetEntity = best;
    sp.targetPart = bestPart;
    if (best) sp.target = null;
  }

  /** Is a minecart sitting on the rail at (x, y, z)? (detector rails) */
  minecartOn(x: number, y: number, z: number) {
    return this.entities.some((e) => e instanceof Minecart && !e.removed && Math.floor(e.x) === x && Math.floor(e.z) === z && Math.floor(e.y + 0.1) - y >= 0 && Math.floor(e.y + 0.1) - y <= 1);
  }

  // ------------------------------------------------------------------ helpers used by gameplay systems
  dropItem(x: number, y: number, z: number, s: ItemStack, scatter = false, pickupDelay = 10) {
    if (!this.world || !s || s.count <= 0) return null;
    const e = new ItemEntity(this.world, this, { ...s });
    e.setPos(x, y, z);
    const f = scatter ? 0.2 : 0.1;
    e.vx = (this.rng.next() - 0.5) * f;
    e.vy = 0.2;
    e.vz = (this.rng.next() - 0.5) * f;
    e.pickupDelay = pickupDelay;
    this.entities.push(e);
    return e;
  }

  spawnXpAt(x: number, y: number, z: number, n: number) {
    this.interact?.spawnXp(x, y, z, n);
  }

  addEntity(e: Entity) {
    this.entities.push(e);
  }

  playBlockSound(blockId: number, x: number, y: number, z: number, kind: 'break' | 'place' | 'hit' | 'step') {
    const snd = SOUND_FOR[BLOCKS[blockId].sound];
    if (!snd) return;
    const vol = kind === 'hit' ? 0.25 : kind === 'step' ? 0.15 : 1;
    const pitch = kind === 'hit' ? 0.5 : kind === 'place' ? 0.8 : 0.8 + this.rng.next() * 0.2;
    this.emitSound(snd, { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, vol, pitch);
  }

  biomeAt(x: number, z: number) {
    const c = this.world?.chunkAt(x, z);
    if (!c) return BIOMES[0];
    return BIOMES[c.biomes[(z & 15) * 16 + (x & 15)]];
  }

  isDaytime() {
    const t = this.time % 24000;
    return t < 12500 || t > 23500;
  }

  /** A sound: positioned ones reach everyone in earshot, unpositioned ones the player whose action made them. */
  emitSound(name: string, pos: { x: number; y: number; z: number } | null, volume: number, pitch: number) {
    if (!pos) {
      if (this.ctx) { if (!this.muteUi) this.ctx.event(['s', name, null, volume, pitch]); return; }
      for (const p of this.playersHere()) p.event(['s', name, null, volume, pitch]);
      return;
    }
    const range = Math.max(16, 16 * volume);
    const at = [Math.round(pos.x * 100) / 100, Math.round(pos.y * 100) / 100, Math.round(pos.z * 100) / 100];
    for (const p of this.playersHere()) {
      const e = p.entity;
      if (Math.abs(e.x - pos.x) > range || Math.abs(e.y - pos.y) > range || Math.abs(e.z - pos.z) > range) continue;
      p.event(['s', name, at, volume, pitch]);
    }
  }

  /** A particle effect, for everyone close enough to see it. */
  emitFx(method: string, args: unknown[]) {
    const a0 = args[0] as { x?: number; y?: number; z?: number } | number;
    const x = typeof a0 === 'number' ? a0 : a0?.x, y = typeof a0 === 'number' ? (args[1] as number) : a0?.y, z = typeof a0 === 'number' ? (args[2] as number) : a0?.z;
    const enc = encodeValue(args);
    for (const p of this.playersHere()) {
      const e = p.entity;
      if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number' && Math.max(Math.abs(e.x - x), Math.abs(e.y - y), Math.abs(e.z - z)) > 64) continue;
      p.event(['f', method, enc]);
    }
  }

  /** Item pickup: tell everyone nearby so the item flies into the collector. */
  pickedUp(item: Entity, by: Entity, id: number) {
    for (const p of this.playersHere()) {
      if (p.entity.distanceTo(item) > 32) continue;
      p.event(['pickup', item.id, by.id, id]);
    }
  }

  get heldItem(): ItemStack | null {
    return this.player?.inventory.held() ?? null;
  }
}

export { stack, I, getItem };
export type { Msg };
