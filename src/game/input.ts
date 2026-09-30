// Keyboard / mouse state with per-tick edge detection.

export class Input {
  down = new Set<string>();
  pressedQ: string[] = []; // key presses since last poll (for gameplay)
  mouseDown = new Set<number>();
  mousePressedQ: number[] = [];
  dx = 0;
  dy = 0;
  wheel = 0;
  mouseX = 0;
  mouseY = 0;
  locked = false;
  onKeyDown: (e: KeyboardEvent) => boolean = () => false; // return true if consumed by UI
  onChar: (ch: string) => void = () => {};
  onMouseDown: (x: number, y: number, button: number, e: MouseEvent) => void = () => {};
  onMouseUp: (x: number, y: number, button: number) => void = () => {};
  onWheel: (d: number) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};
  private lastUnlock = 0;

  constructor(public el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'F3' || e.code === 'F1' || e.code === 'F2' || e.code === 'F5' || e.code === 'Space' || (e.ctrlKey && e.code !== 'KeyV' && e.code !== 'KeyC')) e.preventDefault();
      if (e.code.startsWith('Arrow') || e.code === 'Slash' || e.code === 'Quote') e.preventDefault();
      const consumed = this.onKeyDown(e);
      if (!consumed) {
        if (!this.down.has(e.code)) this.pressedQ.push(e.code);
        this.down.add(e.code);
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) this.onChar(e.key);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouseDown.clear();
    });
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.mouseDown.add(e.button);
      if (this.locked) this.mousePressedQ.push(e.button);
      this.onMouseDown(this.mouseX, this.mouseY, e.button, e);
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown.delete(e.button);
      this.onMouseUp(this.mouseX, this.mouseY, e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
      this.mouseX = e.clientX * devicePixelRatio;
      this.mouseY = e.clientY * devicePixelRatio;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = Math.sign(e.deltaY);
      if (this.locked) this.wheel += d;
      this.onWheel(d);
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) {
        this.lastUnlock = performance.now();
        this.mouseDown.clear();
      }
      this.onLockChange(this.locked);
    });
  }

  lock() {
    if (this.locked) return;
    // browsers refuse re-locking for ~1s after an Esc unlock
    if (performance.now() - this.lastUnlock < 1100) {
      setTimeout(() => this.lock(), 1150 - (performance.now() - this.lastUnlock));
      return;
    }
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* ignore */
    }
  }
  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  takeMouse(): [number, number] {
    const r: [number, number] = [this.dx, this.dy];
    this.dx = this.dy = 0;
    return r;
  }
  takePressed(): string[] {
    const r = this.pressedQ;
    this.pressedQ = [];
    return r;
  }
  takeMousePressed(): number[] {
    const r = this.mousePressedQ;
    this.mousePressedQ = [];
    return r;
  }
  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
  isDown(code: string) {
    return this.down.has(code);
  }
}
