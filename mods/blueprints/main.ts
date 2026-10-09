// Blueprints: Litematica for this game. Select an area and save it as a schematic, or import one made in Java
// Edition (.litematic, .schem, .nbt, from 1.13 on); place schematics as ghost blocks to build from, with layers,
// a verifier and a material list; place blocks right where the ghost wants them (easy place) or paste the whole
// thing in creative; and export schematics for Java Edition, written for the version chosen. Blocks of other
// mods travel by their keys, and blocks this game lacks are kept (and can be given stand-ins).
//
// Files: nbt.ts (NBT), model.ts (schematics), vanilla.ts (blocks in Java's words, versions), tiles.ts (block
// entities), formats.ts (the file formats), library.ts (this browser's schematics), placement.ts, state.ts,
// capture.ts (saving an area), ghost.ts (comparing with the world, ghost blocks), render.ts (outlines,
// highlights), paste.ts + server.ts (pasting, easy place), blocks.ts (materials), ui.ts (screens).
import type { ModContext, Client, Ctx } from '../sdk';
import { initVanilla, gameName, VERSIONS } from './vanilla';
import { initBlocks, materials } from './blocks';
import { initFormats } from './formats';
import { initPlacements } from './placement';
import { initCapture } from './capture';
import { initRender, renderGlow } from './render';
import { initGhosts, tickGhosts, resetGhosts, ghostAlong } from './ghost';
import { initPaste, tickPaste, onPasteReply, pasting } from './paste';
import { serverSide, type PasteMsg, type PasteReply, type PlaceMsg } from './server';
import { makeScreens, loadRemaps, type Settings } from './ui';
import { state, changed, selectedPlacement, boxSize, addPlacement, newId } from './state';
import { Placement } from './placement';
import { readSchematic, writeSchematic } from './formats';
import { capture } from './capture';
import * as lib from './library';
import { totals } from './ghost';
import { initJavaWorld } from './javaworld';
import { initWorldIO, scanWorld, importWorld, exportWorld } from './worldio';
import { openZip, folderArchive } from './zip';
import { worldScreens } from './worldui';
import { startPaste, undoPaste } from './paste';

let cfg: Settings & { radius: number; tintMissing: boolean; menuKey: string };
let paste: ReturnType<ModContext['channel']>;

export function main(mod: ModContext) {
  initVanilla(mod.mc);
  initBlocks(mod.mc);
  initFormats(gameName);
  initPlacements(mod.mc);
  initCapture(mod.mc);
  initRender(mod.mc);
  initJavaWorld(mod.mc);
  cfg = mod.config({
    exportVersion: { type: 'enum', default: '1.20.4', options: VERSIONS.map(([n]) => n), label: 'Export For', description: 'The Java Edition version exported files are written for (newer versions read older files)' },
    pasteMode: { type: 'enum', default: 'all', options: ['all', 'solid', 'empty'], labels: ['All', 'No air', 'Into air'], label: 'Paste', description: 'All: an exact copy, air too. No air: air in the schematic leaves the world alone. Into air: only empty places are filled' },
    radius: { type: 'number', default: 32, min: 8, max: 96, step: 8, label: 'Highlight Distance', description: 'How far from you differences are highlighted' },
    tintMissing: { type: 'boolean', default: true, label: 'Tint Ghost Blocks', description: 'A light blue glow on blocks still to be placed' },
    menuKey: { type: 'key', default: 'KeyB', label: 'Menu Key' },
  }) as typeof cfg;

  mod.item('wand', { display: 'Blueprint Wand', maxStack: 1, tab: 'Tools' }, {
    tooltip: (_s, lines) => { lines.push('§7Left-click: first corner', '§7Right-click: second corner', '§7B (or the button): Blueprints menu'); },
  });
  mod.recipes.shapeless(['stick', 'paper'], 'blueprints:wand');
  // what a ghost shows for a block this game doesn't have
  mod.block('unknown', 'Unknown Block', { tex: 'blueprints:unknown', hardness: -1, item: false });

  paste = mod.channel<PasteMsg>('paste');
  const reply = mod.channel<PasteReply>('paste_reply');
  const place = mod.channel<PlaceMsg>('place');
  if (mod.realm === 'page') serverSide(mod.mc, paste as never, reply, place);
}

export function client(mod: ModContext) {
  const { pixels: px } = mod.mc;
  mod.client.texture('blueprints:white', () => { const img = px.newImg(); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px.set(img, x, y, px.hex('#ffffff')); return img; });
  mod.client.texture('blueprints:unknown', () => {
    const img = px.newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px.set(img, x, y, (x >> 2 ^ y >> 2) & 1 ? px.hex('#f800f8') : px.hex('#101010'));
    return img;
  });
  mod.client.itemSprite('blueprints:wand', () => {
    const img = px.newImg();
    px.art(img, ['            ##', '           #bb#', '          #bWb#', '         #bbb#', '        #bbb#', '       ##b#', '      #s##', '     #s#', '    #s#', '   #s#', '  #s#', ' #s#', '#s#', '##'],
      { '#': px.hex('#1a2a4a'), b: px.hex('#3f7fd8'), W: px.hex('#d8ecff'), s: px.hex('#8a5a2a') });
    return img;
  });
  loadRemaps();
  initWorldIO(mod.mc);
  worldScreens(mod);

  const layer = mod.client.ghostLayer();
  initGhosts(layer, () => mod.blockRef('unknown')?.id ?? 0);
  const say = (m: string) => mod.mc.client?.ui.chat.add(m);
  const bar = (client: Client, m: string) => client.ui.hud.actionBar(m);
  initPaste(paste as never, say);
  mod.channel<PasteReply>('paste_reply').onClient((r) => onPasteReply(r));
  const place = mod.channel<PlaceMsg>('place');
  const screens = makeScreens(mod, cfg, say);
  const wandId = () => mod.itemRef('wand')?.id ?? -1;
  const holdsWand = (c: Client) => c.player?.inventory.held()?.id === wandId();

  mod.client.keybind('menuKey', 'KeyB', (c) => screens.open(c));
  mod.client.touchButton('menu', {
    visible: (c) => !!c.player && !c.ui.screen && (holdsWand(c) || state.placements.length > 0),
    onPress: (c) => screens.open(c),
    label: 'BP',
  });

  mod.on('clientJoin', () => resetGhosts());
  mod.on('clientTick', (c) => {
    if (!c.player || !c.world) return;
    tickGhosts(c);
    tickPaste(c);
  });

  mod.on('clientClick', ({ client: c, button, target }) => {
    const p = c.player!;
    if (holdsWand(c)) {
      if (!target || target.ship) return 'success';
      if (state.wand === 'move') {
        const sel = selectedPlacement();
        if (sel && button === 2) {
          const f = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][target.face];
          sel.data.origin = [target.x + f[0], target.y + f[1], target.z + f[2]];
          sel.resolve();
          changed();
          bar(c, `${sel.data.name} moved to ${sel.data.origin.join(', ')}`);
        }
        return 'success';
      }
      const pos: [number, number, number] = [target.x, target.y, target.z];
      let box = state.boxes[state.active];
      if (!box) { box = { a: [...pos], b: [...pos] }; state.boxes[state.active] = box; }
      if (button === 0) box.a = pos;
      else if (button === 2) box.b = pos;
      changed();
      bar(c, `Corner ${button === 0 ? 1 : 2}: ${pos.join(', ')}  (${boxSize(box).join('x')})`);
      return 'success';
    }
    if (button !== 2 || !state.easyPlace || !state.placements.length) return;
    const eye = { x: p.x, y: p.y + p.eyeHeight(), z: p.z };
    const d = c.lookVec(p.yaw, p.pitch);
    const g = ghostAlong(c, eye.x, eye.y, eye.z, d.x, d.y, d.z, p.creative ? 5 : 4.5);
    if (!g) return;
    const cost = materials(g.v);
    if (!cost.length) return 'success';
    const [item, n] = cost[0];
    let slot = p.inventory.selected;
    if (!p.creative) {
      const has = (i: number) => { const s = p.inventory.main[i]; return !!s && s.id === item && s.count >= n; };
      if (!has(slot)) slot = [0, 1, 2, 3, 4, 5, 6, 7, 8].find(has) ?? -1;
      if (slot < 0) { bar(c, `§eNeeds ${mod.mc.getItem(item)?.display ?? 'an item'} in your hotbar`); return 'success'; }
      p.inventory.selected = slot;
    }
    place.toServer({ x: g.x, y: g.y, z: g.z, b: gameName(g.v), slot });
    return 'success';
  });

  // for the browser console and tests: window.blueprints
  (globalThis as unknown as { blueprints: unknown }).blueprints = {
    state, library: lib, totals, Placement, newId, addPlacement, changed,
    read: readSchematic, write: writeSchematic, capture: (c: Client, name: string) => capture(c, state.boxes, name, ''),
    paste: (mode = 'all') => { const p = selectedPlacement(); if (p) startPaste(p, mode as never); }, pasting, undo: undoPaste,
    worlds: { openZip, folderArchive, scan: scanWorld, import: importWorld, export: exportWorld },
    open: (name?: Parameters<typeof screens.open>[1]) => mod.mc.client && screens.open(mod.mc.client, name),
    /** The ghost block easy place would fill now (what the player looks at). */
    aim: () => { const c = mod.mc.client; if (!c?.player) return null; const p = c.player, d = c.lookVec(p.yaw, p.pitch); return ghostAlong(c, p.x, p.y + p.eyeHeight(), p.z, d.x, d.y, d.z, p.creative ? 5 : 4.5); },
  };

  mod.on('worldRenderGlow', (r) => renderGlow(r, { radius: cfg.radius, missing: cfg.tintMissing }));

  mod.on('hudRender', ({ ctx, client: c, width }: { ctx: Ctx; client: Client; width: number }) => {
    const gui = c.ui.gui;
    const lines: string[] = [];
    const job = pasting();
    if (job) lines.push(`§ePasting ${job.name}: ${job.done}/${job.total}${job.later.length ? ` (${job.later.length} parts waiting: go closer)` : ''}`);
    if (holdsWand(c)) {
      lines.push(state.wand === 'area' ? '§bWand: select area' : '§bWand: move placement (right-click)');
      const b = state.boxes[state.active];
      if (b) lines.push(`§7Box ${state.active + 1}: ${boxSize(b).join('x')}`);
    }
    if (state.easyPlace && state.placements.length) lines.push('§aEasy place');
    lines.forEach((l, i) => gui.text(ctx, l, width - gui.textWidth(l) - 4, 40 + i * 10, '#ffffff'));
  });
}
