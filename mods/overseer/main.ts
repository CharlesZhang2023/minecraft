// Overseer: a 2.5D strategy view inspired by Reign of Nether. Look down on the world as an unseen overseer
// (your body steps out of the world) and command units that gather, build a town and fight; or switch to your
// own character and walk it under the same camera. Wiring only: see README.md for the tour.
import type { ModContext, Channel, Player } from '../sdk';
import { defineUnit } from './units';
import { Overseer } from './server';
import { Ctl } from './ctl';
import { Hud, drawWorld, paintTextures } from './hud';
import { project } from './cam';
import { resetBlocks } from './place';
import { RES, RAIDERS, type Res } from './defs';
import type { ToClient, ToServer, WData, Mode } from './state';

let ch: Channel<ToServer | ToClient>;
let ov: Overseer | null = null;
let cfg: { allow: string; pvp: boolean; raids: boolean; toggleKey: string };

export function main(mod: ModContext) {
  cfg = mod.config({
    toggleKey: { type: 'key', default: 'KeyV', label: 'Overseer view key', description: 'Switches between first person and the 2.5D view.' },
    allow: { type: 'enum', default: 'all', options: ['all', 'host'], labels: ['Everyone', 'Only the host'], label: 'When hosting: who may look down', description: 'The overseer view lifts a player out of the world (they spectate while commanding).' },
    pvp: { type: 'boolean', default: false, label: 'When hosting: players\' units fight each other', description: 'Off: everyone\'s units only fight monsters and raiders.' },
    raids: { type: 'boolean', default: false, label: 'When hosting: nightly raids', description: 'Each night a wave of monsters marches on every town hall, bigger every night.' },
  }) as typeof cfg;
  ch = mod.channel<ToServer | ToClient>('rts');
  const data = mod.worldData<WData>(() => ({ players: {}, buildings: [], next: 1 }));
  if (mod.realm !== 'page') return;
  const Unit = defineUnit(mod);
  const o = (ov = new Overseer(mod, data, ch, Unit as never, () => ({ allow: cfg.allow, pvp: cfg.pvp, raids: cfg.raids })));
  ch.onServer((d, p, g) => o.receive(d as ToServer, p, g));
  mod.on('serverTick', (g) => o.tick(g));
  mod.on('worldLoad', (g) => { o.game = g; o.reset(); resetBlocks(); });
  mod.on('worldClose', () => { o.reset(); o.game = null; });
  // whoever was looking down when they left gets their body back
  mod.on('playerJoin', (g, p) => {
    o.game = g;
    const name = g.playerOf(p)?.name;
    if (!name) return;
    const st = o.ps(name);
    if (st.park) o.restore(p, st);
    st.mode = 'off';
  });
  mod.on('playerLeave', (g, p) => {
    o.game = g;
    const name = g.playerOf(p)?.name;
    if (!name) return;
    const st = o.ps(name);
    if (st.park) o.restore(p, st);
    st.mode = 'off';
  });
  mod.on('entityDeath', ({ game, entity }) => { o.game = game; o.onDeath(entity, (entity as unknown as { lastAttacker?: never }).lastAttacker ?? null); });
  // monsters go after units as well as players
  mod.mixin(mod.mc.Monster.prototype, 'ai', { after(self) { o.monsterLooks(self as never); } });

  mod.commands.register({
    name: 'overseer', aliases: ['rts'], permission: 'all',
    usage: '/overseer [god|hero|off] | res <food> <wood> <ore> | raid | reset',
    description: 'the 2.5D strategy view',
    run({ game, player, args, reply }) {
      o.game = game;
      const sp = game.playerOf(player);
      const sub = (args[0] ?? '').toLowerCase();
      const host = !!sp?.owner;
      if (['god', 'hero', 'off'].includes(sub)) { o.setMode(player as Player, sub as Mode); return `View: ${sub}`; }
      if (!sp) return;
      if (sub === 'res') {
        if (!host) throw new Error('Only the host can do that');
        const st = o.ps(sp.name);
        RES.forEach((r: Res, i) => { const n = Number(args[i + 1]); if (Number.isFinite(n)) st.res[r] = Math.max(0, n); });
        o.dirtyState(sp.name);
        return `Resources: ${RES.map((r) => `${st.res[r]} ${r}`).join(', ')}`;
      }
      if (sub === 'raid') {
        if (!host) throw new Error('Only the host can do that');
        const tc = o.wd().buildings.find((b) => b.owner === sp.name && b.type === 'town_centre');
        if (!tc) throw new Error('You have no town hall');
        const w = game.dims.get('overworld');
        if (!w) return;
        game.inDim(w, () => {
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const u = o.spawnUnit(RAIDERS, ['zombie', 'skeleton', 'spider', 'creeper', 'zombie', 'skeleton'][i], { type: 'stockpile', x: Math.floor(tc.x + Math.cos(a) * 28), y: tc.y, z: Math.floor(tc.z + Math.sin(a) * 28), rot: 0 });
            if (u) o.brains.command(u, { t: 'amove', x: tc.x + 4, y: tc.y + 1, z: tc.z + 4 });
          }
        });
        reply('A raid is coming!');
        return;
      }
      if (sub === 'reset') {
        const st = o.ps(sp.name);
        for (const b of o.wd().buildings.filter((q) => q.owner === sp.name)) o.removeBuilding(b, false);
        for (const d of game.dims.values()) for (const e of d.entities) if ((e as { typeName?: string }).typeName === 'overseer:unit' && (e as unknown as { owner: string }).owner === sp.name) e.removed = true;
        st.faction = null; st.started = false; st.res = { food: 150, wood: 200, ore: 50 };
        o.dirtyState(sp.name);
        return 'Your side starts over';
      }
      const st = o.ps(sp.name);
      return [`§eOverseer§r: view ${st.mode}, ${st.faction ?? 'no side yet'}, ${RES.map((r) => `${Math.floor(st.res[r])} ${r}`).join(', ')}`, 'Press V (or /overseer god) to look down.'];
    },
  });
}

export function client(mod: ModContext) {
  paintTextures(mod);
  const ctl = new Ctl(mod, ch);
  const hud = new Hud(ctl, mod);
  ctl.cfgKey = cfg.toggleKey;
  ch.onClient((d, c) => ctl.receive(d as ToClient, c));
  mod.on('clientTick', (c) => { ctl.cfgKey = cfg.toggleKey; ctl.tick(c); });
  mod.on('clientJoin', () => { ctl.reset(); mod.client.setView(null); });
  mod.on('hudRender', ({ ctx, client, width, height }) => hud.render(ctx, client, width, height));
  mod.on('worldRender', (r) => drawWorld(ctl, r));
  mod.client.keybind('toggleKey', 'KeyV', (c) => ctl.request(ctl.mode === 'off' ? 'god' : 'off', c));
  mod.client.touchButton('view', {
    visible: (c) => ctl.mode === 'off' && !!c.player && !c.player.dead,
    onPress: (c) => ctl.request('god', c),
    icon: (ctx, x, y, w, h) => {
      // an eye looking down
      const cx = x + w / 2, cy = y + h / 2;
      ctx.fillStyle = 'rgba(240,240,240,0.92)';
      ctx.fillRect(cx - 7, cy - 1, 14, 3); ctx.fillRect(cx - 5, cy - 3, 10, 7); ctx.fillRect(cx - 3, cy - 4, 6, 9);
      ctx.fillStyle = '#3060c0'; ctx.fillRect(cx - 2, cy - 2, 4, 5);
      ctx.fillStyle = '#101010'; ctx.fillRect(cx - 1, cy - 1, 2, 3);
    },
  });
  // a handle for tests and the console
  (globalThis as unknown as { __overseer: unknown }).__overseer = {
    ctl, hud, get server() { return ov; },
    /** GUI coordinates of a world point in the current view. */
    project: (x: number, y: number, z: number) => { const c = mod.mc.client!; return project(c, x, y, z, c.ui.gui.w, c.ui.gui.h); },
  };
}
