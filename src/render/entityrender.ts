// Renders entities (mobs, dropped items, projectiles) and the first-person hand.
import type { Renderer } from './renderer';
import type { Game } from '../game/game';
import { Mat4, mat4, identity, translate, rotateX, rotateY, rotateZ, scale, multiply } from '../math';
import * as M from './models';
import { Entity } from '../entity/entity';
import { LivingEntity } from '../entity/living';
import { ItemEntity, FallingBlock, PrimedTnt, Arrow, XpOrb, Snowball, Fireball } from '../entity/item';
import { getItem, I } from '../game/items';
import { BLOCKS, TEXTURES, Render, B, isLeaves, pack } from '../world/blocks';
import { modelBoxes } from '../world/models';
import { DynMesh } from './gl';
import { getTexture } from './textures';
import { Player } from '../game/player';

interface PartGPU { vao: WebGLVertexArrayObject; count: number; def: M.ModelPart }
interface ModelGPU { parts: Map<string, PartGPU> }

const DEG = Math.PI / 180;

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
      sheep: M.sheepModel(), wool: M.sheepWoolModel(), chicken: M.chickenModel(), spider: M.spiderModel(), ghast: M.ghastModel(),
    };
    for (const [k, d] of Object.entries(defs)) this.models.set(k, this.build(d));
    const skins: Record<string, M.Skin> = {
      steve: M.steveSkin(), zombie: M.zombieSkin(), skeleton: M.skeletonSkin(), creeper: M.creeperSkin(), pig: M.pigSkin(),
      cow: M.cowSkin(), sheep: M.sheepSkin(), wool: M.woolSkin(), chicken: M.chickenSkin(), spider: M.spiderSkin(),
      ghast: M.ghastSkin(false), ghastShoot: M.ghastSkin(true), pigman: M.pigmanSkin(),
    };
    for (const [k, s] of Object.entries(skins)) this.skins.set(k, r.makeTexture(s.data, s.w));
    this.handMesh = new DynMesh(gl);
    gl.bindVertexArray(this.handMesh.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.indexBuffer);
    gl.bindVertexArray(null);
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
    gl.bindVertexArray(null);
  }

  private currentVP: Mat4 = mat4();

  /** Model matrix for an entity at camera-relative position with MC's model-space flip. */
  private entityBase(out: Mat4, x: number, y: number, z: number, bodyYaw: number, deathRoll: number, sc = 1, extraY = 0) {
    identity(out);
    translate(out, out, x, y, z);
    rotateY(out, out, (180 - bodyYaw) * DEG);
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
    const list: Entity[] = [...game.entities];
    if (game.thirdPerson && game.player) list.push(game.player);
    for (const e of list) {
      const x = e.lerpX(t) - cam.x, y = e.lerpY(t) - cam.y, z = e.lerpZ(t) - cam.z;
      if (x * x + y * y + z * z > 96 * 96) continue;
      if (!this.r.boxVisible(x - e.width, y - 0.5, z - e.width, x + e.width, y + e.height + 0.5, z + e.width)) continue;
      const [sky, blk] = w.getLight(Math.floor(e.x), Math.floor(e.y + e.height * 0.5), Math.floor(e.z));
      if (e instanceof ItemEntity) this.drawItemEntity(dyn, e, x, y, z, t, sky, blk);
      else if (e instanceof FallingBlock) this.blockCube(dyn, e.block, x - 0.5, y, z - 0.5, 1, sky, blk, 0);
      else if (e instanceof PrimedTnt) {
        const f = e.fuse - t + 1;
        let s = 1;
        if (f < 10) { const k = 1 - f / 10; s = 1 + k * k * k * k * 0.3; }
        const flash = Math.floor(e.fuse / 5) % 2 === 0;
        this.blockCube(dyn, B.TNT, x - 0.5 * s, y - (s - 1) / 2, z - 0.5 * s, s, sky, blk, flash ? 1 : 0);
      } else if (e instanceof Arrow) this.drawArrow(dyn, e, x, y, z, t, sky, blk);
      else if (e instanceof XpOrb) this.billboard(dyn, x, y + 0.25, z, 0.25, TEXTURES.indexOf('particle_spell'), 0x9ffc3a, 15, 15);
      else if (e instanceof Snowball) this.billboard(dyn, x, y + 0.125, z, 0.25, TEXTURES.indexOf('item/' + e.kind), 0xffffff, sky, blk);
      else if (e instanceof Fireball) this.billboard(dyn, x, y + 0.5, z, 1.0, TEXTURES.indexOf('item/fire_charge'), 0xffffff, 15, 15);
      else if (e instanceof LivingEntity) this.drawLiving(game, e, x, y, z, t, sky, blk);
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
    // soft round shadows under entities (vanilla-style, projected on block tops)
    const sh = this.r.dyn;
    sh.reset();
    const layer = TEXTURES.indexOf('entity_shadow');
    for (const e of list) {
      if (e === game.player && game.thirdPerson === 0) continue;
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

  private drawLiving(game: Game, e: LivingEntity, x: number, y: number, z: number, t: number, sky: number, blk: number) {
    const anyE = e as unknown as Record<string, unknown>;
    const model = (anyE.model as string) ?? 'biped';
    const skin = (anyE.skin as string) ?? 'steve';
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
    let sc = baby ? 0.5 : 1;
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
    const base = this.entityBase(this.tmp2, x, y, z, bodyYaw, deathRoll, sc);
    const light: [number, number] = [sky, blk];
    const swing = e.pSwingProgress + (e.swingProgress - e.pSwingProgress) * t;
    const pose: Record<string, [number, number, number]> = {};
    const c = Math.cos;
    switch (model) {
      case 'biped':
      case 'bipedThin': {
        const sneak = e.sneaking;
        pose.head = [hp, netHead, 0];
        pose.hat = pose.head;
        let ra = c(ls * 0.6662 + Math.PI) * 2 * lsa * 0.5, la = c(ls * 0.6662) * 2 * lsa * 0.5;
        let raY = 0, laY = 0, raZ = 0, laZ = 0;
        const arms = anyE.armsPose as string | undefined;
        if (arms === 'zombie') { ra = la = -Math.PI / 2; raY = -0.1; laY = 0.1; }
        if (arms === 'bow') { ra = -Math.PI / 2 + hp; la = -Math.PI / 2 + hp; raY = -0.1 + netHead; laY = 0.1 + netHead + 0.4; }
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
        if (anyE.holding && arms !== 'bow' && arms !== 'zombie') ra = ra * 0.5 - Math.PI / 10;
        pose.rightArm = [ra + (sneak ? 0.4 : 0), raY, raZ];
        pose.leftArm = [la + (sneak ? 0.4 : 0), laY, laZ];
        pose.rightLeg = [c(ls * 0.6662) * 1.4 * lsa, 0, 0];
        pose.leftLeg = [c(ls * 0.6662 + Math.PI) * 1.4 * lsa, 0, 0];
        pose.body = [sneak ? 0.5 : 0, 0, 0];
        const offs: Record<string, [number, number, number]> | undefined = sneak ? { rightLeg: [0, -3, 4], leftLeg: [0, -3, 4], head: [0, 1, 0], hat: [0, 1, 0] } : undefined;
        const skipHat = new Set(['hat']);
        this.drawModel(model, skin, base, pose, light, overlay, skipHat, 1, offs);
        // held item
        const held = anyE.heldItem as number | undefined;
        if (held) this.drawHeldThirdPerson(held, base, pose.rightArm, light, offs?.rightArm);
        if (e instanceof Player) {
          const it = e.inventory.held();
          if (it) this.drawHeldThirdPerson(it.id, base, pose.rightArm, light);
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
      case 'pig': case 'cow': case 'sheep': {
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
        this.drawModel('spider', 'spider', base, pose, light, overlay);
        break;
      }
    }
  }

  private drawHeldThirdPerson(id: number, base: Mat4, armRot: [number, number, number], light: [number, number], off?: [number, number, number]) {
    const m = mat4();
    translate(m, base, -5 / 16 + (off?.[0] ?? 0) / 16, 2 / 16 + (off?.[1] ?? 0) / 16, (off?.[2] ?? 0) / 16);
    rotateZ(m, m, armRot[2]);
    rotateY(m, m, armRot[1]);
    rotateX(m, m, armRot[0]);
    translate(m, m, -1 / 16, 7 / 16, 1 / 16);
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
      else { layer = BLOCKS[it.block!].faces[0]; img = getTexture(TEXTURES[layer]); }
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
    this.appendItem(mesh, I.ARROW, m, sky, blk);
  }

  /** Player model in the inventory screen, drawn into a GUI rectangle. */
  renderPreview(game: Game, box: { x: number; y: number; w: number; h: number; yaw: number; pitch: number }, guiScale: number) {
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
      head: [-box.pitch * 0.6, -box.yaw * 0.6, 0],
      rightArm: [0, 0, 0.1], leftArm: [0, 0, -0.1], rightLeg: [0, 0, 0], leftLeg: [0, 0, 0],
    };
    const saved = this.r.env;
    this.r.env = { ...saved, fogStart: 1e5, fogEnd: 1e5 + 1, sunBright: 1, gamma: 0.5 };
    this.drawModel('biped', 'steve', base, pose, [15, 15], [0, 0, 0, 0], new Set(['hat']));
    const it = p.inventory.held();
    if (it) this.drawHeldThirdPerson(it.id, base, pose.rightArm, [15, 15]);
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
      const pose = { rightArm: [0, 0, 0] as [number, number, number] };
      const skipAll = new Set(['head', 'hat', 'body', 'leftArm', 'rightLeg', 'leftLeg']);
      this.drawModel('biped', 'steve', m, pose, [sky, blk], [0, 0, 0, 0], skipAll);
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
    this.r.drawDyn(dm, { cull: false, viewProj: proj });
    this.currentVP = this.r.viewProj;
  }
}

function wrapDelta(d: number) {
  d %= 360;
  if (d >= 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
