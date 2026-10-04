// The spell catalogue, in the order the network numbers it: spelldefs.ts says what a spell is, catalog/*.ts defines
// them by type. Everything else imports spells from here.
import { S, type SpellType, type SpellDef } from './spelldefs.ts';
import './catalog/projectiles.ts';
import './catalog/statics.ts';
import './catalog/materials.ts';
import './catalog/modifiers.ts';
import './catalog/casting.ts';

export * from './spelldefs.ts';
export { NOTE_PITCH } from './catalog/casting.ts';
export { ORBITS } from './catalog/modifiers.ts';

export const SPELLS: readonly SpellDef[] = S;
export const SPELL_BY_ID = new Map(S.map((s) => [s.id, s]));
/** Network index of a spell (both sides run the same mod version). */
export const SPELL_INDEX = new Map(S.map((s, i) => [s.id, i]));
export const spellAt = (i: number) => S[i];

export const TYPE_ORDER: SpellType[] = ['projectile', 'static', 'modifier', 'multicast', 'material', 'other', 'utility', 'passive'];
export const TYPE_NAMES: Record<SpellType, string> = {
  projectile: 'Projectile', static: 'Static projectile', modifier: 'Projectile modifier', multicast: 'Multicast', material: 'Material', other: 'Other',
  utility: 'Utility', passive: 'Passive',
};
/** Card colours by type (frame, background), after Noita's card backs. */
export const TYPE_COLORS: Record<SpellType, [string, string]> = {
  projectile: ['#c04848', '#3a1414'],
  static: ['#e08030', '#3a2210'],
  modifier: ['#4a78e0', '#121c3a'],
  multicast: ['#40c0b0', '#0f2e2a'],
  material: ['#58b848', '#142a10'],
  other: ['#c8a040', '#2e2810'],
  utility: ['#b050e0', '#2a1238'],
  passive: ['#309058', '#0e2418'],
};
