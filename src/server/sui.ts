// Server-side stand-ins for the things gameplay code reaches for on `game`: the acting player's input, their
// screen (container windows run on the server as "twins" of the client's, fed the same clicks), sounds and
// particles (turned into messages for the players who can see or hear them).
import { UI } from '../ui/ui';
import { Gui } from '../ui/gui';
import type { Screen } from '../ui/screen';
import type { Game } from '../game/game';
import type { ServerPlayer } from './splayer';
import { encodeValue } from '../net/replicate';

/** What a remote player's mouse and keys are doing, as last reported by their client. */
export class VirtualInput {
  /** Playing (pointer locked, no screen open on the client). */
  locked = false;
  mouseDown = new Set<number>();
  private pressed: number[] = [];
  keys = new Set<string>();
  /** Touch aim isn't used server-side: the client sends its look direction instead. */
  aim: { x: number; y: number } | null = null;
  takeMousePressed() {
    const r = this.pressed;
    this.pressed = [];
    return r;
  }
  press(button: number) { this.pressed.push(button); }
  isDown(code: string) { return this.keys.has(code); }
}

let sharedGui: Gui | null = null;

/** Screen openers gameplay code calls, mirrored to the client by name. */
const OPENERS = ['openCrafting', 'openFurnace', 'openChest', 'openEnderChest', 'openHorse', 'openInventory', 'openTrade', 'openEnchant',
  'openHopper', 'openDispenser', 'openBrewing', 'openAnvil', 'openMod', 'openSmithing', 'openStonecutter', 'openGrindstone'] as const;

type Openers = Pick<UI, (typeof OPENERS)[number]>;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export interface ServerUI extends Openers {}

/**
 * A player's UI as seen from the server. Containers opened here become twin screens: the client draws its own
 * copy and sends its clicks, which are replayed on the twin so the real items move here.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class ServerUI {
  /** Screens can tell they're the server's twin (keep their constructor and init light there). */
  readonly isServer = true;
  screen: Screen | null = null;
  gui: Gui;
  /** Set while handling the client's own open/close, so it isn't echoed back. */
  fromClient = false;
  /** Client clock of the click being replayed (double-click detection). */
  clock = 0;
  /** Where the client's pointer was for the event being replayed (hover-based keys: 1-9 swaps, Q drops). */
  mx = 0;
  my = 0;
  opening: [string, unknown[]] | null = null;
  chat = { add: (msg: string) => this.sp.send({ t: 'chat', msg }) };
  hud = {
    actionBar: (msg: string) => this.sp.send({ t: 'bar', msg }),
    pickupAnim: (_id: number) => {},
  };
  touch = { syncKeyboard() {} };
  previewBox = null;

  constructor(private sp: ServerPlayer, public game: Game) {
    this.gui = sharedGui ??= new Gui();
  }

  now() { return this.clock || performance.now(); }
  pausesGame() { return false; }

  open(s: Screen | null) {
    const prev = this.screen;
    this.screen = s;
    if (prev) prev.onClose();
    if (s) s.init();
    if (this.fromClient) return;
    if (s && this.opening) {
      const [m, args] = this.opening;
      this.sp.send({ t: 'open', m, a: args.map((a) => encodeValue(a) ?? null), tile: this.sp.windowTile() });
    } else if (!s && prev) this.sp.send({ t: 'close' });
    this.opening = null;
  }
  close() { this.open(null); }

  /** Sleeping isn't a window: the server tracks it, the client shows the fade. */
  openSleep() {
    const p = this.sp.entity;
    p.sleeping = true;
    this.sp.sleepTicks = 0;
    this.sp.send({ t: 'open', m: 'openSleep', a: [] });
  }
  openDeath(_msg: string) {}
  /** Hoppers and droppers changed a container someone may be looking at. */
  containerChanged(_x: number, _y: number, _z: number) { this.sp.windowDirty = true; }
}

for (const m of OPENERS) {
  const real = (UI.prototype as unknown as Record<string, (...a: unknown[]) => void>)[m];
  (ServerUI.prototype as unknown as Record<string, unknown>)[m] = function (this: ServerUI, ...args: unknown[]) {
    this.opening = [m, args];
    real.apply(this, args);
  };
}

/** UI for gameplay code running outside any one player's action (a dragon dies, a hopper fills): tells everybody. */
export class BroadcastUI {
  screen = null;
  constructor(private game: Game) {}
  chat = { add: (msg: string) => { for (const p of this.game.playersHere()) p.send({ t: 'chat', msg }); } };
  hud = {
    actionBar: (msg: string) => { for (const p of this.game.playersHere()) p.send({ t: 'bar', msg }); },
    pickupAnim: (_id: number) => {},
  };
  containerChanged(_x: number, _y: number, _z: number) { for (const p of this.game.players) p.windowDirty = true; }
  open() {}
  close() {}
}

type Pos = { x: number; y: number; z: number };

/** Sounds: positioned ones go to everyone in earshot; unpositioned ones to the player whose action made them. */
export class ServerAudio {
  constructor(private game: Game) {}
  play(name: string, pos: Pos | null = null, volume = 1, pitch = 1) {
    this.game.emitSound(name, pos ? { x: pos.x, y: pos.y, z: pos.z } : null, volume, pitch);
  }
  init() {}
  setRain() {}
}

/** Particles: every call becomes an effect message for the players near where it happens. */
export function fxSink(game: Game) {
  return new Proxy({}, {
    get: (_t, m: string) => (...args: unknown[]) => game.emitFx(m, args),
  }) as unknown as import('../game/particles').Particles;
}
