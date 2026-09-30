// Game orchestration: main loop, ticking, camera, interaction and rendering.
import { Renderer, Camera } from '../render/renderer';
import { World } from '../world/world';
import { Player, GameMode } from './player';
import { Input } from './input';
import { Audio, SOUND_FOR } from './audio';
import { Options, loadOptions, saveOptions } from './options';
import { Particles } from './particles';
import { computeEnv, netherEnv } from './env';
import { findPortal, buildPortal } from './portal';
import { raycastBlocks, BlockHit } from './raycast';
import { BLOCKS, B, idOf, metaOf, Render, CHUNK_H, TEXTURES, tex } from '../world/blocks';
import { selectionShapes } from '../world/models';
import { getItem, ItemStack, stack, I } from './items';
import { Gui } from '../ui/gui';
import { IconCache } from '../ui/icons';
import { UI } from '../ui/ui';
import { Storage, WorldMeta } from './storage';
import { Entity } from '../entity/entity';
import { LivingEntity } from '../entity/living';
import { ItemEntity, Fireball } from '../entity/item';
import { BlockTicker } from './blockticks';
import { Interaction } from './interact';
import { Spawner } from '../entity/spawner';
import { EntityRenderer } from '../render/entityrender';
import { Weather } from './weather';
import { createEntity } from '../entity/registry';
import { rayAABB, clamp, mat4 } from '../math';
import { getItemSprite, ITEM_SPRITE_NAMES } from '../render/itemsprites';
import { getTexture } from '../render/textures';
import { Random } from '../noise';
import { BIOMES } from '../world/biomes';
import { Commands } from './commands';
import { tickFurnaces } from './furnace';
import { rainTexture, snowTexture } from './weather';

export const TICK_MS = 50;

export class Game {
  renderer: Renderer;
  gui: Gui;
  icons = new IconCache();
  ui: UI;
  input: Input;
  audio = new Audio();
  options: Options;
  world: World | null = null;
  player: Player | null = null;
  meta: WorldMeta | null = null;
  entities: Entity[] = [];
  particles: Particles | null = null;
  ticker: BlockTicker | null = null;
  interact: Interaction | null = null;
  spawner: Spawner | null = null;
  weather: Weather | null = null;
  commands: Commands;
  entityRenderer: EntityRenderer;
  time = 0;
  ticks = 0;
  private acc = 0;
  private last = performance.now();
  partial = 0;
  target: BlockHit | null = null;
  targetEntity: Entity | null = null;
  thirdPerson = 0;
  hideHud = false;
  showDebug = false;
  fps = 0;
  private frames = 0;
  private fpsTime = 0;
  frameMs = 0;
  cam: Camera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 70 };
  fovMod = 1;
  pFovMod = 1;
  ctx: CanvasRenderingContext2D;
  rng = new Random(Date.now() & 0xffffff);
  panorama = false; // title-screen background world
  doDaylightCycle = true;
  lastSave = 0;
  saving = false;
  handSwapAnim = 0; // equip animation
  pHandSwapAnim = 0;
  lastHeldId = -1;
  lastHeldSlot = -1;
  sleepFade = 0;
  dimension: 'overworld' | 'nether' = 'overworld';
  portalTime = 0;
  portalCooldown = 0;
  pendingArrival: { x: number; y: number; z: number; toSpawn: boolean } | null = null;
  traveling = false;
  torchFlicker = 0;
  private torchFlickerDX = 0;
  titleYaw = 0;
  private uiCanvas: HTMLCanvasElement;

  constructor(glCanvas: HTMLCanvasElement, uiCanvas: HTMLCanvasElement) {
    this.options = loadOptions();
    this.renderer = new Renderer(glCanvas);
    this.uiCanvas = uiCanvas;
    this.ctx = uiCanvas.getContext('2d')!;
    // register item sprite textures so they can be used as particles / dropped items
    const extra = ITEM_SPRITE_NAMES.map((n) => ({ name: 'item/' + n, img: getItemSprite(n)! }));
    extra.push({ name: 'weather_rain', img: rainTexture() }, { name: 'weather_snow', img: snowTexture() });
    extra.push({ name: 'grass_side_item', img: tintMasked(getTexture('grass_side'), 0x7cbd6b) });
    extra.push({ name: 'entity_shadow', img: shadowTexture() });
    this.renderer.initAtlas(extra);
    this.gui = new Gui();
    this.input = new Input(uiCanvas);
    this.entityRenderer = new EntityRenderer(this.renderer);
    this.commands = new Commands(this);
    this.ui = new UI(this);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.audio.volume = this.options.volume;
    this.audio.musicVolume = this.options.music;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(window.innerWidth * dpr), h = Math.floor(window.innerHeight * dpr);
    this.renderer.resize(w, h);
    this.uiCanvas.width = w;
    this.uiCanvas.height = h;
  }

  saveOptions() {
    saveOptions(this.options);
    this.audio.setVolume(this.options.volume, this.options.music);
    if (this.world) this.world.renderDistance = this.panorama ? Math.min(6, this.options.renderDistance) : this.options.renderDistance;
    if (this.player) this.player.difficulty = this.options.difficulty;
  }

  // ------------------------------------------------------------------ world lifecycle
  private makeWorld(meta: WorldMeta, dim: 'overworld' | 'nether', panorama: boolean): World {
    const world = new World(meta.seed, dim === 'nether' ? meta.id + '~nether' : meta.id, dim);
    world.readOnly = panorama;
    world.renderDistance = panorama ? Math.min(6, this.options.renderDistance) : this.options.renderDistance;
    return world;
  }

  private attachWorld(world: World) {
    this.world = world;
    world.onMesh = (c, r) => this.renderer.uploadChunk(c, r);
    world.onUnload = (c) => this.renderer.freeChunk(c);
    this.particles = new Particles(world);
    this.ticker = new BlockTicker(this, world);
    world.onBlockChange = (x, y, z, old, v) => this.ticker!.onChange(x, y, z, old, v);
    world.onChunkLoaded = (c) => this.ticker!.onChunkLoaded(c);
    this.dimension = world.dimension;
  }

  private loadEntities(list: unknown[] | undefined) {
    this.entities = [];
    if (list) for (const e of list as { type: string }[]) {
      const ent = createEntity(e.type, this.world!, this);
      if (ent) { (ent as unknown as { load(d: unknown): void }).load(e); this.entities.push(ent); }
    }
  }
  private saveEntities() {
    return this.entities.filter((e) => (e as unknown as { persist?: boolean }).persist && !e.removed).map((e) => (e as unknown as { toJSON(): unknown }).toJSON());
  }

  async openWorld(meta: WorldMeta, panorama = false) {
    await this.closeWorld(false);
    this.panorama = panorama;
    this.meta = meta;
    const dim = meta.dimension ?? 'overworld';
    const world = this.makeWorld(meta, dim, panorama);
    await world.init();
    this.attachWorld(world);
    this.interact = new Interaction(this);
    this.spawner = new Spawner(this);
    this.weather = new Weather(this);
    this.time = meta.time ?? 0;
    this.ticks = 0;
    this.portalTime = 0;
    this.portalCooldown = 0;
    this.pendingArrival = null;
    const p = new Player(world);
    this.player = p;
    p.difficulty = this.options.difficulty;
    p.onDamaged = (src) => {
      this.audio.play('hurt', null, 1, 1);
      void src;
    };
    p.onDeath = (msg) => {
      this.ui.chat.add(msg);
      if (!this.panorama) setTimeout(() => this.ui.openDeath(msg), 50);
      if (this.meta?.hardcore) this.player!.setGameMode(GameMode.Spectator);
      // drop inventory
      if (!p.creative) {
        for (const s of [...p.inventory.main, ...p.inventory.armor]) if (s) this.dropItem(p.x, p.y + 1, p.z, s, true);
        p.inventory.clear();
      }
    };
    if (meta.player) {
      p.load(meta.player);
      if (meta.spawn) [p.spawnX, p.spawnY, p.spawnZ] = meta.spawn;
    } else {
      p.setGameMode(meta.gameMode);
      const [sx, sz] = this.findSpawn(meta.seed);
      p.spawnX = sx;
      p.spawnZ = sz;
      p.spawnY = -1; // resolved once the chunk loads
      p.setPos(sx + 0.5, 200, sz + 0.5);
    }
    this.loadEntities(dim === 'nether' ? meta.netherEntities : meta.entities);
    this.doDaylightCycle = true;
    this.lastSave = performance.now();
  }

  /** Move the player to the other dimension through a portal (or back to spawn after death). */
  async travel(to: 'overworld' | 'nether', toSpawn = false) {
    if (!this.world || !this.player || !this.meta || this.traveling) return;
    this.traveling = true;
    const p = this.player, meta = this.meta;
    const from = this.world;
    const loading = new (await import('../ui/menus')).LoadingScreen(this.ui, to === 'nether' ? 'Entering the Nether' : 'Leaving the Nether');
    loading.ready = true;
    this.ui.open(loading);
    // persist the dimension we're leaving
    if (from.dimension === 'nether') meta.netherEntities = this.saveEntities();
    else meta.entities = this.saveEntities();
    await from.saveAll();
    for (const c of from.chunks.values()) this.renderer.freeChunk(c);
    from.destroy();
    const world = this.makeWorld(meta, to, false);
    await world.init();
    this.attachWorld(world);
    p.world = world;
    this.loadEntities(to === 'nether' ? meta.netherEntities : meta.entities);
    const scale = to === 'nether' ? 1 / 8 : 8;
    let nx = p.x * scale, nz = p.z * scale;
    if (toSpawn) { nx = p.spawnX + 0.5; nz = p.spawnZ + 0.5; }
    p.setPos(nx, toSpawn ? p.spawnY : 70, nz);
    p.vx = p.vy = p.vz = 0;
    this.pendingArrival = { x: nx, y: p.y, z: nz, toSpawn };
    meta.dimension = to;
    this.portalTime = 0;
    this.portalCooldown = 200;
    this.traveling = false;
  }

  private resolveArrival() {
    const a = this.pendingArrival!, w = this.world!, p = this.player!;
    if (!w.chunkAt(Math.floor(a.x), Math.floor(a.z))) return false;
    if (w.loadProgress(a.x, a.z, Math.min(3, w.renderDistance)) < 0.99) return false;
    this.pendingArrival = null;
    if (a.toSpawn) {
      const y = w.topSolidY(Math.floor(a.x), Math.floor(a.z)) + 1;
      p.setPos(a.x, Math.max(a.y, y), a.z);
      return true;
    }
    const nether = w.dimension === 'nether';
    const found = findPortal(w, a.x, a.z, nether ? 16 : 128);
    if (found) {
      p.setPos(found[0] + 0.5, found[1], found[2] + 0.5);
    } else {
      const [x, y, z] = buildPortal(w, Math.floor(a.x), nether ? 70 : Math.max(64, w.topSolidY(Math.floor(a.x), Math.floor(a.z)) + 1), Math.floor(a.z), nether ? 34 : 60, nether ? 100 : 180, (c) => this.interact!.setAll(c));
      p.setPos(x, y, z);
    }
    this.audio.play('portalTravel', null, 0.6, 1);
    return true;
  }

  /** Pick a spawn column on land near the origin using the worldgen noise directly. */
  findSpawn(seed: number): [number, number] {
    // done lazily by the worker-generated chunks: start at 0,0 and search once loaded
    void seed;
    return [0, 0];
  }

  private resolveSpawn() {
    const p = this.player!, w = this.world!;
    if (p.spawnY >= 0) return true;
    // spiral search for a dry grass/sand column around the current spawn column
    for (let r = 0; r < 64; r += 4) {
      for (let a = 0; a < Math.max(1, r * 2); a++) {
        const ang = (a / Math.max(1, r * 2)) * Math.PI * 2;
        const x = Math.round(p.spawnX + Math.cos(ang) * r), z = Math.round(p.spawnZ + Math.sin(ang) * r);
        if (!w.chunkAt(x, z)) return false;
        const y = w.topSolidY(x, z);
        const id = w.getId(x, y, z);
        if (id === B.GRASS || id === B.SAND || id === B.SNOW || id === B.PODZOL) {
          p.spawnX = x; p.spawnZ = z; p.spawnY = y + 1;
          p.setPos(x + 0.5, y + 1, z + 0.5);
          if (this.meta) this.meta.spawn = [x, y + 1, z];
          return true;
        }
      }
    }
    const y = w.topSolidY(p.spawnX, p.spawnZ) + 1;
    p.spawnY = y;
    p.setPos(p.spawnX + 0.5, y, p.spawnZ + 0.5);
    return true;
  }

  async closeWorld(save = true) {
    if (!this.world) return;
    if (save && !this.panorama) await this.saveWorld();
    for (const c of this.world.chunks.values()) this.renderer.freeChunk(c);
    this.world.destroy();
    this.world = null;
    this.player = null;
    this.entities = [];
    this.meta = null;
    this.target = null;
  }

  async saveWorld() {
    if (!this.world || !this.meta || this.panorama || this.saving) return;
    this.saving = true;
    this.meta.time = this.time;
    this.meta.lastPlayed = Date.now();
    this.meta.player = this.player?.toJSON();
    this.meta.gameMode = this.player?.gameMode ?? this.meta.gameMode;
    this.meta.difficulty = this.options.difficulty;
    this.meta.dimension = this.dimension;
    if (this.dimension === 'nether') this.meta.netherEntities = this.saveEntities();
    else this.meta.entities = this.saveEntities();
    try {
      await this.world.saveAll();
      await Storage.saveWorld(this.meta);
    } finally {
      this.saving = false;
    }
  }

  /** Is the world near the player loaded enough to start playing? */
  loadProgress(): number {
    if (!this.world || !this.player) return 0;
    const r = Math.min(3, this.world.renderDistance);
    return this.world.loadProgress(this.player.x, this.player.z, r);
  }

  // ------------------------------------------------------------------ main loop
  start() {
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      this.frame(now);
    };
    requestAnimationFrame(loop);
  }

  frame(now: number) {
    const t0 = performance.now();
    let dt = now - this.last;
    this.last = now;
    if (dt > 1000) dt = 1000;
    const paused = this.ui.pausesGame();
    if (!paused) this.acc += dt;
    let n = 0;
    while (this.acc >= TICK_MS && n < 10) {
      this.tick();
      this.acc -= TICK_MS;
      n++;
    }
    if (n >= 10) this.acc = 0;
    this.ui.tick(dt);
    this.partial = paused ? 1 : this.acc / TICK_MS;
    this.updateLook();
    this.render();
    this.frames++;
    if (now - this.fpsTime >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsTime));
      this.frames = 0;
      this.fpsTime = now;
    }
    this.frameMs = performance.now() - t0;
  }

  /** Mouse look is applied per frame for responsiveness. */
  private updateLook() {
    const [dx, dy] = this.input.takeMouse();
    const p = this.player;
    if (!p || !this.input.locked || this.ui.screen) return;
    if (p.sleeping) return;
    const s = this.options.sensitivity * 0.6 + 0.2;
    const f = s * s * s * 8 * 0.15;
    p.yaw += dx * f;
    p.pitch = clamp(p.pitch + dy * f * (this.options.invertY ? -1 : 1), -90, 90);
    p.pyaw += dx * f;
    p.ppitch = clamp(p.ppitch + dy * f * (this.options.invertY ? -1 : 1), -90, 90);
  }

  tick() {
    this.ticks++;
    const w = this.world, p = this.player;
    this.audio.tickMusic(!w || this.panorama);
    if (!w || !p) return;
    this.renderer.atlas.tick(this.ticks);
    this.torchFlickerDX += (Math.random() - Math.random()) * Math.random() * Math.random();
    this.torchFlickerDX *= 0.9;
    this.torchFlicker += this.torchFlickerDX - this.torchFlicker;
    this.torchFlicker *= 0.9;
    if (this.panorama) {
      this.time += 1;
      this.titleYaw += 0.1;
      p.preTick();
      p.yaw = this.titleYaw;
      p.pitch = 12;
      if (p.spawnY < 0) this.resolveSpawn();
      else {
        // hover above the highest nearby terrain
        let top = p.spawnY;
        for (let dx = -8; dx <= 8; dx += 4) for (let dz = -8; dz <= 8; dz += 4) top = Math.max(top, w.topSolidY(p.spawnX + dx, p.spawnZ + dz) + 1);
        p.setPos(p.spawnX + 0.5, top + 4, p.spawnZ + 0.5);
        p.pitch = p.ppitch = 8;
      }
      return;
    }
    if (this.pendingArrival) {
      p.preTick();
      this.resolveArrival();
      return;
    }
    if (this.dimension === 'overworld' && p.spawnY < 0 && !this.resolveSpawn()) {
      p.preTick();
      return; // wait for spawn chunk
    }
    if (!w.isLoaded(p.x, p.z)) {
      p.preTick();
      return; // don't simulate the player in unloaded chunks
    }
    if (this.doDaylightCycle) this.time++;
    if (this.dimension === 'overworld') this.weather!.tick();
    this.portalTick();

    // ---------- player input
    this.handleKeys();
    p.preTick();
    if (!this.ui.screen || !this.ui.screen.pausesGame) {
      const inp = this.ui.screen ? { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false } : this.moveInput();
      p.applyInput(inp);
    }
    p.tick();
    this.pFovMod = this.fovMod;
    let fovTarget = 1;
    if (p.flying) fovTarget *= 1.1;
    if (p.sprinting) fovTarget *= 1.15;
    const bowDraw = this.interact!.bowCharge();
    if (bowDraw > 0) fovTarget *= 1 - Math.min(1, bowDraw / 20) ** 2 * 0.15;
    this.fovMod += (fovTarget - this.fovMod) * 0.5;

    this.pHandSwapAnim = this.handSwapAnim;
    const held = p.inventory.held();
    const hid = held ? held.id : 0;
    if (hid !== this.lastHeldId || p.inventory.selected !== this.lastHeldSlot) {
      this.handSwapAnim = 1;
      this.lastHeldId = hid;
      this.lastHeldSlot = p.inventory.selected;
    }
    this.handSwapAnim = Math.max(0, this.handSwapAnim - 0.25);

    this.updateTarget();
    this.interact!.tick();

    // ---------- entities
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (!w.isLoaded(e.x, e.z)) { e.preTick(); continue; }
      e.preTick();
      e.tick();
      if (e.removed) this.entities.splice(i, 1);
    }
    this.ticker!.tick();
    tickFurnaces(this);
    this.entityRenderer.tick();
    this.spawner!.tick();
    this.particles!.tick();
    // ambient particles
    this.ambientParticles();
    // footsteps
    if (p.onGround && !p.sneaking && Math.floor(p.distWalked) !== Math.floor(p.pDistWalked)) {
      const below = w.getId(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
      const snd = SOUND_FOR[BLOCKS[below].sound];
      if (snd) this.audio.play(snd, null, 0.15, 1);
    }
    if (p.inWater && Math.floor(p.distWalked * 2) !== Math.floor(p.pDistWalked * 2) && this.rng.int(3) === 0) this.audio.play('swim', null, 0.2, 1 + (this.rng.next() - 0.5) * 0.4);
    // autosave every 60 s
    if (performance.now() - this.lastSave > 60000) {
      this.lastSave = performance.now();
      this.saveWorld();
    }
    this.ui.hud.tick();
    this.audio.setRain(this.dimension === 'overworld' && this.weather!.rainAt(p.x, p.y, p.z) && !p.isInsideOpaque() ? this.weather!.rain : 0);
  }

  private portalTick() {
    const p = this.player!, w = this.world!;
    if (this.portalCooldown > 0) this.portalCooldown--;
    const b = p.box;
    let inPortal = false;
    for (let x = Math.floor(b.x0); x <= Math.floor(b.x1) && !inPortal; x++)
      for (let y = Math.floor(b.y0); y <= Math.floor(b.y1) && !inPortal; y++)
        for (let z = Math.floor(b.z0); z <= Math.floor(b.z1) && !inPortal; z++) if (w.getId(x, y, z) === B.NETHER_PORTAL) inPortal = true;
    if (inPortal && !p.dead) {
      if (this.portalTime === 0 && this.portalCooldown === 0) this.audio.play('portalTrigger', null, 0.5, 0.8 + Math.random() * 0.4);
      this.portalTime = Math.min(90, this.portalTime + 1);
      if (this.portalCooldown === 0 && (this.portalTime >= 80 || (p.creative && this.portalTime >= 2))) {
        this.travel(this.dimension === 'nether' ? 'overworld' : 'nether');
      }
    } else {
      this.portalTime = Math.max(0, this.portalTime - 5);
      if (!inPortal && this.portalCooldown > 0 && this.portalCooldown < 190) this.portalCooldown = 0;
    }
  }

  private moveInput() {
    const i = this.input;
    let forward = 0, strafe = 0;
    if (i.isDown('KeyW')) forward += 1;
    if (i.isDown('KeyS')) forward -= 1;
    if (i.isDown('KeyA')) strafe += 1;
    if (i.isDown('KeyD')) strafe -= 1;
    return {
      forward: forward * 0.98, strafe: strafe * 0.98,
      jump: i.isDown('Space'), sneak: i.isDown('ShiftLeft') || i.isDown('ShiftRight'),
      sprint: i.isDown('ControlLeft') || i.isDown('ControlRight') || this.sprintLatch,
    };
  }
  private sprintLatch = false;
  private lastWTap = -100;
  private lastSpaceTap = -100;

  private handleKeys() {
    const p = this.player!;
    const presses = this.input.takePressed();
    if (!this.input.isDown('KeyW') || p.collidedH) this.sprintLatch = false;
    for (const code of presses) {
      if (this.ui.screen) continue;
      if (code === 'KeyW') {
        if (this.ticks - this.lastWTap < 7) this.sprintLatch = true;
        this.lastWTap = this.ticks;
      }
      if (code === 'Space' && p.canFly) {
        if (this.ticks - this.lastSpaceTap < 7 && !p.spectator) {
          p.flying = !p.flying;
          this.lastSpaceTap = -100;
        } else this.lastSpaceTap = this.ticks;
      }
      if (code.startsWith('Digit')) {
        const n = parseInt(code.slice(5));
        if (n >= 1 && n <= 9) p.inventory.selected = n - 1;
      }
      if (code === 'KeyQ') this.interact!.dropHeld(this.input.isDown('ControlLeft') || this.input.isDown('MetaLeft'));
      if (code === 'KeyF') this.interact!.swapOffhand();
    }
    const wheel = this.input.takeWheel();
    if (wheel && !this.ui.screen) p.inventory.selected = (((p.inventory.selected + wheel) % 9) + 9) % 9;
  }

  // ------------------------------------------------------------------ targeting
  eyePos(t = 1) {
    const p = this.player!;
    return { x: p.lerpX(t), y: p.lerpY(t) + p.pEyeOffset + (p.eyeOffset - p.pEyeOffset) * t, z: p.lerpZ(t) };
  }
  lookVec(yawDeg: number, pitchDeg: number) {
    const y = (yawDeg * Math.PI) / 180, pi = (pitchDeg * Math.PI) / 180;
    return { x: -Math.sin(y) * Math.cos(pi), y: -Math.sin(pi), z: Math.cos(y) * Math.cos(pi) };
  }
  reach() {
    return this.player!.creative ? 5 : 4.5;
  }

  updateTarget() {
    const p = this.player!;
    if (p.spectator || p.dead) { this.target = null; this.targetEntity = null; return; }
    const eye = this.eyePos(1);
    const d = this.lookVec(p.yaw, p.pitch);
    const reach = this.reach();
    this.target = raycastBlocks(this.world!, eye.x, eye.y, eye.z, d.x, d.y, d.z, reach);
    // entities
    let best: Entity | null = null;
    let bestT = this.target ? this.target.t : Math.min(reach, 3.5);
    for (const e of this.entities) {
      if (!(e instanceof LivingEntity) || e.dead) { if (!(e instanceof Fireball)) continue; }
      const b = e.box;
      const g = 0.1;
      const r = rayAABB(eye.x, eye.y, eye.z, d.x, d.y, d.z, { x0: b.x0 - g, y0: b.y0 - g, z0: b.z0 - g, x1: b.x1 + g, y1: b.y1 + g, z1: b.z1 + g }, bestT);
      if (r && r.t < bestT && r.t <= 3.5) { bestT = r.t; best = e; }
    }
    this.targetEntity = best;
    if (best) this.target = null;
  }

  // ------------------------------------------------------------------ helpers used by gameplay systems
  dropItem(x: number, y: number, z: number, s: ItemStack, scatter = false, pickupDelay = 10) {
    if (!this.world || !s || s.count <= 0) return null;
    const e = new ItemEntity(this.world, this, { ...s });
    e.setPos(x, y, z);
    if (scatter) {
      e.vx = (this.rng.next() - 0.5) * 0.2;
      e.vy = 0.2;
      e.vz = (this.rng.next() - 0.5) * 0.2;
    } else {
      e.vx = (this.rng.next() - 0.5) * 0.1;
      e.vy = 0.2;
      e.vz = (this.rng.next() - 0.5) * 0.1;
    }
    e.pickupDelay = pickupDelay;
    this.entities.push(e);
    return e;
  }

  addEntity(e: Entity) {
    this.entities.push(e);
  }

  playBlockSound(blockId: number, x: number, y: number, z: number, kind: 'break' | 'place' | 'hit' | 'step') {
    const def = BLOCKS[blockId];
    const snd = SOUND_FOR[def.sound];
    if (!snd) return;
    const vol = kind === 'hit' ? 0.25 : kind === 'step' ? 0.15 : 1;
    const pitch = kind === 'hit' ? 0.5 : kind === 'place' ? 0.8 : 0.8 + this.rng.next() * 0.2;
    this.audio.play(snd, { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, vol, pitch);
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

  private ambientParticles() {
    const p = this.player!, w = this.world!, pt = this.particles!;
    if (this.options.particles >= 2) return;
    // torch smoke/flames & lava pops in the player's vicinity
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(p.x) + this.rng.int(32) - 16, y = Math.floor(p.y) + this.rng.int(32) - 16, z = Math.floor(p.z) + this.rng.int(32) - 16;
      const v = w.get(x, y, z);
      const id = idOf(v);
      if (id === B.TORCH) {
        const m = metaOf(v);
        let ox = 0.5, oz = 0.5, oy = 0.7;
        if (m >= 1 && m <= 4) {
          const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][m - 1];
          ox += d[0] * 0.27; oz += d[1] * 0.27; oy = 0.92;
        }
        pt.smoke(x + ox, y + oy, z + oz);
        pt.flame(x + ox, y + oy, z + oz);
      } else if (id === B.LAVA && w.getId(x, y + 1, z) === B.AIR && this.rng.int(50) === 0) {
        pt.add({ x: x + this.rng.next(), y: y + 1, z: z + this.rng.next(), vy: 0.2, vx: (this.rng.next() - 0.5) * 0.1, vz: (this.rng.next() - 0.5) * 0.1, layer: tex('particle_flame'), size: 0.07, life: 30, gravity: 0.02, fullbright: true, kind: 'flame' });
      } else if (id === B.LIT_FURNACE && this.rng.int(4) === 0) {
        pt.smoke(x + 0.5, y + 1.05, z + 0.5);
      } else if (id === B.FIRE && this.rng.int(2) === 0) {
        pt.smoke(x + this.rng.next(), y + 0.8, z + this.rng.next(), true);
      } else if ((id === B.WATER || id === B.LAVA) && OPAQUE_BELOW(w, x, y, z) && this.rng.int(20) === 0) {
        // dripping from ceilings
        pt.drip(x + this.rng.next(), y - 1.05, z + this.rng.next(), id === B.LAVA);
      }
      if (id === B.WATER && this.rng.int(10) === 0 && p.inWater) pt.bubble(x + this.rng.next(), y + this.rng.next(), z + this.rng.next());
    }
  }

  // ------------------------------------------------------------------ rendering
  render() {
    const r = this.renderer;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.uiCanvas.width, this.uiCanvas.height);
    if (!this.world || !this.player) {
      r.beginFrame(computeEnv({ time: 6000, renderDistance: 8, underwater: false, inLava: false, blind: 0, rain: 0, thunder: 0, cameraY: 64, gamma: 0.5, clouds: false, skyTemp: 0.8, flicker: 1.5, ticks: 0 }));
      this.ui.render(ctx);
      return;
    }
    const p = this.player, t = this.partial, w = this.world;
    // camera
    const eye = this.eyePos(t);
    let yaw = p.pyaw + (p.yaw - p.pyaw) * t, pitch = p.ppitch + (p.pitch - p.ppitch) * t;
    const cam: Camera = { x: eye.x, y: eye.y, z: eye.z, yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180, fov: this.options.fov * (this.pFovMod + (this.fovMod - this.pFovMod) * t) };
    if (p.inWater && idOf(w.get(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z))) === B.WATER) cam.fov *= 60 / 70;
    if (p.dead) { cam.roll = (Math.min(20, p.deathTime + t) / 20) * (Math.PI / 4); cam.y -= Math.min(1.2, (p.deathTime + t) * 0.06); }
    // hurt tilt
    if (p.hurtTime > 0 && !p.dead) {
      let f = (p.hurtTime - t) / p.hurtDuration;
      f = Math.sin(f * f * f * f * Math.PI);
      cam.roll = ((-f * 14) * Math.PI) / 180 * Math.cos(((p.lastHurtDirection) * Math.PI) / 180);
    }
    // view bobbing
    if (this.options.viewBobbing && this.thirdPerson === 0 && !p.flying) {
      const dw = p.distWalked - p.pDistWalked;
      const f1 = -(p.distWalked + dw * t);
      const f2 = p.pCameraYaw + (p.cameraYaw - p.pCameraYaw) * t;
      cam.bobX = Math.sin(f1 * Math.PI) * f2 * 0.5;
      cam.bobY = -Math.abs(Math.cos(f1 * Math.PI) * f2);
      cam.roll = (cam.roll ?? 0) + ((Math.sin(f1 * Math.PI) * f2 * 3) * Math.PI) / 180;
      cam.pitch += ((Math.abs(Math.cos(f1 * Math.PI - 0.2) * f2) * 5 + (p.pCameraPitch + (p.cameraPitch - p.pCameraPitch) * t)) * Math.PI) / 180;
    }
    if (this.thirdPerson) {
      // pull the camera back, stopping at blocks
      const front = this.thirdPerson === 2;
      if (front) { yaw += 180; pitch = -pitch; cam.yaw += Math.PI; cam.pitch = -cam.pitch; }
      const d = this.lookVec(yaw, pitch);
      let dist = 4;
      const hit = raycastBlocks(w, eye.x, eye.y, eye.z, -d.x, -d.y, -d.z, 4);
      if (hit) dist = Math.max(0.3, hit.t - 0.2);
      cam.x -= d.x * dist; cam.y -= d.y * dist; cam.z -= d.z * dist;
    }
    this.cam = cam;
    this.audio.setListener(eye.x, eye.y, eye.z, yaw);
    r.setupCamera(cam, 0.05, Math.max(256, w.renderDistance * 16 * 1.5 + 64));
    w.update(p.x, p.z, (cx, cz) => r.chunkVisible(cx, cz));

    const camBlock = w.get(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z));
    const underwater = idOf(camBlock) === B.WATER && cam.y < Math.floor(cam.y) + 1 - ((metaOf(camBlock) & 7) + 1) / 9 + 0.12;
    const inLava = idOf(camBlock) === B.LAVA;
    const biome = this.biomeAt(Math.floor(p.x), Math.floor(p.z));
    const nether = w.dimension === 'nether';
    const rain = nether ? 0 : this.weather!.rain;
    const env = nether ? netherEnv(w.renderDistance, this.options.gamma, 1.5 + this.torchFlicker * 0.1, inLava) : computeEnv({
      time: this.time, renderDistance: w.renderDistance, underwater, inLava, blind: 0, rain, thunder: this.weather!.thunder,
      cameraY: cam.y, gamma: this.options.gamma, clouds: this.options.clouds, skyTemp: biome.cold ? -0.5 : biome.name === 'Desert' ? 2 : 0.8,
      flicker: 1.5 + this.torchFlicker * 0.1, ticks: this.ticks + t,
    });
    r.beginFrame(env);
    if (!nether) r.drawSky();
    r.drawChunks(w.chunks.values(), 'opaque');
    this.entityRenderer.render(this, t);
    this.drawSelection();
    const pm = r.dyn;
    pm.reset();
    this.particles!.build(pm, cam.x, cam.y, cam.z, t, yaw, pitch);
    r.drawDyn(pm, { blend: false, cull: false, alphaCut: 0.1 });
    r.drawChunks(w.chunks.values(), 'trans');
    if (!nether) {
      r.drawClouds(192.33);
      this.weather!.render(t);
    }
    // first-person hand
    if (this.thirdPerson === 0 && !this.hideHud && !p.spectator && !this.panorama) this.entityRenderer.renderHand(this, t);
    // overlays
    if (underwater) r.drawOverlay([0.02, 0.05, 0.25, 0.25], 0.5);
    else if (inLava) r.drawOverlay([0.8, 0.25, 0, 0.6]);
    else if (p.fireTicks > 0 && !p.creative) r.drawOverlay([1, 0.45, 0, 0.18]);
    if (camBlock && BLOCKS[idOf(camBlock)].opaque && !p.spectator && this.thirdPerson === 0) r.drawOverlay([0.05, 0.05, 0.05, 0.95]);
    if (this.sleepFade > 0) r.drawOverlay([0.02, 0.02, 0.06, Math.min(1, this.sleepFade)]);
    if (this.portalTime > 0) {
      const f = Math.min(1, (this.portalTime + t) / 80);
      r.drawOverlay([0.45, 0.1, 0.8, f * 0.75 + Math.sin((this.ticks + t) * 0.3) * 0.05 * f]);
    }
    if (this.ui.previewBox) this.entityRenderer.renderPreview(this, this.ui.previewBox, this.gui.scale);
    this.ui.render(ctx);
  }

  private drawSelection() {
    const r = this.renderer, w = this.world!, cam = this.cam;
    const tgt = this.target;
    if (!tgt || this.hideHud || this.ui.screen?.hidesSelection) return;
    const v = w.get(tgt.x, tgt.y, tgt.z);
    const shapes = selectionShapes(v, (a, b, c) => w.get(tgt.x + a, tgt.y + b, tgt.z + c));
    if (!shapes.length) return;
    let x0 = 1, y0 = 1, z0 = 1, x1 = 0, y1 = 0, z1 = 0;
    for (const s of shapes) { x0 = Math.min(x0, s.x0); y0 = Math.min(y0, s.y0); z0 = Math.min(z0, s.z0); x1 = Math.max(x1, s.x1); y1 = Math.max(y1, s.y1); z1 = Math.max(z1, s.z1); }
    const e = 0.002;
    const ox = tgt.x - cam.x, oy = tgt.y - cam.y, oz = tgt.z - cam.z;
    const X0 = ox + x0 - e, Y0 = oy + y0 - e, Z0 = oz + z0 - e, X1 = ox + x1 + e, Y1 = oy + y1 + e, Z1 = oz + z1 + e;
    const L = [
      X0, Y0, Z0, X1, Y0, Z0, X1, Y0, Z0, X1, Y0, Z1, X1, Y0, Z1, X0, Y0, Z1, X0, Y0, Z1, X0, Y0, Z0,
      X0, Y1, Z0, X1, Y1, Z0, X1, Y1, Z0, X1, Y1, Z1, X1, Y1, Z1, X0, Y1, Z1, X0, Y1, Z1, X0, Y1, Z0,
      X0, Y0, Z0, X0, Y1, Z0, X1, Y0, Z0, X1, Y1, Z0, X1, Y0, Z1, X1, Y1, Z1, X0, Y0, Z1, X0, Y1, Z1,
    ];
    r.drawLines(new Float32Array(L), [0, 0, 0, 0.45]);
    // crack overlay
    const br = this.interact!.breaking;
    if (br && br.x === tgt.x && br.y === tgt.y && br.z === tgt.z && br.progress > 0) {
      const stage = Math.min(9, Math.floor(br.progress * 10));
      const layer = TEXTURES.indexOf('destroy_stage_' + stage);
      const m = r.dyn;
      m.reset();
      const E = 0.004;
      for (const s of shapes) {
        const a = [ox + s.x0 - E, oy + s.y0 - E, oz + s.z0 - E], b = [ox + s.x1 + E, oy + s.y1 + E, oz + s.z1 + E];
        boxFaces(m, a, b, layer, s);
      }
      r.gl.enable(r.gl.POLYGON_OFFSET_FILL);
      r.gl.polygonOffset(-1, -10);
      r.drawDyn(m, { blend: true, fullbright: true, alphaCut: 0.01 });
      r.gl.disable(r.gl.POLYGON_OFFSET_FILL);
    }
  }

  get heldItem(): ItemStack | null {
    return this.player?.inventory.held() ?? null;
  }

  // debug info for F3
  debugLines(): string[] {
    const p = this.player, w = this.world;
    if (!p || !w) return [];
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const [sl, bl] = w.getLight(bx, by, bz);
    const facing = ['south (Towards positive Z)', 'west (Towards negative X)', 'north (Towards negative Z)', 'east (Towards positive X)'][((Math.round(p.yaw / 90) % 4) + 4) % 4];
    const chunks = [...w.chunks.values()];
    const lines = [
      `Minecraft Web 1.0 (vanilla-like)`,
      `${this.fps} fps (${this.frameMs.toFixed(1)} ms frame)`,
      `C: ${this.renderer.drawnChunks}/${chunks.filter((c) => c.mesh).length} D: ${w.renderDistance}, ${(this.renderer.chunkBytes / 1048576).toFixed(1)} MB meshes`,
      `E: ${this.entities.length}, P: ${this.particles!.list.length}`,
      '',
      `XYZ: ${p.x.toFixed(3)} / ${p.y.toFixed(5)} / ${p.z.toFixed(3)}`,
      `Block: ${bx} ${by} ${bz}`,
      `Chunk: ${bx & 15} ${by & 15} ${bz & 15} in ${bx >> 4} ${by >> 4} ${bz >> 4}`,
      `Facing: ${facing} (${(((p.yaw % 360) + 540) % 360 - 180).toFixed(1)} / ${p.pitch.toFixed(1)})`,
      `Light: ${Math.max(sl, bl)} (${sl} sky, ${bl} block)`,
      `Biome: ${this.biomeAt(bx, bz).name}`,
      `Local Difficulty: ${['Peaceful', 'Easy', 'Normal', 'Hard'][this.options.difficulty]}`,
      `Day ${Math.floor(this.time / 24000)}, time ${this.time % 24000}`,
      `Seed: ${this.meta?.seed}`,
    ];
    if (this.target) {
      const v = w.get(this.target.x, this.target.y, this.target.z);
      lines.push('', `Targeted Block: ${this.target.x}, ${this.target.y}, ${this.target.z}`, `minecraft:${BLOCKS[idOf(v)].name}${metaOf(v) ? ' [meta=' + metaOf(v) + ']' : ''}`);
    }
    if (this.targetEntity) lines.push('', `Targeted Entity: ${(this.targetEntity as unknown as { typeName: string }).typeName}`);
    return lines;
  }
}

/** Fluid resting on an opaque block that has air beneath it: drips from the ceiling. */
function OPAQUE_BELOW(w: World, x: number, y: number, z: number) {
  return w.isOpaque(x, y - 1, z) && w.getId(x, y - 2, z) === B.AIR;
}

/** Emit 6 faces of a box into a dynamic mesh (used for crack overlays and dropped blocks). */
export function boxFaces(m: import('../render/gl').DynMesh, a: number[], b: number[], layer: number, s: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }, col = 0xffffff, alpha = 1, sky = 15, blk = 15) {
  const [x0, y0, z0] = a, [x1, y1, z1] = b;
  const u = (v: number) => v;
  // -x
  m.v(x0, y0, z0, u(s.z0), 1 - s.y0, layer, col, alpha, sky, blk); m.v(x0, y0, z1, u(s.z1), 1 - s.y0, layer, col, alpha, sky, blk);
  m.v(x0, y1, z1, u(s.z1), 1 - s.y1, layer, col, alpha, sky, blk); m.v(x0, y1, z0, u(s.z0), 1 - s.y1, layer, col, alpha, sky, blk);
  // +x
  m.v(x1, y0, z1, 1 - s.z1, 1 - s.y0, layer, col, alpha, sky, blk); m.v(x1, y0, z0, 1 - s.z0, 1 - s.y0, layer, col, alpha, sky, blk);
  m.v(x1, y1, z0, 1 - s.z0, 1 - s.y1, layer, col, alpha, sky, blk); m.v(x1, y1, z1, 1 - s.z1, 1 - s.y1, layer, col, alpha, sky, blk);
  // -y
  m.v(x0, y0, z0, s.x0, s.z0, layer, col, alpha, sky, blk); m.v(x1, y0, z0, s.x1, s.z0, layer, col, alpha, sky, blk);
  m.v(x1, y0, z1, s.x1, s.z1, layer, col, alpha, sky, blk); m.v(x0, y0, z1, s.x0, s.z1, layer, col, alpha, sky, blk);
  // +y
  m.v(x0, y1, z0, s.x0, s.z0, layer, col, alpha, sky, blk); m.v(x0, y1, z1, s.x0, s.z1, layer, col, alpha, sky, blk);
  m.v(x1, y1, z1, s.x1, s.z1, layer, col, alpha, sky, blk); m.v(x1, y1, z0, s.x1, s.z0, layer, col, alpha, sky, blk);
  // -z
  m.v(x1, y0, z0, 1 - s.x1, 1 - s.y0, layer, col, alpha, sky, blk); m.v(x0, y0, z0, 1 - s.x0, 1 - s.y0, layer, col, alpha, sky, blk);
  m.v(x0, y1, z0, 1 - s.x0, 1 - s.y1, layer, col, alpha, sky, blk); m.v(x1, y1, z0, 1 - s.x1, 1 - s.y1, layer, col, alpha, sky, blk);
  // +z
  m.v(x0, y0, z1, s.x0, 1 - s.y0, layer, col, alpha, sky, blk); m.v(x1, y0, z1, s.x1, 1 - s.y0, layer, col, alpha, sky, blk);
  m.v(x1, y1, z1, s.x1, 1 - s.y1, layer, col, alpha, sky, blk); m.v(x0, y1, z1, s.x0, 1 - s.y1, layer, col, alpha, sky, blk);
}

export { stack, I, getItem, Render, CHUNK_H, mat4 };

function shadowTexture(): Uint8ClampedArray {
  const img = new Uint8ClampedArray(16 * 16 * 4);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5) / 7.5;
      img[(y * 16 + x) * 4 + 3] = d < 1 ? Math.round(255 * (1 - d * d) * 0.9 + 25) * (d < 0.95 ? 1 : 0.5) : 0;
    }
  return img;
}

/** Copy of a texture with the tint-masked (alpha 254) pixels coloured. */
function tintMasked(img: Uint8ClampedArray, col: number): Uint8ClampedArray {
  const o = new Uint8ClampedArray(img);
  for (let i = 0; i < o.length; i += 4) {
    if (o[i + 3] > 0 && o[i + 3] < 255) {
      o[i] = (o[i] * ((col >> 16) & 255)) / 255;
      o[i + 1] = (o[i + 1] * ((col >> 8) & 255)) / 255;
      o[i + 2] = (o[i + 2] * (col & 255)) / 255;
      o[i + 3] = 255;
    }
  }
  return o;
}
