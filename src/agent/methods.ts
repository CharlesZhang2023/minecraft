// The agent API's methods (described in spec.ts): each takes the request's parameters and returns plain JSON.
import { BLOCKS, B, idOf, metaOf, pack, blockByName } from '../world/blocks';
import { ITEMS, I, itemByName, getItem, stack, type ItemStack } from '../game/items';
import { BIOMES } from '../world/biomes';
import { MOB_TYPES } from '../entity/registry';
import { ENTITIES } from '../mod/hooks';
import { modState } from '../mod/state';
import { Storage, type WorldMeta } from '../game/storage';
import { playWorld } from '../ui/menus';
import { LivingEntity } from '../entity/living';
import { Mob, Monster, Animal } from '../entity/mobs';
import { ItemEntity } from '../entity/item';
import { Player } from '../game/player';
import type { Entity } from '../entity/entity';
import type { Game } from '../game/game';
import { Agent, type P3 } from './agent';
import { Shots, lookAngles } from './shots';
import { formatBlock, parseBlock } from './blockspec';
import { findPath } from '../entity/path';
import * as W from './world';
import { METHODS, POS_HELP } from './spec';
import { english } from '../i18n/i18n';

type Params = Record<string, unknown>;
type Method = (p: Params) => unknown;

const r2 = (n: number) => Math.round(n * 100) / 100;
const FACES: Record<string, number> = { west: 0, east: 1, down: 2, up: 3, north: 4, south: 5 };
const COMPASS = ['south', 'west', 'north', 'east'];

export function itemSpec(s: string): ItemStack {
  const m = /^\s*([^\s*]+?)\s*(?:[x*\s]\s*(\d+))?\s*$/.exec(s);
  if (!m) throw new Error(`Bad item '${s}' (e.g. "torch 64")`);
  const name = m[1].toLowerCase().replace(/^minecraft:/, '');
  const def = itemByName(name) ?? [...ITEMS.values()].find((d) => d.display.toLowerCase() === name.replace(/_/g, ' '));
  if (!def || def.missing) throw new Error(`Unknown item '${m[1]}'`);
  return stack(def.id, Math.max(1, Math.min(def.maxStack, parseInt(m[2] ?? '1'))));
}
const stackInfo = (s: ItemStack | null) => (s ? { item: getItem(s.id).name, count: s.count, ...(s.damage ? { damage: s.damage } : {}), ...(s.ench ? { ench: s.ench } : {}), ...(s.name ? { name: s.name } : {}) } : null);

/** An entity's type as a name: zombie, player, item, boat, overseer:unit... */
export function kindOf(e: Entity): string {
  if (e instanceof Player) return 'player';
  if (e instanceof ItemEntity) return 'item';
  const tn = (e as unknown as { typeName?: string }).typeName;
  if (tn) return tn.toLowerCase().replace(/ /g, '_');
  return e.constructor.name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

export function makeMethods(a: Agent): Record<string, Method> {
  const shots = new Shots(a);
  const api = () => Object.fromEntries(Object.keys(m).filter((k) => !k.startsWith('__')).map((k) => [k, (q: Params = {}) => Promise.resolve(m[k](q))]));
  W.setItemNamer((id) => getItem(id).name);
  /** Tasks: code run every few ticks inside the simulation. */
  const tasks = new Map<string, { fn: (n: number, state: Record<string, unknown>) => unknown; every: number; runs: number; times: number; state: Record<string, unknown>; error?: string; next: number }>();
  /** What code from programs (eval, tasks) can use by name. */
  const scopeFor = (printed: string[]): Params => {
    const g = a.game, s = g.server && !g.panorama ? g.server : null;
    const print = (...xs: unknown[]) => { printed.push(xs.map((x) => (typeof x === 'string' ? x : JSON.stringify(safe(x)))).join(' ')); };
    return {
      game: g, server: s, sp: s ? a.sp : null, player: s ? a.player : g.player, world: s ? a.dim().world : g.world, dim: s ? a.dim() : null,
      mc: { BLOCKS, ITEMS, B, I, blockByName, itemByName, getItem, pack, idOf, metaOf, stack, MOB_TYPES }, api: api(), print, block: parseBlock, name: formatBlock,
      sim: <T>(fn: (g: Game, pl: Player) => T) => a.act(() => fn(a.server, a.player)),
    };
  };

  const entityInfo = (e: Entity, from?: P3) => {
    const o: Record<string, unknown> = { id: e.id, type: kindOf(e), pos: [r2(e.x), r2(e.y), r2(e.z)] };
    if (from) o.dist = r2(Math.hypot(e.x - from[0], e.y - from[1], e.z - from[2]));
    const sp = a.game.server?.playerOf(e);
    if (sp) o.name = sp.name;
    if (e instanceof LivingEntity) { o.health = r2(e.health); o.maxHealth = e.maxHealth; if (e.dead) o.dead = true; }
    if (e instanceof ItemEntity) o.item = stackInfo((e as unknown as { item: ItemStack }).item);
    if (e instanceof Mob) {
      if (e.baby) o.baby = true;
      if (e.noAi) o.noAi = true;
      if (e.target) o.target = e.target.id;
    }
    // mods' entities: their own simple fields (an Overseer unit's kind, owner, task...)
    if (String(o.type).includes(':')) for (const [k, v] of Object.entries(e)) if (!(k in o) && (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) && !/^(p[xyz]|v[xyz]|prev|last|tick|age|hurt|death|swing|limb|body|head|walk|anim|fall|fire|air|cool|delay|timer)/i.test(k) && !/Timer|Time$|Ticks?$|^p?yaw|pitch$/i.test(k)) o[k] = v;
    return o;
  };
  const findEntity = (id: unknown): [Entity, string] => {
    const n = Number(id);
    for (const [d, dim] of a.server.dims) { const e = dim.entities.find((x) => x.id === n); if (e) return [e, d]; }
    throw new Error(`No entity ${id}`);
  };
  const playerInfo = () => {
    const sp = a.sp, p = sp.entity;
    const look = a.game.target;
    const tgtE = a.game.targetEntity;
    return {
      name: sp.name, dimension: sp.dim, pos: [r2(p.x), r2(p.y), r2(p.z)], block: [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)],
      yaw: r2(((p.yaw % 360) + 360) % 360), pitch: r2(p.pitch), facing: COMPASS[Math.floor((((p.yaw % 360) + 360) % 360) / 90 + 0.5) & 3],
      health: r2(p.health), food: p.food, xpLevel: p.xpLevel, gameMode: ['survival', 'creative', 'adventure', 'spectator'][p.gameMode], flying: p.flying,
      held: stackInfo(p.inventory.held()), selected: p.inventory.selected,
      effects: [...p.effects.entries()].map(([k, v]) => ({ effect: k, seconds: Math.round(((v as { dur: number }).dur ?? 0) / 20) })),
      lookingAt: tgtE ? { entity: tgtE.id, type: kindOf(tgtE) } : look ? { pos: [look.x, look.y, look.z], block: formatBlock(a.game.world!.get(look.x, look.y, look.z)), face: Object.keys(FACES).find((k) => FACES[k] === look.face) } : null,
    };
  };

  const m: Record<string, Method> = {
    // ---------------------------------------------------------------- session
    status: () => {
      const g = a.game, s = g.server;
      const base = {
        session: { host: !!s, visible: document.visibilityState === 'visible', focused: document.hasFocus(), screen: g.ui.screen ? g.ui.screen.constructor.name : null },
        mods: [...modState.active],
      };
      if (!g.world || !g.player || g.panorama) return { ...base, world: null, note: 'No world open: use `open` (or `worlds` to list saved ones)' };
      if (!s) return { ...base, world: { dimension: g.world.dimension, time: g.time % 24000 }, note: 'This tab joined someone else\'s world: it can look but not change things' };
      const meta = s.meta!;
      const w = s.weather;
      return {
        ...base,
        world: {
          name: meta.name, id: meta.id, seed: meta.seed, mode: ['survival', 'creative'][meta.gameMode] ?? meta.gameMode, dimension: a.sp.dim,
          time: s.time % 24000, day: Math.floor(s.time / 24000), daytime: s.isDaytime(), weather: w.thunder > 0.5 ? 'thunder' : w.rain > 0.2 ? 'rain' : 'clear',
          paused: s.paused, ticks: s.ticks, difficulty: ['peaceful', 'easy', 'normal', 'hard'][s.options.difficulty] ?? s.options.difficulty,
        },
        player: playerInfo(),
        players: s.players.map((sp) => ({ name: sp.name, owner: sp.owner, dimension: sp.dim, pos: [r2(sp.entity.x), r2(sp.entity.y), r2(sp.entity.z)] })),
        undoSteps: a.journal.length, tasks: [...tasks.keys()], markers: [...shots.markers.keys()],
      };
    },
    help: (p) => {
      if (p.method) { const s = METHODS[String(p.method)]; if (!s) throw new Error(`No method '${p.method}'`); return { method: p.method, ...s, positions: POS_HELP }; }
      return { positions: POS_HELP, methods: Object.fromEntries(Object.entries(METHODS).map(([k, s]) => [k, s.summary])) };
    },
    worlds: async () => (await Storage.listWorlds()).sort((x, y) => y.lastPlayed - x.lastPlayed).map((w) => ({ id: w.id, name: w.name, seed: w.seed, mode: ['survival', 'creative'][w.gameMode] ?? w.gameMode, lastPlayed: new Date(w.lastPlayed).toISOString() })),
    open: async (p) => {
      const g = a.game;
      let meta: WorldMeta;
      if (p.new) {
        const o = p.new as Params;
        const seedText = o.seed === undefined ? String(Math.floor(Math.random() * 2 ** 31)) : String(o.seed);
        const seed = /^-?\d+$/.test(seedText) ? parseInt(seedText) : [...seedText].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0);
        const mode = o.mode === undefined ? 1 : typeof o.mode === 'number' ? o.mode : ({ survival: 0, creative: 1 } as Record<string, number>)[String(o.mode)] ?? 1;
        meta = { id: 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), name: String(o.name ?? 'Agent World'), seed, seedText, gameMode: mode, hardcore: false, created: Date.now(), lastPlayed: Date.now(), time: Number(o.time ?? 1000) };
      } else {
        const want = String(p.world ?? '');
        const all = await Storage.listWorlds();
        const found = all.find((w) => w.id === want) ?? all.find((w) => w.name === want) ?? all.find((w) => w.name.toLowerCase().includes(want.toLowerCase()) && want);
        if (!found) throw new Error(`No saved world '${want}'. Saved: ${all.map((w) => `${w.name} (${w.id})`).join(', ') || 'none'}`);
        meta = found;
      }
      if (g.world && !g.panorama) g.saveWorld();
      await g.closeWorld(true);
      void playWorld(g.ui, meta);
      // a tab of the agent's own opens it again after a reload (the dev server reloads tabs when code changes)
      try { sessionStorage.setItem('mc-agent-world', meta.id); } catch { /* fine */ }
      const ok = await a.until(() => !!g.world && !!g.player && g.arrived && !g.ui.screen && g.loadProgress() > 0.99, 90000);
      if (!ok) throw new Error('The world didn\'t finish loading in 90 s' + (g.ui.screen ? ` (a ${g.ui.screen.constructor.name} is open)` : ''));
      // saved straight away, so it's listed (and can be opened again) from now on
      g.saveWorld();
      return { id: meta.id, name: meta.name, seed: meta.seed };
    },
    save: () => { a.server; a.game.saveWorld(); return { saved: true }; },
    resume: async () => {
      const g = a.game;
      if (g.ui.screen) g.ui.close();
      await a.nextFrame();
      return { paused: !!g.server?.paused, screen: g.ui.screen ? g.ui.screen.constructor.name : null };
    },
    awake: (p) => { a.awake = !!p.on; return { awake: a.awake }; },
    catalog: (p) => {
      const f = String(p.filter ?? '').toLowerCase();
      const kind = String(p.kind ?? 'blocks');
      let names: string[];
      if (kind === 'blocks') names = BLOCKS.filter((b) => b && !b.missing && b.name !== 'unused_1').map((b) => b.name);
      else if (kind === 'items') names = [...ITEMS.values()].filter((d) => !d.missing).map((d) => d.name);
      else if (kind === 'entities') names = [...Object.keys(MOB_TYPES), 'item', 'boat', 'minecart', ...[...ENTITIES.keys()].filter((k) => modState.active.has(ENTITIES.get(k)!.mod))];
      else if (kind === 'biomes') names = BIOMES.map((b) => b.name);
      else throw new Error('kind: blocks | items | entities | biomes');
      return [...new Set(names)].filter((n) => n.toLowerCase().includes(f));
    },

    // ---------------------------------------------------------------- chat
    command: (p) => {
      const run = (c: string) => {
        const line = String(c).trim();
        if (!line) return [];
        return a.act(() => a.server.commands.run(line.startsWith('/') ? line : '/' + line)).map((l) => english(l).replace(/§./g, ''));
      };
      if (Array.isArray(p.cmds)) return { output: (p.cmds as unknown[]).map((c) => run(String(c))) };
      if (p.cmd === undefined) throw new Error('Which command? (`cmd`)');
      return { output: run(String(p.cmd)) };
    },
    chat: (p) => {
      const msg = String(p.msg ?? '').slice(0, 500);
      if (!msg) throw new Error('Say what? (`msg`)');
      const name = String(p.as ?? 'Claude').slice(0, 24);
      const text = `§d<${name}>§r ${msg}`;
      if (a.game.server) a.game.server.say(text);
      else a.game.ui.chat.add(text);
      return { said: msg };
    },
    log: async (p) => {
      const since = Number(p.since ?? 0);
      const types = Array.isArray(p.types) ? new Set((p.types as unknown[]).map(String)) : null;
      const limit = Math.max(1, Math.min(1000, Number(p.limit ?? 100)));
      const pick = () => a.log.filter((e) => e.seq > since && (!types || types.has(e.type)));
      let ev = pick();
      const wait = Math.min(300, Number(p.wait ?? 0));
      const end = performance.now() + wait * 1000;
      while (!ev.length && wait > 0 && performance.now() < end) {
        await a.waitLog(end - performance.now());
        ev = pick();
      }
      return { cursor: a.cursor, events: ev.slice(-limit) };
    },

    // ---------------------------------------------------------------- blocks
    block: (p) => W.block(a, p),
    set: (p) => W.set(a, p),
    fill: (p) => W.fill(a, p),
    build: (p) => W.build(a, p),
    shape: (p) => W.shape(a, p),
    clone: (p) => W.clone(a, p),
    read: (p) => W.read(a, p),
    undo: (p) => W.undo(a, p),
    history: () => W.history(a),
    map: (p) => W.map(a, p),
    slice: (p) => W.slice(a, p),
    find: (p) => W.find(a, p),
    surface: (p) => W.surface(a, p),
    shot: (p) => shots.shot(p),
    mark: (p) => shots.mark(p),
    unmark: (p) => shots.unmark(p),

    // ---------------------------------------------------------------- entities
    entities: (p) => {
      const dim = a.dim(p.dim);
      const c = p.center !== undefined ? a.pos(p.center, 'center') : a.pos('~ ~ ~');
      const r = Number(p.radius ?? 32), type = p.type ? String(p.type).toLowerCase() : null;
      const limit = Math.max(1, Math.min(500, Number(p.limit ?? 50)));
      const out = dim.entities
        .filter((e) => !e.removed && Math.hypot(e.x - c[0], e.y - c[1], e.z - c[2]) <= r && (!type || kindOf(e) === type || (type === 'hostile' && e instanceof Monster) || (type === 'animal' && e instanceof Animal)))
        .map((e) => entityInfo(e, c))
        .sort((x, y) => (x.dist as number) - (y.dist as number));
      return { count: out.length, entities: out.slice(0, limit) };
    },
    entity: (p) => {
      const [e, d] = findEntity(p.id);
      if (p.set && typeof p.set === 'object') {
        for (const [k, v] of Object.entries(p.set as Params)) {
          if (k === 'pos') { const q = a.pos(v); e.setPos(q[0], q[1], q[2]); e.vx = e.vy = e.vz = 0; }
          else if (k === 'health' && e instanceof LivingEntity) e.health = Math.max(0, Math.min(e.maxHealth, Number(v)));
          else if (k === 'item' && e instanceof ItemEntity) (e as unknown as { item: ItemStack }).item = itemSpec(String(v));
          else if (k in e && typeof (e as unknown as Params)[k] !== 'function' && typeof (e as unknown as Params)[k] !== 'object') (e as unknown as Params)[k] = v;
          else if (k in e && v !== null && typeof v === 'object' && typeof (e as unknown as Params)[k] === 'object') (e as unknown as Params)[k] = v;
          else throw new Error(`${kindOf(e)} has no field '${k}' that can be set`);
        }
      }
      const info = entityInfo(e) as Params;
      info.dimension = d;
      // the rest of its simple fields
      for (const [k, v] of Object.entries(e)) if (!(k in info) && (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) info[k] = typeof v === 'number' ? r2(v) : v;
      return info;
    },
    spawn: (p) => {
      const type = String(p.type ?? '').toLowerCase().replace(/^minecraft:/, '');
      const known = MOB_TYPES[type] || ['item', 'boat', 'minecart'].includes(type) || (ENTITIES.has(type) && modState.active.has(ENTITIES.get(type)!.mod));
      if (!known) throw new Error(`Unknown entity '${type}'. Try: ${[...Object.keys(MOB_TYPES), 'item', 'boat', 'minecart'].join(', ')}`);
      const dim = a.dim(p.dim);
      const pl = a.player;
      let at: P3;
      if (p.pos !== undefined) at = a.pos(p.pos);
      else { const d = a.server.lookVec(pl.yaw, 0); at = [pl.x + d.x * 3, pl.y, pl.z + d.z * 3]; }
      const n = Math.max(1, Math.min(100, Math.floor(Number(p.count ?? 1))));
      const data = (p.data ?? {}) as Params;
      const ids: number[] = [];
      a.act(() => {
        for (let i = 0; i < n; i++) {
          const jitter = n > 1 ? [(Math.random() - 0.5) * Math.min(4, n / 3), 0, (Math.random() - 0.5) * Math.min(4, n / 3)] : [0, 0, 0];
          const e = dim.interact.spawnMob(type, at[0] + jitter[0], at[1], at[2] + jitter[2]);
          if (!e) throw new Error(`Couldn't make a ${type}`);
          for (const [k, v] of Object.entries(data)) {
            if (k === 'item' && e instanceof ItemEntity) (e as unknown as { item: ItemStack }).item = itemSpec(`${v} ${data.count ?? 1}`);
            else if (k === 'count' && e instanceof ItemEntity) continue;
            else (e as unknown as Params)[k] = v;
          }
          ids.push(e.id);
        }
      }, dim);
      return { ids, pos: at.map(r2) };
    },
    kill: (p) => {
      const dim = a.dim(p.dim);
      const ids = new Set<number>([...(Array.isArray(p.ids) ? (p.ids as unknown[]).map(Number) : []), ...(p.id !== undefined ? [Number(p.id)] : [])]);
      let removed = 0;
      const c = p.center !== undefined ? a.pos(p.center, 'center') : a.pos('~ ~ ~');
      const r = Number(p.radius ?? 32);
      const type = p.type ? String(p.type).toLowerCase() : null;
      if (!ids.size && !type) throw new Error('Give `id`, `ids` or `type`');
      for (const e of dim.entities) {
        if (e instanceof Player) continue;
        const hit = ids.has(e.id) || (type && Math.hypot(e.x - c[0], e.y - c[1], e.z - c[2]) <= r && (type === 'all' || kindOf(e) === type || (type === 'hostile' && e instanceof Monster) || (type === 'animal' && e instanceof Animal)));
        if (hit) { e.removed = true; removed++; }
      }
      return { removed };
    },

    // ---------------------------------------------------------------- the player
    player: () => {
      const p = a.player;
      return { ...playerInfo(), xp: p.xpTotal, saturation: r2(p.saturation), air: p.air, spawn: a.server.meta?.spawn ?? null, inventory: p.inventory.main.map((s, i) => (s ? { slot: i, ...stackInfo(s) } : null)).filter(Boolean), armor: p.inventory.armor.map(stackInfo) };
    },
    tp: (p) => {
      const at = a.pos(p.pos);
      if (p.dim && String(p.dim) !== a.sp.dim) throw new Error('To change dimension use the command `/dimension <name>` first');
      const pl = a.player;
      if (p.lookAt !== undefined) { const eye: P3 = [at[0], at[1] + pl.eyeHeight(), at[2]]; [pl.yaw, pl.pitch] = lookAngles(eye, a.pos(p.lookAt)); }
      else { if (p.yaw !== undefined) pl.yaw = Number(p.yaw); if (p.pitch !== undefined) pl.pitch = Number(p.pitch); }
      a.act(() => { pl.setPos(at[0], at[1], at[2]); pl.vx = pl.vy = pl.vz = 0; pl.fallDistance = 0; });
      return { pos: at.map(r2), yaw: r2(pl.yaw), pitch: r2(pl.pitch) };
    },
    face: async (p) => {
      const pl = a.player;
      if (p.at !== undefined) [pl.yaw, pl.pitch] = lookAngles([pl.x, pl.y + pl.eyeHeight(), pl.z], a.pos(p.at, 'at'));
      else { if (p.yaw !== undefined) pl.yaw = Number(p.yaw); if (p.pitch !== undefined) pl.pitch = Number(p.pitch); }
      a.sp.teleported();
      await a.nextFrame(); await a.nextFrame();
      return { yaw: r2(pl.yaw), pitch: r2(pl.pitch), lookingAt: playerInfo().lookingAt };
    },
    inventory: (p) => {
      const inv = a.player.inventory;
      if (p.clear) inv.main.fill(null);
      if (p.set && typeof p.set === 'object') for (const [k, v] of Object.entries(p.set as Params)) {
        const i = parseInt(k);
        if (!(i >= 0 && i < 36)) throw new Error(`Slot ${k}: 0-8 hotbar, 9-35 storage`);
        inv.main[i] = v === null || v === '' ? null : itemSpec(String(v));
      }
      if (p.select !== undefined) a.sp.select(Math.max(0, Math.min(8, Math.floor(Number(p.select)))));
      return { selected: inv.selected, slots: inv.main.map((s, i) => (s ? { slot: i, ...stackInfo(s) } : null)).filter(Boolean), armor: inv.armor.map(stackInfo) };
    },
    walk: async (p) => {
      const g = a.game, pl = g.player, w = g.world;
      if (!pl || !w || g.panorama) throw new Error('No world is open');
      if (a.server.paused) throw new Error('The game is paused (a menu is open): use `resume` first');
      const to = a.bpos(p.to, 'to');
      const start: P3 = [Math.floor(pl.x), Math.floor(pl.y + 0.01), Math.floor(pl.z)];
      const path = findPath(w, start[0], start[1], start[2], to[0], to[1], to[2], 2, 6000, 3);
      if (!path || !path.length) throw new Error('No way there that a player can walk (try `tp`)');
      const last = path[path.length - 1];
      const reaches = last.x === to[0] && last.z === to[2] && Math.abs(last.y - to[1]) <= 1;
      let i = 0, done = false, stuck = 0, best = Infinity;
      const sprint = !!p.sprint;
      g.steer = () => {
        if (i >= path.length) { done = true; return { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false }; }
        const n = path[i];
        const dx = n.x + 0.5 - pl.x, dz = n.z + 0.5 - pl.z, d = Math.hypot(dx, dz);
        if (d < 0.3 && Math.abs(n.y - pl.y) < 1.2) { i++; best = Infinity; stuck = 0; }
        if (d < best - 0.05) { best = d; stuck = 0; } else if (++stuck > 60) done = true;
        const yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
        // turn smoothly toward the next step (the shortest way round)
        let dy = ((yaw - pl.yaw) % 360 + 540) % 360 - 180;
        dy = Math.max(-35, Math.min(35, dy));
        pl.yaw += dy;
        pl.pitch *= 0.8;
        return { forward: Math.abs(dy) > 60 ? 0.3 : 1, strafe: 0, jump: (n.y > pl.y + 0.5 && d < 1.6) || (pl.collidedH && pl.onGround), sneak: false, sprint };
      };
      const limit = Math.max(2, Math.min(300, Number(p.timeout ?? 20 + path.length * 0.6)));
      try {
        await a.until(() => done || !g.steer, limit * 1000);
      } finally {
        g.steer = null;
      }
      const at: P3 = [r2(pl.x), r2(pl.y), r2(pl.z)];
      const arrived = i >= path.length && reaches;
      return { arrived, pos: at, steps: path.length, ...(arrived ? {} : { note: !reaches ? 'The path only gets close (the target is blocked or too far to search)' : i < path.length ? 'Got stuck on the way' : '' }) };
    },
    container: (p) => {
      const [x, y, z] = a.bpos(p.pos);
      const w = a.dim(p.dim).world;
      const t = w.getTile(x, y, z) as unknown as Record<string, unknown> | undefined;
      const list = (t?.items ?? t?.slots) as (ItemStack | null)[] | undefined;
      if (!t || !Array.isArray(list)) throw new Error(`No container at ${x} ${y} ${z} (${formatBlock(w.get(x, y, z))})`);
      if (p.clear) list.fill(null);
      if (p.set && typeof p.set === 'object') for (const [k, v] of Object.entries(p.set as Params)) {
        const i = parseInt(k);
        if (!(i >= 0 && i < list.length)) throw new Error(`Slot ${k}: this one has slots 0-${list.length - 1}`);
        list[i] = v === null || v === '' ? null : itemSpec(String(v));
      }
      if (p.set || p.clear) w.setTile(x, y, z, t as never);
      return { type: t.type, size: list.length, items: list.map((s, i) => (s ? { slot: i, ...stackInfo(s) } : null)).filter(Boolean) };
    },
    count: async (p) => {
      const [lo, hi] = a.box(p.from, p.to);
      const n = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
      if (n > 4_000_000) throw new Error(`That box has ${n} blocks; count at most 4000000 at a time`);
      const dim = a.dim(p.dim);
      await a.load(dim, lo[0], lo[2], hi[0], hi[2]);
      const w = dim.world, byId = new Map<number, number>();
      const states = !!p.states;
      for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) {
        const v = w.get(x, y, z), k = states ? v : idOf(v);
        byId.set(k, (byId.get(k) ?? 0) + 1);
      }
      const air = byId.get(0) ?? 0;
      return { volume: n, air, blocks: [...byId].filter(([k]) => k !== 0).sort((q, r) => r[1] - q[1]).map(([k, c]) => ({ block: states ? formatBlock(k) : BLOCKS[k]?.name ?? String(k), count: c })) };
    },
    act: async (p) => {
      const action = String(p.action ?? '');
      const sp = a.sp, pl = a.player, dim = a.dim();
      const before = pl.inventory.held() ? { ...pl.inventory.held()! } : null;
      let res: Params = {};
      if (action === 'break' || action === 'use') {
        const [x, y, z] = a.bpos(p.pos);
        const face = FACES[String(p.face ?? 'up')];
        if (face === undefined) throw new Error('face: up, down, north, south, east, west');
        const v = dim.world.get(x, y, z);
        const nd = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][face];
        const nextBefore = formatBlock(dim.world.get(x + nd[0], y + nd[1], z + nd[2]));
        const hit = { x, y, z, face, t: 0, hx: x + 0.5 + [-.5, .5, 0, 0, 0, 0][face], hy: y + 0.5 + [0, 0, -.5, .5, 0, 0][face], hz: z + 0.5 + [0, 0, 0, 0, -.5, .5][face] };
        a.act(() => {
          sp.target = hit; sp.targetEntity = null;
          if (action === 'break') { if (idOf(v) === 0) throw new Error('Nothing to break there'); sp.interact.breakBlock(x, y, z); }
          else sp.interact.useNow();
          sp.target = null;
        });
        res = { before: formatBlock(v), after: formatBlock(dim.world.get(x, y, z)) };
        if (action === 'use') {
          const [dx, dy, dz] = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][face];
          const next = { pos: [x + dx, y + dy, z + dz], block: formatBlock(dim.world.get(x + dx, y + dy, z + dz)), was: nextBefore };
          res.next = next;
          if (res.before === res.after && nextBefore === next.block && JSON.stringify(before) === JSON.stringify(pl.inventory.held())) {
            res.ok = false;
            res.note = 'Nothing happened (no use for the held item there, or something is in the way: a block, an entity or the player)';
          }
        }
      } else if (action === 'attack' || action === 'interact') {
        const [e] = findEntity(p.id);
        a.act(() => {
          sp.targetEntity = e; sp.target = null;
          if (action === 'attack') sp.interact.attack(e); else sp.interact.useNow();
          sp.targetEntity = null;
        });
        res = { target: entityInfo(e) };
      } else if (action === 'useItem') {
        a.act(() => { sp.target = null; sp.targetEntity = null; sp.interact.useNow(); });
      } else throw new Error('action: break | use | attack | interact | useItem');
      const after = pl.inventory.held();
      return { ok: true, ...res, held: stackInfo(after), ...(JSON.stringify(before) !== JSON.stringify(after) ? { heldBefore: stackInfo(before) } : {}) };
    },

    // ---------------------------------------------------------------- code
    eval: async (p) => {
      const code = String(p.code ?? '');
      const printed: string[] = [];
      const scope: Params = { ...scopeFor(printed), args: p.args };
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => (...v: unknown[]) => Promise<unknown>;
      let fn;
      try { fn = new AsyncFunction(...Object.keys(scope), `return (${code}\n);`); } catch { fn = new AsyncFunction(...Object.keys(scope), code); }
      const result = await fn(...Object.values(scope));
      return { result: safe(result), ...(printed.length ? { printed } : {}) };
    },
    task: (p) => {
      const name = String(p.name ?? '');
      if (!name) throw new Error('Name it (`name`)');
      if (p.stop) { const had = tasks.delete(name); return { stopped: had, tasks: [...tasks.keys()] }; }
      const code = String(p.code ?? '');
      if (!code) throw new Error('What should it run? (`code`)');
      a.server;
      const printed: string[] = [];
      const scope = scopeFor(printed);
      delete scope.game;
      const names = [...Object.keys(scope), 'n', 'state', 'log'];
      let fn: (...v: unknown[]) => unknown;
      try { fn = new Function(...names, code) as typeof fn; } catch (e) { throw new Error(`The code doesn't parse: ${(e as Error).message}`); }
      const log = (...xs: unknown[]) => a.emit('task', { name, text: xs.map((x) => (typeof x === 'string' ? x : JSON.stringify(safe(x)))).join(' ') });
      const every = Math.max(1, Math.floor(Number(p.every ?? 1)));
      tasks.set(name, {
        // the world and player are looked up each run (they change with dimensions and worlds)
        fn: (n, st) => { const sc = scopeFor(printed); delete sc.game; return fn(...Object.keys(scope).map((k) => sc[k]), n, st, log); },
        every, runs: 0, times: Number(p.times ?? 0), state: {}, next: 0,
      });
      return { tasks: [...tasks.keys()], note: 'Errors stop a task; see `tasks` and `log`. Return "stop" to end it.' };
    },
    tasks: () => [...tasks].map(([name, t]) => ({ name, every: t.every, runs: t.runs, ...(t.times ? { times: t.times } : {}), ...(t.error ? { stopped: true, error: t.error } : {}) })),
    wait: async (p) => {
      const s = a.server;
      const ticks = Math.max(0, Math.min(20 * 600, Math.floor(p.ticks !== undefined ? Number(p.ticks) : Number(p.seconds ?? 1) * 20)));
      if (s.paused) throw new Error('The game is paused (a menu is open): use `resume` first');
      const start = s.ticks;
      await a.until(() => s.ticks - start >= ticks || s.paused, ticks * 50 * 3 + 5000);
      return { ticks: s.ticks - start, ...(s.paused ? { note: 'paused' } : {}) };
    },
  };

  // run the tasks inside the simulation's tick
  const runTasks = (g: Game) => {
    if (!tasks.size || g !== a.game.server) return;
    for (const [name, t] of [...tasks]) {
      if (t.error || g.ticks < t.next) continue;
      t.next = g.ticks + t.every;
      try {
        const r = a.act(() => t.fn(t.runs, t.state));
        t.runs++;
        if (r === 'stop' || (t.times && t.runs >= t.times)) tasks.delete(name);
      } catch (e) {
        // kept (stopped) so `tasks` shows what went wrong
        t.error = (e as Error).message;
        a.emit('task', { name, error: t.error });
      }
    }
  };
  m.__runTasks = runTasks as unknown as Method;
  m.__tick = () => shots.tick();
  return m;
}

/** Anything into plain JSON (cycles, maps, entities, typed arrays, very deep or very long things trimmed). */
export function safe(v: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'function') return `[function ${v.name || ''}]`;
  if (typeof v !== 'object') return String(v);
  if (seen.has(v)) return '[circular]';
  if (depth > 5) return `[${v.constructor?.name ?? 'object'}]`;
  seen.add(v);
  try {
    if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>).slice(0, 10000);
    if (Array.isArray(v)) return v.slice(0, 10000).map((x) => safe(x, depth + 1, seen));
    if (v instanceof Map) return Object.fromEntries([...v].slice(0, 2000).map(([k, x]) => [String(k), safe(x, depth + 1, seen)]));
    if (v instanceof Set) return [...v].slice(0, 10000).map((x) => safe(x, depth + 1, seen));
    if (v instanceof Error) return { error: v.message };
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, x] of Object.entries(v)) {
      if (['world', 'game', 'server', 'conn', 'sp', 'renderer', 'client', 'dim'].includes(k) && depth > 0) continue;
      if (typeof x === 'function') continue;
      if (++n > 300) { out['…'] = 'more fields'; break; }
      out[k] = safe(x, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(v);
  }
}
