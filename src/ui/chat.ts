import { device } from '../game/device';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { localize } from '../i18n/i18n';

interface Line { text: string; time: number }

export class Chat {
  lines: Line[] = [];
  scroll = 0;
  constructor(private ui: UI) {}

  /** A line from the game (perhaps a message to translate, see i18n.ts) or a player. */
  add(text: string) {
    const gui = this.ui.gui;
    for (const l of gui.font.wrap(localize(text), 320)) this.lines.unshift({ text: l, time: performance.now() });
    if (this.lines.length > 100) this.lines.length = 100;
  }

  render(ctx: Ctx, open: boolean) {
    const gui = this.ui.gui;
    const now = performance.now();
    // touch screens: above the D-pad, which fills the bottom left corner
    const baseY = gui.h - (device.touch && !open ? 84 : 57);
    const max = open ? 20 : 10;
    let n = 0;
    for (let i = this.scroll; i < this.lines.length && n < max; i++) {
      const l = this.lines[i];
      const age = (now - l.time) / 1000;
      let a = 1;
      if (!open) {
        if (age > 10) break;
        a = Math.max(0, Math.min(1, (10 - age) / 1));
      }
      const y = baseY - n * 9;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(2, y - 1, 322, 9);
      gui.font.draw(ctx, l.text, 4, y, '#FFFFFF');
      ctx.globalAlpha = 1;
      n++;
    }
  }
}
