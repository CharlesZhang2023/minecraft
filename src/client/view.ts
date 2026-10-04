// A mod taking over how the world is seen and played (top-down and strategy views, cutscenes): the camera, a
// free mouse pointer instead of the crosshair, how the movement keys walk the player and where the player aims.
// One view at a time, set with `mod.client.setView`; the game asks it at each point below and falls back to
// first-person play for anything it leaves out.
import type { Camera } from '../render/renderer';
import type { Client } from './client';

/** What the movement keys (or the stick) ask of the player this tick. */
export interface MoveInput { forward: number; strafe: number; jump: boolean; sneak: boolean; sprint: boolean }

/** Mouse or finger activity in the world (no screen open), in GUI units. */
export interface ViewPointer {
  type: 'down' | 'move' | 'up' | 'wheel' | 'cancel';
  x: number;
  y: number;
  /** Mouse button: 0 left, 1 middle, 2 right. Fingers are 0. */
  button: number;
  /** Wheel steps: +1 toward the player (zoom out), -1 away. */
  d: number;
  /** A finger's id (several can be down at once), or null for the mouse. */
  touch: number | null;
}

/** Where the player aims and which buttons it holds, instead of the crosshair and the mouse. */
export interface ViewAim {
  /** A unit direction from the player's eyes (the server picks the block or mob along it, within reach). */
  dir: { x: number; y: number; z: number } | null;
  /** Buttons held: 0 attacks and mines, 2 uses and places. */
  down: number[];
  /** Buttons pressed since the last tick (a click that's already let go still counts). */
  pressed: number[];
}

export interface ClientView {
  /** Change this frame's camera: position, `yaw`/`pitch` (radians), `fov`, or `ortho` for a flat projection. */
  camera?(cam: Camera, client: Client, partial: number): void;
  /** Draw our own player (third person, no hand). */
  showSelf?: boolean;
  /**
   * The pointer stays free: no pointer lock and no crosshair. Clicks, drags and the wheel in the world (and on
   * phones every touch that misses the game's buttons) go to `onPointer`.
   */
  freePointer?: boolean;
  onPointer?(e: ViewPointer, client: Client): void;
  /** A key pressed while playing, before the game's own keys: true if the view used it. */
  key?(e: KeyboardEvent, client: Client): boolean;
  /** Mouse-look movement (pointer locked, or a phone's look drag), instead of turning the player. */
  look?(dx: number, dy: number, client: Client): void;
  /** Turn the movement keys into the player's walking (for example relative to the camera, not the player). */
  move?(inp: MoveInput, client: Client): MoveInput;
  /** Where the player aims and what it presses, instead of the crosshair; null = aiming at nothing. */
  aim?(client: Client): ViewAim | null;
  /** 'none' hides the game's HUD (hotbar, health, crosshair) but keeps chat and messages. */
  hud?: 'normal' | 'none';
  /** Phones: keep the movement pad, jump button and hotbar (a character to walk). */
  touchPad?: boolean;
  /** Light the world up this much (0-1, like night vision) so a dark scene stays readable from above. */
  brightness?: number;
}
