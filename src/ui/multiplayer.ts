// Multiplayer screens: joining (nearby games, a code, or offline pairing), hosting (open your world, see who's
// in, kick), and the QR-code dance for devices without internet.
import { Screen, Button, TextField } from './screen';
import type { UI } from './ui';
import type { Ctx } from './gui';
import type { Conn } from '../net/conn';
import { nearbyRooms, onlineAvailable, joinRoom, cleanCode } from '../net/signal';
import { hostPairing, joinPairing } from '../net/pair';
import { qrCanvas, QrScanner } from '../net/qr';
import { cleanName } from '../net/protocol';
import { saveOptions } from '../game/options';

const wrap = (s: string, n = 52) => {
  const out: string[] = [];
  let line = '';
  for (const w of s.split(' ')) {
    if ((line + ' ' + w).trim().length > n) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out;
};

// ------------------------------------------------------------------ joining
export class MultiplayerScreen extends Screen {
  name!: TextField;
  code!: TextField;
  private rooms: { code: string; name: string; players: number }[] = [];
  private online: boolean | null = null;
  private t = 0;
  constructor(ui: UI, public parent: Screen) { super(ui); }

  override init() {
    const W = this.gui.w, H = this.gui.h, x = W / 2 - 100;
    this.name = new TextField(this.ui, x + 60, 32, 140, 18, this.name?.value ?? this.game.options.playerName, 16);
    this.code = new TextField(this.ui, x + 60, H - 76, 80, 18, this.code?.value ?? '', 8, 'ABC234');
    const rows = this.rooms.slice(0, 4).map((r, i) => new Button(this.ui, x, 70 + i * 22, 200, 20, `${r.name} (${r.players}) ${r.code}`, () => this.join(r.code)));
    this.widgets = [
      this.name, this.code, ...rows,
      Object.assign(new Button(this.ui, x + 144, H - 77, 56, 20, 'Join', () => this.join(this.code.value)), { enabled: this.online !== false }),
      new Button(this.ui, x, H - 52, 200, 20, 'Join Without Internet...', () => { this.saveName(); this.ui.open(new OfflineJoinScreen(this.ui, this)); }),
      new Button(this.ui, x, H - 28, 200, 20, 'Back', () => { this.saveName(); this.ui.open(this.parent); }),
    ];
  }

  private saveName() {
    const n = cleanName(this.name.value);
    if (n && n !== this.game.options.playerName) { this.game.options.playerName = n; saveOptions(this.game.options); }
  }

  private join(code: string) {
    this.saveName();
    const c = cleanCode(code);
    if (c.length < 4) return;
    this.ui.open(new ConnectingScreen(this.ui, this, `Joining ${c}`, (status) => joinRoom(c, status)));
  }

  override tick() {
    // look for games on this network every few seconds
    if (this.t++ % 60 !== 0) return;
    onlineAvailable().then((ok) => {
      const changed = this.online !== ok;
      this.online = ok;
      if (!ok) { if (changed) this.relayout(); return; }
      nearbyRooms().then((rooms) => {
        const key = (l: typeof rooms) => l.map((r) => r.code + r.players + r.name).join();
        if (key(rooms) === key(this.rooms) && !changed) return;
        this.rooms = rooms;
        this.relayout();
      });
    });
  }

  override render(ctx: Ctx, mx: number, my: number) {
    const W = this.gui.w, H = this.gui.h, x = W / 2 - 100;
    this.gui.dirtBackground(ctx);
    this.gui.textCenter(ctx, 'Play Multiplayer', W / 2, 12, '#FFFFFF');
    this.gui.text(ctx, 'Your name', x, 37, '#A0A0A0');
    this.gui.text(ctx, this.online === false ? 'Online play is not set up on this site' : 'Games on this network', x, 58, '#A0A0A0');
    if (this.online && !this.rooms.length) this.gui.text(ctx, '(none yet - looking...)', x + 4, 74, '#606060');
    this.gui.text(ctx, 'Game code', x, H - 71, '#A0A0A0');
    super.render(ctx, mx, my);
  }

  override key(e: KeyboardEvent) {
    if (e.code === 'Enter' && this.code.focused) { this.join(this.code.value); return true; }
    if (e.code === 'Escape') { this.saveName(); this.ui.open(this.parent); return true; }
    return super.key(e);
  }
  override mouseDown(mx: number, my: number, b: number) {
    this.name.focused = this.code.focused = false;
    return super.mouseDown(mx, my, b);
  }
}

/** Waiting for a connection; on success the game takes it from here. */
export class ConnectingScreen extends Screen {
  private status = 'Connecting...';
  private error = '';
  private cancelled = false;
  constructor(ui: UI, public parent: Screen, public title: string, task: (status: (s: string) => void) => Promise<Conn>) {
    super(ui);
    task((s) => (this.status = s)).then((conn) => {
      if (this.cancelled) { conn.close('cancelled'); return; }
      this.game.joinRemote(conn);
    }, (e: Error) => { this.error = e.message; this.relayout(); });
  }
  override init() {
    const W = this.gui.w, H = this.gui.h;
    this.widgets = [new Button(this.ui, W / 2 - 100, H / 2 + 30, 200, 20, this.error ? 'Back' : 'Cancel', () => { this.cancelled = true; this.ui.open(this.parent); })];
  }
  override render(ctx: Ctx, mx: number, my: number) {
    const W = this.gui.w, H = this.gui.h;
    this.gui.dirtBackground(ctx);
    this.gui.textCenter(ctx, this.title, W / 2, H / 2 - 30, '#FFFFFF');
    if (this.error) wrap(this.error).forEach((l, i) => this.gui.textCenter(ctx, l, W / 2, H / 2 - 10 + i * 11, '#FF8080'));
    else this.gui.textCenter(ctx, this.status, W / 2, H / 2 - 10, '#A0A0A0');
    super.render(ctx, mx, my);
  }
}

// ------------------------------------------------------------------ QR codes on screen
/** Shows a code as a QR picture plus Copy / Share buttons, and reads one by camera or paste. */
abstract class PairingScreen extends Screen {
  protected qr: HTMLCanvasElement | null = null;
  protected shown = '';
  protected scanner: QrScanner | null = null;
  protected paste!: TextField;
  protected message = '';
  protected bad = false;
  private n = 0;
  constructor(ui: UI, public parent: Screen) { super(ui); }

  protected async show(code: string) {
    this.shown = code;
    this.qr = await qrCanvas(code);
  }

  protected codeButtons(x: number, y: number) {
    const out = [new Button(this.ui, x, y, 60, 20, 'Copy', () => navigator.clipboard?.writeText(this.shown).then(() => this.note('Copied'), () => this.note("Couldn't copy", true)))];
    if (typeof navigator.share === 'function') out.push(new Button(this.ui, x + 64, y, 60, 20, 'Share', () => navigator.share({ text: this.shown }).catch(() => {})));
    return out;
  }

  protected readButtons(x: number, y: number) {
    this.paste = new TextField(this.ui, x, y, 136, 18, this.paste?.value ?? '', 2000, 'paste a code');
    return [
      new Button(this.ui, x, y - 24, 200, 20, this.scanner ? 'Stop Camera' : 'Scan with Camera', () => (this.scanner ? this.stopScan() : this.startScan())),
      this.paste,
      new Button(this.ui, x + 140, y - 1, 60, 20, 'Use', () => this.read(this.paste.value)),
    ];
  }

  protected note(s: string, bad = false) { this.message = s; this.bad = bad; }

  private async startScan() {
    try {
      this.scanner = new QrScanner();
      this.relayout();
      await this.scanner.start();
    } catch (e) {
      this.stopScan();
      this.note((e as Error).message || 'No camera', true);
    }
  }
  protected stopScan() {
    this.scanner?.stop();
    this.scanner = null;
    this.relayout();
  }

  /** A code came in (camera or paste). */
  abstract read(text: string): void;

  override tick() {
    if (this.scanner && this.n++ % 4 === 0) this.scanner.scan().then((t) => { if (t && this.scanner) { this.stopScan(); this.read(t); } });
  }
  override onClose() { this.scanner?.stop(); }

  protected drawCode(ctx: Ctx, x: number, y: number, size: number) {
    if (!this.qr) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.qr, x, y, size, size);
  }
  protected drawCamera(ctx: Ctx, x: number, y: number, size: number) {
    const v = this.scanner?.video;
    if (!v || v.readyState < 2) { ctx.fillStyle = '#000'; ctx.fillRect(x, y, size, size); this.gui.textCenter(ctx, 'Starting camera...', x + size / 2, y + size / 2 - 4, '#A0A0A0'); return; }
    const s = Math.min(v.videoWidth, v.videoHeight);
    ctx.drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, x, y, size, size);
    ctx.strokeStyle = '#80FF80';
    ctx.strokeRect(x + size * 0.15, y + size * 0.15, size * 0.7, size * 0.7);
  }
  protected drawMessage(ctx: Ctx, cx: number, y: number) {
    if (this.message) wrap(this.message, 40).forEach((l, i) => this.gui.textCenter(ctx, l, cx, y + i * 10, this.bad ? '#FF8080' : '#80FF80'));
  }
  override key(e: KeyboardEvent) {
    if (e.code === 'Enter' && this.paste?.focused) { this.read(this.paste.value); return true; }
    if (e.code === 'Escape') { this.ui.open(this.parent); return true; }
    return super.key(e);
  }
  override mouseDown(mx: number, my: number, b: number) {
    if (this.paste) this.paste.focused = false;
    return super.mouseDown(mx, my, b);
  }
}

/** Host side: show our code, read the joining device's reply. */
export class OfflineHostScreen extends PairingScreen {
  private pairing: Awaited<ReturnType<typeof hostPairing>> | null = null;
  private done = false;
  constructor(ui: UI, parent: Screen) {
    super(ui, parent);
    this.begin();
  }
  private async begin() {
    this.done = false;
    this.note('');
    this.pairing?.cancel();
    this.pairing = null;
    try {
      this.pairing = await hostPairing();
      await this.show(this.pairing.code);
      this.relayout();
    } catch (e) {
      this.note((e as Error).message, true);
    }
  }
  override async read(text: string) {
    const p = this.pairing;
    if (!p || this.done) return;
    this.note('Connecting...');
    try {
      const conn = await p.accept(text);
      this.done = true;
      this.pairing = null;
      this.game.acceptGuest(conn);
      this.note('Connected! They are joining your world.');
      this.relayout();
    } catch (e) {
      this.note((e as Error).message, true);
    }
  }
  override init() {
    const W = this.gui.w, H = this.gui.h;
    const right = W / 2 + 10;
    this.widgets = this.done
      ? [new Button(this.ui, right, 120, 140, 20, 'Add Another Device', () => this.begin())]
      : [...this.codeButtons(W / 2 - 150, H - 52), ...this.readButtons(right, 92)];
    this.widgets.push(new Button(this.ui, W / 2 - 100, H - 28, 200, 20, 'Done', () => this.ui.open(this.parent)));
  }
  override render(ctx: Ctx, mx: number, my: number) {
    const W = this.gui.w, H = this.gui.h;
    this.gui.dirtBackground(ctx);
    this.gui.textCenter(ctx, 'Add a Device Without Internet', W / 2, 8, '#FFFFFF');
    const size = Math.min(H - 90, W / 2 - 30);
    this.gui.text(ctx, '1. On the other device: Multiplayer,', W / 2 - 150, 22, '#A0A0A0');
    this.gui.text(ctx, '   Join Without Internet, scan this', W / 2 - 150, 32, '#A0A0A0');
    if (this.scanner) this.drawCamera(ctx, W / 2 - 150, 44, size);
    else if (this.qr) this.drawCode(ctx, W / 2 - 150, 44, size);
    else this.gui.text(ctx, 'Making a code...', W / 2 - 140, 60, '#A0A0A0');
    if (!this.done) {
      this.gui.text(ctx, '2. Then read the code it shows:', W / 2 + 10, 50, '#A0A0A0');
      this.gui.text(ctx, 'Both devices need the same Wi-Fi', W / 2 + 10, 116, '#606060');
      this.gui.text(ctx, 'or hotspot.', W / 2 + 10, 126, '#606060');
    }
    this.drawMessage(ctx, W / 2 + 80, this.done ? 100 : 140);
    super.render(ctx, mx, my);
  }
  override onClose() {
    super.onClose();
    if (!this.done) this.pairing?.cancel();
  }
}

/** Joining side: read the host's code, show our reply, and go in once the host has read it. */
export class OfflineJoinScreen extends PairingScreen {
  private replying = false;
  private cancel: (() => void) | null = null;
  override async read(text: string) {
    if (this.replying) return;
    this.note('Reading the code...');
    try {
      const j = await joinPairing(text);
      this.cancel = j.cancel;
      this.replying = true;
      await this.show(j.code);
      this.note('');
      this.relayout();
      const conn = await j.conn;
      this.cancel = null;
      this.game.joinRemote(conn);
    } catch (e) {
      this.note((e as Error).message, true);
      this.replying = false;
      this.relayout();
    }
  }
  override init() {
    const W = this.gui.w, H = this.gui.h;
    this.widgets = this.replying ? this.codeButtons(W / 2 - 150, H - 52) : this.readButtons(W / 2 - 100, 70);
    this.widgets.push(new Button(this.ui, W / 2 - 100, H - 28, 200, 20, 'Cancel', () => this.ui.open(this.parent)));
  }
  override render(ctx: Ctx, mx: number, my: number) {
    const W = this.gui.w, H = this.gui.h;
    this.gui.dirtBackground(ctx);
    this.gui.textCenter(ctx, 'Join Without Internet', W / 2, 8, '#FFFFFF');
    if (!this.replying) {
      this.gui.textCenter(ctx, "On the host: Pause, Open to LAN, Add a Device.", W / 2, 24, '#A0A0A0');
      this.gui.textCenter(ctx, "Scan the code it shows, or paste it here:", W / 2, 34, '#A0A0A0');
      if (this.scanner) this.drawCamera(ctx, W / 2 - 50, 96, Math.min(100, H - 140));
    } else {
      const size = Math.min(H - 90, W / 2 - 30);
      this.drawCode(ctx, W / 2 - 150, 30, size);
      this.gui.text(ctx, 'Now let the host scan this', W / 2 + 10, 50, '#A0A0A0');
      this.gui.text(ctx, 'code (or send it to them).', W / 2 + 10, 60, '#A0A0A0');
      this.gui.text(ctx, 'Waiting for the host...', W / 2 + 10, 80, '#FFFFFF');
    }
    this.drawMessage(ctx, W / 2, H - 70);
    super.render(ctx, mx, my);
  }
  override onClose() {
    super.onClose();
    this.cancel?.();
  }
}

// ------------------------------------------------------------------ hosting
/** Open your world to others: a code, the nearby list, offline pairing, and who's playing. */
export class HostScreen extends Screen {
  private error = '';
  private busy = false;
  private online: boolean | null = null;
  constructor(ui: UI, public parent: Screen) {
    super(ui);
    onlineAvailable().then((ok) => { this.online = ok; this.relayout(); });
  }
  override init() {
    const W = this.gui.w, H = this.gui.h, g = this.game, x = W / 2 - 100;
    const room = g.room && !g.roomLost ? g.room : null;
    this.widgets = [];
    if (!room) {
      this.widgets.push(Object.assign(new Button(this.ui, x, 54, 200, 20, this.busy ? 'Opening...' : 'Open to Others', () => this.open()), { enabled: !this.busy && this.online !== false }));
    } else this.widgets.push(new Button(this.ui, x, 78, 200, 20, 'Stop Letting New Players In', () => { g.stopHosting(); this.relayout(); }));
    this.widgets.push(new Button(this.ui, x, 102, 200, 20, 'Add a Device Without Internet...', () => this.ui.open(new OfflineHostScreen(this.ui, this))));
    g.guests().slice(0, 5).forEach((sp, i) => this.widgets.push(new Button(this.ui, x + 150, 136 + i * 16, 50, 14, 'Kick', () => { g.kick(sp); this.relayout(); })));
    this.widgets.push(new Button(this.ui, x, H - 28, 200, 20, 'Back to Game', () => this.ui.close()));
  }
  private async open() {
    this.busy = true;
    this.error = '';
    this.relayout();
    try {
      await this.game.openToOthers(true);
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.busy = false;
    this.relayout();
  }
  private seen = '';
  override tick() {
    // the player list changes as people come and go
    const k = this.game.guests().map((p) => p.name).join() + (this.game.room ? 1 : 0);
    if (k !== this.seen) { this.seen = k; this.relayout(); }
  }
  override render(ctx: Ctx, mx: number, my: number) {
    const W = this.gui.w, x = W / 2 - 100, g = this.game;
    this.backgroundGradient(ctx);
    this.gui.textCenter(ctx, 'Play with Others', W / 2, 12, '#FFFFFF');
    const room = g.room && !g.roomLost ? g.room : null;
    if (room) {
      ctx.save();
      ctx.translate(W / 2, 30);
      ctx.scale(2, 2);
      this.gui.font.drawCentered(ctx, room.code, 0, 0, '#FFFF55');
      ctx.restore();
      this.gui.textCenter(ctx, 'Others join with this code (Multiplayer screen),', W / 2, 52, '#A0A0A0');
      this.gui.textCenter(ctx, 'or find this world there if on the same Wi-Fi.', W / 2, 62, '#A0A0A0');
    } else {
      this.gui.textCenter(ctx, this.online === false ? 'Online play is not set up on this site' : 'Get a code friends can join with', W / 2, 30, '#A0A0A0');
      if (this.error) wrap(this.error).forEach((l, i) => this.gui.textCenter(ctx, l, W / 2, 40 + i * 10, '#FF8080'));
    }
    const guests = g.guests();
    this.gui.text(ctx, guests.length ? 'Playing here:' : 'Nobody else is here yet', x, 126, '#A0A0A0');
    guests.slice(0, 5).forEach((sp, i) => this.gui.text(ctx, sp.name, x + 4, 139 + i * 16, '#FFFFFF'));
    super.render(ctx, mx, my);
  }
}
