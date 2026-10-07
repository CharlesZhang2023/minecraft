// Renders entities (mobs, dropped items, projectiles) and the first-person hand.
import { makeRenderContext, drawModTiles, modEntityRenderer, type RenderContext } from '../mod/render';
import { Events } from '../mod/events';
import { modState, guard } from '../mod/state';
import type { Client } from '../client/client';
import type { Renderer } from './renderer';
import type { Client as Game } from '../client/client';
import { Mat4, mat4, identity, translate, rotateX, rotateY, rotateZ, scale, multiply } from '../math';
import * as M from './models';
import { MOB_MODELS, MOB_SKINS } from './mobmodels';
import { MOB_MODELS2, MOB_SKINS2, MOB_POSES as MOB_POSES2 } from './mobmodels2';
import { MOB_MODELS3, MOB_SKINS3, MOB_POSES3, lazySkin } from './mobmodels3';
const MOB_POSES = { ...MOB_POSES2, ...MOB_POSES3 };
import { EvokerFangs, Guardian } from '../entity/overworldmobs';
import { WitherSkull } from '../entity/wither';
import { LeashKnot } from '../entity/leash';
import { ArmorStand } from '../entity/armorstand';
import { Hanging, ItemFrame, Painting } from '../entity/hanging';
import { ShulkerBullet } from '../entity/endmobs';
import { Entity } from '../entity/entity';
import { LivingEntity } from '../entity/living';
import { ItemEntity, FallingBlock, PrimedTnt, Arrow, XpOrb, Snowball, Fireball } from '../entity/item';
import { ThrownPotion } from '../entity/potion';
import { getItem, I, I6, I7, DYE_RGB } from '../game/items';
import { FireworkRocket } from '../entity/firework';
import { BLOCKS, TEXTURES, Render, B, B2, WOOD, T, T2, isLeaves, pack, isFacing6Cube, HORIZ_TO_FACE, HORIZ, PAINTING_TEX, Shape, metaOf, idOf, OPAQUE, isBanner, bannerColor } from '../world/blocks';
import { bannerPixels } from '../game/banners';
import { mapIdOf, mapRGB, MAP_SIZE, drawMapMarks } from '../game/maps';
import { modelBoxes, facing6CubeFaces, Box } from '../world/models';
import { DynMesh } from './gl';
import { poseMat4 } from '../sublevel/pose';
import { getTexture } from './textures';
import { Player } from '../game/player';
import { Boat } from '../entity/boat';
import { Minecart, CART_BLOCK } from '../entity/minecart';
import { Horse } from '../entity/horse';
import { HORSE_ARMOR } from '../game/items';
import { FishingHook } from '../entity/fishing';
import { EnderDragon, EndCrystal, dragonPose, DRAGON_SCALE } from '../entity/dragon';
import { EyeOfEnder } from '../entity/eye';
import { dragonModel, dragonSkin } from './dragonmodel';
import { decodeSkin, isCustom, isPreset, lookSlim, presetSkin } from './skins';

interface PartGPU { vao: WebGLVertexArrayObject; count: number; def: M.ModelPart }
interface ModelGPU { parts: Map<string, PartGPU> }

const DEG = Math.PI / 180;
/** First person: everything but the right arm (and its sleeve). */
const HAND_SKIP = new Set(['head', 'hat', 'body', 'jacket', 'leftArm', 'leftSleeve', 'rightLeg', 'rightPants', 'leftLeg', 'leftPants']);

/** The player model's outer layer moves with the part underneath it. */
function withOverlays<T>(pose: Record<string, T>) {
  for (const [o, p] of M.PLAYER_OVERLAYS) if (pose[p] !== undefined) pose[o] = pose[p];
  return pose;
}

export class EntityRenderer {
  private models = new Map<string, ModelGPU>();
  private skins = new Map<string, WebGLTexture>();
  private itemGeo = new Map<number, Float32Array>();
  private tmp = mat4();
  private tmp2 = mat4();
  private handMesh: DynMesh;
  private pickups: { e: ItemEntity; p: Entity; age: number; x: number; y: number; z: number }[] = [];

  constructor(private r: Renderer) {
    const gl = r.gl;
    const defs: Record<string, M.ModelDef> = {
      biped: M.bipedModel(), bipedThin: M.bipedModel(true), creeper: M.creeperModel(), pig: M.pigModel(), cow: M.cowModel(),
      sheep: M.sheepModel(), wool: M.sheepWoolModel(), chicken: M.chickenModel(), spider: M.spiderModel(), ghast: M.ghastModel(), blaze: M.blazeModel(),
      armor1: M.bipedModel(false, 1.0), armor2: M.bipedModel(false, 0.5), villager: M.villagerModel(), enderman: M.endermanModel(), slimeInner: M.slimeInnerModel(), slimeOuter: M.slimeOuterModel(), squid: M.squidModel(), bat: M.batModel(), wolf: M.wolfModel(),
      silverfish: M.silverfishModel(), crystal: M.crystalModel(), dragon: dragonModel(),
      horse: M.horseModel(false), donkey: M.horseModel(true), horseArmor: M.horseModel(false, 0.35),
      player: M.playerModel(false), playerSlim: M.playerModel(true), elytra: M.elytraModel(),
    };
    for (const [k, make] of Object.entries({ ...MOB_MODELS, ...MOB_MODELS2, ...MOB_MODELS3 })) defs[k] = make();
    for (const [k, d] of Object.entries(defs)) this.models.set(k, this.build(d));
    const skins: Record<string, M.Skin> = {
      steve: M.steveSkin(), zombie: M.zombieSkin(), skeleton: M.skeletonSkin(), creeper: M.creeperSkin(), pig: M.pigSkin(),
      cow: M.cowSkin(), sheep: M.sheepSkin(), wool: M.woolSkin(), chicken: M.chickenSkin(), spider: M.spiderSkin(),
      ghast: M.ghastSkin(false), blaze: M.blazeSkin(), ghastShoot: M.ghastSkin(true), pigman: M.pigmanSkin(), enderman: M.endermanSkin(), slime: M.slimeSkin(), squid: M.squidSkin(), bat: M.batSkin(), wolf: M.wolfSkin('wild'), wolfTame: M.wolfSkin('tame'), wolfAngry: M.wolfSkin('angry'),
      silverfish: M.silverfishSkin(), crystal: M.crystalSkin(), dragon: dragonSkin(), elytra: M.elytraSkin(),
    };
    for (const [k, make] of Object.entries({ ...MOB_SKINS, ...MOB_SKINS2, ...MOB_SKINS3 })) skins[k] = make();
    for (const [k, s] of Object.entries(skins)) this.skins.set(k, r.makeTexture(s.data, s.w));
    for (const k of ['iron', 'gold', 'diamond']) { const sk = M.horseArmorSkin(k); this.skins.set('horseArmor_' + k, r.makeTexture(sk.data, sk.w)); }
    for (const pr of M.PROFESSIONS) { const sk = M.villagerSkin(pr); this.skins.set('villager_' + pr, r.makeTexture(sk.data, sk.w)); }
    for (const m of M.ARMOR_MATERIALS) for (const l of [1, 2] as const) { const sk = M.armorSkin(m, l); this.skins.set(`armor_${m}_${l}`, r.makeTexture(sk.data, sk.w)); }
    this.handMesh = new DynMesh(gl);
    gl.bindVertexArray(this.handMesh.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.indexBuffer);
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------------ player skins
  private decoding = new Set<string>();
  /** Model and texture for a player's look. Imported skins decode in the background (Steve stands in meanwhile). */
  playerLook(look: string, slim: boolean): { model: string; skin: string } {
    if (isCustom(look)) {
      const key = 'look:' + look;
      if (this.skins.has(key)) return { model: slim ? 'playerSlim' : 'player', skin: key };
      if (!this.decoding.has(look)) {
        this.decoding.add(look);
        decodeSkin(look)
          .then(({ data }) => this.skins.set(key, this.r.makeTexture(data, 64)))
          .catch(() => this.skins.set(key, this.presetTexture('steve')));
      }
      look = 'steve';
    }
    const id = isPreset(look) ? look : 'steve';
    this.presetTexture(id);
    return { model: lookSlim(id, slim) ? 'playerSlim' : 'player', skin: 'look:' + id };
  }
  private presetTexture(id: string) {
    const key = 'look:' + id;
    let t = this.skins.get(key);
    if (!t) {
      t = this.r.makeTexture(presetSkin(id).data, 64);
      this.skins.set(key, t);
    }
    return t;
  }

  // ------------------------------------------------------------------ model building
  private build(def: M.ModelDef): ModelGPU {
    const gl = this.r.gl;
    const out: ModelGPU = { parts: new Map() };
    for (const p of def.parts) {
      const v: number[] = [];
      for (const b of p.boxes) this.boxGeometry(v, b, def.texW, def.texH);
      const vao = gl.createVertexArray()!;
      const vbo = gl.createBuffer()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.r.indexBuffer);
      gl.bindVertexArray(null);
      out.parts.set(p.name, { vao, count: v.length / 8, def: p });
    }
    return out;
  }

  private boxGeometry(v: number[], b: M.ModelBox, tw: number, th: number) {
    const g = b.inflate ?? 0;
    let x0 = b.x - g, x1 = b.x + b.w + g;
    const y0 = b.y - g, y1 = b.y + b.h + g, z0 = b.z - g, z1 = b.z + b.d + g;
    if (b.mirror) { const t = x0; x0 = x1; x1 = t; }
    const { u, v: vv, w, h, d } = b;
    // corners TL, TR, BR, BL as seen from outside; uv rect
    const faces: [number[][], number[], number[]][] = [
      [[[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [u + d, vv + d, u + d + w, vv + d + h], [0, 0, -1]], // front (-z)
      [[[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], [u + d + w + d, vv + d, u + d + w + d + w, vv + d + h], [0, 0, 1]], // back
      [[[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], [u, vv + d, u + d, vv + d + h], [-1, 0, 0]], // right (-x)
      [[[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [u + d + w, vv + d, u + d + w + d, vv + d + h], [1, 0, 0]], // left (+x)
      [[[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], [u + d, vv, u + d + w, vv + d], [0, -1, 0]], // top (-y)
      [[[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [u + d + w, vv, u + d + w + w, vv + d], [0, 1, 0]], // bottom
    ];
    for (const [c, uv, n] of faces) {
      let [u0, v0, u1, v1] = uv;
      if (b.mirror) { const t = u0; u0 = u1; u1 = t; }
      const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      // order TL, BL, BR, TR for CCW winding
      for (const k of [0, 3, 2, 1]) v.push(c[k][0], c[k][1], c[k][2], uvs[k][0] / tw, uvs[k][1] / th, n[0], n[1], n[2]);
    }
  }

  // ------------------------------------------------------------------ drawing
  private drawModel(model: string, skin: string, base: Mat4, pose: Record<string, [number, number, number]>, light: [number, number], overlay: [number, number, number, number], skip?: Set<string>, alpha = 1, offsets?: Record<string, [number, number, number]>) {
    const gl = this.r.gl;
    const m = this.models.get(model)!;
    const p = this.r.entityProg;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.u_viewProj, false, this.currentVP);
    this.r.setCommonUniforms(p);
    gl.uniform2f(p.u.u_light, light[0], light[1]);
    gl.uniform4fv(p.u.u_overlay, overlay);
    gl.uniform1f(p.u.u_alpha, alpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.skins.get(skin)!);
    gl.uniform1i(p.u.u_skin, 0);
    const parts = () => {
      for (const [name, part] of m.parts) {
        if (skip?.has(name)) continue;
        const d = part.def;
        const rot = pose[name] ?? [d.rx ?? 0, d.ry ?? 0, d.rz ?? 0];
        const off = offsets?.[name] ?? [0, 0, 0];
        const mm = this.tmp;
        translate(mm, base, (d.px + off[0]) / 16, (d.py + off[1]) / 16, (d.pz + off[2]) / 16);
        if (rot[2]) rotateZ(mm, mm, rot[2]);
        if (rot[1]) rotateY(mm, mm, rot[1]);
        if (rot[0]) rotateX(mm, mm, rot[0]);
        scale(mm, mm, 1 / 16, 1 / 16, 1 / 16);
        gl.uniformMatrix4fv(p.u.u_model, false, mm);
        gl.bindVertexArray(part.vao);
        gl.drawElements(gl.TRIANGLES, (part.count / 4) * 6, gl.UNSIGNED_INT, 0);
      }
    };
    parts();
    // the glowing effect: whatever of it is hidden behind blocks shows as a pale silhouette
    if (this.glow) {
      gl.depthFunc(gl.GREATER);
      gl.uniform4fv(p.u.u_overlay, [1, 1, 1, 0.85]);
      gl.uniform2f(p.u.u_light, 15, 15);
      parts();
      gl.depthFunc(gl.LEQUAL);
    }
    gl.bindVertexArray(null);
  }

  private currentVP: Mat4 = mat4();

  /** Model matrix for an entity at camera-relative position with MC's model-space flip. */
  private entityBase(out: Mat4, x: number, y: number, z: number, bodyYaw: number, deathRoll: number, sc = 1, extraY = 0, tilt?: [number, number]) {
    identity(out);
    translate(out, out, x, y, z);
    rotateY(out, out, (180 - bodyYaw) * DEG);
    // a glider lies along its look, banked toward where it's going
    if (tilt) {
      rotateX(out, out, tilt[0] * DEG);
      rotateY(out, out, tilt[1] * DEG);
    }
    if (deathRoll) rotateZ(out, out, deathRoll * DEG);
    if (sc !== 1) scale(out, out, sc, sc, sc);
    scale(out, out, -1, -1, 1);
    translate(out, out, 0, -1.501 + extraY, 0);
    return out;
  }

  render(game: Game, t: number) {
    const gl = this.r.gl, cam = this.r.cam, w = game.world!;
    this.currentVP = this.r.viewProj;
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    const dyn = this.r.dyn;
    dyn.reset();
    let modCtx: RenderContext | null = null;
    const list: Entity[] = [...game.entities];
    if (game.drawsSelf && game.player) list.push(game.player);
    for (const e of list) {
      // spectators are invisible to everyone else
      if (e instanceof Player && e.spectator && e !== game.player) continue;
      const x = e.lerpX(t) - cam.x, y = e.lerpY(t) - cam.y, z = e.lerpZ(t) - cam.z;
      if (x * x + y * y + z * z > 96 * 96) continue;
      if (!this.r.boxVisible(x - e.width, y - 0.5, z - e.width, x + e.width, y + e.height + 0.5, z + e.width)) continue;
      // light at the middle of the entity, or (when that's inside a solid block) the first open cell above it
      let ly = Math.floor(e.y + e.height * 0.5);
      for (let k = 0; k < 3 && OPAQUE[w.getId(Math.floor(e.x), ly, Math.floor(e.z))]; k++) ly++;
      const [sky, blk] = w.getLight(Math.floor(e.x), ly, Math.floor(e.z));
      const mr = modEntityRenderer(e);
      if (mr) { modCtx ??= makeRenderContext(game as unknown as Client, this, dyn, t); guard(mr.mod, 'entity renderer', () => mr.draw(modCtx!, e), undefined); continue; }
      if (e instanceof FireworkRocket) {
        // one pulling a glider flies with it (and isn't drawn in our own face)
        const a = e.attached;
        if (a === game.player && !game.drawsSelf) continue;
        const rx = a ? a.lerpX(t) - cam.x : x, ry = a ? a.lerpY(t) - cam.y : y, rz = a ? a.lerpZ(t) - cam.z : z;
        this.billboard(dyn, rx, ry + 0.125, rz, 0.25, TEXTURES.indexOf('item/firework_rocket'), 0xffffff, sky, blk);
      } else if (e instanceof ItemEntity) this.drawItemEntity(dyn, e, x, y, z, t, sky, blk);
      else if (e instanceof FallingBlock) this.blockModel(dyn, e.block, x - 0.5, y, z - 0.5, sky, blk);
      else if (e instanceof ThrownPotion) this.billboard(dyn, x, y + 0.125, z, 0.25, TEXTURES.indexOf('item/' + (getItem(e.item.id).sprite ?? 'glass_bottle')), 0xffffff, sky, blk);
      else if (e instanceof PrimedTnt) {
        const f = e.fuse - t + 1;
        let s = 1;
        if (f < 10) { const k = 1 - f / 10; s = 1 + k * k * k * k * 0.3; }
        const flash = Math.floor(e.fuse / 5) % 2 === 0;
        this.blockCube(dyn, B.TNT, x - 0.5 * s, y - (s - 1) / 2, z - 0.5 * s, s, sky, blk, flash ? 1 : 0);
      } else if (e instanceof Arrow) this.drawArrow(dyn, e, x, y, z, t, sky, blk);
      else if (e instanceof XpOrb) this.billboard(dyn, x, y + 0.25, z, 0.25, TEXTURES.indexOf('particle_spell'), 0x9ffc3a, 15, 15);
      else if (e instanceof Snowball) this.billboard(dyn, x, y + 0.125, z, 0.25, TEXTURES.indexOf('item/' + e.kind), 0xffffff, sky, blk);
      else if (e instanceof EyeOfEnder) this.billboard(dyn, x, y + 0.12, z, 0.4, TEXTURES.indexOf('item/ender_eye'), 0xffffff, 15, 15);
      else if (e instanceof WitherSkull) this.blockModel(dyn, pack(B2.WITHER_SKELETON_SKULL, 0), x - 0.5, y - 0.1, z - 0.5, 15, 15);
      else if (e instanceof Fireball) this.billboard(dyn, x, y + 0.5, z, e.small ? 0.35 : 1.0, TEXTURES.indexOf('item/fire_charge'), 0xffffff, 15, 15);
      else if (e instanceof Hanging) { this.drawHanging(dyn, e, x, y, z, sky, blk); if (e instanceof ItemFrame && mapIdOf(e.item) !== null) this.drawFramedMap(game, e, x, y, z, sky, blk); }
      else if (e instanceof EvokerFangs) this.drawFangs(e, x, y, z, t, sky, blk);
      else if (e instanceof ArmorStand) {
        const base = this.entityBase(this.tmp2, x, y, z, e.yaw, 0, 1);
        const pose: Record<string, [number, number, number]> = { head: [0, 0, 0], body: [0, 0, 0], rightArm: [-0.17, 0, 0.17], leftArm: [-0.17, 0, -0.17], rightLeg: [0, 0, 0.02], leftLeg: [0, 0, -0.02] };
        this.drawModel('armor_stand', 'armor_stand', base, pose, [sky, blk], [0, 0, 0, 0]);
        this.drawArmor(e.armorItems, base, pose, [sky, blk], [0, 0, 0, 0]);
      }
      else if (e instanceof LeashKnot) this.blockCube(dyn, B.OAK_PLANKS, x - 0.12, y - 0.12, z - 0.12, 0.25, sky, blk, 0);
      else if (e instanceof ShulkerBullet) this.billboard(dyn, x, y + 0.15, z, 0.35, TEXTURES.indexOf('item/nether_star'), 0xffffff, 15, 15);
      else if (e instanceof Boat) this.drawBoat(dyn, e, x, y, z, t, sky, blk);
      else if (e instanceof Minecart) this.drawMinecart(dyn, e, x, y, z, t, sky, blk);
      else if (e instanceof FishingHook) {
        this.billboard(dyn, x, y + 0.12, z, 0.35, TEXTURES.indexOf('item/fishing_bobber'), 0xffffff, sky, blk);
        this.fishingLine(game, e, x, y, z, t);
      }
      else if (e instanceof LivingEntity) { if (!e.effects.has('invisibility')) { this.glow = e.effects.has('glowing'); this.drawLiving(game, e, x, y, z, t, sky, blk); this.glow = false; } }
    }
    // beams from healing crystals to the dragon
    for (const e of list) {
      if (!(e instanceof EndCrystal) || !e.beam || e.removed || e.dead || (e.beam as EnderDragon).removed) continue;
      const d = e.beam as EnderDragon;
      if (d.dead) continue;
      this.beam(dyn, e.lerpX(t) - cam.x, e.lerpY(t) + 1.2 - cam.y, e.lerpZ(t) - cam.z, d.lerpX(t) - cam.x, d.lerpY(t) - 0.5 - cam.y, d.lerpZ(t) - cam.z, e.age + t);
    }
    // leads: a rope from each leashed mob to whoever holds it (or the fence knot)
    for (const e of list) {
      const h = (e as unknown as { leashHolder?: Entity | null }).leashHolder;
      if (!h || e.removed || h.removed) continue;
      const hy = h instanceof Player ? h.lerpY(t) + 1.0 : h.lerpY(t) + 0.2;
      this.beam(dyn, e.lerpX(t) - cam.x, e.lerpY(t) + e.height * 0.7 - cam.y, e.lerpZ(t) - cam.z, h.lerpX(t) - cam.x, hy - cam.y, h.lerpZ(t) - cam.z, 0, 0x6a4a2a, 0.03);
    }
    // guardians' lasers: blue while charging, warming to yellow just before they hit
    for (const e of list) {
      if (!(e instanceof Guardian) || !e.beamTarget || e.dead || e.removed) continue;
      const tg = e.beamTarget, k = Math.min(1, e.beam / e.chargeTime());
      const col = (Math.round(64 + 191 * k) << 16) | (Math.round(64 + 160 * k) << 8) | Math.round(255 - 128 * k);
      this.beam(dyn, e.lerpX(t) - cam.x, e.lerpY(t) + e.height / 2 - cam.y, e.lerpZ(t) - cam.z, tg.lerpX(t) - cam.x, tg.lerpY(t) + tg.height / 2 - cam.y, tg.lerpZ(t) - cam.z, e.age + t, col, 0.06 + 0.06 * k);
    }
    this.drawSignTexts(game, t);
    this.drawBanners(game);
    // beacon beams (the beacons' tiles keep their colour; 0 is off)
    if (w.dimension === 'overworld' || w.dimension === 'nether' || w.dimension === 'end') {
      const ccx = Math.floor(cam.x) >> 4, ccz = Math.floor(cam.z) >> 4;
      for (const c of w.chunks.values()) {
        if (!c.tiles.size || Math.abs(c.cx - ccx) > 8 || Math.abs(c.cz - ccz) > 8) continue;
        for (const [i, tl] of c.tiles) {
          const bt = tl as unknown as { type: string; beam?: number };
          if (bt.type !== 'beacon' || !bt.beam) continue;
          const bx = c.cx * 16 + (i & 15) + 0.5 - cam.x, by = (i >> 8) + 1 - cam.y, bz = c.cz * 16 + ((i >> 4) & 15) + 0.5 - cam.z;
          this.beam(dyn, bx, by, bz, bx, 256 - cam.y, bz, game.ticks + t, bt.beam, 0.2);
        }
      }
    }
    // an End gateway that was just opened or used: a beam straight up and down through it
    const gb = game.gatewayBeam;
    if (gb && game.ticks < gb.until && w.dimension === 'end') {
      const bx = gb.x + 0.5 - cam.x, by = gb.y + 0.5 - cam.y, bz = gb.z + 0.5 - cam.z;
      this.beam(dyn, bx, by, bz, bx, by + 80, bz, game.ticks + t);
      this.beam(dyn, bx, by, bz, bx, by - 80, bz, game.ticks + t);
    }
    // blocks being moved by pistons
    for (const [bv, bx, by, bz] of game.pistons.renderList(t)) {
      const [sky, blk] = w.getLight(Math.round(bx), Math.round(by), Math.round(bz));
      this.blockModel(dyn, bv, bx - cam.x, by - cam.y, bz - cam.z, sky, Math.max(blk, BLOCKS[bv & 0xfff].light));
    }
    // mods: tile entity renderers (animated machine parts) and anything else drawn into the world
    if (modState.active.size) {
      modCtx ??= makeRenderContext(game as unknown as Client, this, dyn, t);
      drawModTiles(modCtx);
      if (Events.worldRender.any) Events.worldRender.fire(modCtx);
    }
    // item pickup animations
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const a = this.pickups[i];
      const f = Math.min(1, (a.age + t) / 3);
      const px = a.p.lerpX(t), py = a.p.lerpY(t) + 0.8, pz = a.p.lerpZ(t);
      const ix = a.x + (px - a.x) * f * f - cam.x, iy = a.y + (py - a.y) * f * f - cam.y, iz = a.z + (pz - a.z) * f * f - cam.z;
      this.drawItemEntity(dyn, a.e, ix, iy, iz, t, 15, 0, true);
    }
    this.r.drawDyn(dyn, { cull: false });
    // mods' tile renderers on sub-levels: built relative to each one's pivot, drawn turned and placed with it
    if (modState.active.size) {
      for (const s of w.ships) {
        if (Math.abs(s.x - cam.x) > 64 + s.radius() || Math.abs(s.z - cam.z) > 64 + s.radius()) continue;
        const pose = s.poseAt(t);
        dyn.reset();
        drawModTiles(makeRenderContext(game as unknown as Client, this, dyn, t, { x: pose.lx, y: pose.ly, z: pose.lz, yaw: cam.yaw, pitch: cam.pitch }));
        if (dyn.count) this.r.drawDyn(dyn, { cull: false, model: poseMat4(pose, cam.x, cam.y, cam.z) });
      }
    }
    this.boatMasks(game, list, t);
    // soft round shadows under entities (vanilla-style, projected on block tops)
    const sh = this.r.dyn;
    sh.reset();
    const layer = TEXTURES.indexOf('entity_shadow');
    for (const e of list) {
      if (e === game.player && !game.drawsSelf) continue;
      if (e instanceof Player && e.spectator) continue;
      const size = e instanceof ItemEntity ? 0.15 : e instanceof LivingEntity ? Math.max(0.3, e.width * 0.7) * ((e as unknown as { baby?: boolean }).baby ? 0.5 : 1) : 0;
      if (size <= 0 || (e as LivingEntity).deathTime > 0) continue;
      const ex = e.lerpX(t), ey = e.lerpY(t), ez = e.lerpZ(t);
      if ((ex - cam.x) ** 2 + (ez - cam.z) ** 2 > 32 * 32) continue;
      const x0 = Math.floor(ex - size), x1 = Math.floor(ex + size), z0 = Math.floor(ez - size), z1 = Math.floor(ez + size);
      const y0 = Math.floor(ey - 2), y1 = Math.floor(ey);
      for (let bx = x0; bx <= x1; bx++)
        for (let bz = z0; bz <= z1; bz++)
          for (let by = y1; by >= y0; by--) {
            const id = w.getId(bx, by, bz);
            if (!BLOCKS[id].opaque) continue;
            if (BLOCKS[w.getId(bx, by + 1, bz)].opaque) break;
            const top = by + 1;
            const a = 0.5 * (1 - (ey - top) / 2);
            if (a <= 0) break;
            const [sl] = w.getLight(bx, by + 1, bz);
            const alpha = a * Math.max(0.3, sl / 15);
            const u0 = (bx - ex) / (2 * size) + 0.5, u1 = (bx + 1 - ex) / (2 * size) + 0.5;
            const v0 = (bz - ez) / (2 * size) + 0.5, v1 = (bz + 1 - ez) / (2 * size) + 0.5;
            const yy = top + 0.0156 - cam.y;
            const X0 = bx - cam.x, X1 = bx + 1 - cam.x, Z0 = bz - cam.z, Z1 = bz + 1 - cam.z;
            sh.v(X0, yy, Z0, u0, v0, layer, 0x000000, alpha, 15, 15);
            sh.v(X0, yy, Z1, u0, v1, layer, 0x000000, alpha, 15, 15);
            sh.v(X1, yy, Z1, u1, v1, layer, 0x000000, alpha, 15, 15);
            sh.v(X1, yy, Z0, u1, v0, layer, 0x000000, alpha, 15, 15);
            break;
          }
    }
    if (sh.count) {
      gl.depthMask(false);
      this.r.drawDyn(sh, { blend: true, cull: false, fullbright: true, alphaCut: 0.002 });
      gl.depthMask(true);
    }
  }

  tick() {
    for (let i = this.pickups.length - 1; i >= 0; i--) if (++this.pickups[i].age >= 3) this.pickups.splice(i, 1);
  }

  pickup(e: ItemEntity, p: Entity) {
    this.pickups.push({ e: Object.assign(Object.create(Object.getPrototypeOf(e)), e), p, age: 0, x: e.x, y: e.y, z: e.z });
  }

  /** A camera-facing ribbon between two camera-relative points (end crystal healing beam). */
  private beam(dyn: DynMesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number, time: number, col = 0xffffff, w = 0.28) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
    // side = dir x view
    let sx = dy * mz - dz * my, sy = dz * mx - dx * mz, sz = dx * my - dy * mx;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx = (sx / sl) * w; sy = (sy / sl) * w; sz = (sz / sl) * w;
    const len = Math.hypot(dx, dy, dz);
    const layer = TEXTURES.indexOf('end_beam');
    const v0 = -time * 0.08, v1 = v0 + len * 0.25;
    dyn.v(ax - sx, ay - sy, az - sz, 0, v0, layer, col, 1, 15, 15);
    dyn.v(ax + sx, ay + sy, az + sz, 1, v0, layer, col, 1, 15, 15);
    dyn.v(bx + sx, by + sy, bz + sz, 1, v1, layer, col, 1, 15, 15);
    dyn.v(bx - sx, by - sy, bz - sz, 0, v1, layer, col, 1, 15, 15);
  }

  /** Draw one part of a model with an explicit, fully prepared matrix (already scaled by 1/16). */
  private drawPart(model: string, skin: string, partName: string, mm: Mat4, light: [number, number], overlay: [number, number, number, number], alpha = 1) {
    const gl = this.r.gl;
    const part = this.models.get(model)!.parts.get(partName)!;
    const p = this.r.entityProg;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.u_viewProj, false, this.currentVP);
    this.r.setCommonUniforms(p);
    gl.uniform2f(p.u.u_light, light[0], light[1]);
    gl.uniform4fv(p.u.u_overlay, overlay);
    gl.uniform1f(p.u.u_alpha, alpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.skins.get(skin)!);
    gl.uniform1i(p.u.u_skin, 0);
    gl.uniformMatrix4fv(p.u.u_model, false, mm);
    gl.bindVertexArray(part.vao);
    gl.drawElements(gl.TRIANGLES, (part.count / 4) * 6, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  private drawDragon(e: EnderDragon, x: number, y: number, z: number, t: number, sky: number, blk: number) {
    const pose = dragonPose(e, t);
    const yaw = e.pyaw + wrapDelta(e.yaw - e.pyaw) * t;
    const base = this.entityBase(this.tmp2, x, y, z, yaw, 0, DRAGON_SCALE, 1.501);
    const light: [number, number] = [Math.max(sky, 11), Math.max(blk, 11)];
    const flash = e.dead ? Math.min(0.85, e.deathTicks / 200) : 0;
    const overlay: [number, number, number, number] = e.hurtTime > 0 ? [1, 0.2, 0.2, 0.35] : flash > 0 ? [1, 1, 1, flash] : [0, 0, 0, 0];
    const m = mat4(), q = mat4();
    const place = (name: string, px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0, sc = 1, lt = light, flipX = false) => {
      translate(m, base, px / 16, py / 16, pz / 16);
      if (flipX) scale(m, m, -1, 1, 1);
      if (rz) rotateZ(m, m, rz);
      if (ry) rotateY(m, m, ry);
      if (rx) rotateX(m, m, rx);
      if (sc !== 1) scale(m, m, sc, sc, sc);
      scale(q, m, 1 / 16, 1 / 16, 1 / 16);
      this.drawPart('dragon', 'dragon', name, q, lt, overlay);
    };
    place('body', 0, 0, 0);
    pose.neck.forEach((s, i) => place('neck', s.x, s.y, s.z, s.rx, s.ry, 0, 1 - i * 0.02));
    pose.tail.forEach((s, i) => place('tail', s.x, s.y, s.z, s.rx, s.ry, 0, 1 - i * 0.045));
    // head, eyes (glowing) and jaw
    const h = pose.head;
    place('head', h.x, h.y, h.z, h.rx, h.ry);
    place('eyes', h.x, h.y, h.z, h.rx, h.ry, 0, 1, [15, 15]);
    translate(m, base, h.x / 16, h.y / 16, h.z / 16);
    if (h.ry) rotateY(m, m, h.ry);
    rotateX(m, m, h.rx);
    translate(m, m, 0, 4 / 16, -8 / 16);
    rotateX(m, m, pose.jaw * 0.6);
    scale(q, m, 1 / 16, 1 / 16, 1 / 16);
    this.drawPart('dragon', 'dragon', 'jaw', q, light, overlay);
    // legs tucked under the body
    for (const side of [-1, 1]) {
      place('foreLeg', side * 9, 10, -20, pose.legs + 0.35, 0, side * -0.12, 1, light, side > 0);
      place('hindLeg', side * 11, 8, 18, pose.legs * 0.8 + 0.3, 0, side * -0.1, 1, light, side > 0);
    }
    // wings: bone + membrane, then the tip segment hinged at the end of the bone
    for (const side of [-1, 1]) {
      translate(m, base, (side * 12) / 16, -8 / 16, -10 / 16);
      if (side > 0) scale(m, m, -1, 1, 1);
      rotateY(m, m, 0.25 + pose.wing * 0.15);
      rotateZ(m, m, pose.wing);
      scale(q, m, 1 / 16, 1 / 16, 1 / 16);
      this.drawPart('dragon', 'dragon', 'wing', q, light, overlay);
      translate(m, m, -56 / 16, 0, 0);
      rotateZ(m, m, pose.tip - pose.wing * 0.4);
      scale(q, m, 1 / 16, 1 / 16, 1 / 16);
      this.drawPart('dragon', 'dragon', 'wingTip', q, light, overlay);
    }
  }

  private drawCrystal(e: EndCrystal, x: number, y: number, z: number, t: number, sky: number, blk: number) {
    const gl = this.r.gl;
    const age = e.age + t;
    const bob = Math.sin(age * 0.2) * 0.12 + 0.2;
    const spin = age * 0.05;
    const light: [number, number] = [Math.max(sky, 10), Math.max(blk, 12)];
    const overlay: [number, number, number, number] = [0, 0, 0, 0];
    const base = this.entityBase(this.tmp2, x, y + 1.1 + bob, z, 0, 0, 1.4, 1.501);
    const m = mat4(), q = mat4();
    const cube = (name: string, k: number, alpha: boolean) => {
      identity(m);
      translate(m, base, 0, 0, 0);
      rotateY(m, m, spin * k);
      rotateZ(m, m, Math.PI / 4);
      rotateX(m, m, 0.9553);
      rotateY(m, m, spin * k * 0.7);
      scale(q, m, 1 / 16, 1 / 16, 1 / 16);
      if (alpha) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
      this.drawPart('crystal', 'crystal', name, q, light, overlay);
      if (alpha) gl.disable(gl.BLEND);
    };
    cube('inner', 1.3, false);
    cube('outer', 1, true);
    // bedrock slab under it
    const bb = this.entityBase(this.tmp, x, y + 0.2, z, 0, 0, 1.4, 1.501);
    scale(q, bb, 1 / 16, 1 / 16, 1 / 16);
    translate(q, q, 0, 0, 0);
    this.drawPart('crystal', 'crystal', 'base', q, [sky, blk], overlay);
  }

  private drawLiving(game: Game, e: LivingEntity, x: number, y: number, z: number, t: number, sky: number, blk: number) {
    const gl = this.r.gl;
    const anyE = e as unknown as Record<string, unknown>;
    const model = (anyE.model as string) ?? 'biped';
    const skin = model === 'villager' && anyE.profession ? 'villager_' + (anyE.profession as string) : (anyE.skin as string) ?? 'steve';
    const bodyYaw = e.pBodyYaw + wrapDelta(e.bodyYaw - e.pBodyYaw) * t;
    const headYaw = e.pHeadYaw + wrapDelta(e.headYaw - e.pHeadYaw) * t;
    const pitch = e.ppitch + (e.pitch - e.ppitch) * t;
    const netHead = wrapDelta(headYaw - bodyYaw) * DEG;
    const hp = pitch * DEG;
    const ls = e.limbSwing - e.limbSwingAmount * (1 - t);
    const lsa = e.pLimbSwingAmount + (e.limbSwingAmount - e.pLimbSwingAmount) * t;
    const age = e.age + t;
    let deathRoll = 0;
    if (e.deathTime > 0) {
      let f = ((e.deathTime + t - 1) / 20) * 1.6;
      f = Math.sqrt(Math.max(0, f));
      deathRoll = Math.min(1, f) * 90;
    }
    const overlay: [number, number, number, number] = e.hurtTime > 0 || e.deathTime > 0 ? [1, 0, 0, 0.3] : [0, 0, 0, 0];
    const baby = !!anyE.baby;
    let sc = (baby ? 0.5 : 1) * ((anyE.renderScale as number) ?? 1);
    // creeper swell
    const swell = (anyE.swell as number) ?? 0;
    if (swell > 0) {
      const s = Math.min(1, swell + t * ((anyE.swellDir as number) ?? 0)) / 30 * 30;
      let f = Math.min(1, Math.max(0, s / 30));
      const wob = 1 + Math.sin(f * 100) * f * 0.01;
      f = f * f * f * f;
      sc *= (1 + f * 0.4) * wob;
      if (Math.floor(s / 30 * 10) % 2) overlay[0] = overlay[1] = overlay[2] = 1, overlay[3] = Math.max(overlay[3], s / 30 * 0.6);
    }
    let tilt: [number, number] | undefined;
    if (e instanceof Player && e.swimming && !e.gliding) tilt = [-90 - pitch, 0];
    else if (anyE.sleeping && (e instanceof Player || anyE.typeName === 'Villager')) tilt = [-90, 0];
    else if (e instanceof Player && e.gliding) {
      // vanilla RenderPlayer: swing level over the first second, then bank by the angle between look and motion
      const f = e.glideTicks + t, k = Math.min(1, (f * f) / 100);
      const yaw = (e.pyaw + wrapDelta(e.yaw - e.pyaw) * t) * DEG;
      const lx = -Math.sin(yaw), lz = Math.cos(yaw), mv = Math.hypot(e.vx, e.vz);
      let bank = 0;
      if (mv > 1e-6) {
        const cos = Math.max(-1, Math.min(1, (e.vx * lx + e.vz * lz) / mv));
        bank = Math.sign(e.vx * lz - e.vz * lx) * Math.acos(cos) / DEG;
      }
      tilt = [k * (-90 - pitch), bank];
    }
    const base = this.entityBase(this.tmp2, x, y, z, bodyYaw, deathRoll, sc, 0, tilt);
    const light: [number, number] = [sky, blk];
    const swing = e.pSwingProgress + (e.swingProgress - e.pSwingProgress) * t;
    const pose: Record<string, [number, number, number]> = {};
    const c = Math.cos;
    // the mobs whose models come with their own pose (mobmodels2)
    const gp = MOB_POSES[model];
    if (gp) {
      const o = gp({ e: anyE, hp, netHead, ls, lsa, age, t });
      const sk = o.skin ?? skin;
      if (!this.skins.has(sk)) { const made = lazySkin(sk); this.skins.set(sk, made ? this.r.makeTexture(made.data, made.w) : this.skins.get('steve')!); }
      this.drawModel(model, sk, base, o.pose, o.fullBright ? [15, 15] : light, overlay, o.skip, 1, o.offs);
      // what's held in the mouth (foxes) or paws (pandas)
      const held = anyE.heldItem as number | undefined;
      if (held && (model === 'fox' || model === 'panda')) this.drawHeldThirdPerson(held, base, [model === 'fox' ? -Math.PI / 2 : -1.2, 0, 0], light, model === 'fox' ? [5, -6, -11] : [5, -8, -16]);
      return;
    }
    switch (model) {
      case 'horse': this.drawHorse(e as Horse, base, t, light, overlay, hp, netHead, ls, lsa, age); break;
      case 'dragon': this.drawDragon(e as EnderDragon, x, y, z, t, sky, blk); return;
      case 'crystal': this.drawCrystal(e as EndCrystal, x, y, z, t, sky, blk); return;
      case 'silverfish': {
        for (let i = 0; i < 7; i++) pose['s' + i] = [0, Math.cos(age * 0.9 + i * 0.35) * Math.PI * 0.05 * (1 + lsa * 3), 0];
        const offs: Record<string, [number, number, number]> = {};
        for (let i = 0; i < 7; i++) offs['s' + i] = [Math.cos(age * 0.9 + i * 0.35 + 1) * 0.5 * (0.5 + lsa * 2), 0, 0];
        this.drawModel('silverfish', skin, base, pose, light, overlay, undefined, 1, offs);
        break;
      }
      case 'biped':
      case 'bipedThin':
      case 'illager':
      case 'illager_robed':
      case 'piglin': {
        const sneak = e.sneaking;
        pose.head = [hp, netHead, 0];
        // gliding: head up to look ahead, limbs nearly still once going fast
        const glide = e instanceof Player && e.gliding && e.glideTicks > 4;
        const lf = glide ? Math.max(1, ((e.vx * e.vx + e.vy * e.vy + e.vz * e.vz) / 0.2) ** 3) : 1;
        if (glide) pose.head = [-Math.PI / 4, netHead, 0];
        pose.hat = pose.head;
        let ra = (c(ls * 0.6662 + Math.PI) * 2 * lsa * 0.5) / lf, la = (c(ls * 0.6662) * 2 * lsa * 0.5) / lf;
        let raY = 0, laY = 0, raZ = 0, laZ = 0;
        const arms = anyE.armsPose as string | undefined;
        if (arms === 'zombie') { ra = la = -Math.PI / 2; raY = -0.1; laY = 0.1; }
        if (arms === 'bow') { ra = -Math.PI / 2 + hp; la = -Math.PI / 2 + hp; raY = -0.1 + netHead; laY = 0.1 + netHead + 0.4; }
        // spellcasting (evokers): both arms up, waving
        if (arms === 'cast') { ra = la = c(age * 0.6662) * 0.25; raZ = (Math.PI * 3) / 4; laZ = -(Math.PI * 3) / 4; }
        // 1.9+ item poses: bows drawn, crossbows charging or aimed, tridents raised, shields up
        const using = anyE.using as string | undefined;
        const heldStack = e instanceof Player ? e.inventory.held() : null;
        if (using === 'bow') { ra = -Math.PI / 2 + hp; la = -Math.PI / 2 + hp; raY = -0.1 + netHead; laY = 0.1 + netHead + 0.4; }
        else if (using === 'crossbow') { const k = Math.min(1, ((anyE.useTicks as number) ?? 0) / 25); ra = -0.97; raY = -0.8; la = -0.97 + k * 0.4; laY = 0.85 - k * 0.6; }
        else if (heldStack?.charged || (arms === 'bow' && (anyE.heldItem as number) === I7.CROSSBOW)) { ra = -1.5 + hp; raY = -0.3 + netHead; la = -1.5 + hp; laY = 0.6 + netHead; }
        else if (using === 'trident') { ra = ra * 0.5 - Math.PI; raY = 0; }
        if (anyE.blocking) {
          if (e instanceof Player && e.inventory.offhand?.id === I7.SHIELD && heldStack?.id !== I7.SHIELD) { la = la * 0.5 - 0.9424778; laY = -0.5235988; }
          else { ra = ra * 0.5 - 0.9424778; raY = 0.5235988; }
        }
        if (swing > 0) {
          const f1 = Math.sin(Math.sqrt(swing) * Math.PI * 2) * 0.2;
          let f = 1 - swing;
          f = 1 - f * f * f * f;
          const s = Math.sin(f * Math.PI), s2 = Math.sin(swing * Math.PI) * -(hp - 0.7) * 0.75;
          ra = ra - (s * 1.2 + s2);
          raY += f1 * 2;
          raZ += Math.sin(swing * Math.PI) * -0.4;
        }
        raZ += c(age * 0.09) * 0.05 + 0.05;
        laZ -= c(age * 0.09) * 0.05 + 0.05;
        ra += Math.sin(age * 0.067) * 0.05;
        la -= Math.sin(age * 0.067) * 0.05;
        if (anyE.holding && arms !== 'bow' && arms !== 'zombie' && !using && !anyE.blocking) ra = ra * 0.5 - Math.PI / 10;
        pose.rightArm = [ra + (sneak ? 0.4 : 0), raY, raZ];
        pose.leftArm = [la + (sneak ? 0.4 : 0), laY, laZ];
        pose.rightLeg = [(c(ls * 0.6662) * 1.4 * lsa) / lf, 0, 0];
        pose.leftLeg = [(c(ls * 0.6662 + Math.PI) * 1.4 * lsa) / lf, 0, 0];
        pose.body = [sneak ? 0.5 : 0, 0, 0];
        if ((e as unknown as { riding?: unknown }).riding) {
          pose.rightArm[0] -= Math.PI / 5;
          pose.leftArm[0] -= Math.PI / 5;
          pose.rightLeg = [-Math.PI * 2 / 5, Math.PI / 10, 0];
          pose.leftLeg = [-Math.PI * 2 / 5, -Math.PI / 10, 0];
        }
        const offs: Record<string, [number, number, number]> | undefined = sneak ? { rightLeg: [0, -3, 4], leftLeg: [0, -3, 4], head: [0, 1, 0], hat: [0, 1, 0] } : undefined;
        // players wear their own skin, outer layer and all (and so does a mob with a player's `look`)
        const look = e instanceof Player ? e.look : typeof anyE.look === 'string' ? anyE.look : null;
        if (look !== null) {
          const pl = this.playerLook(look, e instanceof Player ? e.slim : !!anyE.slim);
          withOverlays(pose);
          if (offs) withOverlays(offs);
          this.drawModel(pl.model, pl.skin, base, pose, light, overlay, undefined, 1, offs);
        } else this.drawModel(model, skin, base, pose, light, overlay, new Set(['hat']), 1, offs);
        // held item, and armour on a mob that wears some (`armorItems`: helmet, chest, legs, boots)
        const held = anyE.heldItem as number | undefined;
        if (held) this.drawHeldThirdPerson(held, base, pose.rightArm, light, offs?.rightArm);
        if (Array.isArray(anyE.armorItems)) this.drawArmor(anyE.armorItems as ({ id: number } | null)[], base, pose, light, overlay, offs);
        if (e instanceof Player) {
          // parrots riding on the shoulders
          for (const [side, sx] of [['shoulderLeft', 6], ['shoulderRight', -6]] as const) {
            const sp = e[side];
            if (!sp) continue;
            const po: Record<string, [number, number, number]> = {};
            for (const k of ['head', 'crest', 'body', 'wingL', 'wingR', 'tail', 'legL', 'legR']) po[k] = [sx, -24 + (sneak ? 3 : 0), 0];
            this.drawModel('parrot', 'parrot_' + ['red', 'blue', 'green', 'cyan', 'grey'][sp.variant % 5], base, { head: [hp * 0.5, netHead * 0.5, 0], crest: [hp * 0.5 - 0.21, netHead * 0.5, 0] }, light, overlay, undefined, 1, po);
          }
          this.drawArmor(e.inventory.armor, base, pose, light, overlay, offs);
          if (e.inventory.armor[1]?.id === I6.ELYTRA) this.drawElytra(e, base, light, overlay);
          const it = e.inventory.held();
          if (it) this.drawHeldThirdPerson(it.id, base, pose.rightArm, light);
          const oh = e.inventory.offhand;
          if (oh) this.drawHeldThirdPerson(oh.id, base, pose.leftArm, light, undefined, true);
        }
        break;
      }
      case 'creeper': {
        pose.head = [hp, netHead, 0];
        pose.leg1 = [c(ls * 0.6662) * 1.4 * lsa, 0, 0];
        pose.leg2 = [c(ls * 0.6662 + Math.PI) * 1.4 * lsa, 0, 0];
        pose.leg3 = [c(ls * 0.6662 + Math.PI) * 1.4 * lsa, 0, 0];
        pose.leg4 = [c(ls * 0.6662) * 1.4 * lsa, 0, 0];
        this.drawModel('creeper', 'creeper', base, pose, light, overlay);
        break;
      }
      case 'pig': case 'cow': case 'sheep': case 'hoglin': {
        const eat = (anyE.eatTimer as number) ?? 0;
        pose.head = [hp, netHead, 0];
        const offs: Record<string, [number, number, number]> = {};
        if (eat > 0 && model === 'sheep') {
          const f = eat > 4 && eat <= 36 ? 1 : eat <= 4 ? eat / 4 : -(eat - 40) / 4;
          offs.head = [0, 9 * f, 0];
          pose.head = [(eat > 4 && eat <= 36 ? 0.63 + 0.22 * Math.sin(((eat - 4) / 32) * 28.7) : 0.63 * f), netHead, 0];
        }
        pose.body = [Math.PI / 2, 0, 0];
        pose.leg1 = [c(ls * 0.6662) * 1.4 * lsa, 0, 0];
        pose.leg2 = [c(ls * 0.6662 + Math.PI) * 1.4 * lsa, 0, 0];
        pose.leg3 = [c(ls * 0.6662 + Math.PI) * 1.4 * lsa, 0, 0];
        pose.leg4 = [c(ls * 0.6662) * 1.4 * lsa, 0, 0];
        let base2 = base;
        if (baby) {
          // babies: big head, small body
          base2 = mat4();
          base2.set(base);
        }
        this.drawModel(model, skin, base2, pose, light, overlay, undefined, 1, offs);
        if (model === 'sheep' && !anyE.sheared) {
          const col = (anyE.woolColor as number[]) ?? [1, 1, 1];
          const ov: [number, number, number, number] = overlay[3] > 0 ? overlay : [col[0], col[1], col[2], col[0] === 1 && col[1] === 1 ? 0 : 0.75];
          this.drawModel('wool', 'wool', base2, pose, light, ov, undefined, 1, offs);
        }
        break;
      }
      case 'chicken': {
        pose.head = [hp, netHead, 0];
        pose.body = [Math.PI / 2, 0, 0];
        pose.rightLeg = [c(ls * 0.6662) * 1.4 * lsa, 0, 0];
        pose.leftLeg = [c(ls * 0.6662 + Math.PI) * 1.4 * lsa, 0, 0];
        const flap = (anyE.flap as number) ?? 0;
        const wf = (Math.sin(flap) + 1) * ((anyE.flapSpeed as number) ?? 0);
        pose.rightWing = [0, 0, wf];
        pose.leftWing = [0, 0, -wf];
        this.drawModel('chicken', 'chicken', base, pose, light, overlay);
        break;
      }
      case 'ghast': {
        for (let i = 0; i < 9; i++) pose['tentacle' + i] = [0.2 * Math.sin(age * 0.3 + i) + 0.4, 0, 0];
        const g4 = mat4();
        // ghasts are rendered at 4.5x the model scale
        identity(g4);
        translate(g4, g4, x, y - 1.85, z);
        rotateY(g4, g4, (180 - bodyYaw) * DEG);
        if (deathRoll) rotateZ(g4, g4, deathRoll * DEG);
        scale(g4, g4, -4.5, -4.5, 4.5);
        translate(g4, g4, 0, -1.501, 0);
        this.drawModel('ghast', (anyE.shooting as boolean) ? 'ghastShoot' : 'ghast', g4, pose, [15, 15], overlay);
        break;
      }
      case 'enderman': {
        const carrying = (anyE.carried as number) || 0;
        const angry = !!anyE.target;
        pose.head = [hp, netHead, 0];
        pose.jaw = [hp, netHead, 0];
        let ra = c(ls * 0.6662 + Math.PI) * 2 * lsa * 0.5 * 0.5, la = c(ls * 0.6662) * 2 * lsa * 0.5 * 0.5;
        ra = Math.max(-0.4, Math.min(0.4, ra)); la = Math.max(-0.4, Math.min(0.4, la));
        if (carrying) { ra = la = -0.5; }
        pose.rightArm = [ra, 0, carrying ? -0.05 : 0.05];
        pose.leftArm = [la, 0, carrying ? 0.05 : -0.05];
        pose.rightLeg = [Math.max(-0.4, Math.min(0.4, c(ls * 0.6662) * 1.4 * lsa * 0.5)), 0, 0];
        pose.leftLeg = [Math.max(-0.4, Math.min(0.4, c(ls * 0.6662 + Math.PI) * 1.4 * lsa * 0.5)), 0, 0];
        const offs: Record<string, [number, number, number]> = angry ? { head: [0, -5, 0] } : {};
        this.drawModel('enderman', 'enderman', base, pose, light, overlay, new Set(['jaw']), 1, offs);
        if (angry) this.drawModel('enderman', 'enderman', base, pose, light, overlay, new Set(['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']));
        if (carrying) {
          const m = mat4();
          translate(m, base, 0, (-14 + 6.75) / 16, -5 / 16);
          rotateX(m, m, 20 * DEG);
          rotateY(m, m, 45 * DEG);
          scale(m, m, -0.5, -0.5, 0.5);
          const dm = this.handMesh;
          dm.reset();
          this.appendItem(dm, carrying, m, light[0], light[1]);
          this.r.drawDyn(dm, { cull: false, viewProj: this.currentVP });
        }
        break;
      }
      case 'slime': {
        const size = (anyE.size as number) ?? 1;
        const sq = ((anyE.pSquish as number) ?? 0) + (((anyE.squish as number) ?? 0) - ((anyE.pSquish as number) ?? 0)) * t;
        const f = 1 / (sq / (size * 0.5 + 1) + 1);
        const sb = mat4();
        identity(sb);
        translate(sb, sb, x, y, z);
        rotateY(sb, sb, (180 - bodyYaw) * DEG);
        if (deathRoll) rotateZ(sb, sb, deathRoll * DEG);
        scale(sb, sb, size * f, size / f, size * f);
        scale(sb, sb, -1, -1, 1);
        translate(sb, sb, 0, -1.501, 0);
        this.drawModel('slimeInner', skin, sb, pose, light, overlay);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        this.drawModel('slimeOuter', skin, sb, pose, light, overlay, undefined, 1);
        gl.disable(gl.BLEND);
        break;
      }
      case 'shulker': {
        // the lid rises and turns as it peeks; the head looks out from inside
        const pk = ((anyE.pPeek as number) ?? 0) + (((anyE.peek as number) ?? 0) - ((anyE.pPeek as number) ?? 0)) * t;
        pose.lid = [0, pk * Math.PI * 0.75, 0];
        pose.head = [hp, netHead, 0];
        const offs: Record<string, [number, number, number]> = { lid: [0, -pk * 8, 0], head: [0, -pk * 4, 0] };
        const sb = this.entityBase(this.tmp2, x, y, z, 0, deathRoll, 1);
        this.drawModel('shulker', skin, sb, pose, light, overlay, undefined, 1, offs);
        break;
      }
      case 'strider': {
        // legs stride in turn, the body bobs with them; cold striders shiver
        const cold = !!anyE.cold;
        const sw = c(ls * 1.5) * 2 * lsa;
        pose.rightLeg = [sw * 0.5, 0, 0.1];
        pose.leftLeg = [-sw * 0.5, 0, -0.1];
        const offs: Record<string, [number, number, number]> = { body: [cold ? Math.sin(age * 2) * 0.2 : 0, -Math.abs(c(ls * 1.5)) * 2 * lsa, 0] };
        offs.bristle1 = offs.bristle2 = offs.bristle3 = offs.body;
        pose.bristle1 = [0, 0, 0.9 + Math.sin(age * 0.1) * 0.1];
        pose.bristle2 = [0, 0, -0.9 - Math.sin(age * 0.1) * 0.1];
        this.drawModel('strider', cold ? 'strider_cold' : 'strider', base, pose, light, overlay, undefined, 1, offs);
        if (anyE.saddled) { /* the saddle shows as a darker band on top of the body */ }
        break;
      }
      case 'blaze': {
        // three rings of four rods orbiting at different speeds (ModelBlaze)
        const offs: Record<string, [number, number, number]> = {};
        let f = age * Math.PI * -0.1;
        for (let i = 0; i < 4; i++, f += Math.PI / 2) offs['rod' + i] = [Math.cos(f) * 9 - 1, -2 + Math.cos((i * 2 + age) * 0.25), Math.sin(f) * 9 - 1];
        f = Math.PI / 4 + age * Math.PI * 0.03;
        for (let i = 4; i < 8; i++, f += Math.PI / 2) offs['rod' + i] = [Math.cos(f) * 7 - 1, 2 + Math.cos((i * 2 + age) * 0.25), Math.sin(f) * 7 - 1];
        f = 0.47123894 + age * Math.PI * -0.05;
        for (let i = 8; i < 12; i++, f += Math.PI / 2) offs['rod' + i] = [Math.cos(f) * 5 - 1, 11 + Math.cos((i * 1.5 + age) * 0.5), Math.sin(f) * 5 - 1];
        pose.head = [hp, netHead, 0];
        this.drawModel('blaze', 'blaze', base, pose, [15, 15], overlay, undefined, 1, offs);
        break;
      }
      case 'squid': {
        const tent = (anyE.tentacle as number) ?? 0;
        for (let i = 0; i < 8; i++) pose['t' + i] = [tent, (i * Math.PI * -2) / 8 + Math.PI / 2, 0];
        const tilt = ((anyE.tilt as number) ?? 0) * DEG;
        const sq = mat4();
        identity(sq);
        translate(sq, sq, x, y + 0.5, z);
        rotateY(sq, sq, (180 - bodyYaw) * DEG);
        rotateX(sq, sq, tilt);
        if (deathRoll) rotateZ(sq, sq, deathRoll * DEG);
        translate(sq, sq, 0, -1.2, 0);
        scale(sq, sq, -1, -1, 1);
        translate(sq, sq, 0, -1.501, 0);
        this.drawModel('squid', 'squid', sq, pose, light, overlay);
        break;
      }
      case 'wolf': {
        const sitting = !!anyE.sitting;
        pose.head = [hp, netHead, 0];
        const tail = (anyE.owner ? (0.55 - (20 - e.health) * 0.02) * Math.PI : Math.PI / 5) + (sitting ? 0 : c(ls * 0.6662) * 1.4 * lsa * 0.3);
        pose.tail = [tail, 0, 0];
        const offs: Record<string, [number, number, number]> = {};
        if (sitting) {
          pose.mane = [(Math.PI * 2) / 5, 0, 0];
          pose.body = [Math.PI / 4, 0, 0];
          offs.mane = [0, 2, -1]; offs.body = [0, 4, 0]; offs.tail = [0, 7, -2];
          pose.leg1 = [(Math.PI * 3) / 2, 0, 0]; pose.leg2 = [(Math.PI * 3) / 2, 0, 0];
          offs.leg1 = [0, 6.9, -2]; offs.leg2 = [0, 6.9, -2];
          pose.leg3 = [5.811947, 0, 0]; pose.leg4 = [5.811947, 0, 0];
          offs.leg3 = [0.01, 1, 0]; offs.leg4 = [-0.01, 1, 0];
        } else {
          pose.body = [Math.PI / 2, 0, 0];
          pose.mane = [Math.PI / 2, 0, 0];
          pose.leg1 = [c(ls * 0.6662) * 1.4 * lsa, 0, 0];
          pose.leg2 = [c(ls * 0.6662 + Math.PI) * 1.4 * lsa, 0, 0];
          pose.leg3 = [c(ls * 0.6662 + Math.PI) * 1.4 * lsa, 0, 0];
          pose.leg4 = [c(ls * 0.6662) * 1.4 * lsa, 0, 0];
        }
        const sk = anyE.angry ? 'wolfAngry' : anyE.owner ? 'wolfTame' : 'wolf';
        this.drawModel('wolf', sk, base, pose, light, overlay, undefined, 1, offs);
        break;
      }
      case 'bat': {
        const hanging = !!anyE.hanging;
        const flap = Math.cos(age * 1.3) * Math.PI * 0.25;
        pose.rightWing = hanging ? [0, -0.15, 0] : [0, flap, 0];
        pose.leftWing = hanging ? [0, 0.15, 0] : [0, -flap, 0];
        pose.body = [hanging ? 0 : Math.PI / 4 + Math.cos(age * 0.1) * 0.15, 0, 0];
        const bm = mat4();
        identity(bm);
        translate(bm, bm, x, y + (hanging ? 0.9 : 0), z);
        rotateY(bm, bm, (180 - bodyYaw) * DEG);
        if (hanging) rotateX(bm, bm, Math.PI);
        scale(bm, bm, 0.35, 0.35, 0.35);
        scale(bm, bm, -1, -1, 1);
        translate(bm, bm, 0, hanging ? -1.2 : -1.0, 0);
        this.drawModel('bat', 'bat', bm, pose, light, overlay);
        break;
      }
      case 'villager':
      case 'witch': {
        pose.head = [hp, netHead, 0];
        pose.arms = [-0.75, 0, 0];
        pose.rightLeg = [c(ls * 0.6662) * 1.4 * lsa * 0.5, 0, 0];
        pose.leftLeg = [c(ls * 0.6662 + Math.PI) * 1.4 * lsa * 0.5, 0, 0];
        pose.hat = pose.head;
        this.drawModel(model, skin, base, pose, light, overlay);
        // a witch drinking holds the bottle up
        const held = anyE.heldItem as number | undefined;
        if (held) this.drawHeldThirdPerson(held, base, [-1.2, 0, 0], light);
        break;
      }
      case 'spider': {
        pose.head = [hp, netHead, 0];
        const f = Math.PI / 4, f1 = Math.PI / 8;
        const zr = [-f, f, -f * 0.74, f * 0.74, -f * 0.74, f * 0.74, -f, f];
        const yr = [f1 * 2, -f1 * 2, f1, -f1, -f1, f1, -f1 * 2, f1 * 2];
        const k = ls * 0.6662 * 2;
        const f3 = -(c(k) * 0.4) * lsa, f4 = -(c(k + Math.PI) * 0.4) * lsa, f5 = -(c(k + Math.PI / 2) * 0.4) * lsa, f6 = -(c(k + Math.PI * 1.5) * 0.4) * lsa;
        const f7 = Math.abs(Math.sin(ls * 0.6662) * 0.4) * lsa, f8 = Math.abs(Math.sin(ls * 0.6662 + Math.PI) * 0.4) * lsa, f9 = Math.abs(Math.sin(ls * 0.6662 + Math.PI / 2) * 0.4) * lsa, f10 = Math.abs(Math.sin(ls * 0.6662 + Math.PI * 1.5) * 0.4) * lsa;
        const dy = [f3, -f3, f4, -f4, f5, -f5, f6, -f6];
        const dz = [f7, -f7, f8, -f8, f9, -f9, f10, -f10];
        for (let i = 0; i < 8; i++) pose['leg' + (i + 1)] = [0, yr[i] + dy[i], zr[i] + dz[i]];
        this.drawModel('spider', skin, base, pose, light, overlay);
        break;
      }
    }
  }

  /** Armor layers over a biped pose. */
  private drawArmor(armor: ({ id: number; tag?: Record<string, unknown> } | null)[], base: Mat4, pose: Record<string, [number, number, number]>, light: [number, number], overlay: [number, number, number, number], offs?: Record<string, [number, number, number]>) {
    const all = ['head', 'hat', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];
    const parts: [number, number, string[]][] = [[0, 1, ['head']], [1, 1, ['body', 'rightArm', 'leftArm']], [2, 2, ['body', 'rightLeg', 'leftLeg']], [3, 1, ['rightLeg', 'leftLeg']]];
    for (const [slot, layer, show] of parts) {
      const a = armor[slot];
      if (!a) continue;
      const name = getItem(a.id).name;
      const mat = name.split('_')[0];
      const skin = `armor_${mat}_${layer}`;
      if (!this.skins.has(skin)) continue;
      // dyed leather: washed towards its colour (unless the hurt flash is showing)
      const col = typeof a.tag?.color === 'number' ? (a.tag.color as number) : undefined;
      const ov: [number, number, number, number] = col !== undefined && overlay[3] === 0 ? [((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255, 0.55] : overlay;
      this.drawModel(layer === 1 ? 'armor1' : 'armor2', skin, base, pose, light, ov, new Set(all.filter((p) => !show.includes(p))), 1, offs);
    }
  }

  /** Smoothed wing angles per player (vanilla eases them a tenth of the way each frame). */
  private wings = new WeakMap<Entity, number[]>();
  /** Elytra on a player's back: folded, half open while sneaking, spread while gliding (less in a steep dive). */
  private drawElytra(e: Player, base: Mat4, light: [number, number], overlay: [number, number, number, number]) {
    let x = 15 * DEG, y = 0, z = -15 * DEG, py = 0;
    if (e.gliding) {
      let f = 1;
      if (e.vy < 0) f = 1 - Math.pow(-e.vy / (Math.hypot(e.vx, e.vy, e.vz) || 1), 1.5);
      x = f * 20 * DEG + (1 - f) * x;
      z = f * -90 * DEG + (1 - f) * z;
    } else if (e.sneaking) { x = 40 * DEG; z = -45 * DEG; y = 5 * DEG; py = 3; }
    const want = [x, y, z, py];
    let w = this.wings.get(e);
    if (!w) this.wings.set(e, (w = want));
    for (let i = 0; i < 4; i++) w[i] += (want[i] - w[i]) * 0.1;
    const pose: Record<string, [number, number, number]> = { leftWing: [w[0], w[1], w[2]], rightWing: [w[0], -w[1], -w[2]] };
    const offs: Record<string, [number, number, number]> = { leftWing: [0, w[3], 0], rightWing: [0, w[3], 0] };
    this.drawModel('elytra', 'elytra', base, pose, light, overlay, undefined, 1, offs);
  }

  private drawHeldThirdPerson(id: number, base: Mat4, armRot: [number, number, number], light: [number, number], off?: [number, number, number], left = false) {
    const m = mat4();
    const side = left ? -1 : 1;
    translate(m, base, (-5 * side) / 16 + (off?.[0] ?? 0) / 16, 2 / 16 + (off?.[1] ?? 0) / 16, (off?.[2] ?? 0) / 16);
    rotateZ(m, m, armRot[2]);
    rotateY(m, m, armRot[1]);
    rotateX(m, m, armRot[0]);
    translate(m, m, (-1 * side) / 16, 7 / 16, 1 / 16);
    if (left) scale(m, m, -1, 1, 1);
    const it = getItem(id);
    if (it.block !== undefined && !it.flatBlock && !it.sprite) {
      // LayerHeldItem (1.8) block transform, in model space, then flip back to y-up
      translate(m, m, 0, 0.1875, -0.3125);
      rotateX(m, m, 20 * DEG);
      rotateY(m, m, 45 * DEG);
      scale(m, m, -0.375, -0.375, 0.375);
    } else {
      // flat item: sprite plane along the arm's forward axis, grip in the fist, blade forward/up
      scale(m, m, -1, -1, 1);
      const s = 0.62;
      translate(m, m, 0, 0.3 * s - 0.02, -0.3 * s);
      rotateY(m, m, 90 * DEG);
      scale(m, m, s, s, s);
    }
    const dm = this.handMesh;
    dm.reset();
    this.appendItem(dm, id, m, light[0], light[1]);
    this.r.drawDyn(dm, { cull: false, viewProj: this.currentVP });
  }

  // ------------------------------------------------------------------ items
  /** Geometry for an item centred at the origin, 1 unit wide: [x,y,z,u,v,layer,shade] per vertex. */
  itemGeometry(id: number): Float32Array {
    let g = this.itemGeo.get(id);
    if (g) return g;
    const it = getItem(id);
    const v: number[] = [];
    if (it.block !== undefined && !it.flatBlock && !it.sprite) {
      const def = BLOCKS[it.block];
      const boxes = def.render === Render.Model ? modelBoxes(pack(it.block, it.block === B.CHEST ? 2 : 0)) : [{ x0: 0, y0: 0, z0: 0, x1: 16, y1: 16, z1: 16, tex: def.faces.slice(0, 6) }];
      if (def.faces.length > 6 && def.render === Render.Cube) boxes[0].tex[5] = def.faces[6];
      if (it.block === B.GRASS) { const gs = TEXTURES.indexOf('grass_side_item'); if (gs >= 0) for (const f of [0, 1, 4, 5]) boxes[0].tex[f] = gs; }
      for (const b of boxes) {
        const a = [b.x0 / 16 - 0.5, b.y0 / 16 - 0.5, b.z0 / 16 - 0.5], c = [b.x1 / 16 - 0.5, b.y1 / 16 - 0.5, b.z1 / 16 - 0.5];
        const s = { x0: b.x0 / 16, y0: b.y0 / 16, z0: b.z0 / 16, x1: b.x1 / 16, y1: b.y1 / 16, z1: b.z1 / 16 };
        const shades = [0.6, 0.6, 0.5, 1, 0.8, 0.8];
        const F: [number[][], number[][]][] = [
          [[[a[0], a[1], a[2]], [a[0], a[1], c[2]], [a[0], c[1], c[2]], [a[0], c[1], a[2]]], [[s.z0, 1 - s.y0], [s.z1, 1 - s.y0], [s.z1, 1 - s.y1], [s.z0, 1 - s.y1]]],
          [[[c[0], a[1], c[2]], [c[0], a[1], a[2]], [c[0], c[1], a[2]], [c[0], c[1], c[2]]], [[1 - s.z1, 1 - s.y0], [1 - s.z0, 1 - s.y0], [1 - s.z0, 1 - s.y1], [1 - s.z1, 1 - s.y1]]],
          [[[a[0], a[1], a[2]], [c[0], a[1], a[2]], [c[0], a[1], c[2]], [a[0], a[1], c[2]]], [[s.x0, s.z0], [s.x1, s.z0], [s.x1, s.z1], [s.x0, s.z1]]],
          [[[a[0], c[1], a[2]], [a[0], c[1], c[2]], [c[0], c[1], c[2]], [c[0], c[1], a[2]]], [[s.x0, s.z0], [s.x0, s.z1], [s.x1, s.z1], [s.x1, s.z0]]],
          [[[c[0], a[1], a[2]], [a[0], a[1], a[2]], [a[0], c[1], a[2]], [c[0], c[1], a[2]]], [[1 - s.x1, 1 - s.y0], [1 - s.x0, 1 - s.y0], [1 - s.x0, 1 - s.y1], [1 - s.x1, 1 - s.y1]]],
          [[[a[0], a[1], c[2]], [c[0], a[1], c[2]], [c[0], c[1], c[2]], [a[0], c[1], c[2]]], [[s.x0, 1 - s.y0], [s.x1, 1 - s.y0], [s.x1, 1 - s.y1], [s.x0, 1 - s.y1]]],
        ];
        F.forEach(([pts, uvs], f) => {
          for (let k = 0; k < 4; k++) v.push(pts[k][0], pts[k][1], pts[k][2], uvs[k][0], uvs[k][1], b.tex[f], shades[f] + (def.tint !== 'none' && (it.block !== B.GRASS || f === 3) ? 10 : 0));
        });
      }
    } else {
      // extruded sprite
      let layer: number;
      let img: Uint8ClampedArray;
      if (it.sprite) { layer = TEXTURES.indexOf('item/' + it.sprite); img = getTexture('item/' + it.sprite); }
      else { layer = BLOCKS[it.block!].icon ?? BLOCKS[it.block!].faces[0]; img = getTexture(TEXTURES[layer]); }
      if (layer < 0) layer = 0;
      const tintFlag = !it.sprite && BLOCKS[it.block!].tint !== 'none' ? 10 : 0;
      const d = 1 / 32;
      v.push(-0.5, -0.5, d, 0, 1, layer, 1 + tintFlag, 0.5, -0.5, d, 1, 1, layer, 1 + tintFlag, 0.5, 0.5, d, 1, 0, layer, 1 + tintFlag, -0.5, 0.5, d, 0, 0, layer, 1 + tintFlag);
      v.push(0.5, -0.5, -d, 1, 1, layer, 0.8 + tintFlag, -0.5, -0.5, -d, 0, 1, layer, 0.8 + tintFlag, -0.5, 0.5, -d, 0, 0, layer, 0.8 + tintFlag, 0.5, 0.5, -d, 1, 0, layer, 0.8 + tintFlag);
      const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && (img?.[(y * 16 + x) * 4 + 3] ?? 0) > 20;
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          if (!opaque(x, y)) continue;
          const x0 = x / 16 - 0.5, x1 = (x + 1) / 16 - 0.5, y0 = 0.5 - (y + 1) / 16, y1 = 0.5 - y / 16;
          const u = (x + 0.5) / 16, vv = (y + 0.5) / 16;
          if (!opaque(x - 1, y)) v.push(x0, y0, -d, u, vv, layer, 0.6 + tintFlag, x0, y0, d, u, vv, layer, 0.6 + tintFlag, x0, y1, d, u, vv, layer, 0.6 + tintFlag, x0, y1, -d, u, vv, layer, 0.6 + tintFlag);
          if (!opaque(x + 1, y)) v.push(x1, y0, d, u, vv, layer, 0.6 + tintFlag, x1, y0, -d, u, vv, layer, 0.6 + tintFlag, x1, y1, -d, u, vv, layer, 0.6 + tintFlag, x1, y1, d, u, vv, layer, 0.6 + tintFlag);
          if (!opaque(x, y - 1)) v.push(x0, y1, -d, u, vv, layer, 1 + tintFlag, x0, y1, d, u, vv, layer, 1 + tintFlag, x1, y1, d, u, vv, layer, 1 + tintFlag, x1, y1, -d, u, vv, layer, 1 + tintFlag);
          if (!opaque(x, y + 1)) v.push(x0, y0, d, u, vv, layer, 0.5 + tintFlag, x0, y0, -d, u, vv, layer, 0.5 + tintFlag, x1, y0, -d, u, vv, layer, 0.5 + tintFlag, x1, y0, d, u, vv, layer, 0.5 + tintFlag);
        }
    }
    g = new Float32Array(v);
    this.itemGeo.set(id, g);
    return g;
  }

  /** Append item geometry transformed by m (camera-relative). */
  appendItem(mesh: DynMesh, id: number, m: Mat4, sky: number, blk: number, alpha = 1) {
    const g = this.itemGeometry(id);
    const it = getItem(id);
    const tintBlock = it.block !== undefined ? BLOCKS[it.block] : undefined;
    const tintCol = tintBlock ? (tintBlock.tint === 'grass' ? 0x7cbd6b : isLeaves(tintBlock.id) || tintBlock.tint === 'foliage' ? 0x48b518 : tintBlock.tint === 'spruce' ? 0x619961 : tintBlock.tint === 'birch' ? 0x80a755 : 0xffffff) : 0xffffff;
    for (let i = 0; i < g.length; i += 7) {
      const x = g[i], y = g[i + 1], z = g[i + 2];
      const tx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const ty = m[1] * x + m[5] * y + m[9] * z + m[13];
      const tz = m[2] * x + m[6] * y + m[10] * z + m[14];
      let sh = g[i + 6];
      let col = 0xffffff;
      if (sh >= 10) { sh -= 10; col = tintCol; }
      // grass block: only top is tinted fully (sides use mask, approximated untinted)
      const c = Math.round(sh * 255);
      const cr = (((col >> 16) & 255) * c) / 255, cg = (((col >> 8) & 255) * c) / 255, cb = ((col & 255) * c) / 255;
      mesh.v(tx, ty, tz, g[i + 3], g[i + 4], g[i + 5], ((cr << 16) | (cg << 8) | cb) >>> 0, alpha, sky, blk);
    }
  }

  private drawItemEntity(mesh: DynMesh, e: ItemEntity, x: number, y: number, z: number, t: number, sky: number, blk: number, noBob = false) {
    const it = getItem(e.item.id);
    const age = e.age + t;
    const bob = noBob ? 0 : Math.sin(age / 10 + e.bobOffset) * 0.1 + 0.1;
    const spin = (age / 20 + e.bobOffset) % (Math.PI * 2);
    const n = e.item.count > 40 ? 5 : e.item.count > 20 ? 4 : e.item.count > 5 ? 3 : e.item.count > 1 ? 2 : 1;
    const isBlock = it.block !== undefined && !it.flatBlock && !it.sprite;
    const m = mat4();
    for (let k = 0; k < n; k++) {
      identity(m);
      const jr = new Array(3).fill(0).map((_, j) => (k === 0 ? 0 : (((k * 7919 + j * 104729) % 100) / 100 - 0.5) * (isBlock ? 0.15 : 0.1)));
      translate(m, m, x + jr[0], y + bob + (isBlock ? 0.125 : 0.18) + jr[1], z + jr[2]);
      rotateY(m, m, spin);
      if (isBlock) scale(m, m, 0.25, 0.25, 0.25);
      else { translate(m, m, 0, 0, k * 0.06 - (n - 1) * 0.03); scale(m, m, 0.5, 0.5, 0.5); }
      this.appendItem(mesh, e.item.id, m, sky, blk);
    }
  }

  /** Draw a block state (with its model, orientation and uv rules) at camera-relative (x,y,z). */
  blockModel(mesh: DynMesh, v: number, x: number, y: number, z: number, sky: number, blk: number) {
    const id = v & 0xfff, meta = v >>> 12;
    const def = BLOCKS[id];
    let boxes: Box[];
    if (def.render === Render.Model) boxes = modelBoxes(v);
    else if (def.render === Render.Cube && id !== B.GRASS && def.tint === 'none') {
      const tex = new Int32Array(6), rot = new Int8Array(6);
      for (let f = 0; f < 6; f++) tex[f] = def.faces[f];
      if (isFacing6Cube(id)) facing6CubeFaces(id, meta, tex, rot);
      else if (def.faces.length > 6) tex[HORIZ_TO_FACE[meta & 3]] = def.faces[6];
      boxes = [{ x0: 0, y0: 0, z0: 0, x1: 16, y1: 16, z1: 16, tex: [...tex], rot: [...rot] }];
    } else { this.blockCube(mesh, id, x, y, z, 1, sky, blk, 0); return; }
    const shade = [0.6, 0.6, 0.5, 1, 0.8, 0.8];
    for (const b of boxes) {
      for (let f = 0; f < 6; f++) {
        if (b.skip && b.skip & (1 << f)) continue;
        const rect = b.uv?.[f];
        const rot = b.rot?.[f] ?? 0;
        const c = Math.round(shade[f] * 255);
        const col = (c << 16) | (c << 8) | c;
        for (const k of FACE_CORNERS[f]) {
          const px = k[0] ? b.x1 : b.x0, py = k[1] ? b.y1 : b.y0, pz = k[2] ? b.z1 : b.z0;
          let u: number, vv: number;
          const n = faceUV16(f, px, py, pz);
          if (rect) { const d = faceUV16(f, k[0] * 16, k[1] * 16, k[2] * 16); u = rect[0] + ((rect[2] - rect[0]) * d[0]) / 16; vv = rect[1] + ((rect[3] - rect[1]) * d[1]) / 16; }
          else { u = n[0]; vv = n[1]; }
          for (let r = 0; r < rot; r++) { const tt = u; u = 16 - vv; vv = tt; }
          mesh.v(x + px / 16, y + py / 16, z + pz / 16, u / 16, vv / 16, b.tex[f], col, 1, sky, blk);
        }
      }
    }
  }

  private blockCube(mesh: DynMesh, id: number, x: number, y: number, z: number, s: number, sky: number, blk: number, flash: number) {
    const m = mat4();
    identity(m);
    translate(m, m, x + s / 2, y + s / 2, z + s / 2);
    scale(m, m, s, s, s);
    const start = mesh.count;
    this.appendItem(mesh, id, m, flash ? 15 : sky, flash ? 15 : blk);
    if (flash) for (let i = start; i < mesh.count; i++) { const b = i * 32 + 24; mesh.u8[b] = mesh.u8[b + 1] = mesh.u8[b + 2] = 255; }
  }

  private billboard(mesh: DynMesh, x: number, y: number, z: number, s: number, layer: number, col: number, sky: number, blk: number) {
    const cam = this.r.cam;
    const rx = -Math.cos(cam.yaw) * s / 2, rz = -Math.sin(cam.yaw) * s / 2;
    const ux = -Math.sin(cam.yaw) * Math.sin(cam.pitch) * s / 2, uy = Math.cos(cam.pitch) * s / 2, uz = Math.cos(cam.yaw) * Math.sin(cam.pitch) * s / 2;
    mesh.v(x - rx - ux, y - uy, z - rz - uz, 0, 1, layer, col, 1, sky, blk);
    mesh.v(x + rx - ux, y - uy, z + rz - uz, 1, 1, layer, col, 1, sky, blk);
    mesh.v(x + rx + ux, y + uy, z + rz + uz, 1, 0, layer, col, 1, sky, blk);
    mesh.v(x - rx + ux, y + uy, z - rz + uz, 0, 0, layer, col, 1, sky, blk);
  }

  private fishingLine(game: Game, e: FishingHook, x: number, y: number, z: number, t: number) {
    const p = e.angler, cam = this.r.cam;
    const yaw = ((p.pyaw + (p.yaw - p.pyaw) * t) * Math.PI) / 180;
    let sx: number, sy: number, sz: number;
    if (!game.drawsSelf) {
      // from the rod tip at the lower right of the view
      const d = game.lookVec(p.yaw, p.pitch);
      const rx = -Math.cos(yaw), rz = -Math.sin(yaw);
      sx = d.x * 0.6 + rx * 0.35; sy = d.y * 0.6 - 0.25; sz = d.z * 0.6 + rz * 0.35;
    } else {
      sx = p.lerpX(t) - cam.x - Math.cos(yaw) * 0.35 - Math.sin(yaw) * 0.8;
      sy = p.lerpY(t) - cam.y + 1.8;
      sz = p.lerpZ(t) - cam.z - Math.sin(yaw) * 0.35 + Math.cos(yaw) * 0.8;
    }
    const ex = x, ey = y + 0.2, ez = z;
    const pts: number[] = [];
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a = i / N, b = (i + 1) / N;
      const sag = (f: number) => -Math.sin(f * Math.PI) * 0.4;
      pts.push(sx + (ex - sx) * a, sy + (ey - sy) * a * a + sag(a), sz + (ez - sz) * a, sx + (ex - sx) * b, sy + (ey - sy) * b * b + sag(b), sz + (ez - sz) * b);
    }
    this.r.drawLines(new Float32Array(pts), [0, 0, 0, 0.8]);
  }

  private drawBoat(mesh: DynMesh, e: Boat, x: number, y: number, z: number, t: number, sky: number, blk: number) {
    const m = this.boatMatrix(e, x, y, z, t);
    const layer = BLOCKS[e.wood === 'oak' ? B.OAK_PLANKS : (WOOD as Record<string, { planks: number }>)[e.wood]?.planks ?? B.OAK_PLANKS].faces[0];
    // hull (1.9 proportions: 1.75 long along z, 1.25 wide): floor, two long sides, bow and stern
    const hull: number[][] = [
      [-0.5, 0.125, -0.75, 0.5, 0.3, 0.75],
      [-0.625, 0.125, -0.875, -0.5, 0.6875, 0.875],
      [0.5, 0.125, -0.875, 0.625, 0.6875, 0.875],
      [-0.5, 0.125, 0.75, 0.5, 0.6875, 0.875],
      [-0.5, 0.125, -0.875, 0.5, 0.6875, -0.75],
    ];
    for (const b of hull) this.woodBox(mesh, m, b, layer, sky, blk);
    // oars: pivot on the gunwale, sweep back and forth while rowing
    for (const side of [0, 1]) {
      const a = e.pPaddle[side] + (e.paddle[side] - e.pPaddle[side]) * t;
      const sx = side === 0 ? 0.625 : -0.625;
      const pm = mat4();
      translate(pm, m, sx, 0.6, 0.1);
      rotateY(pm, pm, (side === 0 ? 1 : -1) * (Math.PI / 8 + Math.sin(a) * 0.6));
      rotateZ(pm, pm, (side === 0 ? -1 : 1) * (Math.PI / 5 + (Math.cos(a) * 0.5 + 0.5) * 0.25));
      const dir = side === 0 ? 1 : -1;
      const shaft = dir > 0 ? [-0.25, -0.03, -0.03, 0.9, 0.03, 0.03] : [-0.9, -0.03, -0.03, 0.25, 0.03, 0.03];
      const blade = dir > 0 ? [0.6, -0.015, -0.12, 1.05, 0.015, 0.12] : [-1.05, -0.015, -0.12, -0.6, 0.015, 0.12];
      this.woodBox(mesh, pm, shaft, layer, sky, blk);
      this.woodBox(mesh, pm, blade, layer, sky, blk);
    }
  }

  /** Item frames (a wooden square with the item turned inside it) and paintings (their cells' pictures). */
  private drawHanging(mesh: DynMesh, e: Hanging, x: number, y: number, z: number, sky: number, blk: number) {
    const [dx, dz] = HORIZ[e.facing];
    // the entity sits against its wall; what's drawn below is laid out from the middle of its cell
    x -= dx * 0.46; z -= dz * 0.46;
    const along = dx === 0; // the wall runs along x
    const m = mat4();
    identity(m);
    if (e instanceof ItemFrame) {
      const t = 1 / 16, hw = 0.375;
      const bx = along ? [x - hw, y, z + dz * 0.5 - (dz > 0 ? t : 0), x + hw, y + 0.75, z + dz * 0.5 + (dz < 0 ? t : 0)] : [x + dx * 0.5 - (dx > 0 ? t : 0), y, z - hw, x + dx * 0.5 + (dx < 0 ? t : 0), y + 0.75, z + hw];
      this.woodBox(mesh, m, bx, T2.itemFrame, sky, blk);
      if (e.item && mapIdOf(e.item) === null) {
        const im = mat4();
        identity(im);
        translate(im, im, x - dx * 0.02 + dx * 0.43, y + 0.375, z - dz * 0.02 + dz * 0.43);
        rotateY(im, im, [Math.PI, Math.PI / 2, 0, -Math.PI / 2][e.facing]);
        rotateZ(im, im, (-e.rotation * Math.PI) / 4);
        scale(im, im, 0.5, 0.5, 0.5);
        this.appendItem(mesh, e.item.id, im, sky, blk);
      }
      return;
    }
    if (e instanceof Painting) {
      const [w, h] = e.size;
      const layers = PAINTING_TEX[e.motif];
      const [rx, rz] = HORIZ[(e.facing + 1) & 3];
      const t = 1 / 16;
      for (let i = 0; i < w; i++)
        for (let j = 0; j < h; j++) {
          // cells from the left as seen from the room
          const off = i - (w - 1) / 2;
          const cx = x + rx * -off, cz = z + rz * -off, cy = y + (h - 1 - j);
          const bx = along ? [cx - 0.5, cy, cz + dz * 0.5 - (dz > 0 ? t : 0), cx + 0.5, cy + 1, cz + dz * 0.5 + (dz < 0 ? t : 0)] : [cx + dx * 0.5 - (dx > 0 ? t : 0), cy, cz - 0.5, cx + dx * 0.5 + (dx < 0 ? t : 0), cy + 1, cz + 0.5];
          this.woodBox(mesh, m, bx, layers[j * w + i] ?? T2.paintingBack, sky, blk);
        }
    }
  }

  /** Iron tub, 20 x 16 px and 10 px deep, lying along its direction of travel and tipped on slopes. */
  private drawMinecart(mesh: DynMesh, e: Minecart, x: number, y: number, z: number, t: number, sky: number, blk: number) {
    let dy = e.yaw - e.pyaw;
    dy = ((dy % 360) + 540) % 360 - 180;
    const yaw = e.pyaw + dy * t, pitch = e.ppitch + (e.pitch - e.ppitch) * t;
    const m = mat4();
    identity(m);
    translate(m, m, x, y, z);
    rotateY(m, m, (-yaw * Math.PI) / 180);
    rotateZ(m, m, (pitch * Math.PI) / 180);
    if (e.hurtTime > 0) rotateX(m, m, Math.sin(e.hurtTime - t) * (e.hurtTime - t) * 0.02 * e.hurtDir);
    const out = T.minecart, inner = T.minecartInside;
    this.woodBox(mesh, m, [-0.625, 0.0625, -0.5, 0.625, 0.1875, 0.5], inner, sky, blk);
    this.woodBox(mesh, m, [-0.625, 0.0625, -0.5, 0.625, 0.6875, -0.375], out, sky, blk);
    this.woodBox(mesh, m, [-0.625, 0.0625, 0.375, 0.625, 0.6875, 0.5], out, sky, blk);
    this.woodBox(mesh, m, [-0.625, 0.0625, -0.375, -0.5, 0.6875, 0.375], out, sky, blk);
    this.woodBox(mesh, m, [0.5, 0.0625, -0.375, 0.625, 0.6875, 0.375], out, sky, blk);
    // the cargo sits inside (a TNT cart flashes as its fuse burns)
    const cargo = e.kind !== 'minecart' ? CART_BLOCK[e.kind]() : 0;
    if (cargo) this.blockCube(mesh, cargo, x - 0.375, y + 0.25, z - 0.375, 0.75, sky, blk, e.kind === 'tnt' && e.fuse >= 0 && Math.floor(e.fuse / 5) % 2 === 0 ? 1 : 0);
  }

  /** Skin texture for a horse, made the first time that coat is seen. */
  private horseSkin(h: Horse): string {
    const key = h.skinKey;
    if (!this.skins.has(key)) {
      const sk = h.kind === 'horse' ? M.horseSkin(h.color, h.markings) : h.kind === 'skeleton' || h.kind === 'zombie' ? undeadHorseSkin(h.kind) : M.donkeySkin(h.kind === 'mule');
      this.skins.set(key, this.r.makeTexture(sk.data, sk.w));
    }
    return key;
  }

  /** Horse pose: diagonal gait, head bob, grazing, rearing, tail swish; then saddle, chest bags and armour. */
  private drawHorse(h: Horse, base: Mat4, t: number, light: [number, number], overlay: [number, number, number, number], hp: number, netHead: number, ls: number, lsa: number, age: number) {
    const c = Math.cos;
    const rear = h.pRear + (h.rear - h.pRear) * t, eat = h.pEat + (h.eat - h.pEat) * t;
    const pose: Record<string, [number, number, number]> = {};
    const swing = c(ls * 0.6662) * 1.0 * lsa, swing2 = c(ls * 0.6662 + Math.PI) * 1.0 * lsa;
    const headPitch = Math.max(-0.5, Math.min(0.6, hp));
    pose.head = [Math.PI / 6 + headPitch * (1 - eat) + eat * 2.1 - rear * 0.7 + Math.sin(ls * 0.6662 * 2) * 0.05 * lsa, netHead * (1 - eat), 0];
    pose.leg1 = [swing * (1 - rear) + rear * 0.3, 0, 0];
    pose.leg2 = [swing2 * (1 - rear) + rear * 0.3, 0, 0];
    pose.leg3 = [swing2 * (1 - rear) - rear * 1.2, 0, 0];
    pose.leg4 = [swing * (1 - rear) - rear * 0.9, 0, 0];
    const swish = h.tailSwish > 0 ? Math.sin((h.tailSwish - t) * 0.8) * 0.5 : 0;
    pose.tail = [-1.1 + lsa * 0.4 + rear * 0.6, 0, swish + Math.sin(age * 0.05) * 0.04];
    pose.body = [0, 0, 0];
    pose.saddle = [0, 0, 0];
    pose.bags = [0, 0, 0];
    // rearing tips the whole horse up about its hind feet
    let b = base;
    if (rear > 0.01) {
      b = mat4();
      translate(b, base, 0, 21 / 16, 11 / 16);
      rotateX(b, b, -rear * 0.8);
      translate(b, b, 0, -21 / 16, -11 / 16);
    }
    const skip = new Set<string>();
    if (!h.saddle) skip.add('saddle');
    if (!h.chest) skip.add('bags');
    const model = h.kind === 'donkey' || h.kind === 'mule' ? 'donkey' : 'horse';
    this.drawModel(model, this.horseSkin(h), b, pose, light, overlay, skip);
    const ar = h.armorItem ? HORSE_ARMOR[h.armorItem.id] : undefined;
    if (ar) this.drawModel('horseArmor', 'horseArmor_' + ar.kind, b, pose, light, overlay, new Set(['saddle', 'bags', 'tail']));
  }

  private boatMatrix(e: Boat, x: number, y: number, z: number, t: number) {
    const yaw = e.pyaw + (e.yaw - e.pyaw) * t;
    const m = mat4();
    identity(m);
    translate(m, m, x, y, z);
    rotateY(m, m, (-yaw * Math.PI) / 180);
    if (e.hurtTime > 0) rotateZ(m, m, Math.sin(e.hurtTime - t) * (e.hurtTime - t) * 0.02 * e.hurtDir);
    return m;
  }

  /** A plank-textured box (local coords x0..z1) transformed by m, shaded like block faces. */
  private woodBox(mesh: DynMesh, m: Mat4, [x0, y0, z0, x1, y1, z1]: number[], layer: number, sky: number, blk: number) {
    const P = (px: number, py: number, pz: number) => [m[0] * px + m[4] * py + m[8] * pz + m[12], m[1] * px + m[5] * py + m[9] * pz + m[13], m[2] * px + m[6] * py + m[10] * pz + m[14]];
    const faces: [number[][], number, number, number][] = [
      [[P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], 0.6, z1 - z0, y1 - y0],
      [[P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)], 0.6, z1 - z0, y1 - y0],
      [[P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], 0.5, x1 - x0, z1 - z0],
      [[P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0)], 1, x1 - x0, z1 - z0],
      [[P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)], 0.8, x1 - x0, y1 - y0],
      [[P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], 0.8, x1 - x0, y1 - y0],
    ];
    for (const [pts, shade, du, dv] of faces) {
      const c = Math.round(shade * 255);
      const col = (c << 16) | (c << 8) | c;
      const u = Math.min(1, du), v = Math.min(1, dv);
      const uv = [[0, v], [u, v], [u, 0], [0, 0]];
      for (let k = 0; k < 4; k++) mesh.v(pts[k][0], pts[k][1], pts[k][2], uv[k][0], uv[k][1], layer, col, 1, sky, blk);
    }
  }

  /** Depth-only plane inside each boat's hull, so the water surface drawn later doesn't show inside it. */
  private boatMasks(game: Game, list: Entity[], t: number) {
    const cam = this.r.cam, mesh = this.r.dyn, gl = this.r.gl;
    mesh.reset();
    for (const e of list) {
      if (!(e instanceof Boat)) continue;
      const m = this.boatMatrix(e, e.lerpX(t) - cam.x, e.lerpY(t) - cam.y, e.lerpZ(t) - cam.z, t);
      const P = (px: number, pz: number) => [m[0] * px + m[4] * e.maskY + m[8] * pz + m[12], m[1] * px + m[5] * e.maskY + m[9] * pz + m[13], m[2] * px + m[6] * e.maskY + m[10] * pz + m[14]];
      const pts = [P(-0.5, -0.75), P(-0.5, 0.75), P(0.5, 0.75), P(0.5, -0.75)];
      for (const q of pts) mesh.v(q[0], q[1], q[2], 0, 0, 0, 0xffffff, 1, 15, 15);
    }
    if (!mesh.count) return;
    void game;
    gl.colorMask(false, false, false, false);
    this.r.drawDyn(mesh, { cull: false, alphaCut: -1, fullbright: true });
    gl.colorMask(true, true, true, true);
  }

  /** The words on signs within 24 blocks: each sign's text as a texture on a sheet just in front of its board. */
  private signTextures = new Map<string, WebGLTexture>();
  private drawSignTexts(game: Game, t: number) {
    const w = game.world!, cam = this.r.cam;
    void t;
    const ccx = Math.floor(cam.x) >> 4, ccz = Math.floor(cam.z) >> 4;
    for (const c of w.chunks.values()) {
      if (!c.tiles.size || Math.abs(c.cx - ccx) > 2 || Math.abs(c.cz - ccz) > 2) continue;
      for (const [i, tl] of c.tiles) {
        const st = tl as unknown as { type: string; lines?: string[]; color?: number };
        if (st.type !== 'sign' || !st.lines?.some((l) => l)) continue;
        const bx = c.cx * 16 + (i & 15), by = i >> 8, bz = c.cz * 16 + ((i >> 4) & 15);
        if ((bx + 0.5 - cam.x) ** 2 + (by - cam.y) ** 2 + (bz + 0.5 - cam.z) ** 2 > 24 * 24) continue;
        const v = w.get(bx, by, bz), def = BLOCKS[idOf(v)];
        const wall = def?.shape === Shape.WallSign;
        if (!def || (!wall && def.shape !== Shape.Sign)) continue;
        const key = 'sign:' + (st.color ?? 15) + ':' + st.lines.join('\n');
        let tex = this.signTextures.get(key);
        if (!tex) {
          if (this.signTextures.size > 200) this.signTextures.clear();
          const cv = document.createElement('canvas');
          cv.width = 224; cv.height = 64;
          const ctx = cv.getContext('2d')!;
          ctx.imageSmoothingEnabled = false;
          ctx.save();
          ctx.scale(1, 1.6);
          // dyed text: vanilla darkens the dye a little (black stays black)
          const dc = st.color === undefined || st.color === 15 ? 0 : DYE_RGB[st.color];
          const ink = '#' + (0x1000000 + ((Math.round(((dc >> 16) & 255) * 0.4) << 16) | (Math.round(((dc >> 8) & 255) * 0.4) << 8) | Math.round((dc & 255) * 0.4))).toString(16).slice(1);
          st.lines.slice(0, 4).forEach((l, k) => game.ui.gui.font.drawCentered(ctx as never, l, 56, 1 + k * 10, ink, false));
          ctx.restore();
          tex = this.r.makeTexture(cv, 224);
          this.signTextures.set(key, tex);
          this.skins.set(key, tex);
        }
        // the board faces: wall signs by their wall, standing ones by their quarter turn (as their model is drawn)
        const quarter = wall ? metaOf(v) & 3 : Math.round(metaOf(v) / 4) & 3;
        const top = wall ? 12 / 16 : 17 / 16;
        const m = mat4();
        identity(m);
        translate(m, m, bx + 0.5 - cam.x, by + top - cam.y, bz + 0.5 - cam.z);
        rotateY(m, m, (180 - quarter * 90) * DEG);
        scale(m, m, -1, -1, 1);
        // the sheet sits a hair in front of the board's face
        translate(m, m, 0, 0.5 / 16, wall ? 5.9 / 16 : -1.1 / 16);
        const [sky, blk] = w.getLight(bx, by, bz);
        this.drawModel('signText', key, m, {}, [sky, blk], [0, 0, 0, 0]);
      }
    }
  }

  /** Banners: the cloth with its patterns (a texture per design), the crossbar and, standing, the upper pole. */
  private drawBanners(game: Game) {
    const w = game.world!, cam = this.r.cam;
    const ccx = Math.floor(cam.x) >> 4, ccz = Math.floor(cam.z) >> 4;
    for (const c of w.chunks.values()) {
      if (!c.tiles.size || Math.abs(c.cx - ccx) > 4 || Math.abs(c.cz - ccz) > 4) continue;
      for (const [i, tl] of c.tiles) {
        const st = tl as unknown as { type: string; patterns?: { p: string; c: number }[] };
        if (st.type !== 'banner') continue;
        const bx = c.cx * 16 + (i & 15), by = i >> 8, bz = c.cz * 16 + ((i >> 4) & 15);
        if ((bx + 0.5 - cam.x) ** 2 + (by - cam.y) ** 2 + (bz + 0.5 - cam.z) ** 2 > 64 * 64) continue;
        const v = w.get(bx, by, bz), id = idOf(v);
        if (!isBanner(id)) continue;
        const wall = BLOCKS[id].shape === Shape.WallBanner;
        const layers = st.patterns ?? [];
        const key = 'banner:' + bannerColor(id) + ':' + layers.map((l) => l.p + l.c).join(',');
        if (!this.skins.has(key)) {
          if (this.bannerKeys.length > 200) for (const k of this.bannerKeys.splice(0, 100)) { this.r.gl.deleteTexture(this.skins.get(k)!); this.skins.delete(k); }
          this.skins.set(key, this.r.makeTexture(bannerSkin(bannerColor(id), layers), 64));
          this.bannerKeys.push(key);
        }
        const yaw = wall ? (metaOf(v) & 3) * 90 : metaOf(v) * 22.5;
        const m = mat4();
        identity(m);
        translate(m, m, bx + 0.5 - cam.x, by + (wall ? 1 : 28 / 16) - cam.y, bz + 0.5 - cam.z);
        rotateY(m, m, (180 - yaw) * DEG);
        scale(m, m, -1, -1, 1);
        // a wall banner hangs from its bar against the wall
        if (wall) translate(m, m, 0, 0, 6.6 / 16);
        scale(m, m, 2 / 3, 2 / 3, 2 / 3);
        const [sky, blk] = w.getLight(bx, by, bz);
        this.drawModel('banner', key, m, {}, [sky, blk], [0, 0, 0, 0], wall ? new Set(['pole']) : undefined);
      }
    }
  }
  private bannerKeys: string[] = [];
  /** The entity being drawn has the glowing effect (drawModel adds its silhouette through walls). */
  private glow = false;

  /** A map in an item frame fills the frame, turned in quarter turns. */
  private drawFramedMap(game: Game, e: ItemFrame, x: number, y: number, z: number, sky: number, blk: number) {
    const id = mapIdOf(e.item)!, d = game.maps.get(id);
    const key = 'map:' + id;
    const tex = this.mapTextures.get(id);
    if (!tex || tex.ver !== (d?.ver ?? 0)) {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 128;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#d8c8a0';
      ctx.fillRect(0, 0, 256, 128);
      if (d) {
        const img = ctx.getImageData(0, 0, MAP_SIZE, MAP_SIZE);
        for (let i = 0; i < d.colors.length; i++) {
          const rgb = mapRGB(d.colors[i]);
          if (rgb < 0) continue;
          img.data[i * 4] = rgb >> 16; img.data[i * 4 + 1] = (rgb >> 8) & 255; img.data[i * 4 + 2] = rgb & 255;
        }
        ctx.putImageData(img, 0, 0);
        drawMapMarks(ctx, d, 0, 0, 1);
        // the side facing the room is the sheet's back, which shows its picture the other way round
        ctx.save(); ctx.translate(256, 0); ctx.scale(-1, 1); ctx.drawImage(cv, 0, 0, 128, 128, 0, 0, 128, 128); ctx.restore();
      }
      if (tex) this.r.gl.deleteTexture(tex.t);
      const t = this.r.makeTexture(cv, 256);
      this.mapTextures.set(id, { ver: d?.ver ?? 0, t });
      this.skins.set(key, t);
    }
    const [dx, dz] = HORIZ[e.facing];
    const m = mat4();
    identity(m);
    translate(m, m, x - dx * 0.035, y + 0.375, z - dz * 0.035);
    rotateY(m, m, [Math.PI, Math.PI / 2, 0, -Math.PI / 2][e.facing]);
    rotateZ(m, m, (-(e.rotation >> 1) * Math.PI) / 2);
    scale(m, m, -0.75, -0.75, 0.75);
    this.drawModel('mapSheet', key, m, {}, [sky, blk], [0, 0, 0, 0]);
  }
  private mapTextures = new Map<number, { ver: number; t: WebGLTexture }>();

  /** Evoker fangs: the jaws rise out of the ground, snap shut and sink back. */
  private drawFangs(e: EvokerFangs, x: number, y: number, z: number, t: number, sky: number, blk: number) {
    if (e.warmup >= 0) return;
    const f = Math.min(20, e.life + t);
    const open = 1 - Math.min(1, f / 10);
    const rise = f > 18 ? (f - 18) / 4 : 0;
    const base = this.entityBase(this.tmp2, x, y - rise * 0.8, z, 90 - e.yaw, 0, 1);
    const jaw = Math.sin(Math.min(1, (1 - open) * 2) * Math.PI) * 0.6 + 0.2;
    const pose: Record<string, [number, number, number]> = { upperJaw: [0, 0, Math.PI - jaw], lowerJaw: [0, Math.PI, Math.PI + jaw] };
    const lift = (1 - Math.min(1, f / 4)) * 12;
    this.drawModel('fangs', 'fangs', base, pose, [sky, blk], [0, 0, 0, 0], new Set(['base']), 1, { upperJaw: [0, lift, 0], lowerJaw: [0, lift, 0] });
  }

  private drawArrow(mesh: DynMesh, e: Arrow, x: number, y: number, z: number, t: number, sky: number, blk: number) {
    const yaw = e.pyaw + (e.yaw - e.pyaw) * t, pitch = e.ppitch + (e.pitch - e.ppitch) * t;
    const m = mat4();
    identity(m);
    translate(m, m, x, y, z);
    rotateY(m, m, yaw * DEG);
    rotateX(m, m, -pitch * DEG);
    if (e.shake > 0) rotateX(m, m, -Math.sin((e.shake - t) * 3) * (e.shake - t) * DEG);
    rotateY(m, m, -Math.PI / 2);
    rotateZ(m, m, -Math.PI / 4);
    scale(m, m, 0.7, 0.7, 0.7);
    this.appendItem(mesh, e.itemId || I.ARROW, m, sky, blk);
  }

  /** Player model in the inventory screen, drawn into a GUI rectangle. */
  renderPreview(game: Game, box: { x: number; y: number; w: number; h: number; yaw: number; pitch: number; entity?: Entity; look?: string; slim?: boolean }, guiScale: number) {
    const gl = this.r.gl, p = game.player!;
    const sx = Math.round(box.x * guiScale), sw = Math.round(box.w * guiScale), sh = Math.round(box.h * guiScale);
    const sy = this.r.height - Math.round((box.y + box.h) * guiScale);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(sx, sy, sw, sh);
    gl.viewport(sx, sy, sw, sh);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const proj = mat4();
    const aspect = sw / sh;
    const hh = 1.15;
    // orthographic-like view of the player
    proj.fill(0);
    proj[0] = 1 / (hh * aspect); proj[5] = 1 / hh; proj[10] = -0.1; proj[14] = 0; proj[15] = 1;
    this.currentVP = proj;
    const base = mat4();
    identity(base);
    translate(base, base, 0, -0.95, -3);
    rotateX(base, base, -box.pitch * 0.35);
    rotateY(base, base, Math.PI - box.yaw * 0.7);
    scale(base, base, -1, -1, 1);
    translate(base, base, 0, -1.501, 0);
    const pose: Record<string, [number, number, number]> = {
      head: box.look ? [-box.pitch * 0.3, 0, 0] : [-box.pitch * 0.6, -box.yaw * 0.6, 0],
      rightArm: [0, 0, 0.1], leftArm: [0, 0, -0.1], rightLeg: [0, 0, 0], leftLeg: [0, 0, 0],
    };
    const saved = this.r.env;
    this.r.env = { ...saved, fogStart: 1e5, fogEnd: 1e5 + 1, sunBright: 1, gamma: 0.5 };
    if (box.entity instanceof Horse) {
      // the horse screen: side-on view of the horse, turning a little with the mouse
      const hb = mat4();
      identity(hb);
      translate(hb, hb, 0, -0.75, -3);
      rotateX(hb, hb, -box.pitch * 0.25 + 0.15);
      rotateY(hb, hb, Math.PI * 0.75 - box.yaw * 0.5);
      scale(hb, hb, -0.62, -0.62, 0.62);
      translate(hb, hb, 0, -1.501, 0);
      this.drawHorse(box.entity, hb, 1, [15, 15], [0, 0, 0, 0], 0, 0, 0, 0, box.entity.age);
      this.r.env = saved;
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, this.r.width, this.r.height);
      this.currentVP = this.r.viewProj;
      return;
    }
    const pl = this.playerLook(box.look ?? p.look, box.look ? !!box.slim : p.slim);
    this.drawModel(pl.model, pl.skin, base, withOverlays(pose), [15, 15], [0, 0, 0, 0]);
    if (!box.look) {
      this.drawArmor(p.inventory.armor, base, pose, [15, 15], [0, 0, 0, 0]);
      if (p.inventory.armor[1]?.id === I6.ELYTRA) this.drawElytra(p, base, [15, 15], [0, 0, 0, 0]);
      const it = p.inventory.held();
      if (it) this.drawHeldThirdPerson(it.id, base, pose.rightArm, [15, 15]);
    }
    this.r.env = saved;
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, this.r.width, this.r.height);
    this.currentVP = this.r.viewProj;
  }

  // ------------------------------------------------------------------ first person
  renderHand(game: Game, t: number) {
    const gl = this.r.gl;
    const p = game.player!;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const proj = this.r.handViewProj(70);
    this.currentVP = proj;
    const [sky, blk] = game.world!.getLight(Math.floor(p.x), Math.floor(p.y + p.eyeHeight()), Math.floor(p.z));
    const held = p.inventory.held();
    const swing = p.pSwingProgress + (p.swingProgress - p.pSwingProgress) * t;
    const equip = 1 - (game.pHandSwapAnim + (game.handSwapAnim - game.pHandSwapAnim) * t);
    const eq = 1 - equip;
    const m = mat4();
    identity(m);
    // hand sway relative to camera rotation lag
    const dyaw = (p.yaw - p.pyaw) * (1 - t), dpitch = (p.pitch - p.ppitch) * (1 - t);
    rotateX(m, m, dpitch * 0.1 * DEG);
    rotateY(m, m, dyaw * 0.1 * DEG);
    // view bobbing for the hand
    if (game.options.viewBobbing) {
      const dw = p.distWalked - p.pDistWalked;
      const f1 = -(p.distWalked + dw * t);
      const f2 = p.pCameraYaw + (p.cameraYaw - p.pCameraYaw) * t;
      translate(m, m, Math.sin(f1 * Math.PI) * f2 * 0.5, -Math.abs(Math.cos(f1 * Math.PI) * f2), 0);
      rotateZ(m, m, Math.sin(f1 * Math.PI) * f2 * 3 * DEG);
      rotateX(m, m, Math.abs(Math.cos(f1 * Math.PI - 0.2) * f2) * 5 * DEG);
    }
    const eating = game.interact!.eating;
    const bow = game.interact!.bowCharge();
    if (!held) {
      // bare arm (vanilla 1.8 transforms)
      const s = Math.sqrt(swing);
      translate(m, m, -0.3 * Math.sin(s * Math.PI), 0.4 * Math.sin(s * Math.PI * 2), -0.4 * Math.sin(swing * Math.PI));
      translate(m, m, 0.64000005, -0.6, -0.71999997);
      translate(m, m, 0, eq * -0.6, 0);
      rotateY(m, m, 45 * DEG);
      const f3 = Math.sin(swing * swing * Math.PI), f4 = Math.sin(s * Math.PI);
      rotateY(m, m, f4 * 70 * DEG);
      rotateZ(m, m, f3 * -20 * DEG);
      translate(m, m, -1, 3.6, 3.5);
      rotateZ(m, m, 120 * DEG);
      rotateX(m, m, 200 * DEG);
      rotateY(m, m, -135 * DEG);
      translate(m, m, 5.6, 0, 0);
      const pose = { rightArm: [0, 0, 0] as [number, number, number], rightSleeve: [0, 0, 0] as [number, number, number] };
      const pl = this.playerLook(p.look, p.slim);
      this.drawModel(pl.model, pl.skin, m, pose, [sky, blk], [0, 0, 0, 0], HAND_SKIP);
      return;
    }
    const it = getItem(held.id);
    if (eating > 0) {
      const f = (eating + t) / 32;
      const k = 1 - Math.pow(Math.min(1, f), 27);
      translate(m, m, 0, Math.abs(Math.cos((eating + t) / 4 * Math.PI) * 0.1) * (f > 0.2 ? 1 : 0), 0);
      translate(m, m, k * 0.6, -k * 0.5, 0);
      rotateY(m, m, k * 90 * DEG);
      rotateX(m, m, k * 10 * DEG);
      rotateZ(m, m, k * 30 * DEG);
    } else {
      const s = Math.sqrt(swing);
      translate(m, m, -0.4 * Math.sin(s * Math.PI), 0.2 * Math.sin(s * Math.PI * 2), -0.2 * Math.sin(swing * Math.PI));
    }
    // a raised shield comes up toward the middle
    if (p.blocking && held.id === I7.SHIELD) { translate(m, m, -0.2, 0.18, 0); rotateY(m, m, 30 * DEG); }
    // transformFirstPersonItem
    translate(m, m, 0.56, -0.52, -0.71999997);
    translate(m, m, 0, eq * -0.6, 0);
    rotateY(m, m, 45 * DEG);
    const f = Math.sin(swing * swing * Math.PI), f1 = Math.sin(Math.sqrt(swing) * Math.PI);
    rotateY(m, m, f * -20 * DEG);
    rotateZ(m, m, f1 * -20 * DEG);
    rotateX(m, m, f1 * -80 * DEG);
    scale(m, m, 0.4, 0.4, 0.4);
    if (bow > 0) {
      // draw back the bow
      rotateZ(m, m, -18 * DEG);
      rotateY(m, m, -12 * DEG);
      rotateX(m, m, -8 * DEG);
      translate(m, m, -0.9, 0.2, 0);
      let pull = (bow + t) / 20;
      pull = Math.min(1, (pull * pull + pull * 2) / 3);
      if (pull > 0.1) translate(m, m, 0, Math.sin((bow - 0.1 + t) * 1.3) * 0.01 * (pull - 0.1), 0);
      translate(m, m, 0, 0, pull * 0.1);
      rotateZ(m, m, -335 * DEG);
      rotateY(m, m, -50 * DEG);
      translate(m, m, 0, 0.5, 0);
      scale(m, m, 1, 1, 1 + pull * 0.2);
      translate(m, m, 0, -0.5, 0);
      rotateY(m, m, 50 * DEG);
      rotateZ(m, m, 335 * DEG);
    }
    const isBlock = it.block !== undefined && !it.flatBlock && !it.sprite;
    if (isBlock) {
      translate(m, m, 0, 0.1, 0);
      rotateY(m, m, 45 * DEG);
      scale(m, m, 0.4 / 0.4 * 0.42, 0.42, 0.42);
    } else {
      translate(m, m, 0, 4 / 16 * 1.7 * 0.5, 2 / 16 * 1.7 * 0.5);
      rotateY(m, m, -135 * DEG);
      rotateZ(m, m, 25 * DEG);
      scale(m, m, 1.7 * 0.8, 1.7 * 0.8, 1.7 * 0.8);
    }
    const dm = this.handMesh;
    dm.reset();
    this.appendItem(dm, held.id, m, sky, blk);
    const glint: [number, number, number, number] | undefined = (held.ench || getItem(held.id).foil) ? [0.55, 0.3, 1, 0.22 + Math.sin(performance.now() / 300) * 0.08] : undefined;
    this.r.drawDyn(dm, { cull: false, viewProj: proj, overlay: glint });
    this.drawOffhand(game, t, proj, sky, blk);
    this.currentVP = this.r.viewProj;
  }

  /** The off-hand item in first person: the main hand's transform mirrored to the left (a raised shield comes up in front). */
  private drawOffhand(game: Game, t: number, proj: Mat4, sky: number, blk: number) {
    const p = game.player!;
    const off = p.inventory.offhand;
    if (!off) return;
    const m = mat4();
    identity(m);
    const dyaw = (p.yaw - p.pyaw) * (1 - t), dpitch = (p.pitch - p.ppitch) * (1 - t);
    rotateX(m, m, dpitch * 0.1 * DEG);
    rotateY(m, m, dyaw * 0.1 * DEG);
    scale(m, m, -1, 1, 1);
    const up = p.blocking && off.id === I7.SHIELD && p.inventory.held()?.id !== I7.SHIELD;
    translate(m, m, 0.56 - (up ? 0.2 : 0), -0.52 + (up ? 0.18 : 0), -0.72);
    rotateY(m, m, 45 * DEG);
    if (up) rotateY(m, m, -30 * DEG);
    scale(m, m, 0.4, 0.4, 0.4);
    const it = getItem(off.id);
    if (it.block !== undefined && !it.flatBlock && !it.sprite) {
      translate(m, m, 0, 0.1, 0);
      rotateY(m, m, 45 * DEG);
      scale(m, m, 0.42, 0.42, 0.42);
    } else {
      translate(m, m, 0, 4 / 16 * 1.7 * 0.5, 2 / 16 * 1.7 * 0.5);
      rotateY(m, m, -135 * DEG);
      rotateZ(m, m, 25 * DEG);
      scale(m, m, 1.7 * 0.8, 1.7 * 0.8, 1.7 * 0.8);
    }
    const dm = this.handMesh;
    dm.reset();
    this.appendItem(dm, off.id, m, sky, blk);
    this.r.drawDyn(dm, { cull: false, viewProj: proj });
  }
}

function wrapDelta(d: number) {
  d %= 360;
  if (d >= 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export const FACE_CORNERS = [
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
];
/** Default block-face uv (16ths) for a point on face f, matching the chunk mesher. */
export function faceUV16(f: number, px: number, py: number, pz: number): [number, number] {
  switch (f) {
    case 0: return [pz, 16 - py];
    case 1: return [16 - pz, 16 - py];
    case 2: case 3: return [px, pz];
    case 4: return [16 - px, 16 - py];
    default: return [px, 16 - py];
  }
}

/** Skeleton and zombie horses: a horse's coat redone in bone or rotten green. */
function undeadHorseSkin(kind: 'skeleton' | 'zombie'): M.Skin {
  const s = M.horseSkin(3, 0);
  for (let i = 0; i < s.data.length; i += 4) {
    if (!s.data[i + 3]) continue;
    const l = (s.data[i] * 0.3 + s.data[i + 1] * 0.59 + s.data[i + 2] * 0.11) / 255;
    const [r, g, b] = kind === 'skeleton' ? [200 * (0.55 + l * 0.6), 200 * (0.55 + l * 0.6), 195 * (0.55 + l * 0.6)] : [90 * (0.5 + l), 140 * (0.5 + l), 80 * (0.5 + l)];
    s.data[i] = Math.min(255, r); s.data[i + 1] = Math.min(255, g); s.data[i + 2] = Math.min(255, b);
  }
  return s;
}

/** A banner's 64 x 64 skin: the cloth front and back (its design), and wood for the bar and pole. */
function bannerSkin(base: number, layers: { p: string; c: number }[]): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#7a5a32';
  ctx.fillRect(0, 42, 44, 4);
  ctx.fillRect(44, 0, 8, 44);
  ctx.fillStyle = '#5e4424';
  for (let y = 0; y < 44; y += 3) ctx.fillRect(44 + (y % 7), y, 1, 2);
  const img = new ImageData(20, 40);
  img.data.set(bannerPixels(base, layers));
  ctx.putImageData(img, 0, 0);
  // the back shows the design the other way round
  ctx.save(); ctx.translate(40, 0); ctx.scale(-1, 1); ctx.drawImage(cv, 0, 0, 20, 40, 0, 0, 20, 40); ctx.restore();
  return cv;
}

