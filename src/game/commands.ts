import { nearestSite } from '../world/stronghold';
import type { Dimension } from '../world/world';
import type { Game } from './game';
import { GameMode, Player } from './player';
import { tokenize, select, isSelector, entityName, type Pos } from './selectors';
import type { Entity } from '../entity/entity';
import { ITEMS, itemByName, stack, getItem, I3 } from './items';
import { EFFECTS } from './potiondata';
import { ENCH_BY_ID } from './enchant';
import { MOB_TYPES } from '../entity/registry';
import { blockByName, pack } from '../world/blocks';
import { LivingEntity } from '../entity/living';
import { COMMANDS, ENTITIES } from '../mod/hooks';
import { modState } from '../mod/state';
import { sublevelCommand } from '../sublevel/commands';
import { tm } from '../i18n/i18n';

export class Commands {
  history: string[] = [];
  constructor(private game: Game) {}

  /**
   * Run a command line. `origin` is where ~ coordinates and selector distances count from (a command block, or
   * /execute at); `source` says who runs it: `self` is @s (null for a command block) and `name` signs /say.
   * Without a source, the acting player runs it.
   */
  run(line: string, origin?: Pos, source?: { self: Entity | null; name: string }): string[] {
    const g = this.game, p = g.player!;
    const o = origin ?? p;
    const out: string[] = [];
    const args = tokenize(line.trim().replace(/^\//, ''));
    const cmd = args.shift()?.toLowerCase() ?? '';
    const coord = (s: string, base: number) => (s.startsWith('~') ? base + (parseFloat(s.slice(1)) || 0) : parseFloat(s));
    const self: Entity | null = source ? source.self : p;
    // commands written without a target act on whoever runs them (a command block: the nearest player)
    const me: Entity | null = self ?? (source ? p : null);
    // players by name; mobs by a name each reader sees in their language
    const named = (e: Entity) => (g.playerOf(e) || (e as { customName?: string }).customName ? entityName(g, e) : tm(entityName(g, e)));
    /** Does this word name targets (a selector or a player's name)? */
    const isTarget = (s: string | undefined) => isSelector(s) || (!!s && g.players.some((q) => q.name.toLowerCase() === s.toLowerCase()));
    /** The entities a word picks (or whoever runs the command, when it's missing); players only unless `any`. */
    const who = (s: string | undefined, any = false): Entity[] => {
      const list = s === undefined ? (me ? [me] : []) : select(g, s, o, self);
      const out = any ? list : list.filter((e) => e instanceof Player);
      if (!out.length) throw new Error(any ? 'No entity was found' : 'No player was found');
      return out;
    };
    const many = (l: Entity[], what = 'players') => (l.length === 1 ? named(l[0]) : tm(`{0} ${what}`, l.length));
    try {
      // mod commands (a mod may also take over a vanilla one)
      const mc = COMMANDS.get(cmd);
      if (mc && modState.active.has(mc.mod)) {
        const rest = line.trim().replace(/^\/?\S+\s*/, '');
        const r = mc.def.run({ game: g, player: p, args: args.filter(Boolean), rest, reply: (m) => out.push(m), coord: (s, axis) => coord(s ?? '~', [o.x, o.y, o.z][axis]) });
        if (typeof r === 'string') out.push(r);
        else if (Array.isArray(r)) out.push(...r);
        return out;
      }
      switch (cmd) {
        case 'help':
          out.push('§eAvailable commands:', '/gamemode <survival|creative|adventure|spectator> [targets]', '/time <set|add> <day|night|noon|midnight|value>', '/weather <clear|rain|thunder>', '/tp [targets] <x y z | destination>', '/give [targets] <item> [count]', '/summon <mob> [x y z]', '/kill [targets]', '/difficulty <peaceful|easy|normal|hard>', '/seed', '/spawnpoint [targets] [x y z]', '/setblock <x> <y> <z> <block>', '/clear [targets]', '/xp <add|set> <targets> <amount> [points|levels]', '/gamerule <doDaylightCycle|keepInventory> [true|false]', '/effect <give|clear> <targets> [effect] [seconds] [amplifier]', '/locate stronghold', '/dimension <overworld|nether|end>', '/enchant [targets] <enchantment> [level]', '/heal [targets]', '/say <message>', '/tell <targets> <message>', '/testfor <targets>', '/execute <as|at|positioned|if|unless ...> run <command>', '§7Targets: a player name, @p @a @r @s @e, with [type= name= distance= x= y= z= dx= dy= dz= limit= sort= gamemode= level=]', '/sublevel <assemble|land|list|anchor|push|tp|remove> - moving block structures');
          // mods' commands, once each
          for (const [name, { mod, def }] of COMMANDS) if (modState.active.has(mod) && name === def.name.toLowerCase()) out.push(`${def.usage ?? '/' + def.name}${def.description ? ' §7- ' + def.description : ''}`);
          break;
        case 'sublevel': case 'sl':
          out.push(...sublevelCommand(g, p, args, coord));
          break;
        case 'gamemode':
        case 'gm': {
          const m = ({ survival: 0, s: 0, '0': 0, creative: 1, c: 1, '1': 1, adventure: 2, a: 2, '2': 2, spectator: 3, sp: 3, '3': 3 } as Record<string, number>)[args[0]?.toLowerCase() ?? ''];
          if (m === undefined) throw new Error('Unknown game mode');
          for (const e of who(args[1])) {
            (e as Player).setGameMode(m as GameMode);
            const mode = tm(['Survival', 'Creative', 'Adventure', 'Spectator'][m] + ' Mode');
            out.push(e === self ? tm('Set own game mode to {0}', mode) : tm("Set {0}'s game mode to {1}", named(e), mode));
          }
          break;
        }
        case 'time': {
          const names: Record<string, number> = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000 };
          const v = names[args[1]] ?? parseInt(args[1]);
          if (isNaN(v)) throw new Error('Invalid time');
          if (args[0] === 'set') g.time = Math.floor(g.time / 24000) * 24000 + v;
          else if (args[0] === 'add') g.time += v;
          else if (args[0] === 'query') { out.push(tm('The time is {0}', g.time % 24000)); break; }
          else throw new Error('Usage: /time <set|add> <value>');
          out.push(tm('Set the time to {0}', g.time % 24000));
          break;
        }
        case 'weather': {
          const k = args[0] as 'clear' | 'rain' | 'thunder';
          if (!['clear', 'rain', 'thunder'].includes(k)) throw new Error('Usage: /weather <clear|rain|thunder>');
          g.weather!.setWeather(k, 6000 + Math.floor(Math.random() * 6000));
          out.push(k === 'clear' ? 'Changing to clear weather' : k === 'rain' ? 'Changing to rain' : 'Changing to rain and thunder');
          break;
        }
        case 'tp':
        case 'teleport': {
          // /tp <x y z> | <destination> | <targets> <x y z> | <targets> <destination>
          if (!args.length) throw new Error('Usage: /tp [targets] <x y z | destination>');
          const movers = args.length === 2 || args.length >= 4 ? who(args.shift(), true) : who(undefined, true);
          let x: number, y: number, z: number, to = '';
          if (args.length === 1) {
            const d = who(args[0], true);
            if (d.length !== 1) throw new Error('Only one entity is allowed, but the provided selector allows more than one');
            ({ x, y, z } = d[0]); to = named(d[0]);
          } else {
            x = coord(args[0], o.x); y = coord(args[1], o.y); z = coord(args[2], o.z);
            if ([x, y, z].some(isNaN)) throw new Error('Invalid coordinates');
            to = `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
          }
          for (const e of movers) {
            e.setPos(x, y, z);
            e.vx = e.vy = e.vz = 0;
            (e as { fallDistance?: number }).fallDistance = 0;
          }
          out.push(tm('Teleported {0} to {1}', many(movers, 'entities'), to));
          break;
        }
        case 'give': {
          // /give [targets] <item> [count]
          const to = who(isTarget(args[0]) ? args.shift() : undefined) as Player[];
          const name = (args[0] ?? '').replace('minecraft:', '');
          const def = itemByName(name) ?? [...ITEMS.values()].find((d) => d.display.toLowerCase() === name.replace(/_/g, ' ').toLowerCase());
          if (!def) throw new Error(tm("Unknown item '{0}'", name));
          const n = Math.max(1, Math.min(6400, parseInt(args[1] ?? '1') || 1));
          for (const q of to) {
            let left = n;
            while (left > 0) {
              const k = Math.min(left, def.maxStack);
              const rem = q.inventory.add(stack(def.id, k));
              if (rem > 0) g.dropItem(q.x, q.y + 1, q.z, stack(def.id, rem));
              left -= k;
            }
          }
          out.push(tm('Gave {0} [{1}] to {2}', n, tm(def.display), many(to)));
          g.audio.play('pop', null, 0.2, 2);
          break;
        }
        case 'summon': {
          const type = (args[0] ?? '').replace('minecraft:', '').toLowerCase();
          const modType = ENTITIES.get(type);
          if (!MOB_TYPES[type] && !(modType && modState.active.has(modType.mod))) throw new Error(tm("Unknown entity '{0}'. Try: {1}", type, Object.keys(MOB_TYPES).join(', ')));
          // in front of a player who runs it; where a command block (or /execute positioned) is
          const d = self && !origin ? g.lookVec(self.yaw, 0) : { x: 0, z: 0 };
          const x = args[1] ? coord(args[1], o.x) : o.x + d.x * 2, y = args[2] ? coord(args[2], o.y) : o.y, z = args[3] ? coord(args[3], o.z) : o.z + d.z * 2;
          g.interact!.spawnMob(type, x, y, z);
          out.push(tm('Summoned new {0}', tm(type.split(/[_ ]/).map((w) => w[0].toUpperCase() + w.slice(1)).join(' '))));
          break;
        }
        case 'kill': {
          const list = who(args[0], true);
          for (const e of list) {
            if (e instanceof LivingEntity) e.damage(1000, 'kill');
            else e.removed = true;
          }
          out.push(tm('Killed {0}', many(list, 'entities')));
          break;
        }
        case 'difficulty': {
          const d = ({ peaceful: 0, easy: 1, normal: 2, hard: 3, p: 0, e: 1, n: 2, h: 3, '0': 0, '1': 1, '2': 2, '3': 3 } as Record<string, number>)[args[0]?.toLowerCase() ?? ''];
          if (d === undefined) throw new Error('Unknown difficulty');
          g.options.difficulty = d;
          for (const sp of g.players) sp.entity.difficulty = d;
          out.push(tm('The difficulty has been set to {0}', tm(['Peaceful', 'Easy', 'Normal', 'Hard'][d])));
          break;
        }
        case 'locate': {
          if ((args[0] ?? '').toLowerCase() !== 'stronghold') throw new Error('Usage: /locate stronghold');
          const seed = g.meta?.seed ?? 0;
          const s = nearestSite(seed, p.x, p.z);
          out.push(tm('The nearest stronghold is at [{0}, ~, {1}] ({2} blocks away)', s.x, s.z, Math.round(Math.hypot(s.x - p.x, s.z - p.z))));
          break;
        }
        case 'dimension': case 'dim': {
          const to = (args[0] ?? '').toLowerCase();
          if (to !== 'overworld' && to !== 'nether' && to !== 'end') throw new Error('Usage: /dimension <overworld|nether|end>');
          if (to === g.dimension) { out.push('Already there'); break; }
          if (g.ctx) g.travel(g.ctx, to as Dimension, to === 'overworld');
          out.push(`Travelling to the ${to}`);
          break;
        }
        case 'seed':
          out.push(tm('Seed: [{0}]', String(g.meta?.seed)));
          break;
        case 'spawnpoint': {
          // /spawnpoint [targets] [x y z]
          const list = who(args[0]) as Player[];
          for (const q of list) {
            const at = args.length >= 4 ? [coord(args[1], o.x), coord(args[2], o.y), coord(args[3], o.z)] : [q.x, q.y, q.z];
            q.spawnX = Math.floor(at[0]); q.spawnY = Math.floor(at[1]); q.spawnZ = Math.floor(at[2]);
            out.push(tm("Set {0}'s spawn point to {1}, {2}, {3}", named(q), q.spawnX, q.spawnY, q.spawnZ));
          }
          break;
        }
        case 'setblock': {
          const x = Math.floor(coord(args[0], o.x)), y = Math.floor(coord(args[1], o.y)), z = Math.floor(coord(args[2], o.z));
          const b = blockByName((args[3] ?? '').replace('minecraft:', ''));
          if (!b) throw new Error('Unknown block');
          g.world!.set(x, y, z, pack(b.id, parseInt(args[4] ?? '0') || 0));
          out.push('Changed the block');
          break;
        }
        case 'fill': {
          const [x0, y0, z0, x1, y1, z1] = args.slice(0, 6).map((a, i) => Math.floor(coord(a, [o.x, o.y, o.z][i % 3])));
          const b = blockByName((args[6] ?? '').replace('minecraft:', ''));
          if (!b) throw new Error('Unknown block');
          const vol = (Math.abs(x1 - x0) + 1) * (Math.abs(y1 - y0) + 1) * (Math.abs(z1 - z0) + 1);
          if (vol > 32768) throw new Error('Too many blocks in the specified area');
          for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
            for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
              for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) g.world!.set(x, y, z, b.id);
          out.push(tm('Successfully filled {0} blocks', vol));
          break;
        }
        case 'clear': {
          const list = who(args[0]) as Player[];
          for (const q of list) q.inventory.clear();
          out.push(tm('Cleared the inventory of {0}', many(list)));
          break;
        }
        case 'xp':
        case 'experience': {
          // /xp add|set <targets> <amount> [points|levels], or the older /xp <amount>[L] [targets]
          let mode = 'add', amount: string, levels: boolean, list: Player[];
          if (args[0] === 'add' || args[0] === 'set') { mode = args[0]; list = who(args[1]) as Player[]; amount = args[2] ?? ''; levels = args[3] === 'levels'; }
          else { amount = (args[0] ?? '').replace(/l$/i, ''); levels = /l$/i.test(args[0] ?? ''); list = who(args[1]) as Player[]; }
          const n = parseInt(amount);
          if (isNaN(n)) throw new Error('Usage: /xp <add|set> <targets> <amount> [points|levels]');
          for (const q of list) {
            if (levels) q.xpLevel = Math.max(0, mode === 'set' ? n : q.xpLevel + n);
            else if (mode === 'set') { q.xpLevel = 0; q.xpProgress = 0; q.xpTotal = 0; q.addXp(n); }
            else q.addXp(n);
          }
          out.push(tm(`${mode === 'set' ? 'Set' : 'Gave'} {0} experience ${levels ? 'levels' : 'points'} ${mode === 'set' ? 'on' : 'to'} {1}`, n, many(list)));
          break;
        }
        case 'gamerule': {
          const rules: Record<string, [() => boolean, (v: boolean) => void]> = {
            doDaylightCycle: [() => g.doDaylightCycle, (v) => (g.doDaylightCycle = v)],
            keepInventory: [() => g.keepInventory, (v) => (g.keepInventory = v)],
          };
          const name = Object.keys(rules).find((r) => r.toLowerCase() === (args[0] ?? '').toLowerCase());
          if (!name) throw new Error(args[0] ? tm("Unknown gamerule '{0}'. Try: {1}", args[0], Object.keys(rules).join(', ')) : `Usage: /gamerule <${Object.keys(rules).join('|')}> [true|false]`);
          const [get, set] = rules[name];
          const v = (args[1] ?? '').toLowerCase();
          if (!v) { out.push(tm('Gamerule {0} is currently set to: {1}', name, String(get()))); break; }
          if (v !== 'true' && v !== 'false') throw new Error(tm("Invalid value '{0}': expected true or false", args[1]));
          set(v === 'true');
          // keepInventory tells everyone itself
          if (name !== 'keepInventory') out.push(tm('Gamerule {0} is now set to: {1}', name, String(get())));
          break;
        }
        case 'effect': {
          // /effect give <targets> <effect> [seconds] [amplifier] | /effect clear [targets] [effect]
          // (and the short /effect <effect|clear> [seconds] [amplifier] on whoever runs it)
          let list: LivingEntity[], name: string, rest: string[];
          if (args[0] === 'give') { list = who(args[1], true).filter((e) => e instanceof LivingEntity) as LivingEntity[]; name = args[2] ?? ''; rest = args.slice(3); }
          else if (args[0] === 'clear' && args[1] !== undefined) { list = who(args[1], true).filter((e) => e instanceof LivingEntity) as LivingEntity[]; name = args[2] ? 'clear:' + args[2] : 'clear'; rest = []; }
          else { list = who(undefined, true) as LivingEntity[]; name = args[0] ?? ''; rest = args.slice(1); }
          name = name.replace(/minecraft:/g, '');
          if (!list.length) throw new Error('No entity was found');
          if (name === 'clear') { for (const e of list) e.clearEffects(); out.push(tm('Took all effects from {0}', many(list, 'targets'))); break; }
          if (name.startsWith('clear:')) name = name.slice(6), rest = ['0'];
          if (!EFFECTS[name]) throw new Error(tm('Unknown effect: {0}. Try: {1}', name, Object.keys(EFFECTS).join(', ')));
          const secs = rest[0] ? parseInt(rest[0]) : 30, amp = rest[1] ? parseInt(rest[1]) : 0;
          if (secs <= 0) { for (const e of list) e.removeEffect(name); out.push(tm('Took {0} from {1}', tm('effect:' + EFFECTS[name].name), many(list, 'targets'))); break; }
          for (const e of list) e.addEffect(name, secs * 20, Math.max(0, Math.min(9, amp)));
          out.push(tm('Given {0} (ID {1}) * {2} to {3} for {4} seconds', tm('effect:' + EFFECTS[name].name), EFFECTS[name].icon + 1, amp, many(list, 'targets'), secs));
          break;
        }
        case 'enchant': {
          // /enchant [targets] <enchantment> [level]
          const target = who(isTarget(args[0]) ? args.shift() : undefined)[0] as Player;
          const held = target.inventory.held();
          const e = ENCH_BY_ID.get((args[0] ?? '').replace(/^minecraft:/, ''));
          if (!held) throw new Error(tm('{0} is not holding an item', named(target)));
          if (!e) throw new Error(tm('Unknown enchantment. Try: {0}', [...ENCH_BY_ID.keys()].join(', ')));
          const lvl = Math.max(1, Math.min(e.max, parseInt(args[1] ?? '1') || 1));
          if (!e.applies(held) && held.id !== I3.ENCHANTED_BOOK) throw new Error(tm('{0} cannot be applied to this item', tm('enchantment:' + e.name)));
          held.ench = { ...(held.ench ?? {}), [e.id]: lvl };
          out.push('Enchanting succeeded');
          break;
        }
        case 'heal': {
          const list = who(args[0]) as Player[];
          for (const q of list) { q.health = q.maxHealth; q.food = 20; q.saturation = 20; q.fireTicks = 0; }
          out.push(tm('Healed {0}', many(list)));
          break;
        }
        case 'say': {
          // to everyone, signed by whoever said it ("@" for a command block); selectors become names
          const text = args.map((a) => (isSelector(a) ? select(g, a, o, self).map(named).join(', ') : a)).join(' ');
          g.say(`[${source ? source.name : named(p)}] ${text}`);
          break;
        }
        case 'tell': case 'msg': case 'w': {
          const list = who(args.shift());
          const text = args.map((a) => (isSelector(a) ? select(g, a, o, self).map(named).join(', ') : a)).join(' ');
          const from = source ? source.name : named(p);
          for (const q of list) g.playerOf(q)?.send({ t: 'chat', msg: '§7§o' + tm('{0} whispers to you: {1}', from, text) });
          out.push('§7§o' + tm('You whisper to {0}: {1}', many(list), text));
          break;
        }
        case 'testfor': {
          const list = who(args[0] ?? '@e', true);
          out.push(tm('Found {0}', list.map(named).join(', ')));
          break;
        }
        case 'execute':
          out.push(...this.execute(args, self, o, source ? source.name : named(p)));
          break;
        default:
          throw new Error(`Unknown command. Type "/help" for help.`);
      }
    } catch (e) {
      out.push('§c' + (e as Error).message);
    }
    void getItem;
    return out;
  }

  /**
   * /execute (1.13): as <targets>, at <targets>, positioned <x y z> | positioned as <targets>, if|unless block
   * <x y z> <block>, if|unless entity <targets>, then run <command> (or, ending on a condition, a test).
   */
  private execute(args: string[], self: Entity | null, origin: Pos, srcName: string): string[] {
    const g = this.game, out: string[] = [];
    const coord = (s: string, base: number) => (s.startsWith('~') ? base + (parseFloat(s.slice(1)) || 0) : parseFloat(s));
    let ran = 0, passed = 0;
    const step = (i: number, self: Entity | null, o: Pos): void => {
      const word = args[i];
      if (word === undefined) { passed++; return; }
      switch (word) {
        case 'run': {
          const rest = args.slice(i + 1).join(' ');
          if (!rest) throw new Error('Usage: /execute ... run <command>');
          const sp = self ? g.playerOf(self) : null;
          const src = { self, name: self ? entityName(g, self) : srcName };
          const res = sp ? g.asActor(sp, () => this.run(rest, o, src)) : this.run(rest, o, src);
          ran++;
          out.push(...res);
          return;
        }
        case 'as': for (const e of select(g, args[i + 1] ?? '', o, self)) step(i + 2, e, o); return;
        case 'at': for (const e of select(g, args[i + 1] ?? '', o, self)) step(i + 2, self, { x: e.x, y: e.y, z: e.z }); return;
        case 'positioned':
          if (args[i + 1] === 'as') { for (const e of select(g, args[i + 2] ?? '', o, self)) step(i + 3, self, { x: e.x, y: e.y, z: e.z }); return; }
          {
            const p = { x: coord(args[i + 1] ?? '', o.x), y: coord(args[i + 2] ?? '', o.y), z: coord(args[i + 3] ?? '', o.z) };
            if ([p.x, p.y, p.z].some(isNaN)) throw new Error('Invalid coordinates');
            step(i + 4, self, p);
          }
          return;
        case 'if': case 'unless': {
          const want = word === 'if', what = args[i + 1];
          let ok: boolean, next: number;
          if (what === 'block') {
            const x = Math.floor(coord(args[i + 2] ?? '', o.x)), y = Math.floor(coord(args[i + 3] ?? '', o.y)), z = Math.floor(coord(args[i + 4] ?? '', o.z));
            const b = blockByName((args[i + 5] ?? '').replace('minecraft:', ''));
            if (!b) throw new Error(tm("Unknown block '{0}'", args[i + 5] ?? ''));
            ok = g.world!.getId(x, y, z) === b.id;
            next = i + 6;
          } else if (what === 'entity') { ok = select(g, args[i + 2] ?? '', o, self).length > 0; next = i + 3; }
          else throw new Error(tm("Unknown condition '{0}' (block or entity)", what ?? ''));
          if (ok === want) step(next, self, o);
          return;
        }
        default: throw new Error(tm("Unknown /execute subcommand '{0}'", word));
      }
    };
    step(0, self, origin);
    if (!ran && !passed) throw new Error('Test failed');
    if (!ran) out.push(passed > 1 ? tm('Test passed, count: {0}', passed) : 'Test passed');
    return out;
  }
}
