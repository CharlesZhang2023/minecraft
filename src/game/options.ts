import { device } from './device';
import type { GfxChoice } from '../render/backend';

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
  skin: string; // a built-in skin's id, or 'custom' for the imported one below
  customSkin: string; // an imported skin as a 64x64 PNG data URL ('' = none)
  customSlim: boolean; // the imported skin has slim (3-pixel) arms
  lod: boolean; // distant terrain: low-detail land out past the render distance
  lodDistance: number; // how far it reaches, in chunks
  lodQuality: number; // 0 low, 1 medium, 2 high: how soon detail falls off with distance
  gfx: GfxChoice; // what draws the world: WebGPU when there is one ('auto'), or WebGL 2; read at start-up
  resourcePacks: string[]; // resource packs in use, by id, the first winning
  shaderPack: string; // the shader pack in use ('' = none)
  shaderSettings: Record<string, Record<string, boolean | number>>; // each shader pack's settings, by pack id
  language: string; // the game's language (src/i18n): 'en_us', 'zh_cn' or 'zh_tw'
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
  skin: 'steve',
  customSkin: '',
  customSlim: false,
  lod: !device.touch,
  lodDistance: 64,
  lodQuality: 1,
  gfx: 'auto',
  resourcePacks: [],
  shaderPack: '',
  shaderSettings: {},
  language: 'en_us',
};

/** A name for players who haven't picked one: Steve or Alex with a number. */
export function defaultName() {
  return (Math.random() < 0.5 ? 'Steve' : 'Alex') + (100 + Math.floor(Math.random() * 900));
}

/** Alexes start out looking like Alex, everyone else like Steve. */
function defaultSkin(name: string) {
  return /^alex/i.test(name) ? 'alex' : 'steve';
}

/** The skin we wear: a built-in id or the imported PNG, and whether its arms are slim. */
export function myLook(o: Options): { look: string; slim: boolean } {
  if (o.skin === 'custom' && o.customSkin) return { look: o.customSkin, slim: o.customSlim };
  return { look: o.skin === 'custom' ? 'steve' : o.skin, slim: false };
}

/** Phones get lighter defaults: a shorter view distance, plain leaves, and a bit more look sensitivity. */
const TOUCH_DEFAULTS: Partial<Options> = { renderDistance: 5, fancyLeaves: false, particles: 1, sensitivity: 0.6, lodDistance: 32 };

export function loadOptions(): Options {
  try {
    const s = localStorage.getItem('webcraft.options');
    if (s) {
      const o = { ...DEFAULT_OPTIONS, ...JSON.parse(s) } as Options;
      if (!o.playerName) { o.playerName = defaultName(); saveOptions(o); }
      if (!JSON.parse(s).skin) { o.skin = defaultSkin(o.playerName); saveOptions(o); }
      return o;
    }
  } catch {
    /* storage unavailable */
  }
  const name = defaultName();
  const o = { ...DEFAULT_OPTIONS, ...(device.touch ? TOUCH_DEFAULTS : {}), playerName: name, skin: defaultSkin(name) };
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
