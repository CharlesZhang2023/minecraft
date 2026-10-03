import { nearestSite } from '../world/stronghold';
import type { Dimension } from '../world/world';
import type { Game } from './game';
import { GameMode } from './player';
import { ITEMS, itemByName, stack, getItem, I3 } from './items';
import { EFFECTS } from './potiondata';
import { ENCH_BY_ID } from './enchant';
import { MOB_TYPES } from '../entity/registry';
import { blockByName, pack } from '../world/blocks';
import { LivingEntity } from '../entity/living';
import { COMMANDS, ENTITIES } from '../mod/hooks';
import { modState } from '../mod/state';

export class Commands {
  history: string[] = [];
  constructor(private game: Game) {}

  run(line: string): string[] {
    const g = this.game, p = g.player!;
    const out: string[] = [];
    const args = line.trim().replace(/^\//, '').split(/\s+/);
    const cmd = args.shift()?.toLowerCase() ?? '';
    const coord = (s: string, base: number) => (s.startsWith('~') ? base + (parseFloat(s.slice(1)) || 0) : parseFloat(s));
    try {
      // mod commands (a mod may also take over a vanilla one)
      const mc = COMMANDS.get(cmd);
      if (mc && modState.active.has(mc.mod)) {
        const rest = line.trim().replace(/^\/?\S+\s*/, '');
        const r = mc.def.run({ game: g, player: p, args: args.filter(Boolean), rest, reply: (m) => out.push(m), coord: (s, axis) => coord(s ?? '~', [p.x, p.y, p.z][axis]) });
        if (typeof r === 'string') out.push(r);
        else if (Array.isArray(r)) out.push(...r);
        return out;
      }
      switch (cmd) {
        case 'help':
          out.push('§eAvailable commands:', '/gamemode <survival|creative|adventure|spectator>', '/time <set|add> <day|night|noon|midnight|value>', '/weather <clear|rain|thunder>', '/tp <x> <y> <z>', '/give <item> [count]', '/summon <mob> [x y z]', '/kill', '/difficulty <peaceful|easy|normal|hard>', '/seed', '/spawnpoint', '/setblock <x> <y> <z> <block>', '/clear', '/xp <amount>', '/gamerule <doDaylightCycle|keepInventory> [true|false]', '/effect <effect|clear> [seconds] [amplifier]', '/locate stronghold', '/dimension <overworld|nether|end>', '/enchant <enchantment> [level]', '/heal');
          // mods' commands, once each
          for (const [name, { mod, def }] of COMMANDS) if (modState.active.has(mod) && name === def.name.toLowerCase()) out.push(`${def.usage ?? '/' + def.name}${def.description ? ' §7- ' + def.description : ''}`);
          break;
        case 'gamemode':
        case 'gm': {
          const m = ({ survival: 0, s: 0, '0': 0, creative: 1, c: 1, '1': 1, adventure: 2, a: 2, '2': 2, spectator: 3, sp: 3, '3': 3 } as Record<string, number>)[args[0]?.toLowerCase() ?? ''];
          if (m === undefined) throw new Error('Unknown game mode');
          p.setGameMode(m as GameMode);
          out.push(`Set own game mode to ${['Survival', 'Creative', 'Adventure', 'Spectator'][m]} Mode`);
          break;
        }
        case 'time': {
          const names: Record<string, number> = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000 };
          const v = names[args[1]] ?? parseInt(args[1]);
          if (isNaN(v)) throw new Error('Invalid time');
          if (args[0] === 'set') g.time = Math.floor(g.time / 24000) * 24000 + v;
          else if (args[0] === 'add') g.time += v;
          else if (args[0] === 'query') { out.push(`The time is ${g.time % 24000}`); break; }
          else throw new Error('Usage: /time <set|add> <value>');
          out.push(`Set the time to ${g.time % 24000}`);
          break;
        }
        case 'weather': {
          const k = args[0] as 'clear' | 'rain' | 'thunder';
          if (!['clear', 'rain', 'thunder'].includes(k)) throw new Error('Usage: /weather <clear|rain|thunder>');
          g.weather!.setWeather(k, 6000 + Math.floor(Math.random() * 6000));
          out.push(`Changing to ${k === 'clear' ? 'clear' : k === 'rain' ? 'rain' : 'rain and thunder'}`);
          break;
        }
        case 'tp':
        case 'teleport': {
          if (args.length < 3) throw new Error('Usage: /tp <x> <y> <z>');
          const x = coord(args[0], p.x), y = coord(args[1], p.y), z = coord(args[2], p.z);
          if ([x, y, z].some(isNaN)) throw new Error('Invalid coordinates');
          p.setPos(x, y, z);
          p.vx = p.vy = p.vz = 0;
          p.fallDistance = 0;
          out.push(`Teleported Player to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
          break;
        }
        case 'give': {
          const name = (args[0] ?? '').replace('minecraft:', '');
          const def = itemByName(name) ?? [...ITEMS.values()].find((d) => d.display.toLowerCase() === name.replace(/_/g, ' ').toLowerCase());
          if (!def) throw new Error(`Unknown item '${name}'`);
          const n = Math.max(1, Math.min(6400, parseInt(args[1] ?? '1') || 1));
          let left = n;
          while (left > 0) {
            const k = Math.min(left, def.maxStack);
            const rem = p.inventory.add(stack(def.id, k));
            if (rem > 0) g.dropItem(p.x, p.y + 1, p.z, stack(def.id, rem));
            left -= k;
          }
          out.push(`Gave ${n} [${def.display}] to Player`);
          g.audio.play('pop', null, 0.2, 2);
          break;
        }
        case 'summon': {
          const type = (args[0] ?? '').replace('minecraft:', '').toLowerCase();
          const modType = ENTITIES.get(type);
          if (!MOB_TYPES[type] && !(modType && modState.active.has(modType.mod))) throw new Error(`Unknown entity '${type}'. Try: ${Object.keys(MOB_TYPES).join(', ')}`);
          const d = g.lookVec(p.yaw, 0);
          const x = args[1] ? coord(args[1], p.x) : p.x + d.x * 2, y = args[2] ? coord(args[2], p.y) : p.y, z = args[3] ? coord(args[3], p.z) : p.z + d.z * 2;
          g.interact!.spawnMob(type, x, y, z);
          out.push(`Summoned new ${type[0].toUpperCase() + type.slice(1)}`);
          break;
        }
        case 'kill':
          if (args[0] === '@e') {
            let n = 0;
            for (const e of g.entities) if (e instanceof LivingEntity) { e.damage(1000, 'kill'); n++; }
            out.push(`Killed ${n} entities`);
          } else {
            p.damage(1000, 'kill');
            out.push('Killed Player');
          }
          break;
        case 'difficulty': {
          const d = ({ peaceful: 0, easy: 1, normal: 2, hard: 3, p: 0, e: 1, n: 2, h: 3, '0': 0, '1': 1, '2': 2, '3': 3 } as Record<string, number>)[args[0]?.toLowerCase() ?? ''];
          if (d === undefined) throw new Error('Unknown difficulty');
          g.options.difficulty = d;
          for (const sp of g.players) sp.entity.difficulty = d;
          out.push(`The difficulty has been set to ${['Peaceful', 'Easy', 'Normal', 'Hard'][d]}`);
          break;
        }
        case 'locate': {
          if ((args[0] ?? '').toLowerCase() !== 'stronghold') throw new Error('Usage: /locate stronghold');
          const seed = g.meta?.seed ?? 0;
          const s = nearestSite(seed, p.x, p.z);
          out.push(`The nearest stronghold is at [${s.x}, ~, ${s.z}] (${Math.round(Math.hypot(s.x - p.x, s.z - p.z))} blocks away)`);
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
          out.push(`Seed: [${g.meta?.seed}]`);
          break;
        case 'spawnpoint':
          p.spawnX = Math.floor(p.x); p.spawnY = Math.floor(p.y); p.spawnZ = Math.floor(p.z);
          out.push(`Set Player's spawn point to ${p.spawnX}, ${p.spawnY}, ${p.spawnZ}`);
          break;
        case 'setblock': {
          const x = Math.floor(coord(args[0], p.x)), y = Math.floor(coord(args[1], p.y)), z = Math.floor(coord(args[2], p.z));
          const b = blockByName((args[3] ?? '').replace('minecraft:', ''));
          if (!b) throw new Error('Unknown block');
          g.world!.set(x, y, z, pack(b.id, parseInt(args[4] ?? '0') || 0));
          out.push('Changed the block');
          break;
        }
        case 'fill': {
          const [x0, y0, z0, x1, y1, z1] = args.slice(0, 6).map((a, i) => Math.floor(coord(a, [p.x, p.y, p.z][i % 3])));
          const b = blockByName((args[6] ?? '').replace('minecraft:', ''));
          if (!b) throw new Error('Unknown block');
          const vol = (Math.abs(x1 - x0) + 1) * (Math.abs(y1 - y0) + 1) * (Math.abs(z1 - z0) + 1);
          if (vol > 32768) throw new Error('Too many blocks in the specified area');
          for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
            for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
              for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) g.world!.set(x, y, z, b.id);
          out.push(`Successfully filled ${vol} blocks`);
          break;
        }
        case 'clear':
          p.inventory.clear();
          out.push('Cleared the inventory of Player');
          break;
        case 'xp':
        case 'experience':
          if (args[0]?.endsWith('L')) p.xpLevel += parseInt(args[0]);
          else p.addXp(parseInt(args[0] ?? '0') || 0);
          out.push(`Gave ${args[0]} experience to Player`);
          break;
        case 'gamerule': {
          const rules: Record<string, [() => boolean, (v: boolean) => void]> = {
            doDaylightCycle: [() => g.doDaylightCycle, (v) => (g.doDaylightCycle = v)],
            keepInventory: [() => g.keepInventory, (v) => (g.keepInventory = v)],
          };
          const name = Object.keys(rules).find((r) => r.toLowerCase() === (args[0] ?? '').toLowerCase());
          if (!name) throw new Error(args[0] ? `Unknown gamerule '${args[0]}'. Try: ${Object.keys(rules).join(', ')}` : `Usage: /gamerule <${Object.keys(rules).join('|')}> [true|false]`);
          const [get, set] = rules[name];
          const v = (args[1] ?? '').toLowerCase();
          if (!v) { out.push(`Gamerule ${name} is currently set to: ${get()}`); break; }
          if (v !== 'true' && v !== 'false') throw new Error(`Invalid value '${args[1]}': expected true or false`);
          set(v === 'true');
          // keepInventory tells everyone itself
          if (name !== 'keepInventory') out.push(`Gamerule ${name} is now set to: ${get()}`);
          break;
        }
        case 'effect': {
          // /effect <effect|clear> [seconds] [amplifier]
          const name = (args[0] ?? '').replace(/^minecraft:/, '');
          if (name === 'clear') { p.clearEffects(); out.push('Took all effects from Player'); break; }
          if (!EFFECTS[name]) throw new Error(`Unknown effect: ${name}. Try: ${Object.keys(EFFECTS).join(', ')}`);
          const secs = args[1] ? parseInt(args[1]) : 30, amp = args[2] ? parseInt(args[2]) : 0;
          if (secs <= 0) { p.removeEffect(name); out.push(`Took ${EFFECTS[name].name} from Player`); break; }
          p.addEffect(name, secs * 20, Math.max(0, Math.min(9, amp)));
          out.push(`Given ${EFFECTS[name].name} (ID ${EFFECTS[name].icon + 1}) * ${amp} to Player for ${secs} seconds`);
          break;
        }
        case 'enchant': {
          // /enchant <enchantment> [level]
          const held = p.inventory.held();
          const e = ENCH_BY_ID.get((args[0] ?? '').replace(/^minecraft:/, ''));
          if (!held) throw new Error('Player is not holding an item');
          if (!e) throw new Error(`Unknown enchantment. Try: ${[...ENCH_BY_ID.keys()].join(', ')}`);
          const lvl = Math.max(1, Math.min(e.max, parseInt(args[1] ?? '1') || 1));
          if (!e.applies(held) && held.id !== I3.ENCHANTED_BOOK) throw new Error(`${e.name} cannot be applied to this item`);
          held.ench = { ...(held.ench ?? {}), [e.id]: lvl };
          out.push('Enchanting succeeded');
          break;
        }
        case 'heal':
          p.health = p.maxHealth; p.food = 20; p.saturation = 20; p.fireTicks = 0;
          out.push('Healed Player');
          break;
        case 'say':
          out.push(`[Player] ${args.join(' ')}`);
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
}
