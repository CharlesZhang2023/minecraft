import { device } from './device';

export interface Options {
  fov: number;
  renderDistance: number;
  sensitivity: number;
  guiScale: number; // 0 = auto
  viewBobbing: boolean;
  clouds: boolean;
  volume: number;
  music: number;
  gamma: number;
  invertY: boolean;
  difficulty: number;
  showFps: boolean;
  particles: number; // 0 all, 1 decreased, 2 minimal
  fancyLeaves: boolean;
  touchMove: 'dpad' | 'joystick'; // phones: Pocket Edition D-pad or a floating stick
  touchAim: 'touch' | 'crosshair'; // phones: act on what's under the finger, or on the crosshair ("split controls")
  touchSensX: number; // phones: look speed across, 0..1 like `sensitivity`
  touchSensY: number; // phones: look speed up and down, a little slower by default
  touchSwipeDown: boolean; // phones: swiping up drags the view down instead of looking up (like a mouse)
  playerName: string; // shown to other players in multiplayer, and the key their saved progress is kept under
}

export const DEFAULT_OPTIONS: Options = {
  fov: 70,
  renderDistance: 8,
  sensitivity: 0.5,
  guiScale: 0,
  viewBobbing: true,
  clouds: true,
  volume: 1,
  music: 0.5,
  gamma: 0.5,
  invertY: false,
  difficulty: 2,
  showFps: false,
  particles: 0,
  fancyLeaves: true,
  touchMove: 'dpad',
  touchAim: 'touch',
  touchSensX: 0.6,
  touchSensY: 0.55,
  touchSwipeDown: false,
  playerName: '',
};

/** A name for players who haven't picked one: Steve or Alex with a number. */
export function defaultName() {
  return (Math.random() < 0.5 ? 'Steve' : 'Alex') + (100 + Math.floor(Math.random() * 900));
}

/** Phones get lighter defaults: a shorter view distance, plain leaves, and a bit more look sensitivity. */
const TOUCH_DEFAULTS: Partial<Options> = { renderDistance: 5, fancyLeaves: false, particles: 1, sensitivity: 0.6 };

export function loadOptions(): Options {
  try {
    const s = localStorage.getItem('webcraft.options');
    if (s) {
      const o = { ...DEFAULT_OPTIONS, ...JSON.parse(s) } as Options;
      if (!o.playerName) { o.playerName = defaultName(); saveOptions(o); }
      return o;
    }
  } catch {
    /* storage unavailable */
  }
  const o = { ...DEFAULT_OPTIONS, ...(device.touch ? TOUCH_DEFAULTS : {}), playerName: defaultName() };
  saveOptions(o);
  return o;
}

export function saveOptions(o: Options) {
  try {
    localStorage.setItem('webcraft.options', JSON.stringify(o));
  } catch {
    /* ignore */
  }
}
