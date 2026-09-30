import { Game } from './game/game';
import { playWorld } from './ui/menus';
import type { WorldMeta } from './game/storage';

const gl = document.getElementById('gl') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLCanvasElement;

function fail(msg: string) {
  document.body.innerHTML = `<div style="color:#fff;font:16px monospace;padding:40px;background:#300">${msg}</div>`;
}

try {
  const game = new Game(gl, ui);
  (window as unknown as { game: Game }).game = game;
  game.start();

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
} catch (e) {
  console.error(e);
  fail('Failed to start: ' + (e as Error).message);
}
