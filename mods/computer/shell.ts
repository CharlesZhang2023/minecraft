// The computer's shell and script interpreter. Runs on the server (the host), so guests' programs run in the
// host's world; it's a tiny language of its own (no access to anything but the computer), safe to run for anyone.
//
// Commands: help, ls, cat, edit, rm, mv, cp, echo, clear, label, id, time, redstone, beep, run (or a file's name),
// stop, reboot. Scripts are command lines plus: repeat N / while COND / if COND / else / end, sleep SECONDS,
// wait COND, where COND is `input SIDE`, `not input SIDE`, `true`, `false`.

export const COLS = 40, ROWS = 13;
export const SIDES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export type Side = (typeof SIDES)[number];

export interface Program { file: string; code: string[]; pc: number; stack: { kind: 'repeat' | 'while' | 'if'; pc: number; left?: number }[]; wake: number }
export interface ComputerTile {
  type?: string;
  id: number;
  label: string;
  lines: string[];
  fs: Record<string, string>;
  /** Redstone output per side (front, back, left, right, top, bottom). */
  out: number[];
  prog: Program | null;
  rev: number;
}

export interface Machine {
  /** Redstone power coming in on a side. */
  input(side: Side): number;
  /** Set a side's output (0-15). */
  output(side: Side, level: number): void;
  /** Ticks since the server started (sleep). */
  time(): number;
  /** The world's time of day and day count (the time command). */
  clock(): number;
  beep(): void;
  /** Open the editor on the player's screen. */
  edit(file: string, text: string): void;
  setLabel(label: string): void;
}

export const MAX_FILES = 32, MAX_FILE = 8192, MAX_DISK = 32768;
export const validName = (s: string) => /^[A-Za-z0-9_.-]{1,24}$/.test(s);

export function newTile(id: number): ComputerTile {
  return { id, label: '', lines: [], fs: { 'blink': BLINK, 'readme.txt': README }, out: [0, 0, 0, 0, 0, 0], prog: null, rev: 0 };
}

const README = 'Try: help, ls, edit blink, blink\nSides: front back left right top bottom';
const BLINK = '# blink the back output 5 times\nrepeat 5\n  redstone back on\n  sleep 0.5\n  redstone back off\n  sleep 0.5\nend\necho done!';

export function print(t: ComputerTile, text: string) {
  for (const raw of String(text).split('\n')) {
    let s = raw.replace(/\t/g, '  ');
    do {
      t.lines.push(s.slice(0, COLS));
      s = s.slice(COLS);
    } while (s.length);
  }
  if (t.lines.length > ROWS - 1) t.lines.splice(0, t.lines.length - (ROWS - 1));
  t.rev++;
}

export function boot(t: ComputerTile) {
  t.lines = [];
  t.prog = null;
  print(t, `MineOS 1.0 - Computer #${t.id}${t.label ? ' "' + t.label + '"' : ''}`);
  print(t, 'Type help for commands.');
}

const sideOf = (s: string | undefined): Side | null => (SIDES as readonly string[]).includes(s ?? '') ? (s as Side) : null;
const diskUse = (t: ComputerTile) => Object.entries(t.fs).reduce((n, [k, v]) => n + k.length + v.length, 0);

function cond(m: Machine, args: string[]): boolean {
  let neg = false;
  if (args[0] === 'not') { neg = true; args = args.slice(1); }
  let v: boolean;
  if (args[0] === 'true') v = true;
  else if (args[0] === 'false') v = false;
  else if (args[0] === 'input') {
    const s = sideOf(args[1]);
    if (!s) throw new Error('input needs a side');
    v = m.input(s) > 0;
  } else throw new Error(`Unknown condition '${args.join(' ')}'`);
  return v !== neg;
}

/** Run one command line typed at the prompt (scripts go through `step`). */
export function exec(t: ComputerTile, m: Machine, line: string) {
  line = line.trim();
  print(t, '> ' + line);
  if (!line) return;
  try {
    command(t, m, line, null);
  } catch (e) {
    print(t, 'Error: ' + (e as Error).message);
  }
}

/** A command; inside a script, `prog` is the running program (sleep / wait need it). */
function command(t: ComputerTile, m: Machine, line: string, prog: Program | null): void {
  const args = line.split(/\s+/);
  const cmd = args.shift()!.toLowerCase();
  const rest = line.slice(line.indexOf(cmd) + cmd.length).trim();
  switch (cmd) {
    case 'help':
      print(t, 'ls cat edit rm mv cp echo clear label id');
      print(t, 'time redstone beep run stop reboot');
      print(t, 'scripts: repeat/while/if..else..end,');
      print(t, '  sleep S, wait input SIDE');
      return;
    case 'ls': {
      const names = Object.keys(t.fs).sort();
      print(t, names.length ? names.join('  ') : '(no files)');
      print(t, `${diskUse(t)} / ${MAX_DISK} bytes used`);
      return;
    }
    case 'cat': {
      if (!args[0] || !(args[0] in t.fs)) throw new Error(`No such file: ${args[0] ?? ''}`);
      print(t, t.fs[args[0]]);
      return;
    }
    case 'edit': {
      if (prog) throw new Error('edit only works at the prompt');
      if (!args[0] || !validName(args[0])) throw new Error('Usage: edit NAME (letters, digits . _ -)');
      m.edit(args[0], t.fs[args[0]] ?? '');
      return;
    }
    case 'rm':
      if (!args[0] || !(args[0] in t.fs)) throw new Error(`No such file: ${args[0] ?? ''}`);
      delete t.fs[args[0]];
      t.rev++;
      return;
    case 'mv': case 'cp': {
      const [a, b] = args;
      if (!a || !(a in t.fs)) throw new Error(`No such file: ${a ?? ''}`);
      if (!b || !validName(b)) throw new Error(`Bad name: ${b ?? ''}`);
      if (!(b in t.fs) && Object.keys(t.fs).length >= MAX_FILES) throw new Error('Too many files');
      t.fs[b] = t.fs[a];
      if (cmd === 'mv') delete t.fs[a];
      t.rev++;
      return;
    }
    case 'echo': case 'print':
      print(t, rest);
      return;
    case 'clear':
      t.lines = [];
      t.rev++;
      return;
    case 'label':
      if (args.length) { m.setLabel(rest.slice(0, 20)); print(t, `Label set to "${t.label}"`); }
      else print(t, t.label ? `Label: ${t.label}` : 'No label');
      return;
    case 'id':
      print(t, `This is computer #${t.id}`);
      return;
    case 'time': {
      const tt = (m.clock() + 6000) % 24000;
      print(t, `${String(Math.floor(tt / 1000)).padStart(2, '0')}:${String(Math.floor((tt % 1000) * 0.06)).padStart(2, '0')} (day ${Math.floor(m.clock() / 24000) + 1})`);
      return;
    }
    case 'beep':
      m.beep();
      return;
    case 'redstone': case 'rs': {
      if (!args.length) {
        print(t, 'side    in  out');
        SIDES.forEach((s, i) => print(t, `${s.padEnd(7)} ${String(m.input(s)).padStart(2)}  ${String(t.out[i]).padStart(3)}`));
        return;
      }
      const s = sideOf(args[0]);
      if (!s) throw new Error('Usage: redstone SIDE on|off|0-15');
      const v = args[1] === 'on' ? 15 : args[1] === 'off' ? 0 : parseInt(args[1] ?? '');
      if (!Number.isFinite(v) || v < 0 || v > 15) throw new Error('Level: on, off or 0-15');
      m.output(s, v);
      return;
    }
    case 'sleep': {
      const s = parseFloat(args[0] ?? '');
      if (!prog) throw new Error('sleep only works in scripts');
      if (!(s >= 0)) throw new Error('Usage: sleep SECONDS');
      prog.wake = m.time() + Math.max(1, Math.round(s * 20));
      return;
    }
    case 'stop':
      if (t.prog) { print(t, `Stopped ${t.prog.file}`); t.prog = null; }
      return;
    case 'reboot':
      boot(t);
      return;
    case 'run':
      return start(t, args[0] ?? '');
    default:
      if (cmd in t.fs) return start(t, cmd);
      throw new Error(`Unknown command '${cmd}' (try help)`);
  }
}

function start(t: ComputerTile, file: string) {
  if (!(file in t.fs)) throw new Error(`No such file: ${file}`);
  if (t.prog) throw new Error(`Already running ${t.prog.file} (stop it first)`);
  t.prog = { file, code: t.fs[file].split('\n'), pc: 0, stack: [], wake: 0 };
  t.rev++;
}

/** Index of the `else` / `end` closing the block that starts after line `from` (`stopAtElse` for if). */
function matching(code: string[], from: number, stopAtElse: boolean): number {
  let depth = 0;
  for (let i = from + 1; i < code.length; i++) {
    const w = code[i].trim().split(/\s+/)[0].toLowerCase();
    if (w === 'repeat' || w === 'while' || w === 'if') depth++;
    else if (w === 'end') { if (depth === 0) return i; depth--; }
    else if (w === 'else' && depth === 0 && stopAtElse) return i;
  }
  throw new Error(`line ${from + 1}: no matching end`);
}

/** Run a running program for up to `budget` lines (stops early at sleep / wait). */
export function step(t: ComputerTile, m: Machine, budget = 64) {
  const p = t.prog;
  if (!p || m.time() < p.wake) return;
  try {
    for (let n = 0; n < budget && t.prog === p; n++) {
      if (p.pc >= p.code.length) { t.prog = null; t.rev++; return; }
      const line = p.code[p.pc].trim();
      const args = line.split(/\s+/);
      const w = args.shift()!.toLowerCase();
      if (!line || line.startsWith('#')) { p.pc++; continue; }
      switch (w) {
        case 'repeat': {
          const k = parseInt(args[0] ?? '');
          if (!(k >= 0)) throw new Error(`line ${p.pc + 1}: repeat needs a count`);
          if (k === 0) { p.pc = matching(p.code, p.pc, false) + 1; break; }
          p.stack.push({ kind: 'repeat', pc: p.pc, left: k });
          p.pc++;
          break;
        }
        case 'while':
          if (cond(m, args)) { p.stack.push({ kind: 'while', pc: p.pc }); p.pc++; }
          else p.pc = matching(p.code, p.pc, false) + 1;
          break;
        case 'if':
          if (cond(m, args)) { p.stack.push({ kind: 'if', pc: p.pc }); p.pc++; }
          else {
            const j = matching(p.code, p.pc, true);
            const isElse = p.code[j].trim().toLowerCase().startsWith('else');
            if (isElse) p.stack.push({ kind: 'if', pc: p.pc });
            p.pc = j + 1;
          }
          break;
        case 'else':
          // reached the end of a taken if-branch: skip the else part
          p.stack.pop();
          p.pc = matching(p.code, p.pc, false) + 1;
          break;
        case 'end': {
          const f = p.stack[p.stack.length - 1];
          if (!f) throw new Error(`line ${p.pc + 1}: end without a block`);
          if (f.kind === 'repeat' && --f.left! > 0) p.pc = f.pc + 1;
          else if (f.kind === 'while') { p.stack.pop(); p.pc = f.pc; }
          else { p.stack.pop(); p.pc++; }
          break;
        }
        case 'wait':
          if (!cond(m, args)) { p.wake = m.time() + 2; return; }
          p.pc++;
          break;
        default:
          p.pc++;
          command(t, m, line, p);
          if (m.time() < p.wake) return;
      }
      // a loop with nothing to wait on: carry on next tick
      if (n === budget - 1) return;
    }
  } catch (e) {
    print(t, `${p.file}: ${(e as Error).message}`);
    t.prog = null;
  }
}
