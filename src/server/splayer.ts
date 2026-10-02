// One connected player, as the simulation sees them: their entity, what their client says they're doing, and
// everything the client has been told (chunks, entities, their own status) so each tick only sends what changed.
import type { Game } from '../game/game';
import type { Conn, Msg } from '../net/conn';
import type { Dimension } from '../world/world';
import { chunkKey } from '../world/world';
import { Player } from '../game/player';
import { Interaction } from '../game/interact';
import { Achievements } from '../game/achievements';
import type { BlockHit } from '../game/raycast';
import type { Entity } from '../entity/entity';
import { B } from '../world/blocks';
import { rleEncode, rleDecode, Storage } from '../game/storage';
import { ContainerScreen } from '../ui/containers';
import { ServerUI, VirtualInput } from './sui';
import { captureState, encodeValue, sig, netType, State } from '../net/replicate';

/** What a client sends every tick. */
export interface InputPacket {
  t: 'in';
  /** position, motion and look (the client moves its own player) */
  x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; pitch: number;
  /** onGround, sneaking, sprinting, flying, jump key held */
  g: boolean; sn: boolean; sp: boolean; fl: boolean; jp: boolean;
  /** movement keys (steering mounts) */
  fw: number; st: number;
  /** jumps since the last packet (hunger) */
  j: number;
  sel: number;
  /** playing: pointer locked and no screen open */
  act: boolean;
  /** mouse buttons held / pressed since the last packet */
  md: number[]; mp: number[];
  /** where the player aims (the crosshair or, on phones, under the finger) */
  dir: [number, number, number] | null;
  /** keys held (Shift, Ctrl) and pressed (Q, F) */
  kd: string[]; kp: string[];
  /** last teleport the client has applied */
  tp: number;
}

const ENTITY_RANGE = 96;

/** A remote-controlled player entity: its client does the walking, the server does everything else. */
export class NetPlayer extends Player {
  sp: ServerPlayer | null = null;
  /** Velocity as the client last reported it (anything else is a push from the server: knockback, explosions). */
  netV = [0, 0, 0];
  /** Look direction as the client last reported it (a boat or horse turning us is sent back as a turn). */
  netYaw = 0;
  /** Turning the server did (mount steering) that the client hasn't been told about yet. */
  turnOut = 0;
  swings = 0;
  /** Moves the world made (pistons shoving us): the client replays them on its own copy. */
  nudge = [0, 0, 0];
  private lastX = 0;
  private lastZ = 0;

  override setPos(x: number, y: number, z: number) {
    super.setPos(x, y, z);
    this.lastX = x;
    this.lastZ = z;
    this.sp?.teleported();
  }

  override swing() {
    super.swing();
    this.swings++;
  }

  /** Our own walking comes from the client; anything calling move() is the world pushing us. */
  override move(dx: number, dy: number, dz: number) {
    this.nudge[0] += dx; this.nudge[1] += dy; this.nudge[2] += dz;
    super.move(dx, dy, dz);
  }

  override tick() {
    this.sp?.tickInput();
    if (this.riding) { super.tick(); return; }
    this.pEyeOffset = this.eyeOffset;
    this.eyeOffset += ((this.sneaking ? 1.54 : 1.62) - this.eyeOffset) * 0.5;
    this.pDistWalked = this.distWalked;
    this.prevHealth = this.health;
    if (this.dead) { this.deathTime++; this.updateSwing(); return; }
    this.armor = this.inventory.armorPoints();
    const dx = this.x - this.lastX, dz = this.z - this.lastZ;
    this.lastX = this.x;
    this.lastZ = this.z;
    this.updateFluidState();
    // limb swing for the model other players see
    this.pLimbSwingAmount = this.limbSwingAmount;
    let d = Math.sqrt(dx * dx + dz * dz) * 4;
    if (d > 1) d = 1;
    this.limbSwingAmount += (d - this.limbSwingAmount) * 0.4;
    this.limbSwing += this.limbSwingAmount;
    this.environment();
    this.tickEffects();
    this.updateSwing();
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerable > 0) this.invulnerable--;
    const hd = Math.sqrt(dx * dx + dz * dz);
    if (this.onGround && !this.flying) this.distWalked += hd * 0.6;
    this.turnBody(dx, dz);
    if (!this.canFly) {
      if (this.inWater) this.exhaust(0.015 * hd);
      else if (this.onGround && this.sprinting) this.exhaust(0.1 * hd);
      this.foodTick();
    }
    if (this.hurtFlash > 0) this.hurtFlash--;
  }
}

export class ServerPlayer {
  entity: NetPlayer;
  input = new VirtualInput();
  interact: Interaction;
  ui: ServerUI;
  achievements: Achievements;
  target: BlockHit | null = null;
  targetEntity: Entity | null = null;
  targetPart: string | null = null;
  dir: [number, number, number] | null = null;
  dim: Dimension = 'overworld';
  viewDistance = 8;
  /** Waiting for the ground under a portal / respawn spot to load. */
  pendingArrival: { x: number; y: number; z: number; toSpawn: boolean; stay?: boolean } | null = null;
  portalTime = 0;
  portalCooldown = 0;
  traveling = false;
  sleepTicks = 0;
  windowDirty = false;
  /** Has the client been told the spawn area is ready? */
  ready = false;
  private inputs: InputPacket[] = [];
  private last: InputPacket | null = null;
  private tpId = 0;
  private forcedSel: number | null = null;
  /** Chunks the client has: 1 = sent as data, 0 = told to generate it from the seed. */
  private sentChunks = new Map<number, 0 | 1>();
  /** Saved chunks being read from disk for this player. */
  private reading = new Set<number>();
  private tracked = new Set<number>();
  private lastSelf = new Map<string, unknown>();
  private lastWin = '';
  private events: unknown[] = [];
  private outBlocks: number[] = [];
  private outTiles: unknown[] = [];

  constructor(public game: Game, public conn: Conn, public name: string, public owner: boolean) {
    this.entity = new NetPlayer(game.world!);
    this.interact = new Interaction(game);
    this.ui = new ServerUI(this, game);
    this.achievements = new Achievements(game);
    this.achievements.onUnlock = (id, title) => {
      this.send({ t: 'ach', id });
      for (const p of game.players) p.send({ t: 'chat', msg: `${this.name} has just earned the achievement §a[${title}]` });
    };
  }

  send(m: Msg) { this.conn.send(m); }

  /** Flood limits per kind of message (tokens refill every second). */
  private budget = new Map<string, { n: number; at: number }>();
  allow(t: string) {
    if (this.owner) return true;
    const per = t === 'in' ? 40 : t === 'ui' ? 60 : t === 'chat' ? 4 : 20;
    const now = performance.now();
    const b = this.budget.get(t) ?? { n: per, at: now };
    b.n = Math.min(per * 2, b.n + ((now - b.at) / 1000) * per);
    b.at = now;
    this.budget.set(t, b);
    if (b.n < 1) return false;
    b.n--;
    return true;
  }
  /** Something to tell the client at the end of this tick (sounds, particles, pickups...). */
  event(e: unknown) { this.events.push(e); }

  /** Where the server moved us (teleports, respawn): the client must follow before its positions count again. */
  teleported() {
    const p = this.entity;
    this.tpId++;
    this.send({ t: 'tp', id: this.tpId, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
  }

  // ------------------------------------------------------------------ incoming
  receive(m: Msg) {
    const g = this.game;
    switch (m.t) {
      case 'in': this.inputs.push(m as unknown as InputPacket); if (this.inputs.length > 40) this.inputs.splice(0, this.inputs.length - 40); break;
      case 'vd': this.viewDistance = Math.max(2, Math.min(g.maxViewDistance, (m.r as number) | 0)); break;
      case 'chat': g.chat(this, String(m.msg ?? '').slice(0, 256)); break;
      case 'ui': g.asActor(this, () => this.uiEvent(m)); break;
      case 'open': g.asActor(this, () => { this.ui.fromClient = true; if (m.m === 'openInventory' && !this.entity.dead) this.ui.openInventory(); this.ui.fromClient = false; }); break;
      case 'close': g.asActor(this, () => { this.ui.fromClient = true; this.ui.open(null); this.ui.fromClient = false; }); break;
      case 'respawn': g.respawn(this); break;
      case 'wake': this.wake(); break;
      case 'need': {
        // the client's own generation didn't match: send the real chunk
        const k = chunkKey(Number(m.cx), Number(m.cz));
        if (this.sentChunks.get(k) === 0) { this.sentChunks.delete(k); this.fullOnly.add(k); this.mismatches++; }
        break;
      }
      case 'dismount': if (this.entity.riding) g.asActor(this, () => this.entity.riding?.dismount()); break;
    }
  }

  /** A click / key in the client's container screen, replayed on our twin of it. */
  private uiEvent(m: Msg) {
    const s = this.ui.screen;
    if (!s) return;
    const box = s instanceof ContainerScreen ? s : null;
    const x = (box?.left ?? 0) + Number(m.x ?? 0), y = (box?.top ?? 0) + Number(m.y ?? 0);
    this.input.keys = new Set((m.kd as string[] | undefined) ?? []);
    this.ui.clock = Number(m.ms ?? 0);
    this.ui.mx = x;
    this.ui.my = y;
    this.game.muteUi = true;
    try {
      switch (m.e) {
        case 'down': s.mouseDown(x, y, Number(m.b ?? 0)); break;
        case 'up': s.mouseUp(x, y, Number(m.b ?? 0)); break;
        case 'move': s.mouseMove(x, y); break;
        case 'wheel': s.wheel(Number(m.d ?? 0)); break;
        case 'key': s.key({ code: String(m.code ?? ''), key: String(m.key ?? ''), ctrlKey: !!m.ctrl, metaKey: !!m.meta, shiftKey: !!m.shift, preventDefault() {} } as unknown as KeyboardEvent); break;
        case 'char': s.char(String(m.ch ?? '').slice(0, 1)); break;
      }
    } finally {
      this.game.muteUi = false;
      this.ui.clock = 0;
    }
    this.windowDirty = true;
  }

  wake() {
    const p = this.entity;
    if (!p.sleeping) return;
    p.sleeping = false;
    this.sleepTicks = 0;
    this.send({ t: 'wake' });
  }

  /** The tile behind the open window (chests, furnaces...), for the client's copy. */
  windowTile() {
    const s = this.ui.screen as unknown as { x?: number; y?: number; z?: number } | null;
    if (!s || typeof s.x !== 'number' || typeof s.y !== 'number' || typeof s.z !== 'number') return null;
    const t = this.game.world?.getTile(s.x, s.y, s.z);
    return t ? { x: s.x, y: s.y, z: s.z, v: encodeValue(t) } : null;
  }

  // ------------------------------------------------------------------ per tick (inside the entity loop, as the actor)
  tickInput() {
    const g = this.game;
    g.asActor(this, () => this.applyInput());
  }

  private applyInput() {
    const g = this.game, p = this.entity;
    const inp = this.inputs.shift() ?? this.last;
    // a backlog means the client is ahead (lag spike): catch up on positions but keep every click
    while (this.inputs.length > 2) {
      const skip = this.inputs.shift()!;
      for (const b of skip.mp) this.input.press(b);
      this.keyPresses(skip.kp);
    }
    if (!inp) return;
    const fresh = inp !== this.last;
    this.last = inp;
    // movement: the client is in charge unless it hasn't caught up with a teleport, or rides something
    if (fresh && inp.tp === this.tpId && !this.pendingArrival && !p.dead) {
      if (p.riding) {
        p.forward = inp.fw; p.strafe = inp.st; p.jumping = inp.jp; p.sneaking = inp.sn;
      } else this.applyMove(inp);
      p.turnOut += p.yaw - p.netYaw;
      p.yaw = p.netYaw = inp.yaw;
      p.pitch = Math.max(-90, Math.min(90, inp.pitch));
    }
    // the hotbar slot is the client's, except right after the server picked one (pick block)
    if (this.forcedSel !== null) { if (inp.sel === this.forcedSel) this.forcedSel = null; }
    else if (inp.sel >= 0 && inp.sel < 9) p.inventory.selected = inp.sel;
    if (fresh && inp.j > 0 && !p.canFly) p.exhaust((p.sprinting ? 0.2 : 0.05) * Math.min(inp.j, 4));
    // mouse and keys
    const v = this.input;
    v.locked = inp.act && !this.ui.screen;
    v.mouseDown = new Set(inp.act ? inp.md : []);
    v.keys = new Set(inp.kd);
    if (fresh) {
      for (const b of inp.mp) v.press(b);
      this.keyPresses(inp.kp);
    }
    this.dir = inp.dir;
    g.portalTick(this);
    if (this.pendingArrival) { g.resolveArrival(this); return; }
    const sel = p.inventory.selected;
    g.updateTarget(this);
    // a phone tap on a mob: use the held item on it if it has a use for it, otherwise hit it
    if (fresh && inp.act && inp.mp.includes(3) && this.targetEntity && !this.interact.interactEntity()) this.interact.attack(this.targetEntity);
    this.interact.tick();
    if (p.inventory.selected !== sel) { this.forcedSel = p.inventory.selected; this.send({ t: 'sel', n: p.inventory.selected }); }
  }

  private keyPresses(kp: string[]) {
    const ctrl = this.input.isDown('ControlLeft') || this.input.isDown('MetaLeft');
    for (const k of kp) {
      if (this.ui.screen || this.entity.dead) continue;
      // 'KeyQ!' is a whole-stack drop (Ctrl+Q, or holding a hotbar slot on a phone)
      if (k === 'KeyQ' || k === 'KeyQ!') this.interact.dropHeld(ctrl || k === 'KeyQ!');
      else if (k === 'KeyF') this.interact.swapOffhand();
    }
  }

  private applyMove(inp: InputPacket) {
    const p = this.entity;
    const fin = (n: number) => Number.isFinite(n);
    if (![inp.x, inp.y, inp.z, inp.vx, inp.vy, inp.vz].every(fin)) return;
    // sanity: a client can't walk faster than an ender pearl flies; anything wilder is snapped back
    const d = Math.hypot(inp.x - p.x, inp.y - p.y, inp.z - p.z);
    if (d > (p.canFly ? 40 : 12)) { p.setPos(p.x, p.y, p.z); return; }
    const oy = p.y;
    p.x = inp.x; p.y = inp.y; p.z = inp.z;
    p.vx = inp.vx; p.vy = inp.vy; p.vz = inp.vz;
    p.netV = [p.vx, p.vy, p.vz];
    p.sneaking = inp.sn;
    p.sprinting = inp.sp && p.food > 6;
    p.flying = inp.fl && p.canFly;
    // falling is tracked here, so fall damage stays the server's call
    const wasOnGround = p.onGround;
    p.onGround = inp.g;
    const dy = p.y - oy;
    const below = this.game.world!.getId(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
    if (p.flying || p.inWater || p.isOnLadder() || below === B.SLIME_BLOCK && p.onGround && !p.sneaking) p.fallDistance = 0;
    else if (!p.onGround && dy < 0) p.fallDistance -= dy;
    if (p.onGround && p.fallDistance > 0) {
      p.onLand(p.fallDistance);
      p.fallDistance = 0;
    }
    void wasOnGround;
  }

  // ------------------------------------------------------------------ outgoing (end of each server tick)
  /** Called by the server for each block changed in this player's dimension this tick. */
  /** A block changed: tell the client if it has that chunk (sent, or generating it: it queues the change). */
  blockChanged(x: number, y: number, z: number, v: number) {
    if (this.sentChunks.has(chunkKey(x >> 4, z >> 4))) this.outBlocks.push(x, y, z, v);
  }
  tileChanged(x: number, y: number, z: number) {
    if (!this.sentChunks.has(chunkKey(x >> 4, z >> 4))) return;
    const t = this.game.dims.get(this.dim)?.world.getTile(x, y, z);
    this.outTiles.push([x, y, z, t ? encodeValue(t) : null]);
  }

  /** Forget everything the client knew about the old dimension. */
  resetView() {
    this.sentChunks.clear();
    this.reading.clear();
    this.tracked.clear();
    this.outBlocks = [];
    this.outTiles = [];
    this.ready = false;
  }

  holdsChunk(k: number) { return this.sentChunks.has(k); }

  flush() {
    if (this.conn.closed) return;
    const g = this.game, dim = g.dims.get(this.dim);
    if (!dim) return;
    this.streamChunks(dim.world);
    const bundle: Record<string, unknown> = { t: 'tick', n: g.ticks };
    if (this.outBlocks.length) { bundle.blocks = this.outBlocks; this.outBlocks = []; }
    if (this.outTiles.length) { bundle.tiles = this.outTiles; this.outTiles = []; }
    const ents = this.entityUpdates(dim);
    if (ents) bundle.ents = ents;
    const self = this.selfState();
    if (self) bundle.self = self;
    const win = this.windowState();
    if (win) bundle.win = win;
    if (this.events.length) { bundle.ev = this.events; this.events = []; }
    if (g.ticks % 20 === 0) bundle.time = g.timeState();
    const pist = dim.pistons.snapshot();
    if (pist.length || dim.pistonsWere) bundle.pist = pist;
    // knockback, explosions, being pushed: velocity the client didn't make
    const p = this.entity;
    const dv = [p.vx - p.netV[0], p.vy - p.netV[1], p.vz - p.netV[2]];
    if (!p.riding && dv.some((v) => Math.abs(v) > 1e-4)) {
      bundle.push = dv.map((v) => Math.round(v * 1e4) / 1e4);
      p.netV = [p.vx, p.vy, p.vz];
    }
    // boats and horses turn their riders
    p.turnOut += p.yaw - p.netYaw;
    p.netYaw = p.yaw;
    if (Math.abs(p.turnOut) > 1e-4) {
      bundle.turn = Math.round(p.turnOut * 1e4) / 1e4;
      p.turnOut = 0;
    }
    if (p.nudge.some((v) => v !== 0)) {
      bundle.nudge = p.nudge.map((v) => Math.round(v * 1e4) / 1e4);
      p.nudge = [0, 0, 0];
    }
    // riding: the mount moves us, the client follows
    if (p.riding) bundle.ride = [p.x, p.y, p.z];
    this.send(bundle as Msg);
  }

  /**
   * Fill the client's view, nearest first. Within the simulation distance (what the server keeps loaded) chunks go
   * as data; farther out, chunks that were ever changed are read from disk and sent, and untouched ones the client
   * generates itself from the seed, which keeps the host's CPU and upload for what's actually being played.
   */
  private streamChunks(w: import('../world/world').World) {
    // one ring past the view distance: a chunk can only be drawn once all its neighbours are there
    const p = this.entity, r = this.viewDistance + 1, near = this.simRadius();
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    for (const k of this.sentChunks.keys()) {
      const cx = Math.floor(k / 0x10000) - 0x8000, cz = (k % 0x10000) - 0x8000;
      const dx = cx - pcx, dz = cz - pcz;
      if (dx * dx + dz * dz > (r + 2) * (r + 2)) {
        this.sentChunks.delete(k);
        this.send({ t: 'unchunk', cx, cz });
      }
    }
    let budget = this.conn.kind === 'local' ? 24 : 6;
    if (this.conn.backlog() > 512 * 1024) return;
    const want: [number, number, number][] = [];
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const d = dx * dx + dz * dz;
        if (d > (r + 0.5) * (r + 0.5)) continue;
        const cx = pcx + dx, cz = pcz + dz, k = chunkKey(cx, cz);
        const st = this.sentChunks.get(k);
        if (st !== undefined) continue;
        want.push([d, cx, cz]);
      }
    want.sort((a, b) => a[0] - b[0]);
    for (const [d, cx, cz] of want) {
      if (budget <= 0) break;
      const k = chunkKey(cx, cz);
      const c = w.getChunk(cx, cz);
      if (c?.ready) {
        // the client generates the terrain itself and applies what players changed (checked against the hash)
        if (c.base && this.mayGenerate(k)) this.sendGen(cx, cz, c.base.hash, Uint16Array.from(c.base.orig.keys()), c.blocks, [...c.tiles.entries()]);
        else if (c.needsBase && this.mayGenerate(k)) continue; // being worked out
        else { this.sendChunk(cx, cz, c); budget--; }
        continue;
      }
      if (d <= (near + 0.5) * (near + 0.5)) continue; // the server is loading it
      const key = cx + ',' + cz;
      if (!w.savedKeys.has(key)) {
        // never changed: exactly what the seed makes
        this.sentChunks.set(k, 0);
        this.send({ t: 'gen', cx, cz });
        continue;
      }
      if (this.reading.has(k) || this.reading.size > 8) continue;
      this.reading.add(k);
      Storage.loadChunk(w.worldId, key).then((saved) => {
        this.reading.delete(k);
        if (!saved || this.conn.closed || this.sentChunks.has(k) || this.game.dims.get(this.dim)?.world !== w) return;
        // it may have loaded meanwhile (then that copy is the current one)
        const live = w.getChunk(cx, cz);
        if (live?.ready) { this.sendChunk(cx, cz, live); return; }
        // saved with its base: just the changes; older saves: the whole chunk
        if (saved.base && this.mayGenerate(k)) this.sendGen(cx, cz, saved.base.h, saved.base.i, rleDecode(saved.blocks, 16 * 16 * 256), (saved.tiles ?? []) as [number, unknown][]);
        else {
          this.sentChunks.set(k, 1);
          this.send({ t: 'chunk', cx, cz, blocks: saved.blocks, biomes: saved.biomes, tiles: encodeValue(saved.tiles ?? []) });
        }
      });
    }
  }

  /** Chunks whose own generation came out wrong on this client get full data from now on. */
  private fullOnly = new Set<number>();
  /** A client whose generator keeps disagreeing (a different engine's maths) just gets full chunks. */
  private mismatches = 0;
  private mayGenerate(k: number) {
    // in the same page (single-player, the host's own view) handing over the data is free; generating isn't
    return this.conn.kind !== 'local' && this.mismatches < 8 && !this.fullOnly.has(k);
  }

  /** "Generate it, check it hashes to h, then apply these changes": the values at the changed indices now. */
  private sendGen(cx: number, cz: number, h: number, idx: Uint16Array, blocks: Uint16Array, tiles: [number, unknown][]) {
    const v = new Uint16Array(idx.length);
    for (let k = 0; k < idx.length; k++) v[k] = blocks[idx[k]];
    this.sentChunks.set(chunkKey(cx, cz), 0);
    this.send({ t: 'gen', cx, cz, h, ci: idx, cv: v, tiles: tiles.length ? encodeValue(tiles) : undefined });
  }

  private sendChunk(cx: number, cz: number, c: import('../world/world').Chunk) {
    this.sentChunks.set(chunkKey(cx, cz), 1);
    this.send({ t: 'chunk', cx, cz, blocks: rleEncode(c.blocks), biomes: c.biomes, tiles: encodeValue([...c.tiles.entries()]) });
  }

  /** How far around this player the server keeps the world loaded and running. */
  simRadius() {
    return Math.min(this.game.simDistance, this.viewDistance);
  }

  private entityUpdates(dim: import('../game/game').Dim) {
    const me = this.entity;
    const spawn: unknown[] = [], delta: unknown[] = [], gone: number[] = [];
    const seen = new Set<number>();
    for (const e of dim.entities) {
      if (e === me || e.removed) continue;
      const dx = e.x - me.x, dz = e.z - me.z;
      if (dx * dx + dz * dz > ENTITY_RANGE * ENTITY_RANGE) continue;
      const type = netType(e);
      if (!type) continue;
      seen.add(e.id);
      if (!this.tracked.has(e.id)) {
        this.tracked.add(e.id);
        spawn.push([e.id, type, dim.states.get(e.id) ?? captureState(e)]);
      } else {
        const d = dim.deltas.get(e.id);
        if (d) delta.push([e.id, d]);
      }
    }
    for (const id of this.tracked) if (!seen.has(id)) { this.tracked.delete(id); gone.push(id); }
    if (!spawn.length && !delta.length && !gone.length) return null;
    return { s: spawn, d: delta, r: gone };
  }

  /** Our own status, field by field, when it changed. */
  private selfState() {
    const p = this.entity, ia = this.interact;
    const fields: Record<string, unknown> = {
      health: p.health, maxHealth: p.maxHealth, food: p.food, saturation: p.saturation, air: p.air,
      xpLevel: p.xpLevel, xpProgress: p.xpProgress, xpTotal: p.xpTotal, gameMode: p.gameMode, dead: p.dead,
      fireTicks: p.fireTicks, absorption: p.absorption, effects: [...p.effects.values()], inventory: p.inventory.toJSON(),
      eatingTicks: p.eatingTicks, sleeping: p.sleeping, swings: p.swings, riding: p.riding ? (p.riding as unknown as Entity).id : 0,
      breaking: ia.breaking ? [ia.breaking.x, ia.breaking.y, ia.breaking.z, ia.breaking.progress] : null,
      bow: ia.usingBow ? ia.bowTicks : 0, portal: this.portalTime, spawn: [p.spawnX, p.spawnY, p.spawnZ], hurtFlash: p.hurtFlash,
    };
    const out: Record<string, unknown> = {};
    let any = false;
    for (const [k, v] of Object.entries(fields)) {
      const e = encodeValue(v), s = sig(e);
      if (this.lastSelf.get(k) === s) continue;
      this.lastSelf.set(k, s);
      out[k] = e;
      any = true;
    }
    return any ? out : null;
  }

  /** The open container's slots and cursor, when they changed. */
  private windowState() {
    const s = this.ui.screen;
    if (!(s instanceof ContainerScreen)) { this.lastWin = ''; return null; }
    if (!this.windowDirty && this.game.ticks % 4 !== 0) return null;
    this.windowDirty = false;
    const w = { slots: s.slots.map((sl) => (sl.infinite ? 0 : sl.get())), cursor: s.cursor, tile: this.windowTile(), extra: s.syncState() };
    const enc = encodeValue(w), j = JSON.stringify(enc);
    if (j === this.lastWin) return null;
    this.lastWin = j;
    return enc;
  }

  /** What's saved for this player between sessions. */
  save() {
    return { ...this.entity.toJSON(), dim: this.dim, achievements: this.achievements.toJSON() };
  }
}

export type { State };
