// The debug stick (1.13, creative): attacking a block picks the next of its properties, using it steps that
// property to its next value (sneaking: the previous one). The change is made without updating the neighbours, so
// states that couldn't normally stand stay put. Which property is picked for each kind of block lives on the stick.
import type { Game } from './game';
import type { Player } from './player';
import type { ItemStack } from './items';
import { BLOCKS, idOf } from '../world/blocks';
import { stateOf, stateValues, withState } from '../agent/blockspec';
import { tm } from '../i18n/i18n';

export function debugStick(g: Game, p: Player, s: ItemStack, x: number, y: number, z: number, use: boolean, back: boolean) {
  if (!p.creative) return;
  const w = g.world!, v = w.get(x, y, z), id = idOf(v);
  const name = 'minecraft:' + BLOCKS[id].name;
  const values = stateValues(id), keys = Object.keys(values);
  const say = (m: string) => g.ui.hud.actionBar(m);
  if (!keys.length) { say(tm('"{0}" has no properties', name)); return; }
  const picks = ((s.tag ??= {}).debug ??= {}) as Record<string, string>;
  let k = keys.includes(picks[name]) ? picks[name] : keys[0];
  if (!use) {
    // pick the next property (the first one if none was picked yet for this block)
    k = picks[name] && keys.includes(picks[name]) ? keys[(keys.indexOf(k) + (back ? keys.length - 1 : 1)) % keys.length] : keys[0];
    picks[name] = k;
    say(tm('selected "{0}" ({1})', k, String(stateOf(v)[k])));
    return;
  }
  picks[name] = k;
  const list = values[k], cur = list.indexOf(stateOf(v)[k]);
  for (let i = 1; i <= list.length; i++) {
    const val = list[(cur + (back ? -i : i) + list.length * 2) % list.length];
    const n = withState(v, k, val);
    if (n === null || n === v) continue;
    const t = g.ticker!;
    t.suppress = true;
    w.set(x, y, z, n);
    t.suppress = false;
    say(tm('"{0}" to {1}', k, String(val)));
    return;
  }
  say(tm('"{0}" to {1}', k, String(stateOf(v)[k])));
}
