// 16x16 item sprites as hand-authored pixel art. Outlines are added automatically.
import { Img, RGB, newImg, hex, set, get, art, shade, S } from './pixels';

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

export function getItemSprite(name: string): Img | null {
  const f = sprites[name];
  return f ? f() : null;
}
export const ITEM_SPRITE_NAMES = Object.keys(sprites);
void get; void shade;
