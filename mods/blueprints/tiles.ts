// Block entities between this game and Java Edition: container contents, signs, spawners, command blocks,
// banners, jukeboxes and lecterns, written the way the target version expects (item stacks changed to
// "components" in 1.20.5, signs got two sides in 1.20, text stopped being JSON in 1.21.5). Whatever has no Java
// counterpart still rides along as the game's own JSON (`blueprints:tile`), so nothing is lost coming back here.
import type { ItemStack } from '../sdk';
import * as N from './nbt';
import type { Compound, Tag } from './nbt';
import { itemFromJava, itemToJava, itemForVersion } from './vanilla';

const DV_1_18 = 2825, DV_1_20 = 3463, DV_1_20_5 = 3837, DV_1_21_5 = 4325;
export const GAME_TAG = 'blueprints:tile';

type GameTile = Record<string, unknown> & { type: string };
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const PATTERNS: Record<string, string> = {
  b: 'base', bs: 'stripe_bottom', ts: 'stripe_top', ls: 'stripe_left', rs: 'stripe_right', cs: 'stripe_center', ms: 'stripe_middle',
  drs: 'stripe_downright', dls: 'stripe_downleft', ss: 'small_stripes', cr: 'cross', sc: 'straight_cross', ld: 'diagonal_left',
  rud: 'diagonal_right', lud: 'diagonal_up_left', rd: 'diagonal_up_right', vh: 'half_vertical', vhr: 'half_vertical_right',
  hh: 'half_horizontal', hhb: 'half_horizontal_bottom', bl: 'square_bottom_left', br: 'square_bottom_right', tl: 'square_top_left',
  tr: 'square_top_right', bt: 'triangle_bottom', tt: 'triangle_top', bts: 'triangles_bottom', tts: 'triangles_top', mc: 'circle',
  mr: 'rhombus', bo: 'border', cbo: 'curly_border', bri: 'bricks', gra: 'gradient', gru: 'gradient_up', cre: 'creeper', sku: 'skull',
  flo: 'flower', moj: 'mojang', glb: 'globe', pig: 'piglin',
};
const PATTERN_CODES = Object.fromEntries(Object.entries(PATTERNS).map(([a, b]) => [b, a]));

// ------------------------------------------------------------------ items
/** An item stack as a Java container slot. */
export function itemToNbt(s: ItemStack, slot: number, dv: number): Compound {
  const id = itemForVersion(itemToJava(s.id), dv);
  const ench = s.ench && Object.keys(s.ench).length ? s.ench : null;
  if (dv >= DV_1_20_5) {
    const comps: Record<string, Tag> = {};
    if (s.damage) comps['minecraft:damage'] = N.int(s.damage);
    if (ench) {
      const levels = N.comp(Object.fromEntries(Object.entries(ench).map(([k, l]) => [k.includes(':') ? k : 'minecraft:' + k, N.int(l)])));
      comps['minecraft:enchantments'] = dv >= DV_1_21_5 ? levels : N.comp({ levels });
    }
    if (s.name) comps['minecraft:custom_name'] = dv >= DV_1_21_5 ? N.str(s.name) : N.str(JSON.stringify({ text: s.name }));
    return N.comp({ Slot: N.byte(slot), id: N.str(id), count: N.int(s.count), components: Object.keys(comps).length ? N.comp(comps) : undefined });
  }
  const tag: Record<string, Tag> = {};
  if (s.damage) tag.Damage = N.int(s.damage);
  if (ench) tag.Enchantments = N.list('compound', Object.entries(ench).map(([k, l]) => N.comp({ id: N.str(k.includes(':') ? k : 'minecraft:' + k), lvl: N.short(l) })));
  if (s.name) tag.display = N.comp({ Name: N.str(JSON.stringify({ text: s.name })) });
  return N.comp({ Slot: N.byte(slot), id: N.str(id), Count: N.byte(s.count), tag: Object.keys(tag).length ? N.comp(tag) : undefined });
}

/** A Java item (any version's) as a stack here, and its slot; null for items this game doesn't have. */
export function itemFromNbt(t: Tag, dv: number): { slot: number; stack: ItemStack } | null {
  const id = itemFromJava(N.text(N.get(t, 'id')), dv);
  if (id === null) return null;
  const count = Math.max(1, Math.min(127, N.num(N.get(t, 'count'), N.num(N.get(t, 'Count'), 1))));
  const s: ItemStack = { id, count };
  const comps = N.compound(N.get(t, 'components')), tag = N.compound(N.get(t, 'tag'));
  const dmg = N.num(N.get(comps, 'minecraft:damage'), N.num(N.get(tag, 'Damage')));
  if (dmg > 0) s.damage = dmg;
  const ench: Record<string, number> = {};
  const ce = N.compound(N.get(comps, 'minecraft:enchantments'));
  const levels = N.compound(N.get(ce, 'levels')) ?? ce;
  if (levels) for (const [k, l] of Object.entries(levels.v)) if (k !== 'show_in_tooltip') ench[k.replace(/^minecraft:/, '')] = N.num(l);
  for (const e of N.items(N.get(tag, 'Enchantments'))) ench[N.text(N.get(e, 'id')).replace(/^minecraft:/, '')] = N.num(N.get(e, 'lvl'), 1);
  if (Object.keys(ench).length) s.ench = ench;
  const name = plainText(N.get(comps, 'minecraft:custom_name') ?? N.get(N.compound(N.get(tag, 'display')), 'Name'));
  if (name) s.name = name;
  return { slot: N.num(N.get(t, 'Slot'), -1), stack: s };
}

/** Text of a Java text component: JSON (before 1.21.5), plain NBT (since) or a bare string. */
export function plainText(t: Tag | undefined): string {
  if (!t) return '';
  if (t.t === 'string') {
    const s = t.v;
    if (!/^\s*[[{"]/.test(s)) return s;
    try { return jsonText(JSON.parse(s)); } catch { return s; }
  }
  return jsonText(N.toPlain(t));
}
function jsonText(j: unknown): string {
  if (typeof j === 'string') return j;
  if (Array.isArray(j)) return j.map(jsonText).join('');
  if (j && typeof j === 'object') {
    const o = j as { text?: unknown; extra?: unknown[]; translate?: string; '': unknown };
    return (typeof o.text === 'string' ? o.text : typeof o[''] === 'string' ? (o[''] as string) : o.translate ?? '') + (o.extra ?? []).map(jsonText).join('');
  }
  return '';
}
const textTag = (s: string, dv: number) => (dv >= DV_1_21_5 ? N.str(s) : N.str(JSON.stringify({ text: s })));

function slotsToNbt(list: unknown, dv: number): Tag {
  const out: Tag[] = [];
  if (Array.isArray(list)) list.forEach((s, i) => { if (s && typeof s === 'object' && (s as ItemStack).count > 0) out.push(itemToNbt(s as ItemStack, i, dv)); });
  return N.list('compound', out);
}
function slotsFromNbt(t: Tag | undefined, size: number, dv: number): (ItemStack | null)[] {
  const out: (ItemStack | null)[] = new Array(size).fill(null);
  for (const e of N.items(t)) {
    const r = itemFromNbt(e, dv);
    if (r && r.slot >= 0 && r.slot < size) out[r.slot] = r.stack;
  }
  return out;
}

// ------------------------------------------------------------------ block entities
/** Java's block entity id for a block (its Java name), or null if it has none. */
export function blockEntityId(block: string): string | null {
  const n = block.replace(/^minecraft:/, '');
  if (/shulker_box$/.test(n)) return 'minecraft:shulker_box';
  if (/_sign$/.test(n)) return 'minecraft:sign';
  if (/_banner$/.test(n)) return 'minecraft:banner';
  if (/(_skull|_head)$/.test(n)) return 'minecraft:skull';
  if (/_bed$/.test(n)) return 'minecraft:bed';
  if (n === 'spawner') return 'minecraft:mob_spawner';
  if (/command_block$/.test(n)) return 'minecraft:command_block';
  if (n === 'bee_nest') return 'minecraft:beehive';
  const same = ['chest', 'trapped_chest', 'barrel', 'hopper', 'dispenser', 'dropper', 'furnace', 'smoker', 'blast_furnace', 'brewing_stand', 'jukebox', 'lectern',
    'beacon', 'beehive', 'bell', 'campfire', 'soul_campfire', 'comparator', 'conduit', 'daylight_detector', 'enchanting_table', 'end_gateway', 'ender_chest',
    'end_portal', 'jigsaw', 'structure_block', 'piston'];
  return same.includes(n) ? 'minecraft:' + n : null;
}

/** A tile entity of this game as Java block entity data (without position) for block `block` (Java name). */
export function tileToNbt(t: GameTile, block: string, dv: number): Compound | null {
  const id = blockEntityId(block);
  const out: Record<string, Tag | undefined> = {};
  switch (t.type) {
    case 'chest': case 'hopper': case 'dispenser': case 'dropper':
      out.Items = slotsToNbt(t.items, dv);
      break;
    case 'furnace': out.Items = slotsToNbt(t.slots, dv); break;
    case 'brewing': {
      // here: three bottles, the ingredient, the fuel; Java: the same slots 0-4
      out.Items = slotsToNbt(t.items, dv);
      break;
    }
    case 'sign': {
      const lines = (Array.isArray(t.lines) ? t.lines : []).map((l) => String(l ?? '')).concat(['', '', '', '']).slice(0, 4);
      const color = COLORS[typeof t.color === 'number' ? t.color : 15] ?? 'black';
      if (dv >= DV_1_20) {
        const side = (ls: string[]) => N.comp({ messages: N.list('string', ls.map((l) => textTag(l, dv))), color: N.str(color), has_glowing_text: N.byte(0) });
        out.front_text = side(lines);
        out.back_text = side(['', '', '', '']);
        out.is_waxed = N.byte(0);
      } else {
        lines.forEach((l, i) => (out['Text' + (i + 1)] = N.str(JSON.stringify({ text: l }))));
        out.Color = N.str(color);
      }
      break;
    }
    case 'spawner': {
      const mob = String(t.mob ?? 'pig');
      const eid = mob.includes(':') ? mob : 'minecraft:' + mob.replace(/ /g, '_');
      out.SpawnData = dv >= DV_1_18 ? N.comp({ entity: N.comp({ id: N.str(eid) }) }) : N.comp({ id: N.str(eid) });
      out.Delay = N.short(typeof t.delay === 'number' ? t.delay : 20);
      break;
    }
    case 'command':
      out.Command = N.str(String(t.cmd ?? ''));
      out.auto = N.byte(t.auto ? 1 : 0);
      out.powered = N.byte(t.powered ? 1 : 0);
      out.TrackOutput = N.byte(1);
      out.SuccessCount = N.int(typeof t.success === 'number' ? t.success : 0);
      break;
    case 'banner': {
      const layers = Array.isArray(t.patterns) ? (t.patterns as { p: string; c: number }[]) : [];
      out[dv >= DV_1_20_5 ? 'patterns' : 'Patterns'] = N.list('compound', layers.map((l) => (dv >= DV_1_20_5
        ? N.comp({ pattern: N.str('minecraft:' + (PATTERNS[l.p] ?? l.p)), color: N.str(COLORS[l.c] ?? 'white') })
        : N.comp({ Pattern: N.str(l.p), Color: N.int(l.c) }))));
      break;
    }
    case 'jukebox':
      if (t.disc) out.RecordItem = itemToNbt(t.disc as ItemStack, 0, dv);
      break;
    case 'lectern': {
      const book = Array.isArray(t.items) ? (t.items[0] as ItemStack | null) : null;
      if (book) { out.Book = itemToNbt(book, 0, dv); out.Page = N.int(typeof t.page === 'number' ? t.page : 0); }
      break;
    }
  }
  if (!id && !Object.keys(out).length) return null;
  delete out.Slot;
  const c = N.comp(out);
  if (id) c.v.id = N.str(id);
  return c;
}

/**
 * Java block entity data as this game's tile for the block (packed value `v`, its Java name `block`), or null to
 * keep the tile the block gets anyway. `items` sizes come from the game's own containers.
 */
export function tileFromNbt(nbt: Compound, block: string, dv: number): GameTile | null {
  const n = block.replace(/^minecraft:/, '');
  const items = N.get(nbt, 'Items');
  if (n === 'chest' || n === 'trapped_chest' || n === 'barrel' || /shulker_box$/.test(n)) return { type: 'chest', items: slotsFromNbt(items, 27, dv) };
  if (n === 'hopper') return { type: 'hopper', items: slotsFromNbt(items, 5, dv), cooldown: 0 };
  if (n === 'dispenser' || n === 'dropper') return { type: n, items: slotsFromNbt(items, 9, dv) };
  if (n === 'furnace' || n === 'smoker' || n === 'blast_furnace') {
    const t: GameTile = { type: 'furnace', slots: slotsFromNbt(items, 3, dv), burn: 0, burnMax: 0, cook: 0 };
    if (n !== 'furnace') t.kind = n === 'smoker' ? 'smoker' : 'blast';
    return t;
  }
  if (n === 'brewing_stand') return { type: 'brewing', items: slotsFromNbt(items, 5, dv), brewTime: 0, fuel: N.num(N.get(nbt, 'Fuel')), ingredient: 0 };
  if (/_sign$/.test(n)) {
    const front = N.compound(N.get(nbt, 'front_text'));
    const lines = front ? N.items(N.get(front, 'messages')).map(plainText) : [1, 2, 3, 4].map((i) => plainText(N.get(nbt, 'Text' + i)));
    const color = COLORS.indexOf(N.text(N.get(front, 'color'), N.text(N.get(nbt, 'Color'), 'black')));
    const t: GameTile = { type: 'sign', lines: lines.concat(['', '', '', '']).slice(0, 4) };
    if (color >= 0 && color !== 15) t.color = color;
    return t;
  }
  if (n === 'spawner') {
    const sd = N.compound(N.get(nbt, 'SpawnData'));
    const eid = N.text(N.get(N.compound(N.get(sd, 'entity')), 'id'), N.text(N.get(sd, 'id'), N.text(N.get(nbt, 'EntityId'), 'minecraft:pig')));
    return { type: 'spawner', mob: eid.replace(/^minecraft:/, ''), delay: Math.max(1, N.num(N.get(nbt, 'Delay'), 200)) };
  }
  if (/command_block$/.test(n)) return { type: 'command', cmd: N.text(N.get(nbt, 'Command')), auto: N.num(N.get(nbt, 'auto')) !== 0, powered: false, success: 0, last: '' };
  if (/_banner$/.test(n)) {
    const list = N.items(N.get(nbt, 'patterns') ?? N.get(nbt, 'Patterns'));
    return {
      type: 'banner',
      patterns: list.map((l) => {
        const pat = N.text(N.get(l, 'pattern')).replace(/^minecraft:/, '');
        const c = N.get(l, 'color');
        return { p: pat ? PATTERN_CODES[pat] ?? pat : N.text(N.get(l, 'Pattern'), 'b'), c: c?.t === 'string' ? Math.max(0, COLORS.indexOf(c.v)) : N.num(N.get(l, 'Color')) };
      }),
    };
  }
  if (n === 'jukebox') {
    const r = N.get(nbt, 'RecordItem');
    const it = r ? itemFromNbt(r, dv) : null;
    return { type: 'jukebox', disc: it?.stack ?? null };
  }
  if (n === 'lectern') {
    const b = N.get(nbt, 'Book');
    const it = b ? itemFromNbt(b, dv) : null;
    return it ? { type: 'lectern', items: [it.stack], page: N.num(N.get(nbt, 'Page')) } : null;
  }
  return null;
}

/** The game's own tile JSON a file of ours carried, if it did. */
export function embeddedTile(nbt: Compound | undefined): GameTile | null {
  const s = N.text(N.get(nbt, GAME_TAG));
  if (!s) return null;
  try {
    const t = JSON.parse(s);
    return t && typeof t === 'object' && typeof t.type === 'string' ? t : null;
  } catch { return null; }
}
