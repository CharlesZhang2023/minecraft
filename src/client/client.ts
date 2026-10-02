// The client: what a player sees, hears and touches. It draws the world it's been sent, moves its own player
// (so walking feels instant), and tells the server what the player does each tick. Single-player starts a server
// in this page and talks to it over a loopback connection; joining someone else's game uses WebRTC instead.
import { Renderer, Camera } from '../render/renderer';
import { World, Dimension, TileEntity } from '../world/world';
import { Player } from '../game/player';
import { Input } from '../game/input';
import { device } from '../game/device';
import { Audio, SOUND_FOR } from '../game/audio';
import { Options, loadOptions, saveOptions } from '../game/options';
import { Particles } from '../game/particles';
import { computeEnv, netherEnv, endEnv } from '../game/env';
import { raycastBlocks, BlockHit } from '../game/raycast';
import { BLOCKS, B, idOf, metaOf, TEXTURES, tex, CHUNK_H } from '../world/blocks';
import { selectionShapes } from '../world/models';
import { ItemStack } from '../game/items';
import { Gui } from '../ui/gui';
import { IconCache } from '../ui/icons';
import { UI } from '../ui/ui';
import { WorldMeta, rleDecode } from '../game/storage';
import { Entity } from '../entity/entity';
import { LivingEntity } from '../entity/living';
import { ItemEntity, Fireball } from '../entity/item';
import { Boat } from '../entity/boat';
import { Minecart } from '../entity/minecart';
import { EntityRenderer } from '../render/entityrender';
import { Weather, rainTexture, snowTexture } from '../game/weather';
import { rayAABB, clamp } from '../math';
import { getItemSprite, ITEM_SPRITE_NAMES } from '../render/itemsprites';
import { getTexture } from '../render/textures';
import { Random } from '../noise';
import { BIOMES } from '../world/biomes';
import { Achievements } from '../game/achievements';
import { LoadingScreen, CreditsScreen, DisconnectedScreen, SleepScreen, DeathScreen } from '../ui/menus';
import { ContainerScreen } from '../ui/containers';
import { pistonDrawList } from '../game/pistons';
import type { Breaking } from '../game/interact';
import type { Mount } from '../entity/mount';
import { Game } from '../game/game';
import type { Conn, Msg } from '../net/conn';
import { loopbackPair } from '../net/conn';
import { makePuppet, applyState, decodeValue, syncInventory, State } from '../net/replicate';

export const TICK_MS = 50;

/** The client's view of its own actions: progress bars and animations the server reports back. */
class ClientInteract {
  breaking: Breaking | null = null;
  eating = 0;
  usingBow = false;
  bowTicks = 0;
  constructor(private c: Client) {}
  bowCharge() { return this.usingBow ? this.bowTicks : 0; }
  /** Throwing items out of a window happens in the server's copy of it. */
  throwStack(_s: ItemStack) {}
  dropHeld(all: boolean) { this.c.keyPress(all ? 'KeyQ!' : 'KeyQ'); }
  swapOffhand() { this.c.keyPress('KeyF'); }
  /** Taps on mobs are resolved by the server (use the held item on it, or else hit it). */
  interactEntity() { return false; }
}

/** A tick's worth of changes from the server. */
interface Bundle extends Msg {
  n: number;
  blocks?: number[];
  tiles?: [number, number, number, unknown][];
  ents?: { s: [number, string, State][]; d: [number, State][]; r: number[] };
  self?: Record<string, unknown>;
  win?: { slots: (ItemStack | null | 0)[]; cursor: ItemStack | null; tile: { x: number; y: number; z: number; v: unknown } | null; extra: unknown };
  ev?: unknown[][];
  time?: { time: number; dl: boolean; raining: boolean; thundering: boolean; rain: number; thunder: number };
  pist?: number[][];
  push?: [number, number, number];
  nudge?: [number, number, number];
  turn?: number;
  ride?: [number, number, number];
}

export class Client {
  renderer: Renderer;
  gui: Gui;
  icons = new IconCache();
  ui: UI;
  input: Input;
  audio = new Audio();
  options: Options;
  world: World | null = null;
  player: Player | null = null;
  entities: Entity[] = [];
  particles: Particles | null = null;
  weather: Weather | null = null;
  interact: ClientInteract | null = null;
  achievements: Achievements;
  entityRenderer: EntityRenderer;
  /** World facts the server shared on joining. */
  meta: (Pick<WorldMeta, 'name' | 'seed' | 'hardcore'> & { enderChest?: unknown[] }) | null = null;
  time = 0;
  ticks = 0;
  private acc = 0;
  private last = performance.now();
  partial = 0;
  gatewayBeam: { x: number; y: number; z: number; until: number } | null = null;
  pistons = { list: [] as number[][], renderList: (t: number) => pistonDrawList(this.pistons.list, t) };
  target: BlockHit | null = null;
  targetEntity: Entity | null = null;
  targetPart: string | null = null;
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
  handSwapAnim = 0;
  pHandSwapAnim = 0;
  lastHeldId = -1;
  lastHeldSlot = -1;
  sleepFade = 0;
  dimension: Dimension = 'overworld';
  portalTime = 0;
  torchFlicker = 0;
  private torchFlickerDX = 0;
  titleYaw = 0;
  private uiCanvas: HTMLCanvasElement;

  // ---- connection
  /** The simulation, when it runs in this page (single-player, or hosting). */
  server: Game | null = null;
  conn: Conn | null = null;
  /** Joined someone else's game. */
  remote = false;
  /** The server has placed us (spawn area / portal exit ready). */
  arrived = false;
  myId = 0;
  private puppets = new Map<number, Entity>();
  private tpId = 0;
  private bundles: Bundle[] = [];
  private keyQueue: string[] = [];
  private lastSwings = 0;
  private lastHurt = 0;
  /** A screen the server opened is being opened (don't echo it back). */
  serverOpening = false;
  /** What was typed in chat, for the up-arrow. */
  chatHistory = { history: [] as string[] };

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
    extra.push({ name: 'end_beam', img: getTexture('end_beam') });
    this.renderer.initAtlas(extra);
    this.gui = new Gui();
    this.input = new Input(uiCanvas);
    this.entityRenderer = new EntityRenderer(this.renderer);
    this.achievements = new Achievements(this as unknown as Game);
    this.achievements.passive = true;
    this.ui = new UI(this);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    screen.orientation?.addEventListener('change', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('scroll', () => this.resize());
    device.onChange(() => this.resize());
    this.audio.volume = this.options.volume;
    this.audio.musicVolume = this.options.music;
  }

  private lastSize = '';
  resize() {
    const dpr = device.ratio(), vp = device.viewport();
    const w = Math.max(1, Math.floor(vp.w * dpr)), h = Math.max(1, Math.floor(vp.h * dpr));
    // visualViewport fires scroll/resize in bursts (iOS keyboard, pinch): resizing a canvas reallocates and clears it
    const key = `${w},${h},${vp.x},${vp.y},${vp.w},${vp.h},${vp.rot},${device.touch}`;
    if (key === this.lastSize) return;
    this.lastSize = key;
    // on touch devices the canvases follow the visual viewport (it shrinks when the soft keyboard opens);
    // held upright, they are turned a quarter clockwise so the game stays landscape
    for (const c of [this.renderer.canvas, this.uiCanvas]) {
      c.style.left = device.touch ? vp.x + 'px' : '';
      c.style.top = device.touch ? vp.y + 'px' : '';
      c.style.width = device.touch ? vp.w + 'px' : '';
      c.style.height = device.touch ? vp.h + 'px' : '';
      c.style.transformOrigin = vp.rot ? '0 0' : '';
      c.style.transform = vp.rot ? `translateX(${vp.sw}px) rotate(90deg)` : '';
    }
    this.renderer.resize(w, h);
    this.uiCanvas.width = w;
    this.uiCanvas.height = h;
  }

  saveOptions() {
    saveOptions(this.options);
    this.audio.setVolume(this.options.volume, this.options.music);
    if (this.world) this.world.renderDistance = this.panorama ? Math.min(6, this.options.renderDistance) : this.options.renderDistance;
    this.conn?.send({ t: 'vd', r: this.options.renderDistance });
    if (this.server && !this.remote) {
      this.server.options.difficulty = this.options.difficulty;
      for (const sp of this.server.players) sp.entity.difficulty = this.options.difficulty;
    }
  }

  /** Is this page simulating with nobody else connected (so the pause menu can stop time)? */
  get alone() {
    return !!this.server && this.server.players.length <= 1;
  }

  // ------------------------------------------------------------------ world lifecycle
  /** Single-player (or a world about to be hosted): run the server here and join it. */
  async openWorld(meta: WorldMeta, panorama = false) {
    await this.closeWorld(false);
    if (panorama) { this.openPanorama(meta); return; }
    const server = new Game();
    server.options.difficulty = this.options.difficulty;
    server.maxViewDistance = Math.max(12, this.options.renderDistance);
    meta.difficulty ??= this.options.difficulty;
    await server.openWorld(meta);
    const [mine, theirs] = loopbackPair();
    this.server = server;
    this.connect(mine, false);
    await server.addPlayer(theirs, this.options.playerName || 'Player', true);
  }

  /** The title screen's backdrop: a world generated and drawn locally, nobody in it. */
  private openPanorama(meta: WorldMeta) {
    this.panorama = true;
    const world = new World(meta.seed, meta.id, 'overworld', 'local');
    world.renderDistance = Math.min(6, this.options.renderDistance);
    this.attachWorld(world);
    this.time = meta.time ?? 0;
    const p = new Player(world);
    p.clientSide = true;
    p.spawnY = -1;
    p.setPos(0.5, 200, 0.5);
    this.player = p;
  }

  /** Start talking to a server (ours over loopback, or someone else's). */
  connect(conn: Conn, remote: boolean) {
    this.conn = conn;
    this.remote = remote;
    this.arrived = false;
    this.bundles = [];
    this.puppets.clear();
    conn.send({ t: 'vd', r: this.options.renderDistance });
  }

  private attachWorld(world: World) {
    this.world = world;
    world.onMesh = (c, r) => this.renderer.uploadChunk(c, r);
    world.onUnload = (c) => this.renderer.freeChunk(c);
    this.particles = new Particles(world);
    this.weather = new Weather(this as unknown as Game);
    this.interact = new ClientInteract(this);
    this.dimension = world.dimension;
    this.entities = [];
    this.puppets.clear();
    this.pistons.list = [];
    this.gatewayBeam = null;
  }

  private dropWorld() {
    if (!this.world) return;
    for (const c of this.world.chunks.values()) this.renderer.freeChunk(c);
    this.world.destroy();
    this.world = null;
  }

  async closeWorld(_save = true) {
    const server = this.server, conn = this.conn;
    this.conn = null;
    this.server = null;
    conn?.close('quit');
    if (server) await server.close();
    this.dropWorld();
    this.player = null;
    this.entities = [];
    this.meta = null;
    this.target = null;
    this.panorama = false;
    this.remote = false;
  }

  /** Save without leaving (tab hidden / closing). */
  saveWorld() {
    return this.server?.saveWorld();
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
    // the pause menu stops time only when nobody else is playing (like opening to LAN does in the real game)
    const paused = this.ui.pausesGame() && (!this.server || this.alone) && !this.remote;
    if (this.server) this.server.paused = paused;
    if (!paused) this.acc += dt;
    let n = 0;
    while (this.acc >= TICK_MS && n < 10) {
      this.tick();
      if (this.server) this.server.tick();
      // in-page server: take its answer straight away, so actions show up the same tick
      if (this.server) this.receive();
      this.acc -= TICK_MS;
      n++;
    }
    if (paused && this.server) {
      // keep the connection alive (chunks keep streaming while paused)
      this.server.tick();
      this.receive();
    }
    if (n >= 10) this.acc = 0;
    if (!this.server && this.conn) this.receive();
    this.ui.tick(dt);
    this.partial = paused ? 1 : this.acc / TICK_MS;
    this.ui.touch.update();
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
    const o = this.options;
    const curve = (v: number) => { const s = v * 0.6 + 0.2; return s * s * s * 8 * 0.15; };
    // touch: separate across / up-down speeds, swipe up looks up unless set to drag the view with the
    // finger; the mouse keeps one speed and its own invert setting
    const fx = curve(device.touch ? o.touchSensX : o.sensitivity);
    const fy = device.touch ? curve(o.touchSensY) * (o.touchSwipeDown ? -1 : 1) : curve(o.sensitivity) * (o.invertY ? -1 : 1);
    p.yaw += dx * fx;
    p.pitch = clamp(p.pitch + dy * fy, -90, 90);
    p.pyaw += dx * fx;
    p.ppitch = clamp(p.ppitch + dy * fy, -90, 90);
  }

  /** A key that acts in the world (drop, swap hands), sent with the next tick. */
  keyPress(code: string) {
    this.keyQueue.push(code);
  }

  tick() {
    this.ticks++;
    const w = this.world, p = this.player;
    this.audio.tickMusic(!w || this.panorama);
    if (this.conn && !this.server) this.applyBundles();
    if (this.conn?.closed && !this.server) { this.disconnected(this.conn.closeReason); return; }
    if (!w || !p) return;
    this.renderer.atlas.tick(this.ticks);
    this.torchFlickerDX += (Math.random() - Math.random()) * Math.random() * Math.random();
    this.torchFlickerDX *= 0.9;
    this.torchFlicker += this.torchFlickerDX - this.torchFlicker;
    this.torchFlicker *= 0.9;
    if (this.panorama) { this.panoramaTick(); return; }
    if (this.doDaylightCycle) this.time++;
    if (this.dimension === 'overworld') this.weather!.clientTick();

    // ---------- player input and movement (our own player moves here; the server follows)
    this.handleKeys();
    p.preTick();
    const loaded = this.arrived && w.isLoaded(p.x, p.z);
    const inp = this.ui.screen || !loaded ? { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false } : this.moveInput();
    if (loaded) {
      if (p.riding) {
        if (inp.sneak) this.conn?.send({ t: 'dismount' });
        p.tick();
      } else if (!p.dead) {
        p.applyInput(inp);
        p.tick();
      } else p.tick();
    }
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
    this.sendInput(inp);

    // potion swirls around entities under status effects
    for (const e of [p, ...this.entities]) {
      if (!(e instanceof LivingEntity) || !e.effectColor || e.dead) continue;
      const own = e === p && this.thirdPerson === 0;
      if (this.rng.next() > (own ? 0.12 : e.effects.has('invisibility') ? 0.15 : 0.6)) continue;
      this.particles!.swirl(e.x + (this.rng.next() - 0.5) * e.width, e.y + this.rng.next() * e.height, e.z + (this.rng.next() - 0.5) * e.width, 0, 0.02, 0, e.effectColor);
    }
    this.entityRenderer.tick();
    this.particles!.tick();
    this.ambientParticles();
    // footsteps
    if (p.onGround && !p.sneaking && Math.floor(p.distWalked) !== Math.floor(p.pDistWalked)) {
      const below = w.getId(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
      const snd = SOUND_FOR[BLOCKS[below].sound];
      if (snd) this.audio.play(snd, null, 0.15, 1);
    }
    if (p.inWater && Math.floor(p.distWalked * 2) !== Math.floor(p.pDistWalked * 2) && this.rng.int(3) === 0) this.audio.play('swim', null, 0.2, 1 + (this.rng.next() - 0.5) * 0.4);
    this.ui.hud.tick();
    // cave ambience: underground in the dark, every few minutes
    if (this.dimension === 'overworld' && this.rng.int(6000) === 0) {
      const [sl, bl] = w.getLight(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z));
      if (sl === 0 && bl < 8 && p.y < 60) this.audio.play('cave', null, 0.7, 0.8 + this.rng.next() * 0.3);
    }
    this.audio.setRain(this.dimension === 'overworld' && this.weather!.rainAt(p.x, p.y, p.z) && !p.isInsideOpaque() ? this.weather!.rain : 0);
  }

  private panoramaTick() {
    const p = this.player!, w = this.world!;
    this.time += 1;
    this.titleYaw += 0.1;
    p.preTick();
    p.yaw = this.titleYaw;
    p.pitch = 12;
    if (p.spawnY < 0) {
      if (!w.chunkAt(0, 0)) return;
      p.spawnY = w.topSolidY(0, 0) + 1;
    }
    // hover above the highest nearby terrain
    let top = p.spawnY;
    for (let dx = -8; dx <= 8; dx += 4) for (let dz = -8; dz <= 8; dz += 4) top = Math.max(top, w.topSolidY(p.spawnX + dx, p.spawnZ + dz) + 1);
    p.setPos(p.spawnX + 0.5, top + 4, p.spawnZ + 0.5);
    p.pitch = p.ppitch = 8;
  }

  private moveInput() {
    const i = this.input;
    let forward = 0, strafe = 0;
    if (i.isDown('KeyW')) forward += 1;
    if (i.isDown('KeyS')) forward -= 1;
    if (i.isDown('KeyA')) strafe += 1;
    if (i.isDown('KeyD')) strafe -= 1;
    if (i.stick) {
      // analog stick overrides the keys: up is forward, left is +strafe
      forward = -i.stick.y;
      strafe = -i.stick.x;
    }
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
      if (code === 'KeyQ') this.keyPress(this.input.isDown('ControlLeft') || this.input.isDown('MetaLeft') ? 'KeyQ!' : 'KeyQ');
      if (code === 'KeyF') this.keyPress('KeyF');
    }
    const wheel = this.input.takeWheel();
    if (wheel && !this.ui.screen) p.inventory.selected = (((p.inventory.selected + wheel) % 9) + 9) % 9;
  }

  /** Tell the server where we are and what we're pressing. */
  private sendInput(inp: { forward: number; strafe: number; jump: boolean; sneak: boolean }) {
    const p = this.player!, conn = this.conn;
    if (!conn) return;
    const i = this.input;
    const act = i.locked && !this.ui.screen && !p.dead;
    const aim = this.touchAim() ? (i.aim ? this.screenRay(i.aim.x, i.aim.y) : null) : this.lookVec(p.yaw, p.pitch);
    const pressed = i.takeMousePressed();
    const held = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'MetaLeft'].filter((k) => i.isDown(k));
    conn.send({
      t: 'in', x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, yaw: p.yaw, pitch: p.pitch,
      g: p.onGround, sn: p.sneaking, sp: p.sprinting, fl: p.flying, jp: inp.jump, fw: inp.forward, st: inp.strafe,
      j: p.jumps, sel: p.inventory.selected, act, md: act ? [...i.mouseDown] : [], mp: act ? pressed : [],
      dir: aim ? [aim.x, aim.y, aim.z] : null, kd: held, kp: this.keyQueue, tp: this.tpId,
    });
    p.jumps = 0;
    this.keyQueue = [];
  }

  // ------------------------------------------------------------------ messages from the server
  /** Handle everything that has arrived. Tick bundles from a remote server wait in a small jitter buffer. */
  receive() {
    const conn = this.conn;
    if (!conn) return;
    for (const m of conn.poll()) this.handle(m);
    if (this.server) this.applyBundles();
    if (conn.closed && !this.server) this.disconnected(conn.closeReason);
  }

  private applyBundles() {
    if (!this.bundles.length) return;
    // from a server in this page: everything at once; from far away: one per tick (smooth), catching up if behind
    if (this.server) { for (const b of this.bundles) this.applyBundle(b); this.bundles = []; return; }
    let n = this.bundles.length > 4 ? this.bundles.length - 2 : 1;
    while (n-- > 0 && this.bundles.length) this.applyBundle(this.bundles.shift()!);
  }

  private handle(m: Msg) {
    switch (m.t) {
      case 'tick': this.bundles.push(m as Bundle); break;
      case 'join': this.joined(m); break;
      case 'dim': this.changedDim(m.dim as Dimension, String(m.title ?? 'Loading')); break;
      case 'chunk': {
        if (!this.world) break;
        const tiles = decodeValue(m.tiles, () => null) as [number, TileEntity][] | undefined;
        this.world.receiveChunk(m.cx as number, m.cz as number, rleDecode(m.blocks as Uint16Array, 16 * 16 * CHUNK_H), m.biomes as Uint8Array, tiles);
        break;
      }
      case 'unchunk': this.world?.dropChunk(m.cx as number, m.cz as number); break;
      case 'gen': this.world?.generateChunk(m.cx as number, m.cz as number); break;
      case 'tp': {
        const p = this.player;
        if (!p) break;
        this.tpId = m.id as number;
        p.setPos(m.x as number, m.y as number, m.z as number);
        p.yaw = p.pyaw = m.yaw as number;
        p.pitch = p.ppitch = m.pitch as number;
        p.vx = p.vy = p.vz = 0;
        break;
      }
      case 'ready': this.arrived = true; break;
      case 'chat': this.ui.chat.add(String(m.msg)); break;
      case 'bar': this.ui.hud.actionBar(String(m.msg)); break;
      case 'ach': this.achievements.show(String(m.id)); break;
      case 'sel': if (this.player) this.player.inventory.selected = m.n as number; break;
      case 'death': setTimeout(() => this.ui.openDeath(String(m.msg)), 50); break;
      case 'credits': this.ui.open(new CreditsScreen(this.ui, () => this.ui.close())); break;
      case 'open': this.serverOpen(m); break;
      case 'close':
        if (this.ui.screen instanceof ContainerScreen) { this.serverOpening = true; this.ui.open(null); this.serverOpening = false; }
        break;
      case 'wake':
        if (this.player) this.player.sleeping = false;
        this.sleepFade = 0;
        if (this.ui.screen instanceof SleepScreen) { this.serverOpening = true; this.ui.close(); this.serverOpening = false; }
        break;
    }
  }

  private joined(m: Msg) {
    this.meta = { name: String(m.worldName ?? ''), seed: m.seed as number, hardcore: !!m.hardcore };
    this.myId = m.id as number;
    this.syncTime(m.time as Bundle['time']);
    this.changedDim(m.dim as Dimension, 'Loading world');
  }

  /** A new dimension (or the first one): a fresh, empty copy of the world to fill. */
  private changedDim(dim: Dimension, title: string) {
    this.dropWorld();
    const world = new World(this.meta?.seed ?? 0, 'remote', dim, 'client');
    world.renderDistance = this.options.renderDistance;
    this.attachWorld(world);
    let p = this.player;
    if (!p) {
      p = new Player(world);
      p.clientSide = true;
      this.player = p;
    }
    p.world = world;
    p.riding = null;
    this.arrived = false;
    const loading = new LoadingScreen(this.ui, title);
    loading.ready = true;
    this.ui.open(loading);
  }

  private syncTime(s: Bundle['time']) {
    if (!s) return;
    this.time = s.time;
    this.doDaylightCycle = s.dl;
    this.weather?.sync(s);
  }

  private resolve = (id: number): Entity | null => (id === this.myId ? this.player : this.puppets.get(id) ?? null);

  private applyBundle(b: Bundle) {
    const w = this.world, p = this.player;
    if (!w || !p) return;
    if (b.blocks) for (let i = 0; i < b.blocks.length; i += 4) w.set(b.blocks[i], b.blocks[i + 1], b.blocks[i + 2], b.blocks[i + 3]);
    if (b.tiles) for (const [x, y, z, v] of b.tiles) {
      const t = decodeValue(v, this.resolve) as TileEntity | null;
      const cur = w.getTile(x, y, z);
      // update in place so an open window keeps looking at the same arrays
      if (cur && t && cur.type === t.type) syncInto(cur, t);
      else w.setTile(x, y, z, t ?? undefined);
    }
    // every puppet moves on a tick, whether or not it changed (so interpolation doesn't replay the last step)
    for (const e of this.entities) e.preTick();
    if (b.ents) {
      for (const [id, type, s] of b.ents.s) {
        const e = makePuppet(type, w, this as unknown as Game, p);
        if (!e) continue;
        e.id = id;
        this.puppets.set(id, e);
        this.entities.push(e);
        (e as unknown as { netState: State }).netState = s;
      }
      for (const [id, , s] of b.ents.s) {
        const e = this.puppets.get(id);
        if (!e) continue;
        applyState(e, s, this.resolve);
        e.px = e.x; e.py = e.y; e.pz = e.z; e.pyaw = e.yaw; e.ppitch = e.pitch;
        if (e instanceof LivingEntity) { e.pHeadYaw = e.headYaw; e.pBodyYaw = e.bodyYaw; }
      }
      for (const [id, s] of b.ents.d) {
        const e = this.puppets.get(id);
        if (!e) continue;
        applyState(e, s, this.resolve);
        // a jump of more than a few blocks is a teleport: don't draw it sliding there
        if (Math.abs(e.x - e.px) + Math.abs(e.y - e.py) + Math.abs(e.z - e.pz) > 8) { e.px = e.x; e.py = e.y; e.pz = e.z; }
      }
      // pickups first: the item has to still be there to fly into whoever took it
      if (b.ev) for (const e of b.ev) if (e[0] === 'pickup') this.event(e);
      for (const id of b.ents.r) {
        const e = this.puppets.get(id);
        if (!e) continue;
        this.puppets.delete(id);
        const k = this.entities.indexOf(e);
        if (k >= 0) this.entities.splice(k, 1);
      }
    }
    if (b.self) this.applySelf(b.self);
    if (b.push) { p.vx += b.push[0]; p.vy += b.push[1]; p.vz += b.push[2]; }
    if (b.nudge) p.move(b.nudge[0], b.nudge[1], b.nudge[2]);
    if (b.turn) p.yaw += b.turn;
    if (b.ride) { p.x = b.ride[0]; p.y = b.ride[1]; p.z = b.ride[2]; }
    if (b.win) this.applyWindow(b.win);
    if (b.time) this.syncTime(b.time);
    if (b.pist) this.pistons.list = b.pist;
    if (b.ev) for (const e of b.ev) if (e[0] !== 'pickup' || !b.ents) this.event(e);
  }

  /** Our own status from the server. */
  private applySelf(s: Record<string, unknown>) {
    const p = this.player!;
    const o = p as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(s)) {
      switch (k) {
        case 'inventory': syncInventory(p.inventory, v as never, true); break;
        case 'effects':
          p.effects.clear();
          for (const e of v as { id: string; amp: number; dur: number }[]) p.effects.set(e.id, e);
          p.effectsChanged();
          break;
        case 'gameMode': p.setGameMode(v as number); break;
        case 'breaking': {
          const b = v as [number, number, number, number] | null;
          this.interact!.breaking = b ? { x: b[0], y: b[1], z: b[2], progress: b[3], face: 0, sound: 0 } : null;
          break;
        }
        case 'bow': this.interact!.usingBow = (v as number) > 0; this.interact!.bowTicks = v as number; break;
        case 'eatingTicks': p.eatingTicks = v as number; this.interact!.eating = v as number; break;
        case 'portal': this.portalTime = v as number; break;
        case 'swings': if ((v as number) !== this.lastSwings) { this.lastSwings = v as number; p.swing(); } break;
        case 'riding': p.riding = (v ? (this.puppets.get(v as number) as unknown as Mount) ?? null : null); break;
        case 'spawn': [p.spawnX, p.spawnY, p.spawnZ] = v as [number, number, number]; break;
        case 'sleeping':
          p.sleeping = !!v;
          break;
        default: o[k] = v;
      }
    }
    if (s.dead === false && this.ui.screen instanceof DeathScreen) this.ui.close();
  }

  private applyWindow(w: NonNullable<Bundle['win']>) {
    const s = this.ui.screen;
    if (!(s instanceof ContainerScreen)) return;
    if (w.tile && this.world) {
      const t = decodeValue(w.tile.v, this.resolve) as TileEntity;
      const cur = this.world.getTile(w.tile.x, w.tile.y, w.tile.z);
      if (cur && t && cur.type === t.type) syncInto(cur, t);
      else if (t) this.world.setTile(w.tile.x, w.tile.y, w.tile.z, t);
    }
    if (w.slots.length === s.slots.length)
      for (let i = 0; i < s.slots.length; i++) {
        const sl = s.slots[i];
        if (sl.infinite || w.slots[i] === 0) continue;
        const v = w.slots[i] as ItemStack | null;
        const cur = sl.get();
        if (JSON.stringify(cur ?? null) !== JSON.stringify(v ?? null)) sl.set(v ? { ...v } : null);
      }
    s.cursor = w.cursor ? { ...w.cursor } : null;
    if (w.extra !== null && w.extra !== undefined) s.applySyncState(w.extra);
  }

  /** The server opened a window for us (we clicked a chest, a villager...). */
  private serverOpen(m: Msg) {
    const name = String(m.m);
    const args = ((m.a as unknown[]) ?? []).map((a) => decodeValue(a, this.resolve));
    const tile = m.tile as { x: number; y: number; z: number; v: unknown } | null;
    if (tile && this.world) {
      const t = decodeValue(tile.v, this.resolve) as TileEntity;
      const cur = this.world.getTile(tile.x, tile.y, tile.z);
      if (cur && t && cur.type === t.type) syncInto(cur, t);
      else this.world.setTile(tile.x, tile.y, tile.z, t);
    }
    if (name === 'openSleep') { if (this.player) this.player.sleeping = true; }
    const fn = (this.ui as unknown as Record<string, (...a: unknown[]) => void>)[name];
    if (typeof fn !== 'function') return;
    this.serverOpening = true;
    try {
      fn.apply(this.ui, args);
    } finally {
      this.serverOpening = false;
    }
  }

  /** Something that happened near us: a sound, particles, getting hurt... */
  private event(e: unknown[]) {
    const p = this.player!;
    switch (e[0]) {
      case 's': {
        const at = e[2] as [number, number, number] | null;
        this.audio.play(e[1] as string, at ? { x: at[0], y: at[1], z: at[2] } : null, e[3] as number, e[4] as number);
        break;
      }
      case 'f': {
        const pt = this.particles as unknown as Record<string, (...a: unknown[]) => void>;
        const fn = pt?.[e[1] as string];
        if (typeof fn === 'function') fn.apply(this.particles, decodeValue(e[2], this.resolve) as unknown[]);
        break;
      }
      case 'hurt': {
        if (this.ticks - this.lastHurt < 2) break;
        this.lastHurt = this.ticks;
        p.hurtTime = p.hurtDuration;
        p.lastHurtDirection = e[1] as number;
        this.audio.play('hurt', null, 1, 1);
        break;
      }
      case 'pickup': {
        const item = this.puppets.get(e[1] as number), by = this.resolve(e[2] as number);
        if (item instanceof ItemEntity && by) this.entityRenderer.pickup(item, by);
        if (by === p) this.ui.hud.pickupAnim(e[3] as number);
        break;
      }
      case 'beam': this.gatewayBeam = { x: e[1] as number, y: e[2] as number, z: e[3] as number, until: this.ticks + (e[4] as number) }; break;
      case 'thunder': this.weather?.strike(e[1] as number); break;
    }
  }

  /** Lost the connection to a remote game. */
  private disconnected(reason: string) {
    const r = reason;
    this.conn = null;
    this.dropWorld();
    this.player = null;
    this.entities = [];
    this.remote = false;
    this.ui.open(new DisconnectedScreen(this.ui, r === 'kicked' ? 'You were kicked from the game' : r === 'quit' ? 'Left the game' : r || 'Connection lost'));
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

  /** Phones aiming by touch: the block or mob under the finger is the target, and there's no crosshair. */
  touchAim() {
    return device.touch && this.options.touchAim === 'touch';
  }

  /** The ray through a point on screen (fractions of its width and height), from the first-person camera. */
  screenRay(sx: number, sy: number) {
    const p = this.player!;
    const f = this.lookVec(p.yaw, p.pitch);
    const y = (p.yaw * Math.PI) / 180;
    const r = { x: -Math.cos(y), y: 0, z: -Math.sin(y) };
    const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
    const t = Math.tan(((this.cam.fov || this.options.fov) * Math.PI) / 360);
    const a = (sx * 2 - 1) * t * (this.renderer.width / this.renderer.height), b = (1 - sy * 2) * t;
    const d = { x: f.x + r.x * a + u.x * b, y: f.y + r.y * a + u.y * b, z: f.z + r.z * a + u.z * b };
    const l = Math.hypot(d.x, d.y, d.z);
    return { x: d.x / l, y: d.y / l, z: d.z / l };
  }

  /** What's under the crosshair (or finger): for the selection box here; the server works it out for itself. */
  updateTarget() {
    const p = this.player!;
    const aim = this.input.aim;
    if (p.spectator || p.dead || (this.touchAim() && !aim)) { this.target = null; this.targetEntity = null; this.targetPart = null; return; }
    const eye = this.eyePos(1);
    const d = this.touchAim() && aim ? this.screenRay(aim.x, aim.y) : this.lookVec(p.yaw, p.pitch);
    const reach = this.reach();
    this.target = raycastBlocks(this.world!, eye.x, eye.y, eye.z, d.x, d.y, d.z, reach);
    let best: Entity | null = null, bestPart: string | null = null;
    let bestT = this.target ? this.target.t : Math.min(reach, 3.5);
    for (const e of this.entities) {
      if (!(e instanceof LivingEntity) || e.dead) { if (!(e instanceof Fireball) && !(e instanceof Boat) && !(e instanceof Minecart)) continue; }
      if (e === (p.riding as unknown as Entity)) continue;
      if (e instanceof Player && e.spectator) continue;
      for (const b of e.hitBoxes()) {
        const g = 0.1;
        const r = rayAABB(eye.x, eye.y, eye.z, d.x, d.y, d.z, { x0: b.x0 - g, y0: b.y0 - g, z0: b.z0 - g, x1: b.x1 + g, y1: b.y1 + g, z1: b.z1 + g }, bestT);
        if (r && r.t < bestT && r.t <= 3.5) { bestT = r.t; best = e; bestPart = b.part ?? null; }
      }
    }
    this.targetEntity = best;
    this.targetPart = bestPart;
    if (best) this.target = null;
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
    const nether = w.dimension === 'nether', end = w.dimension === 'end';
    const rain = nether || end ? 0 : this.weather!.rain;
    const env = nether ? netherEnv(w.renderDistance, this.options.gamma, 1.5 + this.torchFlicker * 0.1, inLava) : end ? endEnv(w.renderDistance, this.options.gamma, 1.5 + this.torchFlicker * 0.1, inLava) : computeEnv({
      time: this.time, renderDistance: w.renderDistance, underwater, inLava, blind: 0, rain, thunder: this.weather!.thunder,
      cameraY: cam.y, gamma: this.options.gamma, clouds: this.options.clouds, skyTemp: biome.cold ? -0.5 : biome.name === 'Desert' ? 2 : 0.8,
      flicker: 1.5 + this.torchFlicker * 0.1, ticks: this.ticks + t,
    });
    const nv = p.effects.get('night_vision');
    env.nightVision = nv ? (nv.dur > 200 ? 1 : 0.7 + Math.sin(((nv.dur - t) * Math.PI) * 0.2) * 0.3) : 0;
    r.beginFrame(env);
    if (end) r.drawEndSky();
    else if (!nether) r.drawSky();
    r.drawChunks(w.chunks.values(), 'opaque');
    this.entityRenderer.render(this, t);
    this.drawSelection();
    const pm = r.dyn;
    pm.reset();
    this.particles!.build(pm, cam.x, cam.y, cam.z, t, yaw, pitch);
    r.drawDyn(pm, { blend: false, cull: false, alphaCut: 0.1 });
    r.drawChunks(w.chunks.values(), 'trans');
    if (!nether && !end) {
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
    // crack overlay (the server reports how far along the mining is)
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
      `Minecraft Web 1.0 (vanilla-like)${this.remote ? ' - multiplayer' : this.server && this.server.players.length > 1 ? ` - hosting ${this.server.players.length - 1}` : ''}`,
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

/** Copy a tile entity's fields into the existing object (arrays element by element), keeping references alive. */
function syncInto(cur: Record<string, unknown>, src: Record<string, unknown>) {
  for (const [k, v] of Object.entries(src)) {
    const c = cur[k];
    if (Array.isArray(c) && Array.isArray(v) && c.length === v.length) {
      for (let i = 0; i < v.length; i++) c[i] = v[i] && typeof v[i] === 'object' ? { ...(v[i] as object) } : v[i];
    } else cur[k] = v;
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

