// Computers: a block with a tile entity (its files, screen and program live in the tile, saved with the chunk),
// a terminal screen, mod network channels for typing and saving, redstone outputs and inputs on each side,
// per-world data (the computer list) and a command, a synthesised beep, and a client setting (screen colour).
import type { ModContext, BlockCtx, Player, Game, Channel, BlockRef } from '../sdk';
import { newTile, boot, exec, step, print, SIDES, MAX_FILES, MAX_FILE, MAX_DISK, validName, type ComputerTile, type Machine, type Side } from './shell';
import { terminalScreen } from './terminal';

/** Horizontal facing (0 N, 1 E, 2 S, 3 W) -> vanilla 6-way direction (0 down, 1 up, 2 N, 3 S, 4 W, 5 E). */
const H2F6 = [2, 5, 3, 4];
/** A side of the computer (as the computer sees it: its front is the screen) as a world direction. */
export function sideDir(meta: number, s: Side): number {
  const f = meta & 3;
  switch (s) {
    case 'front': return H2F6[f];
    case 'back': return H2F6[(f + 2) & 3];
    case 'right': return H2F6[(f + 1) & 3];
    case 'left': return H2F6[(f + 3) & 3];
    case 'top': return 1;
    default: return 0;
  }
}

interface Registry { next: number; list: Record<string, { x: number; y: number; z: number; dim: string; label: string }> }

export function main(mod: ModContext) {
  const world = mod.worldData<Registry>(() => ({ next: 1, list: {} }));
  const run = mod.channel<{ x: number; y: number; z: number; cmd?: string; stop?: boolean }>('run');
  const save = mod.channel<{ x: number; y: number; z: number; file: string; text: string }>('save');
  const edit = mod.channel<{ x: number; y: number; z: number; file: string; text: string }>('edit');
  /** Tiles already seen this session (a saved program's sleep clock restarts with the server's). */
  const seen = new WeakSet<object>();
  const shown = new WeakMap<object, number>();

  const machine = (c: BlockCtx, t: ComputerTile, player: Player | null): Machine => ({
    input: (s) => c.powerFrom(sideDir(c.meta, s)),
    output: (s, v) => {
      const i = SIDES.indexOf(s);
      if (t.out[i] === v) return;
      t.out[i] = v;
      t.rev++;
      c.updateRedstone();
    },
    time: () => c.game.ticks,
    clock: () => c.game.time,
    beep: () => c.game.audio.play('computer:beep', { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 }, 0.6, 1),
    edit: (file, text) => { if (player) edit.toPlayer(player, { x: c.x, y: c.y, z: c.z, file, text }); },
    setLabel: (label) => {
      t.label = label;
      t.rev++;
      const e = world().list[t.id];
      if (e) e.label = label;
    },
  });

  const computer = mod.block('computer', 'Computer', { hardness: 3.5, tool: 'pickaxe', sound: 'metal', side: 'computer:computer_side', top: 'computer:computer_top', front: 'computer:computer_front' }, {
    redstone: {
      // what a program set on the side facing that way
      power: (c, dir) => {
        const t = c.tile<ComputerTile>();
        if (!t) return 0;
        const i = SIDES.findIndex((s) => sideDir(c.meta, s) === dir);
        return i >= 0 ? t.out[i] : 0;
      },
    },
    tile: {
      create: () => newTile(0),
      tick: (c, t: ComputerTile) => {
        if (!seen.has(t)) { seen.add(t); if (t.prog) t.prog.wake = 0; }
        if (t.prog) step(t, machine(c, t, null));
        // send the screen to players nearby when it changed (at most once a tick)
        if (shown.get(t) !== t.rev) { shown.set(t, t.rev); c.tileChanged(); }
      },
      contents: () => [],
    },
    onPlaced: (c) => {
      const t = c.tile<ComputerTile>();
      if (!t) return;
      const reg = world();
      t.id = reg.next++;
      reg.list[t.id] = { x: c.x, y: c.y, z: c.z, dim: c.world.dimension, label: '' };
      boot(t);
    },
    onBreak: (c) => {
      // the block is gone; its id leaves the list (its files go with it, as in ComputerCraft without a disk)
      const reg = world();
      for (const [id, e] of Object.entries(reg.list)) if (e.x === c.x && e.y === c.y && e.z === c.z && e.dim === c.world.dimension) delete reg.list[id];
    },
    onUse: (c) => {
      c.openScreen('computer:terminal', c.x, c.y, c.z);
      return true;
    },
  });

  // ---- what players' terminals send (the server checks it: it came over the network)
  const at = (game: Game, player: Player, d: { x: number; y: number; z: number }) => {
    if (![d?.x, d?.y, d?.z].every(Number.isInteger)) return null;
    if ((player.x - d.x - 0.5) ** 2 + (player.y - d.y) ** 2 + (player.z - d.z - 0.5) ** 2 > 10 * 10) return null;
    if ((game.world!.get(d.x, d.y, d.z) & 0xfff) !== computer.id) return null;
    const t = game.world!.getTile(d.x, d.y, d.z) as unknown as ComputerTile | undefined;
    if (!t) return null;
    return { t, c: mod.mc.blockCtx(game, d.x, d.y, d.z) };
  };

  run.onServer((d, player, game) => {
    const hit = at(game, player, d);
    if (!hit) return;
    if (d.stop) { if (hit.t.prog) { print(hit.t, `Stopped ${hit.t.prog.file}`); hit.t.prog = null; } return; }
    if (typeof d.cmd !== 'string') return;
    exec(hit.t, machine(hit.c, hit.t, player), d.cmd.slice(0, 200));
  });
  save.onServer((d, player, game) => {
    const hit = at(game, player, d);
    if (!hit || typeof d.text !== 'string' || !validName(String(d.file))) return;
    const t = hit.t, text = d.text.slice(0, MAX_FILE);
    const used = Object.entries(t.fs).reduce((n, [k, v]) => n + (k === d.file ? 0 : k.length + v.length), 0);
    if (!(d.file in t.fs) && Object.keys(t.fs).length >= MAX_FILES) { print(t, 'Disk full: too many files'); return; }
    if (used + d.file.length + text.length > MAX_DISK) { print(t, 'Disk full'); return; }
    t.fs[d.file] = text;
    print(t, `Saved ${d.file} (${text.length} bytes)`);
  });

  mod.recipes.shaped(['SSS', 'SRS', 'SGS'], { S: 'stone', R: 'redstone', G: 'glass_pane' }, computer);

  mod.commands.register({
    name: 'computers',
    usage: '/computers',
    description: 'list the computers in this world',
    permission: 'all',
    run({ game }) {
      const reg = mod.worldData<Registry>(() => ({ next: 1, list: {} }))();
      const list = Object.entries(reg.list);
      if (!list.length) return 'No computers yet';
      void game;
      return [`§e${list.length} computer(s):`, ...list.map(([id, e]) => `#${id}${e.label ? ' "' + e.label + '"' : ''} at ${e.x}, ${e.y}, ${e.z} (${e.dim})`)];
    },
  });

  mod.on('tooltip', ({ stack, lines }) => {
    if (stack.id === computer.id) lines.splice(1, 0, '§7Right-click to use; type help');
  });

  // the client entrypoint (same module, runs right after) builds the terminal on these
  shared = { run, save, edit, computer };
}

export type Shared = { run: Channel<{ x: number; y: number; z: number; cmd?: string; stop?: boolean }>; save: Channel<{ x: number; y: number; z: number; file: string; text: string }>; edit: Channel<{ x: number; y: number; z: number; file: string; text: string }>; computer: BlockRef };
let shared: Shared | null = null;

export function client(mod: ModContext) {
  const { pixels: px } = mod.mc;

  const cfg = mod.config({
    theme: { type: 'enum', default: 'green', options: ['green', 'amber', 'white', 'blue'], labels: ['Green', 'Amber', 'White', 'Blue'], label: 'Screen', description: 'Text colour of computer screens' },
    scanlines: { type: 'boolean', default: true, label: 'Scanlines', description: 'Faint CRT lines over the screen' },
  });
  const ch = shared!;
  const Terminal = terminalScreen(mod, ch, cfg);
  mod.client.screen('terminal', (ui, x, y, z) => new Terminal(ui, Number(x), Number(y), Number(z)));
  ch.edit.onClient((d, client) => {
    const s = client.ui.screen as unknown as { openEditor?(file: string, text: string, x: number, y: number, z: number): void } | null;
    s?.openEditor?.(String(d.file), String(d.text), d.x, d.y, d.z);
  });

  // a short square-wave beep
  mod.client.sound('computer:beep', () => {
    const { tone, env, normalize } = mod.mc.synth;
    return normalize(env(tone(mod.mc.SAMPLE_RATE * 0.18, 880, 880, 'square'), 0.002, 0.16, 1), 0.35);
  });

  // textures: light grey casing, a dark screen with a prompt
  const C = { o: px.hex('#4a4a4a'), c: px.hex('#c6c6c6'), C: px.hex('#d8d8d8'), d: px.hex('#9a9a9a'), s: px.hex('#101410'), g: px.hex('#4cff4c'), G: px.hex('#1f7a1f') };
  const casing = (r: { int(n: number): number }) => {
    const img = px.newImg();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const rim = x === 0 || y === 0 || x === 15 || y === 15;
        px.set(img, x, y, rim ? C.d : r.int(9) === 0 ? C.C : C.c);
      }
    return img;
  };
  mod.client.texture('computer:computer_side', (r) => {
    const img = casing(r);
    for (let y = 11; y < 14; y++) for (let x = 3; x < 13; x += 2) px.set(img, x, y, C.d); // vents
    return img;
  });
  mod.client.texture('computer:computer_top', (r) => casing(r));
  mod.client.texture('computer:computer_front', (r) => {
    const img = casing(r);
    for (let y = 2; y < 11; y++) for (let x = 2; x < 14; x++) px.set(img, x, y, C.s);
    px.set(img, 3, 3, C.g); px.set(img, 4, 4, C.g); px.set(img, 3, 5, C.g); // >
    for (let x = 6; x < 9; x++) px.set(img, x, 5, C.G); // _
    px.set(img, 12, 13, C.g); // power light
    for (let x = 3; x < 9; x++) px.set(img, x, 13, C.d); // drive slot
    return img;
  });
}
