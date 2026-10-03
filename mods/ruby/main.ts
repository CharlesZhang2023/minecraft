// Rubies: the example content mod. Shows blocks and items (with tools), drops, world generation, recipes and
// smelting, procedural textures and sprites, an event listener and a command.
import type { ModContext, Img } from '../sdk';

/** Common: runs in the page and in the workers (the terrain generator places the ore). */
export function main(mod: ModContext) {
  const { stack } = mod.mc;

  const ruby = mod.item('ruby', { display: 'Ruby', rarity: 'uncommon' });
  const ore = mod.block('ruby_ore', 'Ruby Ore', { hardness: 3, tool: 'pickaxe', harvestLevel: 2, sound: 'stone', blastResistance: 15 }, {
    // the gem, or with Silk Touch the ore itself
    drops: ({ silk }) => [silk ? stack(ore.id) : stack(ruby.id, 1)],
    onBreak: (c) => { if (c.player && !c.player.creative) c.game.spawnXpAt(c.x + 0.5, c.y + 0.5, c.z + 0.5, 3 + Math.floor(Math.random() * 5)); },
  });
  const block = mod.block('ruby_block', 'Block of Ruby', { hardness: 5, tool: 'pickaxe', harvestLevel: 2, sound: 'metal' }, undefined, { tab: 'Building Blocks' });

  // diamond-like tools, a little faster and longer-lived
  const tool = (type: 'pickaxe' | 'sword' | 'axe' | 'shovel', display: string, dmg: number) =>
    mod.item(`ruby_${type}`, {
      display, maxStack: 1, durability: 1800, attack: dmg, rarity: 'uncommon',
      tool: { type, level: 3, speed: 10, damage: dmg }, tab: type === 'sword' ? 'Combat' : 'Tools',
    });
  const pick = tool('pickaxe', 'Ruby Pickaxe', 5), sword = tool('sword', 'Ruby Sword', 8);
  const axe = tool('axe', 'Ruby Axe', 7), shovel = tool('shovel', 'Ruby Shovel', 4);

  mod.recipes.shaped(['RRR', 'RRR', 'RRR'], { R: ruby }, block);
  mod.recipes.shapeless([block], ruby, 9);
  mod.recipes.shaped(['RRR', ' S ', ' S '], { R: ruby, S: 'stick' }, pick);
  mod.recipes.shaped(['R', 'R', 'S'], { R: ruby, S: 'stick' }, sword);
  mod.recipes.shaped(['RR', 'RS', ' S'], { R: ruby, S: 'stick' }, axe);
  mod.recipes.shaped(['R', 'S', 'S'], { R: ruby, S: 'stick' }, shovel);
  mod.recipes.smelting(ore, ruby, 1);

  // deep and rare: three small veins per chunk below y 28
  mod.worldgen.ore({ block: ore, size: 6, count: 3, minY: 4, maxY: 28 });

  // zombies sometimes drop one
  mod.on('entityDeath', ({ game, entity, source }) => {
    const e = entity as unknown as { typeName?: string; x: number; y: number; z: number };
    if (e.typeName === 'Zombie' && (source === 'player' || source === 'arrow') && Math.random() < 0.05) game.dropItem(e.x, e.y + 0.5, e.z, stack(ruby.id));
  });

  // a small mob: wanders, likes beetroot... well, wheat seeds; drops a ruby now and then
  if (mod.realm === 'page') {
    const { Animal, I } = mod.mc;
    class GemBeetle extends Animal {
      typeName = 'ruby:beetle';
      override temptItems = [I.WHEAT_SEEDS];
      constructor(world: ConstructorParameters<typeof Animal>[0], game: ConstructorParameters<typeof Animal>[1]) {
        super(world, game);
        this.width = 0.6; this.height = 0.4;
        this.maxHealth = this.health = 6;
        this.speedAttr = 0.3;
      }
      override eyeHeight() { return 0.25; }
      override drops() { return Math.random() < 0.4 ? [stack(ruby.id)] : []; }
    }
    mod.entity('beetle', GemBeetle);
  }
  mod.item('beetle_spawn_egg', { display: 'Spawn Gem Beetle', egg: 'ruby:beetle', tab: 'Miscellaneous' });

  mod.commands.register({
    name: 'ruby',
    usage: '/ruby locate',
    description: 'find the nearest ruby ore in loaded chunks',
    permission: 'all',
    run({ game, player, args }) {
      if (args[0] !== 'locate') throw new Error('Usage: /ruby locate');
      const w = game.world!, px = Math.floor(player.x), pz = Math.floor(player.z);
      let best: [number, number, number] | null = null, bd = Infinity;
      for (let x = px - 48; x <= px + 48; x++)
        for (let z = pz - 48; z <= pz + 48; z++)
          for (let y = 1; y < 30; y++) {
            if ((w.get(x, y, z) & 0xfff) !== ore.id) continue;
            const d = (x - player.x) ** 2 + (y - player.y) ** 2 + (z - player.z) ** 2;
            if (d < bd) { bd = d; best = [x, y, z]; }
          }
      return best ? `§cRuby ore§r at ${best.join(', ')} (${Math.round(Math.sqrt(bd))} blocks away)` : 'No ruby ore within 48 blocks';
    },
  });
}

/** Page only: textures and item sprites. */
export function client(mod: ModContext) {
  const { pixels: px, getTexture } = mod.mc;
  const RED = ['#5a0a14', '#8c1020', '#c01a30', '#e8384c', '#ff8a96'].map(px.hex);

  mod.client.texture('ruby:ruby_ore', (r) => {
    const img = px.copy(getTexture('stone'));
    // four small gem clusters: dark rim, bright core, one highlight
    for (let k = 0; k < 4; k++) {
      const cx = 2 + r.int(11), cy = 2 + r.int(11);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [2, 1], [0, -1], [1, 2]]) {
        const edge = Math.abs(dx - 0.5) + Math.abs(dy - 0.5) > 1.2;
        px.set(img, cx + dx, cy + dy, RED[edge ? 1 : 2 + r.int(2)]);
      }
      px.set(img, cx, cy, RED[4]);
    }
    return img;
  });
  mod.client.texture('ruby:ruby_block', (r) => {
    const img = px.newImg();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const rim = x === 0 || y === 0 || x === 15 || y === 15;
        const facet = (x + y) % 6 === 0 || (x - y + 16) % 6 === 0;
        px.set(img, x, y, rim ? RED[0] : facet ? RED[3] : RED[1 + r.int(2)]);
      }
    for (let i = 1; i < 6; i++) px.set(img, i, i, RED[4]);
    return img;
  });

  const P = { r: RED[1], R: RED[2], h: RED[3], w: RED[4], d: RED[0], s: px.hex('#8a6b3c'), S: px.hex('#5c4424') };
  const sprite = (name: string, rows: string[]) => mod.client.itemSprite(name, (): Img => {
    const img = px.newImg();
    px.art(img, rows, P);
    return img;
  }, '#2a0408');
  sprite('ruby:ruby', [
    '                ', '                ', '                ', '     dddddd     ', '    drRRRRrd    ', '   drRwhhRRrd   ',
    '   dRwhRRRRRd   ', '   drRRRRRrrd   ', '    drRRRrrd    ', '     drRrrd     ', '      drrd      ', '       dd       ',
  ]);
  sprite('ruby:ruby_pickaxe', [
    '                ', '   dRRRRRRd     ', '  dRhhRRRRRRd   ', '  dRd   SdRRd   ', '        S  dRd  ', '       S    dd  ',
    '      S         ', '     S          ', '    S           ', '   S            ', '  S             ', '                ',
  ]);
  sprite('ruby:ruby_sword', [
    '            dd  ', '           dhd  ', '          dhRd  ', '         dhRd   ', '        dhRd    ', '       dhRd     ',
    '  d   dhRd      ', '   d dhRd       ', '    dSRd        ', '    SSd         ', '   S  d         ', '  S             ',
  ]);
  sprite('ruby:ruby_axe', [
    '                ', '      dRRd      ', '     dRhRRd     ', '     dRRSRd     ', '      dSRRd     ', '      S dd      ',
    '     S          ', '    S           ', '   S            ', '  S             ', '                ', '                ',
  ]);
  mod.client.itemSprite('ruby:beetle_spawn_egg', (): Img => {
    const img = px.newImg();
    px.art(img, [
      '                ', '      dddd      ', '     dRRRRd     ', '    dRhRRRRd    ', '    dRRwRRRd    ', '   dRRRRRRwRd   ', '   dRwRRRRRRd   ',
      '   dRRRRRwRRd   ', '   dRRRRRRRRd   ', '    dRRwRRRd    ', '    dRRRRRRd    ', '     dddddd     ',
    ], { ...P, w: px.hex('#1a1a1a') });
    return img;
  });
  // the beetle: a ruby shell on a dark body, six legs that scuttle as it walks
  mod.client.texture('ruby:beetle_shell', (r) => {
    const img = px.newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px.set(img, x, y, (x === 7 || x === 8) ? RED[0] : r.int(7) === 0 ? RED[3] : RED[1 + r.int(2)]);
    for (const [x, y] of [[3, 4], [11, 5], [4, 10], [12, 11]]) { px.set(img, x, y, RED[4]); px.set(img, x + 1, y, RED[3]); }
    return img;
  });
  mod.client.texture('ruby:beetle_body', (r) => {
    const img = px.newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px.set(img, x, y, px.hex(r.int(3) ? '#1c1418' : '#2a2026'));
    return img;
  });
  const M = mod.mc.math, m = M.mat4();
  mod.client.entityRenderer('beetle', (r, e) => {
    const b = e as unknown as { lerpX(t: number): number; lerpY(t: number): number; lerpZ(t: number): number; pBodyYaw: number; bodyYaw: number; limbSwing: number; limbSwingAmount: number; hurtTime: number; deathTime: number };
    const t = r.partial;
    const x = b.lerpX(t), y = b.lerpY(t), z = b.lerpZ(t);
    const yaw = b.pBodyYaw + (b.bodyYaw - b.pBodyYaw) * t;
    const shell = r.tex('ruby:beetle_shell'), body = r.tex('ruby:beetle_body');
    const S6 = (i: number) => [i, i, i, i, i, i];
    const swing = Math.sin(b.limbSwing * 1.6) * b.limbSwingAmount * 2.5;
    const parts = [
      { x0: 4, y0: 2, z0: 3, x1: 12, y1: 6, z1: 13, tex: [shell, shell, body, shell, shell, shell] },
      { x0: 5.5, y0: 1.5, z0: 13, x1: 10.5, y1: 4.5, z1: 16, tex: S6(body) },
    ];
    for (let i = 0; i < 3; i++) {
      const off = (i % 2 ? swing : -swing);
      parts.push({ x0: 2, y0: 0, z0: 5 + i * 3 + off, x1: 4, y1: 2.5, z1: 6 + i * 3 + off, tex: S6(body) });
      parts.push({ x0: 12, y0: 0, z0: 5 + i * 3 - off, x1: 14, y1: 2.5, z1: 6 + i * 3 - off, tex: S6(body) });
    }
    // turn with the body around its middle; dying, it rolls over
    M.identity(m);
    M.translate(m, m, 0.5, 0, 0.5);
    M.rotateY(m, m, (-yaw * Math.PI) / 180);
    if (b.deathTime > 0) M.rotateZ(m, m, Math.min(1, (b.deathTime + t) / 10) * Math.PI);
    M.translate(m, m, -0.5, 0, -0.5);
    r.boxes(parts, x - 0.5, y, z - 0.5, m, undefined, b.hurtTime > 0 ? 0xff7070 : 0xffffff);
  });
  sprite('ruby:ruby_shovel', [
    '                ', '         ddd    ', '        dhRRd   ', '        dRRRd   ', '        dRRd    ', '       S dd     ',
    '      S         ', '     S          ', '    S           ', '   S            ', '                ', '                ',
  ]);
}
