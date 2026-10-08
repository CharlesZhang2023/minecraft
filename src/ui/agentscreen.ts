// Options > More... > Agent: pair this tab with the agent bridge on this computer (`mc online`), so an AI agent or a
// program can play in this world. The code comes from the link `mc online` prints; the tab connects out to this
// computer only (ws://127.0.0.1), never to the game's server.
import { Screen, Button, TextField } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import { agentLink, agentStatus, parsePairing, savePairing, forgetPairing, remembered, startAgent, stopAgent, DEFAULT_PORT } from '../agent/pairing';
import { t } from '../i18n/i18n';

export class AgentScreen extends Screen {
  code!: TextField;
  remember = remembered();
  message = '';
  messageAt = 0;
  constructor(ui: UI, public parent: Screen) { super(ui); }
  override pausesGame = true;
  override init() {
    const W = this.gui.w, H = this.gui.h;
    const p = agentLink.pairing;
    const top = Math.max(30, Math.min(H / 6, 60));
    const prev = this.code?.value ?? (p ? p.pair + (p.port !== DEFAULT_PORT ? '@' + p.port : '') : '');
    this.code = new TextField(this.ui, W / 2 - 150, top + 56, 240, 20, prev, 200, 'Paste the link or code');
    const y = top + 100;
    this.widgets = [
      this.code,
      new Button(this.ui, W / 2 + 94, top + 56, 56, 20, 'Paste', () => this.paste()),
      new Button(this.ui, W / 2 - 150, y, 148, 20, () => (agentStatus() === 'off' ? 'Connect' : 'Reconnect'), () => this.connect()),
      Object.assign(new Button(this.ui, W / 2 + 2, y, 148, 20, 'Disconnect', () => this.disconnect()), { enabled: true }),
      new Button(this.ui, W / 2 - 150, y + 24, 300, 20, () => t('Remember on this device: {0}', t(this.remember ? 'ON' : 'OFF')), () => {
        this.remember = !this.remember;
        const pr = agentLink.pairing;
        if (!this.remember) { try { localStorage.removeItem('mc-agent-pair-remember'); } catch { /* fine */ } }
        else if (pr) savePairing(pr, true);
      }),
      new Button(this.ui, W / 2 - 100, H - 28, 200, 20, 'Done', () => this.ui.open(this.parent)),
    ];
  }
  async paste() {
    try {
      this.code.value = (await navigator.clipboard.readText()).trim().slice(0, 200);
      this.message = '';
    } catch {
      this.messageAt = performance.now(); this.message = 'No clipboard access: click the box, press Ctrl+V';
    }
  }
  connect() {
    const p = parsePairing(this.code.value);
    if (!p) { this.messageAt = performance.now(); this.message = 'Not a pairing code: copy the link mc online prints'; return; }
    savePairing(p, this.remember);
    this.message = '';
    void startAgent(this.game, p);
  }
  disconnect() {
    stopAgent();
    forgetPairing();
    this.remember = false;
    this.messageAt = performance.now();
    this.message = 'Disconnected: nothing can drive this tab now';
  }
  override render(ctx: Ctx, mx: number, my: number) {
    const W = this.gui.w, H = this.gui.h, g = this.gui;
    if (this.game.world && !this.game.panorama) this.backgroundGradient(ctx);
    else g.dirtBackground(ctx);
    const top = Math.max(30, Math.min(H / 6, 60));
    g.textCenter(ctx, 'Agent', W / 2, 15, '#FFFFFF');
    const lines = [
      'Let an AI agent (Claude Code) or a program on this',
      'computer play in this tab: look, build, run commands.',
      'In the game\'s folder run this, then paste its link:',
      'node tools/agent/mc.mjs online',
    ];
    lines.forEach((l, i) => g.textCenter(ctx, l, W / 2, top + i * 10, i === 3 ? '#FFFF80' : '#A0A0A0'));
    const st = agentStatus();
    const [label, col] = {
      off: ['Not connected', '#A0A0A0'],
      loading: ['Starting...', '#FFFF80'],
      waiting: ['Waiting for mc online on this computer...', '#FFFF80'],
      connected: ['Connected: an agent can play in this tab', '#55FF55'],
    }[st];
    // a message for a few seconds, else how the connection is
    if (this.message && performance.now() - this.messageAt < 5000) g.textCenter(ctx, this.message, W / 2, top + 84, '#FFAAAA');
    else g.textCenter(ctx, agentLink.error ? t('Error: {0}', agentLink.error) : label, W / 2, top + 84, agentLink.error ? '#FF5555' : col);
    g.textCenter(ctx, 'It connects to this computer only, not to the server.', W / 2, H - 42, '#808080');
    super.render(ctx, mx, my);
  }
  override key(e: KeyboardEvent) {
    if (e.code === 'Enter') { this.connect(); return true; }
    if (e.code === 'Escape') { this.ui.open(this.parent); return true; }
    return super.key(e);
  }
  override mouseDown(mx: number, my: number, b: number) {
    this.code.focused = false;
    return super.mouseDown(mx, my, b);
  }
}
