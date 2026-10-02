// Device capabilities: touch vs. mouse mode, the pixel ratio used for the canvases, and the usable viewport.
// Touch mode is detected up front (coarse pointer) and follows the last input actually used, so hybrid
// laptops/tablets with a keyboard or mouse attached switch back and forth.

const q = new URLSearchParams(location.search);

function detect(): boolean {
  if (q.has('touch')) return q.get('touch') !== '0';
  try {
    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) return true;
    if (matchMedia('(pointer: coarse)').matches && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
    // iPadOS pretends to be a Mac
    if (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) && !matchMedia('(any-pointer: fine)').matches) return true;
  } catch {
    /* old browser */
  }
  return false;
}

/** The physical screen is upright. Asked of the screen, not the viewport, so an open soft keyboard doesn't flip it. */
function portraitScreen(): boolean {
  const t = screen.orientation?.type;
  return t ? t.startsWith('portrait') : screen.height > screen.width;
}

const listeners: (() => void)[] = [];
let touch = detect();
let lastTouch = -1e9;

export const device = {
  get touch() { return touch; },
  set touch(v: boolean) {
    if (v === touch) return;
    touch = v;
    for (const l of listeners) l();
  },
  /** Called when touch mode flips. */
  onChange(fn: () => void) { listeners.push(fn); },
  /** Mark that a touch just happened (browsers follow touches with emulated mouse events we must ignore). */
  touched() { lastTouch = performance.now(); },
  recentTouch() { return performance.now() - lastTouch < 700; },
  /** Device pixels per CSS pixel for the canvases; capped on phones to keep the fill rate sane. */
  ratio() {
    const dpr = window.devicePixelRatio || 1;
    return touch ? Math.min(dpr, 2) : dpr;
  },
  /**
   * The visible area. On touch devices this follows the visual viewport, which shrinks when the keyboard opens.
   * A phone held upright still plays in landscape: the canvases are turned a quarter clockwise (`rot`), so
   * `w`/`h` are the game's size and `sw` is the screen width the turned canvases are pushed across.
   */
  viewport() {
    const vv = touch ? window.visualViewport : null;
    const r = vv ? { x: vv.offsetLeft, y: vv.offsetTop, w: Math.round(vv.width), h: Math.round(vv.height) } : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    const rot = touch && portraitScreen();
    return rot ? { x: r.x, y: r.y, w: r.h, h: r.w, sw: r.w, rot } : { ...r, sw: r.w, rot };
  },
  /** Is the game drawn turned a quarter clockwise on a portrait screen? */
  get rotated() { return touch && portraitScreen(); },
  /** Try to really switch to landscape: fullscreen, then lock the orientation (Android; iOS has no lock). */
  landscape() {
    const so = screen.orientation as unknown as { lock?: (o: string) => Promise<void> } | undefined;
    const lock = () => so?.lock?.('landscape').catch(() => {});
    if (document.fullscreenElement || !document.fullscreenEnabled) { lock(); return; }
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(lock).catch(() => {});
  },
};
