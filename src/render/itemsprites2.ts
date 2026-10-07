// Item sprites for the 1.9 - 1.16 items. itemsprites.ts calls `paintItems2` with its own helpers once its sprites
// exist, so these can reuse them (recoloured boats, buckets with fish, potions, arrows...).
import { Img, RGB, newImg, hex, set, get, art, shade, S } from './pixels';
import { POTION_SPRITES } from '../game/potiondata';
import { DYE_COLORS } from '../world/blocks';

type Pal = Record<string, RGB | [number, number, number, number]>;
export interface SpriteKit {
  sprite(name: string, rows: string[], pal: Pal, outlineCol?: string): void;
  define(name: string, make: () => Img, outlineCol?: string): void;
  get(name: string): Img | null;
  potion(name: string, col: number, splash: boolean): void;
  bucket(name: string, fill?: string, fill2?: string): void;
}
const DYE_HEX = ['#f9fffe', '#f9801d', '#c74ebd', '#3ab3da', '#fed83d', '#80c71f', '#f38baa', '#474f52', '#9d9d97', '#169c9c', '#8932b8', '#3c44aa', '#835432', '#5e7c16', '#b02e26', '#1d1d21'];
const rgb = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** A copy of a sprite with some colours swapped (by closeness). */
function recolor(src: Img | null, map: [string, string][]): Img {
  const img = newImg();
  if (!src) return img;
  img.set(src);
  const pairs = map.map(([a, b]) => [hex(a), hex(b)] as const);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const c = get(img, x, y);
      if (!c[3]) continue;
      for (const [a, b] of pairs) if (Math.abs(c[0] - a[0]) + Math.abs(c[1] - a[1]) + Math.abs(c[2] - a[2]) < 40) { set(img, x, y, b, c[3]); break; }
    }
  return img;
}
/** Tint every opaque pixel toward a colour by its brightness. */
function tinted(src: Img | null, col: RGB, keepDark = 0.35): Img {
  const img = newImg();
  if (!src) return img;
  img.set(src);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const c = get(img, x, y);
      if (!c[3]) continue;
      const l = (c[0] + c[1] + c[2]) / 765;
      if (l < keepDark) continue;
      set(img, x, y, shade(col, 0.55 + l * 0.6), c[3]);
    }
  return img;
}

export function paintItems2(k: SpriteKit) {
  const { sprite, define } = k;
  // dyes: a little heap of powder in each colour
  DYE_COLORS.forEach((c, i) => {
    const L = hex(DYE_HEX[i]);
    sprite(`${c}_dye`, [
      '', '', '', '', '',
      '.......ll.......',
      '.....lLLLLl.....',
      '....lLLWLLLl....',
      '...lLLLLLLLLd...',
      '..lLLLWLLLLLLd..',
      '..LLLLLLLLLLDd..',
      '...dLLLLLLDDd...',
      '....ddDDDDdd....',
    ], { l: shade(L, 1.15), L, W: shade(L, 1.35), D: shade(L, 0.75), d: shade(L, 0.6) }, '#1a1a1a');
  });
  // netherite
  sprite('netherite_ingot', ['', '', '', '', '',
    '.....hhhhhhh....', '....hHHHHHHHd...', '...hHHHHHHHHd...', '..hHHHHHHHHd....', '..dddddddddd....'],
  { h: hex('#6e6668'), H: hex('#4a4446'), d: hex('#2a2426') }, '#141012');
  sprite('netherite_scrap', ['', '', '', '',
    '......hhh.......', '....hhHHHd......', '...hHHdHHHd.....', '...HHHHHdHHd....', '..hHdHHHHHHd....', '..HHHHHdHHHd....', '...dHHHHHHd.....', '....dddddd......'],
  { h: hex('#7a6058'), H: hex('#5a4840'), d: hex('#3a2a24') }, '#1a1210');
  // sticks with things on them
  for (const [name, top, top2] of [['warped_fungus_on_a_stick', '#167e86', '#2bb8a7'], ['carrot_on_a_stick', '#e8721a', '#f09a3a']] as const)
    sprite(name, ['', '',
      '..........sS....', '.........sS.l...', '........sS..l...', '.......sS...l...', '......sS....l...', '.....sS.....l...', '....sS......l...', '...sS.......cC..', '..sS........CCc.', '.sS.........cCC.', 'sS...........cc.'],
    { s: hex('#8a6b3c'), S: hex('#5c4424'), l: hex('#c8c8c8'), c: hex(top), C: hex(top2) }, '#2a1a0a');
  // the sea
  sprite('prismarine_shard', ['', '', '', '.........hH.....', '........hHHd....', '.......hHHHd....', '......hHHHd.....', '.....hHHHd......', '....hHHHd.......', '...hHHHd........', '...HHHd.........', '...Hdd..........'], { h: hex('#a8e0d0'), H: hex('#68b0a0'), d: hex('#3a7a6a') }, '#1a3a32');
  sprite('prismarine_crystals', ['', '', '', '....w....w......', '...wWw..wWw.....', '....w....w..w...', '......w.....wWw.', '.....wWw.....w..', '..w...w...w.....', '.wWw.....wWw....', '..w.......w.....'], { w: hex('#d8f8f0'), W: hex('#ffffff') });
  sprite('nautilus_shell', ['', '', '', '', '.....pppppp.....', '...pPPPPPPPPp...', '..pPPsssssPPPp..', '..PPsPPPPPsPPd..', '..PPsPssPPsPPd..', '..PPsPPPsPsPd...', '...dPssssPPd....', '....dddddd......'], { p: hex('#f0e0d0'), P: hex('#e0c8b0'), s: hex('#b08a6a'), d: hex('#a07a5a') }, '#4a3a2a');
  sprite('heart_of_the_sea', ['', '', '', '.....bbbbbb.....', '....bBBBBBBb....', '...bBBwBBBBBb...', '...BBwwBBBBBd...', '...BBBBBBBBBd...', '...dBBBBBBBdd...', '....dBBBBBdd....', '.....dddddd.....'], { b: hex('#4a9ae0'), B: hex('#2a6ac0'), w: hex('#d0f0ff'), d: hex('#1a3a80') }, '#0a1a40');
  sprite('scute', ['', '', '', '', '....gggggggg....', '...gGGGGGGGGg...', '..gGGgGGGGgGGg..', '..GGGGGGGGGGGG..', '..dGGGgGGgGGGd..', '...dGGGGGGGGd...', '....dddddddd....'], { g: hex('#6ab84a'), G: hex('#4a9a2a'), d: hex('#2a6a14') }, '#143a08');
  sprite('turtle_helmet', ['', '', '', '', '', '...hhhhhhhhhh...', '..hHHGHHHHGHHd..', '..HHGGHHHHGGHd..', '..HHd......HHd..', '..HHd......HHd..', '..dd........dd..'], { h: hex('#7ac85a'), H: hex('#4a9a2a'), G: hex('#2a6a14'), d: hex('#1e5010') }, '#0e2808');
  sprite('trident', ['', 'p.p.p...........', 'pPpPp...........', '.pPp............', '..pP............', '...sS...........', '....sS..........', '.....sS.........', '......sS........', '.......sS.......', '........sS......', '.........sS.....', '..........sS....', '...........sS...', '............sS..', '.............ss.'], { p: hex('#7ad8c8'), P: hex('#4aa898'), s: hex('#5a9a8a'), S: hex('#3a7a6a') }, '#14322a');
  sprite('dried_kelp', ['', '', '', '', '', '.....kkkk.......', '....kKKKKk......', '...kKkKKkKk.....', '...kKKKKKKk.....', '....kKkKKk......', '.....kkkk.......'], { k: hex('#2a3418'), K: hex('#4a5428') }, '#101408');
  for (const [name, f1, f2] of [['cod_bucket', '#b89a6a', '#d8ba8a'], ['salmon_bucket', '#a84a3a', '#c86a4a'], ['pufferfish_bucket', '#e8c82a', '#f8e04a'], ['tropical_fish_bucket', '#e86a2a', '#f8f8f8']] as const) k.bucket(name, f1, f2);
  sprite('phantom_membrane', ['', '', '', '...mm...........', '..mMMm..........', '..mMMMmm........', '...mMMMMmm......', '....mMMMMMmm....', '.....mmMMMMMm...', '.......mmMMMm...', '.........mmm....'], { m: hex('#c8c0a8'), M: hex('#e8e0c8') }, '#5a5448');
  // the End
  sprite('chorus_fruit', ['', '', '', '', '.....cccc.......', '....cCCCCc......', '...cCcCCcCc.....', '...cCCCCCCc.....', '...cCcCCcCc.....', '....cCCCCc......', '.....cccc.......'], { c: hex('#7a5a7a'), C: hex('#a07aa0') }, '#2a1a2a');
  sprite('popped_chorus_fruit', ['', '', '', '', '.....cccc.......', '....cCCCCc......', '...cCwCCwCc.....', '...cCCCCCCc.....', '...cwCCCCwc.....', '....cCCCCc......', '.....cccc.......'], { c: hex('#b08ab0'), C: hex('#d0a8d0'), w: hex('#f8e8f8') }, '#3a2a3a');
  sprite('shulker_shell', ['', '', '', '', '...pppppppppp...', '..pPPPPPPPPPPp..', '..PPPPPPPPPPPP..', '..PPdddddddPPP..', '..Pd.......dPP..', '..d.........dd..'], { p: hex('#b08ab0'), P: hex('#8a6a8a'), d: hex('#5a3a5a') }, '#2a1a2a');
  k.potion('dragon_breath', 0xc050c0, false);
  // combat
  sprite('shield', ['', '..hhhhhhhhhhhh..', '..hWWWWWWWWWWd..', '..hWwwwwwwwWWd..', '..hWwwwwwwwwWd..', '..hWwwwiiwwwWd..', '..hWwwwiiwwwWd..', '..hWwwwwwwwwWd..', '..hWwwwwwwwwWd..', '...hWwwwwwwWd...', '...hWWwwwwWWd...', '....hWWWWWWd....', '.....hhhhdd.....'], { h: hex('#c8c8c8'), W: hex('#8a6a3a'), w: hex('#a0804a'), i: hex('#a8a8a8'), d: hex('#5a5a5a') }, '#2a2a2a');
  sprite('crossbow', ['', 'llll............', 'lsSl............', 'l.sSl...........', 'l..sSl..........', '.l..sSl.........', '..l..sSs........', '...l..sSs.......', '....lllsSs......', '........sSs.....', '........isSs....', '.........iSs....', '..........ii....'], { l: hex('#c8c8c8'), s: hex('#8a6a3a'), S: hex('#5c4424'), i: hex('#8a8a8a') }, '#1a1a1a');
  sprite('totem_of_undying', ['', '.....gggggg.....', '....gGGGGGGg....', '....gGkGGkGg....', '....gGGGGGGg....', '...gggGeeGggg...', '..gGGgGGGGgGGg..', '..g..gGGGGg..g..', '.....gGGGGg.....', '.....gGggGg.....', '.....gg..gg.....', '.....gg..gg.....'], { g: hex('#c89a2a'), G: hex('#f0c84a'), k: hex('#2a8a2a'), e: hex('#8a5a1a') }, '#4a3a0a');
  define('spectral_arrow', () => recolor(k.get('arrow'), [['#8a8a8a', '#d8b840'], ['#d8d8d8', '#f8e870'], ['#f0f0f0', '#f8f0a0']]));
  for (const [key, col] of Object.entries(POTION_SPRITES)) {
    define('tipped_arrow_' + key, () => recolor(k.get('arrow'), [['#8a8a8a', '#' + shade(rgb(col), 0.7).map((v) => v.toString(16).padStart(2, '0')).join('')], ['#d8d8d8', '#' + rgb(col).map((v) => v.toString(16).padStart(2, '0')).join('')]]));
    define('lingering_potion_' + key, () => {
      const img = newImg();
      const s = k.get('splash_potion_' + key);
      if (s) img.set(s);
      for (let x = 6; x < 10; x++) set(img, x, 1, hex('#c8c8d8'));
      return img;
    });
  }
  // food and farming
  sprite('beetroot', ['', '.....g..g.......', '......gg........', '.......g........', '.....rrrr.......', '....rRRRRr......', '...rRRRRRRr.....', '...rRRwRRRr.....', '...rRRRRRRr.....', '....rRRRRr......', '.....rrRr.......', '.......r........'], { g: hex('#3a8a1a'), r: hex('#6a1a2a'), R: hex('#9a2a3a'), w: hex('#c84a5a') }, '#2a0a10');
  sprite('beetroot_seeds', ['', '', '', '', '', '....s...........', '...sS....s......', '.........Ss.....', '......s.........', '.....sS.....s...', '............Ss..'], { s: hex('#c8b86a'), S: hex('#a8984a') });
  sprite('beetroot_soup', ['', '', '', '', '', '', '..rrrrrrrrrrrr..', '..bRRRRRRRRRRb..', '...bBBBBBBBBb...', '....bBBBBBBb....', '.....bbbbbb.....'], { r: hex('#8a1a2a'), R: hex('#a82a3a'), b: hex('#5a3a1a'), B: hex('#7a5a2a') }, '#2a1a0a');
  sprite('melon_seeds', ['', '', '', '', '', '....s...........', '...sS....s......', '.........Ss.....', '......s.........', '.....sS.....s...', '............Ss..'], { s: hex('#3a2a1a'), S: hex('#1a1208') });
  sprite('sweet_berries', ['', '', '', '.......g........', '......gG..g.....', '.....rR.gG......', '....rRRr.rR.....', '....rRRrrRRr....', '.....rr.rRRr....', '.........rr.....'], { g: hex('#3a6a1a'), G: hex('#4a8a2a'), r: hex('#8a1a1a'), R: hex('#c82a2a') }, '#2a0a0a');
  sprite('honey_bottle', ['', '.......cc.......', '......gccg......', '.......gg.......', '......gHHg......', '......gHHg......', '.....gHHHHg.....', '....gHhHHHHg....', '...gHhHHHHHDg...', '...gHHHHHHHDg...', '...gHHHHHHDDg...', '....gHHHHDDg....', '.....gggggg.....'], { c: hex('#8a6035'), g: hex('#e8e0c8'), H: hex('#f0a020'), h: hex('#f8d070'), D: hex('#c87810') }, '#4a3a1a');
  sprite('honeycomb', ['', '', '', '....hhhhhh......', '...hHHhHHHh.....', '..hHhHHhHHHh....', '..hHHhHHhHHh....', '..hHhHHhHHhh....', '...hHHhHHHh.....', '....hhhhhh......'], { h: hex('#c88010'), H: hex('#f4b030') }, '#4a2a08');
  sprite('pumpkin_pie', ['', '', '', '', '', '...cccccccccc...', '..cOOOOOOOOOOc..', '..cOoOOoOOoOOc..', '..cOOOOOOOOOOc..', '...cccccccccc...'], { c: hex('#c8a060'), O: hex('#e07a2a'), o: hex('#f0a050') }, '#4a2a0a');
  sprite('cake', ['', '', '', '', '', '...wwwwwwwwww...', '..wWWrWWWWrWWw..', '..wWWWWWWWWWWw..', '..ccccccccccccc.', '..cCCCCCCCCCCCc.', '..cCCCCCCCCCCCc.', '...ccccccccccc..'], { w: hex('#f0e8e0'), W: hex('#ffffff'), r: hex('#d82a2a'), c: hex('#a07a4a'), C: hex('#c09a6a') }, '#4a3a2a');
  define('rabbit', () => recolor(k.get('chicken'), [['#f0b0a0', '#e8a090'], ['#e8c8b8', '#d8a898']]));
  define('cooked_rabbit', () => recolor(k.get('cooked_chicken'), [['#c87a40', '#a85a2a']]));
  define('rabbit_stew', () => recolor(k.get('mushroom_stew'), [['#c8a07a', '#a8703a'], ['#e0c098', '#c08850']]));
  sprite('rabbit_foot', ['', '', '', '.....ff.........', '....fFFf........', '....fFFf........', '.....fFf........', '.....fFFf.......', '.....fFFFf......', '......fFFFff....', '.......ffff.....'], { f: hex('#c8a87a'), F: hex('#e8d0a8') }, '#3a2a1a');
  sprite('rabbit_hide', ['', '', '', '...hhhhhhhh.....', '..hHHHHHHHHh....', '..hHhHHHHHHh....', '..hHHHHhHHHh....', '..hHHHHHHHHh....', '...hhHHHHhh.....', '.....hhhh.......'], { h: hex('#a8885a'), H: hex('#c8a87a') }, '#3a2a1a');
  define('poisonous_potato', () => recolor(k.get('potato'), [['#c8a64a', '#a8b84a'], ['#d8b85a', '#b8c85a']]));
  define('enchanted_golden_apple', () => { const img = newImg(); const s = k.get('golden_apple'); if (s) img.set(s); for (const [x, y] of [[4, 5], [9, 7], [6, 10], [11, 4]]) set(img, x, y, hex('#f8c0ff')); return img; });
  define('suspicious_stew', () => recolor(k.get('mushroom_stew'), [['#c8a07a', '#a0a05a']]));
  // materials and tools
  sprite('iron_nugget', ['', '', '', '', '', '......hh........', '.....hHHd.......', '....hHHHHd......', '.....dHHd.......', '......dd........'], { h: hex('#f0f0f0'), H: hex('#c8c8c8'), d: hex('#8a8a8a') }, '#2a2a2a');
  define('experience_bottle', () => tinted(k.get('glass_bottle'), hex('#8ae84a'), 0.2));
  sprite('lead', ['', '', '..lll...........', '.l...l..........', '.l...l..........', '..lll.l.........', '.......l........', '........l.......', '.........l......', '..........l.....', '...........lll..', '...........l.l..', '...........lll..'], { l: hex('#a8885a') }, '#3a2a1a');
  define('leather_horse_armor', () => recolor(k.get('iron_horse_armor'), [['#e8e8e8', '#c78452'], ['#b8b8b8', '#a0663a'], ['#707070', '#6b4222']]));
  sprite('item_frame', ['', '.ffffffffffffff.', '.fFFFFFFFFFFFFf.', '.fFllllllllllFf.', '.fFllllllllllFf.', '.fFllllllllllFf.', '.fFllllllllllFf.', '.fFllllllllllFf.', '.fFllllllllllFf.', '.fFllllllllllFf.', '.fFFFFFFFFFFFFf.', '.ffffffffffffff.'], { f: hex('#6b5130'), F: hex('#a0804a'), l: hex('#c8a87a') }, '#2a1a0a');
  sprite('painting', ['', '.ffffffffffffff.', '.fsssssssssssssf', '.fsssyyssssssssf', '.fssyyyysssssssf', '.fsssyysssggsssf', '.fssssssggggsssf', '.fgggggggggggggf', '.fgGGgggGGgggGgf', '.fggggggggggggg.f'.slice(0, 16), '.ffffffffffffff.'], { f: hex('#6b5130'), s: hex('#7ab0e0'), y: hex('#f8e040'), g: hex('#4a9a2a'), G: hex('#3a7a1a') }, '#2a1a0a');
  sprite('armor_stand', ['', '.......ww.......', '......wWWw......', '.......ww.......', '...wwwwwwwwww...', '.......ww.......', '.......ww.......', '.....wwwwww.....', '.......ww.......', '......w..w......', '......w..w......', '....ssssssss....'], { w: hex('#a0804a'), W: hex('#c8a87a'), s: hex('#8a8a8a') }, '#2a1a0a');
  const cart = k.get('minecart');
  for (const [name, fill] of [['chest_minecart', ['#9c6b30', '#7a5020']], ['furnace_minecart', ['#6b6b6b', '#4a4a4a']], ['hopper_minecart', ['#4a4a4a', '#2a2a2a']], ['tnt_minecart', ['#c82a2a', '#f0f0f0']]] as const)
    define(name, () => {
      const img = newImg();
      if (cart) img.set(cart);
      for (let y = 3; y < 7; y++) for (let x = 4; x < 12; x++) set(img, x, y, hex(y === 5 ? fill[1] : fill[0]));
      return img;
    });
  sprite('map', ['', '.pppppppppppppp.', '.pPPPPPPPPPPPPp.', '.pPPPPPPPPPPPPp.', '.pPPPPPPPPPPPPp.', '.pPPPPPPPPPPPPp.', '.pPPPPPPPPPPPPp.', '.pPPPPPPPPPPPPp.', '.pPPPPPPPPPPPPp.', '.pPPPPPPPPPPPPp.', '.pPPPPPPPPPPPPp.', '.pppppppppppppp.'], { p: hex('#c8b890'), P: hex('#e8dcb8') }, '#4a3a2a');
  sprite('filled_map', ['', '.pppppppppppppp.', '.pPPgggPPPPbbPp.', '.pPgggggPPbbbPp.', '.pPPggPPPbbbbPp.', '.pPPPPPrPPbbPPp.', '.pPPPPrrrPPPPPp.', '.pggPPPrPPPgggp.', '.pgggPPPPPggggp.', '.pPggPPbbPPggPp.', '.pPPPPbbbbPPPPp.', '.pppppppppppppp.'], { p: hex('#c8b890'), P: hex('#e8dcb8'), g: hex('#6a9a4a'), b: hex('#4a7ab0'), r: hex('#c82a2a') }, '#4a3a2a');
  define('writable_book', () => { const img = newImg(); const s = k.get('book'); if (s) img.set(s); for (let i = 0; i < 8; i++) set(img, 6 + i, 1 + i, i < 2 ? hex('#2a2a2a') : hex('#f0f0f0')); return img; });
  define('unused_item_1', () => newImg());
  define('unused_item_2', () => newImg());
  sprite('ominous_banner', ['.ss.............', '.sWWWWWWWWW.....', '.sWWWWWWWWW.....', '.sWbbWWWbbW.....', '.sWbkbbbkbW.....', '.sWWbbbbbWW.....', '.sWWbkkkbWW.....', '.sWWWbbbWWW.....', '.sWWbbkbbWW.....', '.sWWWbbbWWW.....', '.sWWWWWWWWW.....', '.sWgWgWgWgW.....', '.sWWWWWWWWW.....', '.s..............', '.s..............', '.s..............'], { s: hex('#6a4a2a'), W: hex('#e8e8e0'), b: hex('#1a8a8a'), k: hex('#1a1a1a'), g: hex('#c8a040') });
  sprite('nether_star', ['', '.......w........', '......wWw.......', '......wWw.......', '..ww.wWWWw.ww...', '...wWWWyWWWw....', '....wWyyyWw.....', '.....wWyWw......', '....wWWwWWw.....', '...wWw...wWw....', '..ww.......ww...'], { w: hex('#d8e0f0'), W: hex('#ffffff'), y: hex('#f8f0a0') }, '#4a4a6a');
  // boats in every wood
  const BOAT_WOOD: Record<string, [string, string]> = { spruce: ['#5a4024', '#3e2d17'], birch: ['#c8b077', '#9a8757'], jungle: ['#a0734d', '#5f4027'], acacia: ['#ad5d32', '#7a3e1f'], dark_oak: ['#442d14', '#2d1d0c'] };
  for (const [w, [a, b]] of Object.entries(BOAT_WOOD)) define(`${w}_boat`, () => recolor(k.get('oak_boat'), [['#a2824e', a], ['#9f844d', a], ['#b8945f', a], ['#6b5130', b], ['#c29d62', a]]));
  // music discs: a black disc with a coloured label
  const DISC_COL: Record<string, string> = { '13': '#e8d040', cat: '#4ad04a', blocks: '#e86a2a', chirp: '#c83a3a', far: '#8ae84a', mall: '#8a4ae8', mellohi: '#c8a0e8', stal: '#2a2a2a', strad: '#f0f0f0', ward: '#3a8a3a', '11': '#5a5a5a', wait: '#4a8ae8', pigstep: '#c8662a' };
  for (const [n, c] of Object.entries(DISC_COL)) sprite(`music_disc_${n}`, ['', '', '.....kkkkkk.....', '...kkKKKKKKkk...', '..kKKkkkkkkKKk..', '..kKkKKKKKKkKk..', '.kKkKKllllKKkKk.', '.kKkKlLLLLlKkKk.', '.kKkKlLooLlKkKk.', '.kKkKlLLLLlKkKk.', '.kKkKKllllKKkKk.', '..kKkKKKKKKkKk..', '..kKKkkkkkkKKk..', '...kkKKKKKKkk...', '.....kkkkkk.....'], { k: hex('#1a1a1a'), K: hex('#2e2e2e'), l: shade(hex(c), 0.8), L: hex(c), o: hex('#000000') });
  void art;
}
