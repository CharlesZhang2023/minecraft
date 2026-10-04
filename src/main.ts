import { Client } from './client/client';
import { playWorld } from './ui/menus';
import type { WorldMeta } from './game/storage';
import { BLOCKS } from './world/blocks';
import { ITEMS } from './game/items';
import { WorldGen } from './world/worldgen';
import { BIOMES } from './world/biomes';
import { regionVillage } from './world/village';
import { regionFortress } from './world/fortress';
import { strongholdSites, layoutStronghold, nearestSite } from './world/stronghold';
import { mods } from './mod/loader';
import { readPairing, startAgent } from './agent/pairing';

const gl = document.getElementById('gl') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLCanvasElement;

function fail(msg: string) {
  document.body.innerHTML = `<div style="color:#fff;font:16px monospace;padding:40px;background:#300">${msg}</div>`;
}

async function start() {
  // mods first: their blocks, items and textures must exist before the client builds its atlas
  try {
    await mods.boot();
  } catch (e) {
    console.error('mod loader', e);
  }
  (window as unknown as { mods: unknown }).mods = mods;
  const game = new Client(gl, ui);
  // tests and the console: `game` is what you see; `game.server` is the simulation (single-player / hosting)
  (window as unknown as { game: Client }).game = game;
  (window as unknown as { __mc: unknown }).__mc = { BLOCKS, ITEMS, WorldGen, BIOMES, regionVillage, regionFortress, strongholdSites, layoutStronghold, nearestSite };
  // tests: run code inside the simulation as the first player (their dimension, `g.player`, `g.world`...)
  (window as unknown as { sim: unknown }).sim = <T>(fn: (g: NonNullable<Client['server']>, p: NonNullable<Client['player']>) => T): T | undefined => {
    const s = game.server, sp = s?.players[0];
    return s && sp ? s.asActor(sp, () => fn(s, sp.entity)) : undefined;
  };
  // tests: the server, its first player, their dimension and world
  (window as unknown as { S: unknown }).S = () => {
    const g = game.server!, sp = g.players[0], d = g.dims.get(sp.dim);
    return { g, sp, p: sp.entity, d, w: d?.world };
  };
  // development: two tabs can play together without a network (tests)
  if (import.meta.env.DEV) {
    (window as unknown as { mp: unknown }).mp = {
      host: async (ch: string) => game.acceptGuest((await import('./net/bc')).bcConn(ch, 'host')),
      join: async (ch: string) => game.joinRemote((await import('./net/bc')).bcConn(ch, 'guest')),
    };
  }
  game.start();
  // programs on the player's own computer (the `mc` command, AI agents over MCP) can drive this tab: in development
  // through the dev server, and anywhere through `mc online` once the tab is paired (a link, or Options > More... >
  // Agent)
  const pairing = readPairing();
  if (pairing) void startAgent(game, pairing);
  else if (import.meta.env.DEV) import('./agent').then((m) => { const link = m.hmrLink(); if (link) m.attach(game, link); }).catch((e) => console.warn('agent bridge', e));
  // a pairing link (or #agent=off) typed into an open tab: start over with it
  window.addEventListener('hashchange', () => { if (/(?:^#|&)agent=/.test(location.hash)) location.reload(); });
  // never lose progress: save when the tab is hidden or closed
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && game.world && !game.panorama) game.saveWorld();
  });
  window.addEventListener('beforeunload', (e) => {
    if (game.world && !game.panorama) {
      game.saveWorld();
      e.preventDefault();
    }
  });

  // Automation hook: ?autoplay&seed=..&mode=..&time=..&x=..&z=..
  const q = new URLSearchParams(location.search);
  if (q.has('autoplay')) {
    const seed = parseInt(q.get('seed') ?? '12345');
    const meta: WorldMeta = {
      id: q.get('id') ?? 'test-' + seed, name: 'Test World', seed, seedText: String(seed), gameMode: parseInt(q.get('mode') ?? '1'),
      hardcore: false, created: Date.now(), lastPlayed: Date.now(), time: parseInt(q.get('time') ?? '1000'),
    };
    setTimeout(async () => {
      await game.closeWorld(false);
      await playWorld(game.ui, meta);
    }, 50);
  }
  // offline play (hotspots, pairing by QR code): keep the game's files in a service worker's cache
  if ('serviceWorker' in navigator && !import.meta.env.DEV) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      if (navigator.onLine) (reg.active ?? reg.waiting ?? reg.installing)?.postMessage('precache');
    }).catch(() => {});
  }
}

start().catch((e) => {
  console.error(e);
  fail('Failed to start: ' + (e as Error).message);
});
