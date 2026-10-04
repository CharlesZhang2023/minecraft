// The game tab's side of the agent API: answers requests from programs on this computer (through the dev server's
// bridge, tools/agent/bridge.ts) by reading and changing the world this tab runs. Development builds only.
//
// Everything acts on the simulation this tab hosts (single-player, or the host of a shared world) as its owner;
// a tab that joined someone else's world can only look. Block changes are recorded so they can be undone.
import type { Client } from '../client/client';
import type { Game, Dim } from '../game/game';
import type { ServerPlayer } from '../server/splayer';
import type { Player } from '../game/player';
import type { TileEntity } from '../world/world';
import { Events } from '../mod/events';
import { formatBlock } from './blockspec';

export type P3 = [number, number, number];

/** A change to blocks that `undo` can take back. */
interface Step {
  what: string;
  dim: string;
  at: number;
  cells: number[]; // x, y, z, old value, ...
  tiles: Map<number, TileEntity>; // cell index -> tile entity it had
}

export interface LogEvent { seq: number; t: number; type: string; [k: string]: unknown }

export class Agent {
  journal: Step[] = [];
  private journalCells = 0;
  log: LogEvent[] = [];
  private seq = 0;
  private logWaiters: (() => void)[] = [];
  /** Requests being answered: the game is kept running while there are any (hidden tabs get no frames). */
  busy = 0;
  awake = false;
  /** When the last request finished: the game keeps running a little after (its effects go out to players). */
  lastBusy = 0;
  lastFrame = performance.now();
  private frameWaiters: (() => void)[] = [];
  /** Areas the server keeps loaded for us for a while. */
  private loads: { dim: Dim; entry: { x: number; z: number; r: number }; until: number }[] = [];

  constructor(readonly game: Client) {}

  // ------------------------------------------------------------------ who and where
  get server(): Game {
    const s = this.game.server;
    if (!s || !this.game.world || this.game.panorama) {
      if (this.game.world && !this.game.panorama) throw new Error('This tab joined someone else\'s world, so it can only look: connect to the host\'s tab to change things');
      throw new Error('No world is open in this tab (use `open` to open or create one)');
    }
    return s;
  }
  get sp(): ServerPlayer {
    const s = this.server;
    const sp = s.players.find((p) => p.owner) ?? s.players[0];
    if (!sp) throw new Error('The world is still loading');
    return sp;
  }
  get player(): Player { return this.sp.entity; }
  dim(name?: unknown): Dim {
    const want = name ? String(name) : this.sp.dim;
    const d = this.server.dims.get(want as never);
    if (!d) throw new Error(`The ${want} isn't loaded (only dimensions someone is in are)`);
    return d;
  }
  /** Run inside the simulation as the host player (commands, interactions and events expect an actor). */
  act<T>(fn: () => T, dim?: Dim): T {
    const s = this.server, sp = this.sp;
    return s.asActor(sp, () => {
      if (!dim) return fn();
      const prev = s.dim;
      s.dim = dim;
      try { return fn(); } finally { s.dim = prev; }
    });
  }

  /** A position from [x, y, z], {x, y, z} or "x y z" (each may be `~` / `~n`, relative to the player's feet). */
  pos(v: unknown, what = 'position'): P3 {
    if (v === undefined || v === null) throw new Error(`Missing ${what}`);
    let parts: unknown[];
    if (Array.isArray(v)) parts = v;
    else if (typeof v === 'string') parts = v.trim().split(/[\s,]+/);
    else if (typeof v === 'object') { const o = v as Record<string, unknown>; parts = [o.x, o.y, o.z]; }
    else throw new Error(`Bad ${what}: ${JSON.stringify(v)}`);
    if (parts.length !== 3) throw new Error(`Bad ${what} ${JSON.stringify(v)}: needs x, y and z`);
    let base: number[] | null = null;
    const out = parts.map((p, i) => {
      if (typeof p === 'number') return p;
      const s = String(p).trim();
      if (s.startsWith('~')) {
        if (!base) { const e = this.game.server && !this.game.panorama ? this.player : this.game.player; if (!e) throw new Error('No world is open'); base = [e.x, e.y, e.z]; }
        return base[i] + (s.length > 1 ? parseFloat(s.slice(1)) : 0);
      }
      return parseFloat(s);
    });
    if (out.some((n) => !Number.isFinite(n))) throw new Error(`Bad ${what} ${JSON.stringify(v)}`);
    return out as P3;
  }
  /** The block a position falls in. */
  bpos(v: unknown, what?: string): P3 {
    const [x, y, z] = this.pos(v, what);
    return [Math.floor(x), Math.floor(y), Math.floor(z)];
  }
  /** Two corners as min and max. */
  box(a: unknown, b: unknown): [P3, P3] {
    const p = this.bpos(a, 'from'), q = this.bpos(b ?? a, 'to');
    return [[Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2])], [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])]];
  }

  // ------------------------------------------------------------------ time passing
  /** Called by the game for every frame it draws (and by us when the tab gets none). */
  frameDone() {
    this.lastFrame = performance.now();
    const w = this.frameWaiters;
    this.frameWaiters = [];
    for (const f of w) f();
  }
  nextFrame(): Promise<void> {
    return new Promise((r) => this.frameWaiters.push(r));
  }
  /** Wait (frame by frame) until `ok()` is true; false if `ms` runs out first. */
  async until(ok: () => boolean, ms: number): Promise<boolean> {
    const end = performance.now() + ms;
    while (!ok()) {
      if (performance.now() > end) return false;
      await this.nextFrame();
    }
    return true;
  }
  /**
   * The timer (a worker's, which browsers don't slow down in background tabs) calls this: a tab nobody looks at
   * gets no animation frames, so while we're working the game is stepped from here instead.
   */
  pump() {
    const now = performance.now();
    if (this.busy) this.lastBusy = now;
    const wanted = this.busy > 0 || this.awake || now - this.lastBusy < 3000 || this.frameWaiters.length > 0;
    if (wanted && now - this.lastFrame > 100) {
      try { this.game.frame(now); } catch (e) { console.error('agent pump', e); }
      this.frameDone();
    }
    // a paused game doesn't load chunks; areas we asked for must load anyway
    const s = this.game.server;
    if (s?.paused && this.loads.length && wanted) {
      for (const dim of new Set(this.loads.map((l) => l.dim))) {
        const w = dim.world;
        const here = s.players.filter((p) => p.dim === w.dimension);
        s.inDim(dim, () => w.updateCenters([...here.map((p) => ({ x: p.entity.x, z: p.entity.z, r: p.simRadius() })), ...dim.keepLoaded]));
      }
    }
    // let go of areas loaded a while ago
    for (let i = this.loads.length - 1; i >= 0; i--) {
      const l = this.loads[i];
      if (now < l.until) continue;
      const k = l.dim.keepLoaded.indexOf(l.entry);
      if (k >= 0) l.dim.keepLoaded.splice(k, 1);
      this.loads.splice(i, 1);
    }
  }

  /** Make sure the server has every chunk of a rectangle loaded (waiting for them), and keeps them a while. */
  async load(dim: Dim, x0: number, z0: number, x1: number, z1: number) {
    const w = dim.world;
    const cx0 = x0 >> 4, cz0 = z0 >> 4, cx1 = x1 >> 4, cz1 = z1 >> 4;
    const count = (cx1 - cx0 + 1) * (cz1 - cz0 + 1);
    if (count > 1600) throw new Error(`That area is ${count} chunks; do it in parts of at most 640 x 640 blocks`);
    const missing = () => {
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) if (!w.getChunk(cx, cz)?.ready) return true;
      return false;
    };
    const keep = 45000;
    // already asked for this area? just keep it longer
    const old = this.loads.find((l) => l.dim === dim && l.entry.r * 16 >= Math.max(x1 - x0, z1 - z0) / 2 + 16 && Math.abs(l.entry.x - (x0 + x1) / 2) < 8 && Math.abs(l.entry.z - (z0 + z1) / 2) < 8);
    if (old) old.until = performance.now() + keep;
    if (!missing()) return;
    if (!old) {
      const entry = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2 / 16) + 1 };
      dim.keepLoaded.push(entry);
      this.loads.push({ dim, entry, until: performance.now() + keep });
    }
    if (!(await this.until(() => !missing(), 60000))) throw new Error('The area didn\'t finish loading in a minute');
  }

  // ------------------------------------------------------------------ undo
  record(what: string, dim: Dim, cells: number[], tiles: Map<number, TileEntity>) {
    if (!cells.length) return;
    this.journal.push({ what, dim: dim.world.dimension, at: Date.now(), cells, tiles });
    this.journalCells += cells.length / 4;
    // keep the journal to a few million blocks
    while (this.journalCells > 4_000_000 && this.journal.length > 1) this.journalCells -= this.journal.shift()!.cells.length / 4;
  }
  popStep(): Step | undefined {
    const s = this.journal.pop();
    if (s) this.journalCells -= s.cells.length / 4;
    return s;
  }

  // ------------------------------------------------------------------ what happened
  emit(type: string, data: Record<string, unknown>) {
    const ev: LogEvent = { seq: ++this.seq, t: this.game.server?.ticks ?? this.game.ticks, type, ...data };
    this.log.push(ev);
    if (this.log.length > 3000) this.log.splice(0, this.log.length - 2000);
    const w = this.logWaiters;
    this.logWaiters = [];
    for (const f of w) f();
  }
  get cursor() { return this.seq; }
  waitLog(ms: number): Promise<void> {
    return new Promise((r) => {
      const t = setTimeout(r, ms);
      this.logWaiters.push(() => { clearTimeout(t); r(); });
    });
  }

  /** Listen to the game for the log. */
  listen() {
    const g = this.game;
    const chat = g.ui.chat;
    const add = chat.add.bind(chat);
    chat.add = (text: string) => {
      add(text);
      this.emit('chat', { text: String(text).replace(/§./g, '') });
    };
    const P = (p: Player) => this.game.server?.playerOf(p)?.name ?? 'player';
    const at = (c: { x: number; y: number; z: number }) => [c.x, c.y, c.z];
    Events.blockPlaced.register((c) => this.emit('place', { player: P(c.player), pos: at(c), block: formatBlock(c.v) }));
    Events.blockBroken.register((c) => this.emit('break', { player: P(c.player), pos: at(c), block: formatBlock(c.v) }));
    Events.entityDeath.register((c) => {
      const e = c.entity as unknown as { typeName?: string; x: number; y: number; z: number; id: number };
      const sp = this.game.server?.playerOf(c.entity);
      this.emit('death', { id: e.id, entity: sp ? 'player' : (e.typeName ?? 'entity').toLowerCase().replace(/ /g, '_'), ...(sp ? { name: sp.name } : {}), pos: [Math.round(e.x), Math.round(e.y), Math.round(e.z)], source: c.source });
    });
    Events.playerJoin.register((_g, p) => this.emit('join', { player: P(p) }));
    Events.playerLeave.register((_g, p) => this.emit('leave', { player: P(p) }));
  }
}
