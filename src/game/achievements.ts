// Classic achievements with the 1.8-style "Achievement get!" popup.
import type { Game } from './game';
import { B, isLog } from '../world/blocks';
import { I, I2, TOOLS } from './items';
import type { Ctx } from '../ui/gui';

interface Ach { id: string; name: string; desc: string; icon: number }

const LIST: Ach[] = [
  { id: 'openInventory', name: 'Taking Inventory', desc: "Press 'E' to open your inventory.", icon: 0 },
  { id: 'mineWood', name: 'Getting Wood', desc: 'Attack a tree until a block of wood pops out', icon: B.OAK_LOG },
  { id: 'buildWorkBench', name: 'Benchmarking', desc: 'Craft a workbench with four blocks of planks', icon: B.CRAFTING_TABLE },
  { id: 'buildPickaxe', name: 'Time to Mine!', desc: 'Use planks and sticks to make a pickaxe', icon: 0 },
  { id: 'buildFurnace', name: 'Hot Topic', desc: 'Construct a furnace out of eight cobblestone blocks', icon: B.FURNACE },
  { id: 'acquireIron', name: 'Acquire Hardware', desc: 'Smelt an iron ingot', icon: I.IRON_INGOT },
  { id: 'buildHoe', name: 'Time to Farm!', desc: 'Use planks and sticks to make a hoe', icon: 0 },
  { id: 'makeBread', name: 'Bake Bread', desc: 'Turn wheat into bread', icon: I.BREAD },
  { id: 'buildBetterPickaxe', name: 'Getting an Upgrade', desc: 'Construct a better pickaxe', icon: 0 },
  { id: 'buildSword', name: 'Time to Strike!', desc: 'Use planks and sticks to make a sword', icon: 0 },
  { id: 'killEnemy', name: 'Monster Hunter', desc: 'Attack and destroy a monster', icon: I.BONE },
  { id: 'killCow', name: 'Cow Tipper', desc: 'Harvest some leather', icon: I.LEATHER },
  { id: 'snipeSkeleton', name: 'Sniper Duel', desc: 'Kill a skeleton with an arrow from more than 50 meters', icon: I.BOW },
  { id: 'diamonds', name: 'DIAMONDS!', desc: 'Acquire diamonds with your iron tools', icon: I.DIAMOND },
  { id: 'portal', name: 'We Need to Go Deeper', desc: 'Build a portal to the Nether', icon: B.OBSIDIAN },
  { id: 'ghast', name: 'Return to Sender', desc: 'Destroy a Ghast with a fireball', icon: I.GHAST_TEAR },
  { id: 'bookcase', name: 'Librarian', desc: 'Build some bookshelves to improve your enchantment table', icon: B.BOOKSHELF },
  { id: 'onFire', name: 'Hot Stuff', desc: 'Get a lava bucket', icon: I.LAVA_BUCKET },
  { id: 'theEnd', name: 'The End?', desc: 'Step through an End portal', icon: 0 },
  { id: 'theEnd2', name: 'The End.', desc: 'Defeat the Ender Dragon', icon: B.DRAGON_EGG },
];

export class Achievements {
  unlocked = new Set<string>();
  private queue: { a: Ach; t: number }[] = [];
  /** Server side: a player earned one (their client shows it). */
  onUnlock: ((id: string, name: string) => void) | null = null;
  /** Client side: only the server awards achievements; the client just shows them. */
  passive = false;
  constructor(private game: Game) {
    const fix = (id: string, icon: number) => { const a = LIST.find((x) => x.id === id); if (a) a.icon = icon; };
    fix('openInventory', I.BOOK);
    fix('buildPickaxe', TOOLS.wooden_pickaxe);
    fix('buildHoe', TOOLS.wooden_hoe);
    fix('buildBetterPickaxe', TOOLS.stone_pickaxe);
    fix('buildSword', TOOLS.wooden_sword);
    fix('theEnd', I2.ENDER_EYE);
  }

  load(list: string[] | undefined) {
    this.unlocked = new Set(list ?? []);
    this.queue = [];
  }
  toJSON() {
    return [...this.unlocked];
  }

  unlock(id: string) {
    if (this.passive || this.unlocked.has(id) || this.game.panorama) return;
    const a = LIST.find((x) => x.id === id);
    if (!a) return;
    this.unlocked.add(id);
    this.onUnlock?.(id, a.name);
  }

  /** Client: the server says we earned one. */
  show(id: string) {
    const a = LIST.find((x) => x.id === id);
    if (!a) return;
    this.unlocked.add(id);
    this.queue.push({ a, t: performance.now() });
    this.game.audio.play('levelup', null, 0.35, 1.3);
  }

  // ------------------------------------------------------------------ triggers
  onPickup(id: number) {
    if (isLog(id)) this.unlock('mineWood');
    if (id === I.DIAMOND) this.unlock('diamonds');
    if (id === I.LEATHER) this.unlock('killCow');
  }
  onCraft(id: number) {
    if (id === B.CRAFTING_TABLE) this.unlock('buildWorkBench');
    if (id === B.FURNACE) this.unlock('buildFurnace');
    if (id === B.BOOKSHELF) this.unlock('bookcase');
    if (id === I.BREAD) this.unlock('makeBread');
    if (id === TOOLS.wooden_pickaxe) this.unlock('buildPickaxe');
    if (id === TOOLS.wooden_hoe) this.unlock('buildHoe');
    if (id === TOOLS.wooden_sword) this.unlock('buildSword');
    if (id === TOOLS.stone_pickaxe || id === TOOLS.iron_pickaxe || id === TOOLS.diamond_pickaxe) this.unlock('buildBetterPickaxe');
  }
  onSmelt(id: number) {
    if (id === I.IRON_INGOT) this.unlock('acquireIron');
  }
  onKill(type: string, byArrowFrom?: number, byFireball = false) {
    if (['Zombie', 'Skeleton', 'Creeper', 'Spider', 'Ghast', 'Zombified Piglin', 'Piglin', 'Piglin Brute', 'Hoglin', 'Zoglin', 'Wither Skeleton', 'Magma Cube', 'Blaze', 'Shulker', 'Enderman', 'Slime'].includes(type)) this.unlock('killEnemy');
    if (type === 'Skeleton' && byArrowFrom !== undefined && byArrowFrom > 50) this.unlock('snipeSkeleton');
    if (type === 'Ghast' && byFireball) this.unlock('ghast');
  }

  // ------------------------------------------------------------------ popup
  render(ctx: Ctx) {
    if (!this.queue.length) return;
    const c = this.game as unknown as import('../client/client').Client;
    const gui = c.gui;
    const cur = this.queue[0];
    const age = (performance.now() - cur.t) / 3000;
    if (age > 1) { this.queue.shift(); if (this.queue[0]) this.queue[0].t = performance.now(); return; }
    let slide = age * 2;
    if (slide > 1) slide = 2 - slide;
    slide = Math.min(1, slide * 4);
    slide = 1 - slide;
    slide = 1 - slide * slide * slide * slide;
    const x = gui.w - 160, y = Math.round(-32 + slide * 32);
    // 1.8 achievement frame: dark panel with a lighter border
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(x, y, 160, 32);
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(x + 1, y + 1, 158, 1);
    ctx.fillRect(x + 1, y + 1, 1, 30);
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(x + 1, y + 30, 158, 1);
    ctx.fillRect(x + 158, y + 1, 1, 30);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(x + 4, y + 4, 24, 24);
    ctx.drawImage(c.icons.get(cur.a.icon || I.BOOK), x + 8, y + 8, 16, 16);
    gui.text(ctx, 'Achievement get!', x + 30, y + 7, '#FFFF00', false);
    gui.text(ctx, cur.a.name, x + 30, y + 18, '#FFFFFF', false);
  }
}
