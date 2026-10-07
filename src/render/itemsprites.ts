// 16x16 item sprites as hand-authored pixel art. Outlines are added automatically.
import { OVERRIDES, small } from './overrides';
import { Img, RGB, newImg, hex, set, get, art, shade, S } from './pixels';
import { POTION_SPRITES } from '../game/potiondata';
import { SPAWN_EGGS, EXTRA_EGGS, EXTRA_EGGS2, EXTRA_EGGS3, EXTRA_EGGS4, EXTRA_EGGS5 } from '../game/items';
import { paintItems2 } from './itemsprites2';

type Pal = Record<string, RGB | [number, number, number, number]>;
const sprites: Record<string, () => Img> = {};

function outline(img: Img, col: RGB) {
  const mask = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) mask[i] = img[i * 4 + 3] > 0 ? 1 : 0;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (mask[y * S + x]) continue;
      const n = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < S && yy < S && mask[yy * S + xx] === 1;
      if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) set(img, x, y, col);
    }
}
function sprite(name: string, rows: string[], pal: Pal, outlineCol?: string) {
  sprites[name] = () => {
    const img = newImg();
    art(img, rows, pal);
    if (outlineCol) outline(img, hex(outlineCol));
    return img;
  };
}

// ------------------------------------------------------------------ tools
const STICK: Pal = { s: hex('#8a6b3c'), S: hex('#5c4424') };
const TOOL_MATS: Record<string, { H: string; h: string; d: string; o: string }> = {
  wooden: { H: '#9f844d', h: '#c29d62', d: '#6b5130', o: '#3b2a15' },
  stone: { H: '#8a8a8a', h: '#aaaaaa', d: '#5f5f5f', o: '#2e2e2e' },
  iron: { H: '#d8d8d8', h: '#ffffff', d: '#a8a8a8', o: '#3f3f3f' },
  golden: { H: '#f5cc27', h: '#fffcb8', d: '#c29b10', o: '#5a4200' },
  diamond: { H: '#33ebcb', h: '#b8fff4', d: '#1a9b93', o: '#0c3d3a' },
  netherite: { H: '#4a4446', h: '#6e6668', d: '#2e2a2c', o: '#120f10' },
};
const TOOL_ART: Record<string, string[]> = {
  pickaxe: [
    '................',
    '................',
    '...hhhhHH.......',
    '..hHHHHHHHd.....',
    '...dd..sSHHd....',
    '......sS..dHd...',
    '.....sS....dHd..',
    '....sS......HHd.',
    '...sS.......dHd.',
    '..sS.........Hd.',
    '.sS..........Hd.',
    'sS...........dd.',
    'S...............',
    '................',
    '................',
    '................',
  ],
  axe: [
    '................',
    '................',
    '......hH........',
    '.....hHHH.......',
    '....hHHHHH......',
    '....HHHHsSd.....',
    '.....dHsS.......',
    '......sS........',
    '.....sS.........',
    '....sS..........',
    '...sS...........',
    '..sS............',
    '.sS.............',
    'sS..............',
    '................',
    '................',
  ],
  shovel: [
    '................',
    '...........hH...',
    '..........hHHH..',
    '.........hHHHHd.',
    '..........HHHd..',
    '.........sSdd...',
    '........sS......',
    '.......sS.......',
    '......sS........',
    '.....sS.........',
    '....sS..........',
    '...sS...........',
    '..sS............',
    '.sS.............',
    '................',
    '................',
  ],
  hoe: [
    '................',
    '................',
    '.......hhHH.....',
    '......hHHdsS....',
    '...........sS...',
    '..........sS....',
    '.........sS.....',
    '........sS......',
    '.......sS.......',
    '......sS........',
    '.....sS.........',
    '....sS..........',
    '...sS...........',
    '..sS............',
    '................',
    '................',
  ],
  sword: [
    '................',
    '.............hH.',
    '............hHd.',
    '...........hHd..',
    '..........hHd...',
    '.........hHd....',
    '........hHd.....',
    '.......hHd......',
    '..gg..hHd.......',
    '...gghHd........',
    '....gHd.........',
    '...sSgg.........',
    '..sS..gg........',
    '.sS.............',
    '................',
    '................',
  ],
};
for (const [mat, c] of Object.entries(TOOL_MATS))
  for (const [kind, rows] of Object.entries(TOOL_ART))
    sprite(`${mat}_${kind}`, rows, { ...STICK, H: hex(c.H), h: hex(c.h), d: hex(c.d), g: hex(mat === 'wooden' ? '#6b5130' : '#4a3a24') }, c.o);

// ------------------------------------------------------------------ armor
const ARMOR_MATS: Record<string, { H: string; h: string; d: string; o: string }> = {
  leather: { H: '#a0663a', h: '#c78452', d: '#6b4222', o: '#2e1c0d' },
  iron: TOOL_MATS.iron,
  golden: TOOL_MATS.golden,
  diamond: TOOL_MATS.diamond,
  netherite: TOOL_MATS.netherite,
  chainmail: { H: '#8a8a8a', h: '#c4c4c4', d: '#4a4a4a', o: '#1a1a1a' },
};
const ARMOR_ART: Record<string, string[]> = {
  helmet: [
    '................', '................', '................', '................',
    '...hhhhhhhhhh...', '..hHHHHHHHHHHd..', '..HHHHHHHHHHHd..', '..HHd......HHd..',
    '..HHd......HHd..', '..dd........dd..', '................', '................',
  ],
  chestplate: [
    '................', '..hhh......hhh..', '.hHHHh....hHHHd.', '.HHHHHhhhhHHHHd.',
    '.HHHHHHHHHHHHHd.', '.ddHHHHHHHHHHdd.', '...HHHHHHHHHd...', '...HHHHHHHHHd...',
    '...HHHHHHHHHd...', '...HHHHHHHHHd...', '...HHHHHHHHHd...', '...dddddddddd...',
  ],
  leggings: [
    '................', '...hhhhhhhhhh...', '...HHHHHHHHHd...', '...HHHHHHHHHd...',
    '...HHHd..HHHd...', '...HHHd..HHHd...', '...HHHd..HHHd...', '...HHHd..HHHd...',
    '...HHHd..HHHd...', '...HHHd..HHHd...', '...HHHd..HHHd...', '...ddd....ddd...',
  ],
  boots: [
    '................', '................', '................', '................',
    '................', '...hHd....hHd...', '...HHd....HHd...', '...HHd....HHd...',
    '..hHHd...hHHd...', '.hHHHd..hHHHd...', '.HHHHd..HHHHd...', '.ddddd..ddddd...',
  ],
};
for (const [mat, c] of Object.entries(ARMOR_MATS))
  for (const [kind, rows] of Object.entries(ARMOR_ART))
    sprite(`${mat}_${kind}`, ['', '', ...rows], { H: hex(c.H), h: hex(c.h), d: hex(c.d) }, c.o);

// ------------------------------------------------------------------ materials
sprite('stick', [
  '', '', '',
  '............sS..',
  '...........sS...',
  '..........sS....',
  '.........sS.....',
  '........sS......',
  '.......sS.......',
  '......sS........',
  '.....sS.........',
  '....sS..........',
  '...sS...........',
], STICK, '#2b1d0e');
const lump = [
  '', '', '', '',
  '.......kk.......',
  '.....kKKKk......',
  '....kKLKKKkk....',
  '....KKKKKKKKk...',
  '...kKKKKLKKKK...',
  '...KKKKKKKKKk...',
  '...kKKKKKKKK....',
  '....kKKKKKk.....',
  '......kkk.......',
];
sprite('coal', lump, { k: hex('#1a1a1a'), K: hex('#2e2e2e'), L: hex('#505050') }, '#0a0a0a');
sprite('charcoal', lump, { k: hex('#2a2218'), K: hex('#3e3226'), L: hex('#5e5040') }, '#120d08');
const ingot = [
  '', '', '', '', '',
  '.......hhhhhh...',
  '.....hhHHHHHd...',
  '...hhHHHHHHd....',
  '..hHHHHHHHdd....',
  '..HHHHHHHd......',
  '..ddddddd.......',
];
sprite('iron_ingot', ingot, { h: hex('#ffffff'), H: hex('#d8d8d8'), d: hex('#8a8a8a') }, '#353535');
sprite('gold_ingot', ingot, { h: hex('#fffcb8'), H: hex('#f5cc27'), d: hex('#b8860b') }, '#4a3500');
sprite('brick', ingot, { h: hex('#c46a4a'), H: hex('#a0503a'), d: hex('#6b3020') }, '#2e140c');
const gem = [
  '', '', '', '',
  '.....hhhhhh.....',
  '....hHHHHHHd....',
  '...hHWHHHHHHd...',
  '...HHHHHHHHHd...',
  '....dHHHHHHd....',
  '.....dHHHHd.....',
  '......dHHd......',
  '.......dd.......',
];
sprite('diamond', gem, { h: hex('#d5fffa'), H: hex('#4aedd9'), W: hex('#ffffff'), d: hex('#1a9b93') }, '#0c3d3a');
sprite('emerald', gem, { h: hex('#b8ffcf'), H: hex('#17dd62'), W: hex('#ffffff'), d: hex('#00872b') }, '#00361a');
const dust = [
  '', '', '', '', '', '', '',
  '.......r........',
  '.....rRr.r......',
  '....rRRRRr.r....',
  '..r.RRLRRRr.....',
  '...rRRRRRRRr....',
  '..rRRRRRRRRRr...',
];
sprite('redstone', dust, { r: hex('#8f0000'), R: hex('#ff0000'), L: hex('#ff8080') }, '#3a0000');
sprite('glowstone_dust', dust, { r: hex('#a88430'), R: hex('#f5d06a'), L: hex('#fff3b8') }, '#4a3508');
sprite('gunpowder', dust, { r: hex('#4a4a4a'), R: hex('#6e6e6e'), L: hex('#9a9a9a') }, '#1f1f1f');
sprite('sugar', dust, { r: hex('#d8d8d8'), R: hex('#f4f4f4'), L: hex('#ffffff') }, '#8a8a8a');
sprite('bone_meal', dust, { r: hex('#c8c8b8'), R: hex('#eeeee0'), L: hex('#ffffff') }, '#7a7a70');
sprite('lapis_lazuli', lump, { k: hex('#16328c'), K: hex('#2656c7'), L: hex('#6a90e8') }, '#0a1848');
sprite('flint', [
  '', '', '', '',
  '.......kK.......',
  '......kKKL......',
  '.....kKKKKL.....',
  '....kKKKLKKL....',
  '....KKKKKKKK....',
  '....kKKKKKKk....',
  '.....kKKKKk.....',
  '......kkkk......',
], { k: hex('#2a2a2a'), K: hex('#404040'), L: hex('#6a6a6a') }, '#0e0e0e');
sprite('string', [
  '', '', '',
  '..........ww....',
  '.........w......',
  '........w.......',
  '.......w........',
  '......ww........',
  '........w.......',
  '.......w........',
  '......w.........',
  '.....w..........',
  '...ww...........',
], { w: hex('#f0f0f0') });
sprite('feather', [
  '', '',
  '...........ww...',
  '..........wWWw..',
  '.........wWWWw..',
  '........wWWWw...',
  '.......wWWWw....',
  '......wWWWw.....',
  '.....wWWWw......',
  '....wWWWw.......',
  '....WWWw........',
  '...q.ww.........',
  '..q.............',
], { w: hex('#c8c8c8'), W: hex('#f4f4f4'), q: hex('#8a8a8a') }, '#5a5a5a');
sprite('leather', [
  '', '', '',
  '....lL..LLl.....',
  '....LLLLLLLL....',
  '...lLLLLLLLLl...',
  '...LLLLDLLLLL...',
  '...LLLLLLLLLL...',
  '....LLLLLLLL....',
  '....LLLLLDLL....',
  '....lLLLLLLl....',
  '.....l....l.....',
], { l: hex('#7a4a22'), L: hex('#a0663a'), D: hex('#8a5530') }, '#3a200c');
sprite('bone', [
  '', '', '',
  '...........ww...',
  '..........wWWw..',
  '..........WWw...',
  '.........WWw....',
  '........WWw.....',
  '.......WWw......',
  '......WWw.......',
  '.....WWw........',
  '...wWWw.........',
  '..wWWw..........',
  '...ww...........',
], { w: hex('#c8c8b8'), W: hex('#f4f4e8') }, '#6a6a60');
sprite('paper', [
  '', '', '',
  '...wwwwwwwwww...',
  '...wWWWWWWWWw...',
  '...wWWWWWWWWw...',
  '...wWWWWWWWWw...',
  '...wWWWWWWWWw...',
  '...wWWWWWWWWw...',
  '...wWWWWWWWWw...',
  '...wWWWWWWWWw...',
  '...wwwwwwwwww...',
], { w: hex('#d8d8d0'), W: hex('#f8f8f0') }, '#8a8a80');
sprite('book', [
  '', '', '',
  '....bbbbbbbbb...',
  '...bBBBBBBBBbp..',
  '...bBBBBBBBBbp..',
  '...bBBGGGGBBbp..',
  '...bBBBBBBBBbp..',
  '...bBBBBBBBBbp..',
  '...bBBBBBBBBbp..',
  '...bBBBBBBBBbp..',
  '...bbbbbbbbbbp..',
  '....pppppppppp..',
], { b: hex('#5a2e14'), B: hex('#7a4222'), G: hex('#d8b030'), p: hex('#f0f0e0') }, '#2a1408');
sprite('clay_ball', [
  '', '', '', '', '',
  '......cccc......',
  '.....cCCLCc.....',
  '....cCCCCCCc....',
  '....cCCCCCCc....',
  '....cCCCCCCc....',
  '.....cCCCCc.....',
  '......cccc......',
], { c: hex('#8a8f9a'), C: hex('#a8adb8'), L: hex('#d0d4dc') }, '#4a4e56');
sprite('snowball', [
  '', '', '', '', '',
  '......cccc......',
  '.....cCCLCc.....',
  '....cCCCLLCc....',
  '....cCCCCCCc....',
  '....cCCCCCCc....',
  '.....cCCCCc.....',
  '......cccc......',
], { c: hex('#c8d8e0'), C: hex('#eef6fa'), L: hex('#ffffff') }, '#708890');
sprite('egg', [
  '', '', '', '',
  '.......ee.......',
  '......eEEe......',
  '.....eEELEe.....',
  '.....EEEEEE.....',
  '.....EEEEEE.....',
  '.....eEEEEe.....',
  '......eEEe......',
  '.......ee.......',
], { e: hex('#c8b490'), E: hex('#e8d8b8'), L: hex('#fff8e8') }, '#6a5a40');
sprite('ender_pearl', [
  '', '', '', '', '',
  '......gggg......',
  '.....gGGLGg.....',
  '....gGGGGLGg....',
  '....gGgGGGGg....',
  '....gGGGGgGg....',
  '.....gGGGGg.....',
  '......gggg......',
], { g: hex('#0b3a33'), G: hex('#1d7a6a'), L: hex('#7ae0c8') }, '#021410');

// ------------------------------------------------------------------ food
sprite('apple', [
  '', '',
  '........g.......',
  '.......gLl......',
  '.......b.l......',
  '....rrrbrrr.....',
  '...rRRRRRRRr....',
  '..rRWRRRRRRRr...',
  '..rRRRRRRRRRr...',
  '..rRRRRRRRRRr...',
  '..rRRRRRRRRRr...',
  '...rRRRRRRRr....',
  '....rrRRRrr.....',
  '......rr........',
], { r: hex('#a01010'), R: hex('#e02020'), W: hex('#ff9090'), b: hex('#5a3a1a'), g: hex('#2d6a14'), L: hex('#4a8f23'), l: hex('#2d6a14') }, '#3a0404');
sprite('golden_apple', [
  '', '',
  '........g.......',
  '.......gLl......',
  '.......b.l......',
  '....rrrbrrr.....',
  '...rRRRRRRRr....',
  '..rRWRRRRRRRr...',
  '..rRRRRRRRRRr...',
  '..rRRRRRRRRRr...',
  '..rRRRRRRRRRr...',
  '...rRRRRRRRr....',
  '....rrRRRrr.....',
  '......rr........',
], { r: hex('#c29b10'), R: hex('#f5cc27'), W: hex('#fffcb8'), b: hex('#5a3a1a'), g: hex('#2d6a14'), L: hex('#4a8f23'), l: hex('#2d6a14') }, '#4a3500');
sprite('bread', [
  '', '', '', '',
  '..........bbb...',
  '........bbBBBb..',
  '......bbBBLBBb..',
  '....bbBBLBBBBb..',
  '...bBBLBBBBBb...',
  '..bBBBBBBBBb....',
  '..bBBBBBBbb.....',
  '...bbBBbb.......',
  '.....bb.........',
], { b: hex('#8a5a1f'), B: hex('#c48a3a'), L: hex('#e8b870') }, '#3a2208');
sprite('cookie', [
  '', '', '', '', '',
  '......cccc......',
  '.....cCkCCc.....',
  '....cCCCCkCc....',
  '....cCkCCCCc....',
  '....cCCCCCkc....',
  '.....cCCkCc.....',
  '......cccc......',
], { c: hex('#a0662a'), C: hex('#d08a44'), k: hex('#4a2a10') }, '#3a2008');
sprite('wheat', [
  '', '',
  '...........y.y..',
  '..........yYyY..',
  '.........yYyYy..',
  '........yYyYy...',
  '.......yYyYy....',
  '......gYyYy.....',
  '.....gg.yy......',
  '....gg..........',
  '...gg...........',
  '..gg............',
  '.g..............',
], { y: hex('#b89a2a'), Y: hex('#e0c850'), g: hex('#8a8a28') }, '#4a3a08');
sprite('wheat_seeds', [
  '', '', '', '', '', '',
  '......g...g.....',
  '....g...G.......',
  '.......g....G...',
  '...G..g...g.....',
  '.....G...G..g...',
  '....g..g........',
], { g: hex('#3a8a1a'), G: hex('#6ab830') });
sprite('pumpkin_seeds', [
  '', '', '', '', '', '',
  '......w...w.....',
  '....w...W.......',
  '.......w....W...',
  '...W..w...w.....',
  '.....W...W..w...',
], { w: hex('#d8d0a0'), W: hex('#f0e8c0') });
sprite('cocoa_beans', [
  '', '', '', '', '', '',
  '......bb..bb....',
  '.....bBBbbBBb...',
  '......bb..bb....',
  '...bb....bb.....',
  '..bBBb..bBBb....',
  '...bb....bb.....',
], { b: hex('#4a2a10'), B: hex('#7a4a22') });
sprite('melon_slice', [
  '', '', '',
  '..g.............',
  '..gGr...........',
  '..gGRr..........',
  '..gGRRr.........',
  '..gGRkRr........',
  '..gGRRRRr.......',
  '..gGRRkRRr......',
  '..gGRRRRRRr.....',
  '..gGGGGGGGGr....',
  '..gggggggggg....',
], { g: hex('#2d6a14'), G: hex('#6ab830'), R: hex('#e03030'), r: hex('#b02020'), k: hex('#1a1a1a') }, '#1a3a08');
function meat(name: string, a: string, b: string, c: string, fat: string, o: string) {
  sprite(name, [
    '', '', '',
    '.......aaaa.....',
    '.....aaBBBBa....',
    '....aBBBBCBBa...',
    '...aBBfBBBBBa...',
    '...aBBBBBBBBa...',
    '...aBBBBBfBBa...',
    '....aBBBBBBa....',
    '.....aaBBaa.....',
    '.......ff.......',
    '......fFf.......',
    '......ff........',
  ], { a: hex(a), B: hex(b), C: hex(c), f: hex(fat), F: hex('#ffffff') }, o);
}
meat('porkchop', '#c0505a', '#f08a90', '#ffb8bc', '#f0e0d0', '#5a1a1e');
meat('cooked_porkchop', '#7a4a22', '#b87848', '#d8a070', '#e8d0b0', '#3a200c');
meat('beef', '#8a1a1a', '#d03030', '#f07070', '#f0e0e0', '#3a0808');
meat('cooked_beef', '#4a2a10', '#7a4a22', '#a06a3a', '#c8a080', '#20100a');
meat('mutton', '#a02a2a', '#e04848', '#ff8080', '#f0f0f0', '#400c0c');
meat('cooked_mutton', '#5a3418', '#8a5a2e', '#b88048', '#d8b890', '#28160a');
meat('rotten_flesh', '#5a6a2a', '#8a7a3a', '#6a8a3a', '#a09050', '#2a3008');
function drumstick(name: string, a: string, b: string, c: string, o: string) {
  sprite(name, [
    '', '', '',
    '.......aaa......',
    '.....aaBBBa.....',
    '....aBBBBCBa....',
    '....aBBBBBBa....',
    '....aBBBBBBa....',
    '.....aBBBBa.....',
    '......aBBa......',
    '.......ww.......',
    '......wWWw......',
    '......w..w......',
  ], { a: hex(a), B: hex(b), C: hex(c), w: hex('#d8d8c8'), W: hex('#ffffff') }, o);
}
drumstick('chicken', '#c09080', '#f0c8b8', '#fff0e8', '#5a3a30');
drumstick('cooked_chicken', '#8a5a22', '#c88a3a', '#f0b860', '#3a2008');
sprite('spider_eye', [
  '', '', '', '', '',
  '......rrrr......',
  '.....rRRRRr.....',
  '....rRRkkRRr....',
  '....rRkWkRRr....',
  '....rRRkkRRr....',
  '.....rRRRRr.....',
  '......rrrr......',
], { r: hex('#6a1020'), R: hex('#b82840'), k: hex('#1a0a0a'), W: hex('#ffd0d0') }, '#2a0408');

// ------------------------------------------------------------------ utility
function bucket(name: string, fill?: string, fill2?: string) {
  sprite(name, [
    '', '', '',
    '...hHHHHHHHHd...',
    '..hLffffffffLd..',
    '..hHFFFFFFFFHd..',
    '...hHHHHHHHHd...',
    '...hHHHHHHHHd...',
    '....hHHHHHHd....',
    '....hHHHHHHd....',
    '.....hHHHHd.....',
    '.....dddddd.....',
  ], { h: hex('#e8e8e8'), H: hex('#bcbcbc'), L: hex('#ffffff'), d: hex('#7a7a7a'), f: hex(fill ?? '#3a3a3a'), F: hex(fill2 ?? '#5a5a5a') }, '#2a2a2a');
}
bucket('bucket');
bucket('water_bucket', '#2f5fd0', '#4a80f0');
bucket('lava_bucket', '#d45a12', '#fc9f2a');
bucket('milk_bucket', '#e8e8e8', '#ffffff');
sprite('bowl', [
  '', '', '', '', '', '', '',
  '..bbbbbbbbbbbb..',
  '..bBBBBBBBBBBb..',
  '...bBBBBBBBBb...',
  '....bBBBBBBb....',
  '.....bbbbbb.....',
], { b: hex('#5a3a1a'), B: hex('#8a6035') }, '#2a1808');
sprite('mushroom_stew', [
  '', '', '', '', '', '',
  '...ssSssSsss....',
  '..bsSSsssSSsbb..',
  '..bBBBBBBBBBBb..',
  '...bBBBBBBBBb...',
  '....bBBBBBBb....',
  '.....bbbbbb.....',
], { b: hex('#5a3a1a'), B: hex('#8a6035'), s: hex('#b0806a'), S: hex('#d0a080') }, '#2a1808');
sprite('flint_and_steel', [
  '', '', '',
  '..sss...........',
  '.s...s..........',
  '.s...s..........',
  '.s...s..........',
  '..ssss..........',
  '.....s.kK.......',
  '.......kKK......',
  '.......kKKK.....',
  '........kKK.....',
  '.........k......',
], { s: hex('#b8b8b8'), k: hex('#2a2a2a'), K: hex('#505050') }, '#1a1a1a');
sprite('shears', [
  '', '', '',
  '.........ss.....',
  '........sSs.....',
  '.......sSs......',
  '......sSs.ss....',
  '.....sSs.sSs....',
  '....rr..sSs.....',
  '...rRRr.ss......',
  '...rRRrrr.......',
  '....rr.rRr......',
  '.......rRr......',
  '........r.......',
], { s: hex('#a8a8a8'), S: hex('#e8e8e8'), r: hex('#8a2020'), R: hex('#c03030') }, '#2a2a2a');
sprite('bow', [
  '', '',
  '..........ww....',
  '.........bbw....',
  '........b..w....',
  '.......b...w....',
  '......b....w....',
  '.....b.....w....',
  '....b.....w.....',
  '....b....w......',
  '...b....w.......',
  '..bb...w........',
  '..w..ww.........',
  '..www...........',
], { b: hex('#6b4b1a'), w: hex('#e8e8e8') });
sprite('arrow', [
  '', '',
  '............ss..',
  '...........sSs..',
  '..........sSs...',
  '.........sSs....',
  '........bb......',
  '.......bb.......',
  '......bb........',
  '.....bb.........',
  '....bb..........',
  '..fbb...........',
  '.ffb............',
  '..ff............',
], { s: hex('#8a8a8a'), S: hex('#d8d8d8'), b: hex('#6b4b1a'), f: hex('#f0f0f0') });
sprite('sugar_cane', [
  '', '',
  '....g....g......',
  '....G...gG......',
  '....g....g..g...',
  '....G....G..G...',
  '...gg....g..g...',
  '....G....G.gG...',
  '....g....g..g...',
  '....G....G..G...',
  '....g...gg..g...',
  '....G....G..G...',
  '....g....g..g...',
], { g: hex('#8ac04a'), G: hex('#6a9a30') });
sprite('oak_door', [
  '',
  '.....wwwwww.....',
  '.....w..w.w.....',
  '.....wwwwww.....',
  '.....w..w.w.....',
  '.....wwwwww.....',
  '.....wWWWWw.....',
  '.....wWWWWw.....',
  '.....wWWWkw.....',
  '.....wWWWWw.....',
  '.....wWWWWw.....',
  '.....wWWWWw.....',
  '.....wwwwww.....',
], { w: hex('#7a5a30'), W: hex('#a2824e'), k: hex('#4a4a4a') }, '#3a2810');
sprite('red_bed', [
  '', '', '', '', '', '',
  '.wwwwrrrrrrrrr..',
  '.wwwwrrrrrrrrr..',
  '.RRRRRRRRRRRRR..',
  '.pppppppppppppp.',
  '.p...........p..',
], { w: hex('#f0f0f0'), r: hex('#c02020'), R: hex('#8e1414'), p: hex('#8a6035') }, '#2a0808');
sprite('compass', [
  '', '', '', '',
  '.....gggggg.....',
  '....gGGGGGGg....',
  '...gGGGrGGGGg...',
  '...gGGGrGGGGg...',
  '...gGGGwGGGGg...',
  '...gGGGwGGGGg...',
  '....gGGGGGGg....',
  '.....gggggg.....',
], { g: hex('#6a6a6a'), G: hex('#d8d8d8'), r: hex('#e02020'), w: hex('#707070') }, '#2a2a2a');
sprite('clock', [
  '', '', '', '',
  '.....gggggg.....',
  '....gYYYYYYg....',
  '...gYBBBBBBYg...',
  '...gYBBBBBBYg...',
  '...gYGGGGGGYg...',
  '...gYGGGGGGYg...',
  '....gYYYYYYg....',
  '.....gggggg.....',
], { g: hex('#a88410'), Y: hex('#f5cc27'), B: hex('#3a6ad1'), G: hex('#3a8a1a') }, '#4a3500');

sprite('quartz', [
  '', '', '', '',
  '......wW........',
  '.....wWWW.......',
  '....wWWWWWw.....',
  '...wWWWWWWWw....',
  '....WWWWWWWw....',
  '.....wWWWWw.....',
  '......wWWw......',
], { w: hex('#c8bfb2'), W: hex('#f0ebe4') }, '#6a6258');
sprite('gold_nugget', [
  '', '', '', '', '', '',
  '......yY........',
  '.....yYYy.......',
  '....yYWYYy......',
  '.....yYYy.......',
  '......yy........',
], { y: hex('#c29b10'), Y: hex('#f5cc27'), W: hex('#fffcb8') }, '#4a3500');
sprite('fire_charge', [
  '', '', '', '',
  '......kkkk......',
  '.....kRoYRk.....',
  '....kRoYYoRk....',
  '....koYWYYok....',
  '....kRoYYoRk....',
  '.....kRooRk.....',
  '......kkkk......',
], { k: hex('#2a1a0a'), R: hex('#8a2a0a'), o: hex('#e06010'), Y: hex('#ffb030'), W: hex('#fff0a0') }, '#1a0a00');
sprite('ghast_tear', [
  '', '', '', '',
  '.......w........',
  '......wWw.......',
  '.....wWWWw......',
  '.....WWWWW......',
  '.....wWWWw......',
  '......www.......',
], { w: hex('#b8d8e0'), W: hex('#f0ffff') }, '#5a7880');

sprite('oak_boat', [
  '', '', '', '', '', '', '',
  '.w............w.',
  '.wW..........Ww.',
  '.wWwwwwwwwwwwWw.',
  '..wWWWWWWWWWWw..',
  '...wwwwwwwwww...',
], { w: hex('#6b5130'), W: hex('#a2824e') }, '#2e2010');
sprite('slime_ball', [
  '', '', '', '', '',
  '......gggg......',
  '.....gGGLGg.....',
  '....gGGGGLGg....',
  '....gGGGGGGg....',
  '....gGGGGGGg....',
  '.....gGGGGg.....',
  '......gggg......',
], { g: hex('#4a9a2a'), G: hex('#7ad04a'), L: hex('#c8ffa8') }, '#1a4a0a');
sprite('end_crystal', [
  '', '',
  '.......ww.......',
  '......wPPw......',
  '.....wPppPw.....',
  '....wPpWWpPw....',
  '....wPWppWPw....',
  '....wPpWWpPw....',
  '.....wPppPw.....',
  '......wPPw......',
  '.......ww.......',
], { w: hex('#f4e8ff'), P: hex('#d890ff'), p: hex('#a040e0'), W: hex('#ffffff') }, '#3a1058');
sprite('ender_eye', [
  '', '', '', '', '',
  '......gggg......',
  '.....gGyyGg.....',
  '....gGyKKyGg....',
  '....gGyKKyGg....',
  '.....gGyyGg.....',
  '......gggg......',
], { g: hex('#0b3a33'), G: hex('#2a8a6a'), y: hex('#c8d850'), K: hex('#101010') }, '#021410');
sprite('blaze_powder', [
  '', '', '', '', '', '', '',
  '.......y........',
  '.....yYy.y......',
  '....yYYYYy.y....',
  '..y.YYOYYYy.....',
  '...yYYYYYYYy....',
  '..yYYYYYYYYYy...',
], { y: hex('#c88a10'), Y: hex('#ffc830'), O: hex('#fff0a0') }, '#5a3a00');

sprite('fishing_rod', [
  '', '',
  '..........ssw...',
  '.........sS..w..',
  '........sS....w.',
  '.......sS.....w.',
  '......sS......w.',
  '.....sS.......w.',
  '....sS........w.',
  '...sS.........g.',
  '..sS..........G.',
  '.sS.............',
  'sS..............',
], { s: hex('#8a6b3c'), S: hex('#6b5130'), w: hex('#e8e8e8'), g: hex('#707070'), G: hex('#a0a0a0') });
function fish(name: string, body: string, belly: string, fin: string, o: string) {
  sprite(name, [
    '', '', '', '',
    '..........ff....',
    '...bbbbbbbbf....',
    '..bBBBBBBBBbf...',
    '.bKBBBBBBBBBbFF.',
    '.bBBLLLLLLBBbFF.',
    '..bLLLLLLLLbf...',
    '...bbbbbbbbf....',
    '..........ff....',
  ], { b: hex(o), B: hex(body), L: hex(belly), f: hex(fin), F: hex(fin), K: hex('#101010') });
}
fish('cod', '#b8a07a', '#d8ccb0', '#8a7456', '#5a4a36');
fish('cooked_cod', '#c89a5a', '#e0c090', '#8a6030', '#4a3218');
fish('salmon', '#a84a3a', '#e0907a', '#6a2a20', '#3a1a14');
fish('cooked_salmon', '#b8703a', '#e0a870', '#7a4a20', '#3a2410');
sprite('fishing_bobber', [
  '', '', '', '', '',
  '.......kk.......',
  '......kRRk......',
  '......RRRR......',
  '......WWWW......',
  '......kWWk......',
  '.......kk.......',
], { k: hex('#2a2a2a'), R: hex('#d82020'), W: hex('#f0f0f0') });
sprite('ink_sac', [
  '', '', '', '',
  '.......kk.......',
  '......kKKk......',
  '.....kKKKKk.....',
  '....kKKLKKKk....',
  '....kKKKKKKk....',
  '.....kKKKKk.....',
  '......kkkk......',
], { k: hex('#101018'), K: hex('#262636'), L: hex('#4a4a60') }, '#050508');

// ------------------------------------------------------------------ brewing, eggs, potions
const rgb = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const GLASS: RGB = hex('#d8e4f0');
function potionSprite(name: string, col: number, splash: boolean) {
  const L = rgb(col);
  const rows = splash ? [
    '',
    '......cccc......',
    '.......gg.......',
    '.......gg.......',
    '......gLLg......',
    '.....gLWLLg.....',
    '....gLWLLLLg....',
    '....gLLLLLLg....',
    '...gLLLLLLLDg...',
    '...gLLLLLLLDg...',
    '...gLLLLLLDDg...',
    '....gLLLLDDg....',
    '.....gggggg.....',
  ] : [
    '',
    '.......cc.......',
    '......gccg......',
    '.......gg.......',
    '......g..g......',
    '......gWLg......',
    '.....gLLLLg.....',
    '....gLWLLLLg....',
    '...gLWLLLLLDg...',
    '...gLLLLLLLDg...',
    '...gLLLLLLDDg...',
    '...gLLLLLDDDg...',
    '....gLLLLDDg....',
    '.....gggggg.....',
  ];
  sprite(name, rows, { c: hex('#8a6035'), g: GLASS, L, D: shade(L, 0.75), W: [Math.min(255, L[0] + 90), Math.min(255, L[1] + 90), Math.min(255, L[2] + 90)] }, '#4a5a6a');
}
for (const [k, col] of Object.entries(POTION_SPRITES)) {
  potionSprite('potion_' + k, col, false);
  potionSprite('splash_potion_' + k, col, true);
}
sprite('glass_bottle', [
  '',
  '.......cc.......',
  '......gccg......',
  '.......gg.......',
  '......g..g......',
  '......gw.g......',
  '.....g....g.....',
  '....g.w....g....',
  '...g.w......g...',
  '...g........g...',
  '...g........g...',
  '...g........g...',
  '....g......g....',
  '.....gggggg.....',
], { c: hex('#8a6035'), g: GLASS, w: hex('#ffffff') }, '#4a5a6a');
for (const e of [...SPAWN_EGGS, ...EXTRA_EGGS, ...EXTRA_EGGS2, ...EXTRA_EGGS3, ...EXTRA_EGGS4, ...EXTRA_EGGS5]) {
  const E = rgb(e.c1), sp = rgb(e.c2);
  sprite(`${e.mob}_spawn_egg`, [
    '',
    '',
    '......eeee......',
    '.....eEEEEe.....',
    '....eEHEEEEe....',
    '....eHEEsEEe....',
    '...eEEsEEEsEe...',
    '...eEEEEEEEEe...',
    '...eEEEsEEEEe...',
    '...eEEEEEEsEe...',
    '...esEEEEEEEe...',
    '....eEEEEsEe....',
    '.....eeeeee.....',
  ], { e: shade(E, 0.7), E, H: [Math.min(255, E[0] + 60), Math.min(255, E[1] + 60), Math.min(255, E[2] + 60)], s: sp }, '#101010');
}
// ------------------------------------------------------------------ rails and horses
sprite('minecart', [
  '', '', '', '', '',
  '.hHHHHHHHHHHHHd.',
  '.Hiiiiiiiiiiiid.',
  '.HiIIIIIIIIIIid.',
  '.HiIIIIIIIIIIid.',
  '..HIIIIIIIIIId..',
  '..HdddddddddDd..',
  '...ww......ww...',
  '...ww......ww...',
], { h: hex('#e8e8e8'), H: hex('#c8c8c8'), i: hex('#4a4a4a'), I: hex('#8c8c8c'), d: hex('#5a5a5a'), D: hex('#3a3a3a'), w: hex('#2a2a2a') }, '#1a1a1a');
sprite('saddle', [
  '', '', '',
  '.....bbbbb......',
  '...bBBBBBBbb....',
  '..bBLLLBBBBBb...',
  '..bBBBBBBBBBBb..',
  '...bbBBBBBBBBb..',
  '.....bbbbbbbb...',
  '.....s.....s....',
  '.....s.....s....',
  '....ii....ii....',
], { b: hex('#5a3418'), B: hex('#8a5428'), L: hex('#b07440'), s: hex('#3a2010'), i: hex('#b0b0b0') }, '#2a1408');
for (const [mat, H, M, D] of [['iron', '#e8e8e8', '#b8b8b8', '#707070'], ['golden', '#fff4a0', '#f0c830', '#a07810'], ['diamond', '#c0fff4', '#40e0d0', '#188880']] as const) {
  sprite(`${mat}_horse_armor`, [
    '', '',
    '..........hh....',
    '.........hMMd...',
    '........hMMMMd..',
    '.......hMMMdMd..',
    '......hMMMd.dd..',
    '..hhhhMMMMd.....',
    '.hMMMMMMMMd.....',
    '.hMMMMMMMMd.....',
    '.hMMddddMMd.....',
    '.hMd....hMd.....',
    '.hd......hd.....',
  ], { h: hex(H), M: hex(M), d: hex(D) }, '#202020');
}
sprite('enchanted_book', [
  '', '', '',
  '....bbbbbbbbb...',
  '...bBBBBBBBBbp..',
  '...bBBBBBBBBbp..',
  '...bBBGGGGBBbp..',
  '...bBBGrrGBBbp..',
  '...bBBGGGGBBbp..',
  '...bBBBBBBBBbp..',
  '...bBBBBBBBBbp..',
  '...bbbbbbbbbbp..',
  '....pppppppppp..',
], { b: hex('#4a1e3a'), B: hex('#7a2e5a'), G: hex('#d8b030'), r: hex('#b02040'), p: hex('#f0f0e0') }, '#1a0814');
sprite('blaze_rod', [
  '', '',
  '............yY..',
  '...........yYo..',
  '..........yYo...',
  '.........yYo....',
  '........yYo.....',
  '.......yYo......',
  '......yYo.......',
  '.....yYo........',
  '....yYo.........',
  '...yYo..........',
  '..yYo...........',
  '..Yo............',
], { y: hex('#f8d020'), Y: hex('#fff080'), o: hex('#e08010') }, '#6a3a00');
sprite('fermented_spider_eye', [
  '', '', '',
  '......bbbb......',
  '.....bBBBBb.....',
  '....bBwBBwBb....',
  '....rrrrrrrr....',
  '....rRRkkRRr....',
  '....rRkWkRRr....',
  '....rRRkkRRr....',
  '.....rRRRRr.....',
  '......rrrr......',
], { b: hex('#5a3a1e'), B: hex('#8a6035'), w: hex('#f0f0f0'), r: hex('#6a1020'), R: hex('#b82840'), k: hex('#1a0a0a'), W: hex('#ffd0d0') }, '#2a0408');
sprite('glistering_melon_slice', [
  '', '', '',
  '..y.............',
  '..yYr...........',
  '..yYRr..........',
  '..yYRRr.........',
  '..yYRyRr........',
  '..yYRRRRr.......',
  '..yYRRyRRr......',
  '..yYRRRRRRr.....',
  '..yYYYYYYYYr....',
  '..yyyyyyyyyy....',
], { y: hex('#c29b10'), Y: hex('#fff080'), R: hex('#e03030'), r: hex('#b02020') }, '#4a3500');
sprite('magma_cream', [
  '', '', '', '',
  '......oooo......',
  '....ooOOOOoo....',
  '...oOOyyyyOOo...',
  '...oOyYYYYyOo...',
  '...oOyYWYYyOo...',
  '...oOOyyyyOOo...',
  '....ooOOOOoo....',
  '......oooo......',
], { o: hex('#8a3a0a'), O: hex('#d06a1a'), y: hex('#f8b020'), Y: hex('#ffe060'), W: hex('#ffffc0') }, '#3a1400');
function carrotSprite(name: string, a: string, b: string, c: string, o: string) {
  sprite(name, [
    '', '',
    '...........gg...',
    '..........gGg...',
    '.........gGgg...',
    '........aBa.....',
    '.......aBBa.....',
    '......aBCBa.....',
    '.....aBBBa......',
    '....aBCBa.......',
    '...aBBBa........',
    '..aBBa..........',
    '..aa............',
  ], { a: hex(a), B: hex(b), C: hex(c), g: hex('#2d6a14'), G: hex('#6ab830') }, o);
}
carrotSprite('carrot', '#c05a08', '#f08a1a', '#ffb050', '#4a2000');
carrotSprite('golden_carrot', '#c29b10', '#f5cc27', '#fffcb8', '#4a3500');
function foodLump(name: string, a: string, b: string, c: string, o: string) {
  sprite(name, [
    '', '', '', '',
    '......aaaa......',
    '....aaBBBBaa....',
    '...aBBCBBBBBa...',
    '...aBBBBBaBBa...',
    '...aBaBBBBBBa...',
    '....aBBBBCBa....',
    '.....aaaaaa.....',
  ], { a: hex(a), B: hex(b), C: hex(c) }, o);
}
foodLump('potato', '#9a7a3a', '#d0a860', '#e8c888', '#3a2a0a');
foodLump('baked_potato', '#8a5a1a', '#d8a040', '#f0c860', '#3a2008');
sprite('pufferfish', [
  '', '', '',
  '....y..y..y.....',
  '.....yyyyyy.....',
  '..y.yYYYYYYy....',
  '...yYkYYYYYYyff.',
  '..yYYYYYYYYYyff.',
  '...yYYYYYYYYyff.',
  '..y.yYYYYYYy....',
  '.....yyyyyy.....',
  '....y..y..y.....',
], { y: hex('#c8a010'), Y: hex('#f8d838'), k: hex('#101010'), f: hex('#d8b020') }, '#4a3a00');
sprite('tropical_fish', [
  '', '', '', '',
  '..........ff....',
  '...oowoooof.....',
  '..oOkwOOwOOoff..',
  '.oOOOwOOwOOOoff.',
  '..oOOwOOwOOoff..',
  '...oowoooof.....',
  '..........ff....',
], { o: hex('#c85010'), O: hex('#f07820'), w: hex('#f8f8f8'), k: hex('#101010'), f: hex('#f07820') }, '#3a1400');
sprite('name_tag', [
  '', '', '',
  '...........ss...',
  '..........s..s..',
  '...ttttttttt.s..',
  '..tTTTTTTTTtss..',
  '..tTkkTkkTTt....',
  '..tTTTTTTTTt....',
  '...ttttttttt....',
], { t: hex('#8a6035'), T: hex('#e8d8b0'), k: hex('#6a6a6a'), s: hex('#c8c8c8') }, '#2a1a08');
function diodeSprite(name: string, three: boolean) {
  sprite(name, [
    '', '', '', '', '',
    three ? '..r.......r.....' : '..r......r......',
    three ? '..R....r..R.....' : '..R......R......',
    three ? '..s....R..s.....' : '..s......s......',
    three ? '..s....s..s.....' : '..s......s......',
    'aaaaaaaaaaaaaa..',
    'bBBBBBBBBBBBBb..',
    'bbbbbbbbbbbbbb..',
  ], { r: hex('#ff3020'), R: hex('#b01010'), s: hex('#8a6b3c'), a: hex('#b8b8b8'), B: hex('#9a9a9a'), b: hex('#6a6a6a') }, '#2a2a2a');
}
diodeSprite('repeater', false);
diodeSprite('comparator', true);
sprite('brewing_stand', [
  '',
  '.......y........',
  '.......r........',
  '...aaaaraaaa....',
  '...a...r...a....',
  '..ggg..r..ggg...',
  '..gLg..r..gLg...',
  '.gLLLg.r.gLLLg..',
  '.gLLLg.r.gLLLg..',
  '..ggg..r..ggg...',
  '.......r........',
  '.....bbrbb......',
  '...bbbbbbbbb....',
], { y: hex('#f8d020'), r: hex('#6a5a3a'), a: hex('#6a5a3a'), g: GLASS, L: hex('#8aa4e8'), b: hex('#707070') }, '#2a2a2a');
sprite('nether_brick', [
  '', '', '', '', '',
  '..bbbbbbbbbbbb..',
  '.bBBBBBBBBBBBBb.',
  '.bBRBBBBBBRBBBb.',
  '.bBBBBBRBBBBBBb.',
  '.bbBBBBBBBBBBbb.',
  '..bbbbbbbbbbbb..',
], { b: hex('#2a1014'), B: hex('#4a1c22'), R: hex('#6a2a30') }, '#12060a');
sprite('nether_wart', [
  '', '', '', '',
  '.....rr..rr.....',
  '....rRRrrRRr....',
  '....rRWRRRRr....',
  '.....rRRRRr.....',
  '......rRRr......',
  '.......dd.......',
  '......d..d......',
], { r: hex('#6a1014'), R: hex('#b0202a'), W: hex('#e05050'), d: hex('#5a0a0e') }, '#2a0406');

// ------------------------------------------------------------------ fireworks and elytra
sprite('elytra', [
  '', '',
  '....dddddddd....',
  '...dHHHddHHHd...',
  '..dHhhHddHhhHd..',
  '..dHhHHddHHhHd..',
  '.dHhHHd..dHHhHd.',
  '.dHhHHd..dHHhHd.',
  '.dHhHd....dHhHd.',
  '.dHHHd....dHHHd.',
  '.dHhd......dhHd.',
  '.dHHd......dHHd.',
  '..dHd......dHd..',
  '..d.d......d.d..',
], { H: hex('#8e8ea6'), h: hex('#bdbdd0'), d: hex('#55556a') }, '#24242e');
sprite('firework_rocket', [
  '',
  '.............g..',
  '............gG..',
  '...........wWg..',
  '..........rRw...',
  '.........rRRr...',
  '........wWRr....',
  '.......rwWr.....',
  '......rRRw......',
  '.....rRRr.......',
  '....wWRr........',
  '...rwWr.........',
  '..rRRr..........',
  '..sr............',
  '.s..............',
], { r: hex('#a8221d'), R: hex('#d83a2c'), w: hex('#d8d0c0'), W: hex('#ffffff'), g: hex('#7a7a7a'), G: hex('#b4b4b4'), s: hex('#6b5130') }, '#2a0a08');
// the middle (alpha 254) takes the star's colour in the inventory
sprite('firework_star', [
  '', '',
  '......kkkk......',
  '....kkGGGGkk....',
  '...kGGooooGGk...',
  '...kGooOOooGk...',
  '..kGooOOOOooGk..',
  '..kGoOOOOOOoGk..',
  '..kGoOOOOOOoGk..',
  '..kGooOOOOooGk..',
  '...kGooOOooGk...',
  '...kGGooooGGk...',
  '....kkGGGGkk....',
  '......kkkk......',
], { k: hex('#3a3a3a'), G: hex('#5e5e5e'), o: [200, 200, 200, 254], O: [255, 255, 255, 254] }, '#161616');

// an item whose mod isn't loaded: the missing-texture checker
sprites.missing = () => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, ((x >> 3) ^ (y >> 3)) & 1 ? hex('#f800f8') : hex('#000000'));
  return img;
};

// the 1.9 - 1.16 items (itemsprites2.ts)
paintItems2({
  sprite,
  define: (name, make, o) => { sprites[name] = () => { const img = make(); if (o) outline(img, hex(o)); return img; }; },
  get: (name) => (sprites[name] ? sprites[name]() : null),
  potion: potionSprite,
  bucket,
});

export function getItemSprite(name: string): Img | null {
  const o = OVERRIDES.items.get(name);
  if (o) return new Uint8ClampedArray(small(o));
  const f = sprites[name];
  return f ? f() : null;
}
export const ITEM_SPRITE_NAMES = Object.keys(sprites);
/** Mods: add an item sprite (16x16) by name. */
export function registerItemSprite(name: string, make: () => Img, outlineCol?: string) {
  sprites[name] = () => {
    const img = make();
    if (outlineCol) outline(img, hex(outlineCol));
    return img;
  };
}
/** Every sprite name, including those mods added since start-up. */
export const itemSpriteNames = () => Object.keys(sprites);
void get; void shade;
