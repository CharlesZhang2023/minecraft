// The server side: what each part does to the sub-level it's on, once a tick before the physics step.
// Parts note themselves from their tile ticks (so only parts on loaded sub-levels count); the subLevelTick event
// then pushes each sub-level with what its parts add up to.
import type { ModContext, Game, SubLevel, BlockCtx, Player, Channel } from '../sdk';
import { type Refs, OPP6 } from './blocks';

/** kpg*m/s^2 a propeller pushes with at full power (a block weighs 11 of these). */
export const PROP_THRUST = 220;
/** Hot air: what a block of it lifts (kpg), and how much one burner at full heat keeps filled (blocks). */
export const HOT_AIR_LIFT = 1.5;
export const BURNER_GAS = 250;
/** Levitite: how much weight one can hold up (kpg). */
export const LEVITITE_LIFT = 10;

export interface PropTile { p: number }
export interface BurnerTile { lvl: number; out: number; gas: number; cap: number; leak: boolean; red?: number }
interface Part { kind: 'prop' | 'burner' | 'lev' | 'gyro' | 'helm'; x: number; y: number; z: number; meta: number; tile: Record<string, unknown> }
export interface Telemetry { gas: number; cap: number; lift: number; thrust: number; lev: number; leak: boolean; burners: number; props: number }
/** What the pilot presses (W/S forward, A/D turn, jump up, sneak down). */
export interface Controls { fw: number; st: number; up: number; dn: number }
export interface HelmMsg { fw?: number; st?: number; up?: number; dn?: number; leave?: boolean }
export interface HelmSet { ship: number; x?: number; y?: number; z?: number }

const FACING6: [number, number, number][] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
const HORIZ: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function setupFlight(mod: ModContext, refs: Refs, helmChannel: Channel<HelmMsg | HelmSet>) {
  const mc = mod.mc;
  /** Parts seen last tick (in use now) and this tick (filling), by sub-level id. */
  let parts = new Map<number, Part[]>(), filling = new Map<number, Part[]>();
  /** Who steers what. */
  const pilots = new Map<number, { player: Player; ship: SubLevel; helm: [number, number, number]; meta: number; c: Controls; at: number }>();
  /** Grabs with the Physics Staff. */
  const grabs = new Map<Player, { ship: SubLevel; l: [number, number, number]; dist: number }>();
  /** Balloons found (they're looked for again every second or so). */
  const balloons = new Map<number, { at: number; list: Balloon[] }>();

  mod.on('serverTickStart', () => { parts = filling; filling = new Map(); });
  mod.on('worldClose', () => { parts.clear(); filling.clear(); pilots.clear(); grabs.clear(); balloons.clear(); });

  const note = (c: BlockCtx, kind: Part['kind']) => {
    const s = c.game.sublevels.containing(c.x, c.y, c.z);
    if (!s) return null;
    let l = filling.get(s.id);
    if (!l) filling.set(s.id, (l = []));
    l.push({ kind, x: c.x, y: c.y, z: c.z, meta: c.meta, tile: c.tile<Record<string, unknown>>() ?? {} });
    return s;
  };
  const pilotOf = (s: SubLevel) => {
    for (const p of pilots.values()) if (p.ship === s) return p;
    return null;
  };

  // ------------------------------------------------------------------ the parts' own ticks
  const propTick = (c: BlockCtx, t: PropTile) => {
    const s = note(c, 'prop');
    const red = c.power();
    let p = red;
    // no redstone: the helm drives it (forward/back for ones lined up with the helm, up/down for vertical ones)
    if (!red && s) {
      const pl = pilotOf(s);
      if (pl) {
        const [dx, dy, dz] = FACING6[c.meta & 7];
        if (dy) p = Math.round((pl.c.up - pl.c.dn) * 15 * dy);
        else {
          const [hx, hz] = HORIZ[pl.meta & 3];
          const d = dx * hx + dz * hz;
          if (Math.abs(d) > 0.5) p = Math.round(pl.c.fw * 15 * d);
        }
      }
    }
    if (t.p !== p) { t.p = p; c.tileChanged(); }
    if (p && c.game.ticks % 12 === 0) c.game.audio.play('aeronautics:propeller', { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 }, 0.25 + Math.abs(p) / 30, 0.7 + Math.abs(p) / 30);
    // air blown out the back
    if (p && s && c.game.ticks % 3 === 0) {
      const [dx, dy, dz] = FACING6[c.meta & 7], sg = -Math.sign(p);
      const back = s.toWorld(c.x + 0.5 - dx * 1.2, c.y + 0.5 - dy * 1.2, c.z + 0.5 - dz * 1.2);
      const v = mc.pose.dirToWorld(s.pose(), dx * sg * 0.3, dy * sg * 0.3, dz * sg * 0.3);
      for (let i = 0; i < 2; i++) c.game.particles.swirl(back.x + (Math.random() - 0.5) * 1.6, back.y + (Math.random() - 0.5) * 1.6, back.z + (Math.random() - 0.5) * 1.6, v.x, v.y, v.z, 0xe8eef2);
    }
  };

  const burnerTick = (c: BlockCtx, t: BurnerTile) => {
    const s = note(c, 'burner');
    const red = c.power();
    // (with a pilot at the helm, the heat is set for the height they want: see subLevelTick)
    t.red = red;
    const out = red || t.lvl;
    if (t.out !== out) { t.out = out; c.tileChanged(); }
    if (out && c.game.ticks % 2 === 0) c.game.particles.flame(c.x + 0.3 + Math.random() * 0.4, c.y + 0.85, c.z + 0.3 + Math.random() * 0.4);
    if (out && c.game.ticks % 16 === 0) c.game.audio.play('aeronautics:burner', { x: c.x + 0.5, y: c.y + 1, z: c.z + 0.5 }, 0.3 + out / 30, 0.8 + Math.random() * 0.2);
  };


  // ------------------------------------------------------------------ pushing the sub-levels
  mod.on('subLevelTick', ({ game, ship: s }) => {
    const sl = game.sublevels;
    const list = parts.get(s.id) ?? [];
    const pose = s.pose();
    const g = mc.PHYS.gravity;
    const tel: Telemetry = { gas: 0, cap: 0, lift: 0, thrust: 0, lev: 0, leak: false, burners: 0, props: 0 };
    let gyros = 0;
    const levs: Part[] = [];
    for (const p of list) {
      if (p.kind === 'prop') {
        const pw = Number(p.tile.p ?? 0);
        tel.props++;
        if (!pw) continue;
        const [dx, dy, dz] = FACING6[p.meta & 7];
        const at = s.toWorld(p.x + 0.5, p.y + 0.5, p.z + 0.5);
        const f = PROP_THRUST * (pw / 15) * mc.airPressure(at.y);
        sl.applyLocalForce(s, dx * f, dy * f, dz * f, p.x + 0.5, p.y + 0.5, p.z + 0.5);
        tel.thrust += Math.abs(f) / g;
      } else if (p.kind === 'lev') levs.push(p);
      else if (p.kind === 'gyro') gyros++;
    }
    // levitite (Sable's floating blocks): each crystal holds up to its share of the weight, and the air is "thick"
    // around it while it moves slowly, so a ship with enough of it hovers where it's left instead of sinking
    if (levs.length) {
      const held = Math.min(s.mass, levs.length * LEVITITE_LIFT);
      const share = held / levs.length;
      for (const p of levs) {
        // it pulls its column of the ship up from a little above the centre of mass (like the crystal cancelling
        // gravity there), so the ship hangs level from it instead of balancing on it: crystals under the deck
        // would otherwise tip it over the way a push from below does
        const at = s.toWorld(p.x + 0.5, s.ly + 2, p.z + 0.5);
        const v = sl.velocityAt(s, at.x, at.y, at.z);
        const hv = Math.hypot(v.x, v.z);
        const fv = Math.abs(v.y) < 3 ? 2 : 0.1, fh = hv < 3 ? 1.5 : 0.05;
        sl.applyForce(s, -v.x * fh * share, share * g - v.y * fv * share, -v.z * fh * share, at.x, at.y, at.z);
      }
      tel.lev = held;
    }
    // hot air
    const burners = list.filter((p) => p.kind === 'burner');
    tel.burners = burners.length;
    if (burners.length) {
      let b = balloons.get(s.id);
      if (!b || game.ticks - b.at > 20 || b.list.reduce((n, x) => n + x.burners.length, 0) !== burners.length) {
        b = { at: game.ticks, list: findBalloons(s, burners) };
        balloons.set(s.id, b);
      } else for (const bl of b.list) bl.burners = bl.burners.map((o) => burners.find((q) => q.x === o.x && q.y === o.y && q.z === o.z) ?? o);
      // a pilot flies by height: holding it, or climbing / sinking at a steady few metres a second (the burners
      // they don't run by redstone are turned to whatever lift that takes)
      const pl = pilotOf(s);
      const caps = b.list.reduce((n, x) => n + (x.leak ? 0 : x.cap), 0);
      let wantLift = -1;
      if (pl && caps > 0) {
        const vyWant = pl.c.up ? 4 : pl.c.dn ? -4 : 0;
        wantLift = Math.max(0, s.mass * (1 + (0.8 * (vyWant - s.lin[1])) / g) - tel.lev);
      }
      for (const bl of b.list) {
        const heat = bl.burners.reduce((n, q) => n + Number(q.tile.out ?? 0), 0);
        let gas = bl.burners.reduce((n, q) => n + Number(q.tile.gas ?? 0), 0);
        let target = bl.leak ? 0 : Math.min(bl.cap, (heat / 15) * BURNER_GAS);
        const piloted = bl.burners.filter((q) => !Number(q.tile.red ?? 0));
        if (wantLift >= 0 && piloted.length && !bl.leak) {
          const at0 = s.toWorld(bl.cx, bl.cy, bl.cz);
          target = Math.min(bl.cap, (wantLift * (bl.cap / caps)) / (HOT_AIR_LIFT * Math.max(0.05, mc.airPressure(at0.y))));
          // the burners' own setting follows, so the ship keeps about this height when the pilot lets go
          const lvl = Math.max(0, Math.min(15, Math.ceil((target / BURNER_GAS) * 15 / piloted.length)));
          for (const q of piloted) if (Number(q.tile.lvl) !== lvl) { q.tile.lvl = lvl; q.tile.out = lvl; }
        }
        // fills (and cools) over about nine seconds, like Aeronautics' balloons
        const rate = Math.max(1, bl.cap / 180);
        gas = gas < target ? Math.min(target, gas + rate) : Math.max(target, gas - rate * 0.7);
        for (const q of bl.burners) {
          const t = q.tile as unknown as BurnerTile;
          t.gas = gas / bl.burners.length;
          t.cap = bl.cap;
          t.leak = bl.leak;
        }
        if (game.ticks % 10 === 0) for (const q of bl.burners) mc.blockCtx(game, q.x, q.y, q.z).tileChanged();
        tel.gas += gas; tel.cap += bl.cap; tel.leak ||= bl.leak;
        if (gas <= 0) continue;
        const at = s.toWorld(bl.cx, bl.cy, bl.cz);
        const lift = gas * HOT_AIR_LIFT * mc.airPressure(at.y);
        sl.applyForce(s, 0, lift * g, 0, at.x, at.y, at.z);
        tel.lift += lift;
      }
    } else balloons.delete(s.id);
    // gyroscopes: lean back upright and stop rocking
    const [x0, y0, z0, x1, y1, z1] = s.bounds;
    const inertia = Math.max(1, s.mass * ((x1 - x0 + 1) ** 2 + (y1 - y0 + 1) ** 2 + (z1 - z0 + 1) ** 2) / 12);
    if (gyros) {
      const k = Math.min(4, gyros);
      const u = mc.pose.qrot(pose.q, 0, 1, 0);
      // u x up: the axis to turn about to stand up
      const ax = -u.z, az = u.x;
      const [wx, , wz] = s.ang;
      sl.applyTorque(s, (ax * 6 - wx * 3) * inertia * k, 0, (az * 6 - wz * 3) * inertia * k);
    }
    // the pilot: turning, and holding the heading steady
    const pl = pilotOf(s);
    if (pl) {
      const wy = s.ang[1];
      const want = pl.c.st * 0.6;
      sl.applyTorque(s, 0, (want - wy) * 2.5 * inertia, 0);
    }
    // grabbed with the staff: pulled toward a point in front of the player
    for (const [player, gr] of grabs) {
      if (gr.ship !== s) continue;
      if (player.dead || player.removed || player.world !== s.world) { grabs.delete(player); continue; }
      const look = game.lookVec(player.yaw, player.pitch);
      const ey = player.y + player.eyeHeight();
      const tx = player.x + look.x * gr.dist, ty = ey + look.y * gr.dist, tz = player.z + look.z * gr.dist;
      const cur = s.toWorld(gr.l[0], gr.l[1], gr.l[2]), v = sl.velocityAt(s, cur.x, cur.y, cur.z);
      const m = Math.max(1, s.mass);
      const cap = 400 * m;
      const f = [(tx - cur.x) * 30 - v.x * 9, (ty - cur.y) * 30 - v.y * 9 + g, (tz - cur.z) * 30 - v.z * 9].map((q) => Math.max(-cap, Math.min(cap, q * m)));
      sl.applyForce(s, f[0], f[1], f[2], cur.x, cur.y, cur.z);
      // and don't let it spin wildly while held
      sl.applyTorque(s, -s.ang[0] * inertia * 2, -s.ang[1] * inertia * 2, -s.ang[2] * inertia * 2);
    }
    if (game.ticks % 10 === 0) {
      const r = (n: number) => Math.round(n * 10) / 10;
      s.data.aero = { gas: r(tel.gas), cap: r(tel.cap), lift: r(tel.lift), thrust: r(tel.thrust), lev: r(tel.lev), leak: tel.leak, burners: tel.burners, props: tel.props };
    }
  });

  // ------------------------------------------------------------------ balloons
  interface Balloon { cap: number; cx: number; cy: number; cz: number; leak: boolean; burners: Part[] }
  const envelopeIds = () => new Set(refs.envelopes.map((e) => e.id));
  /**
   * The hot air above each burner, found the way Aeronautics' balloon layers work: straight up from the burner to
   * the roof (an envelope, or any full solid block), then everything under that roof that hot air can rise into;
   * then down from there a layer at a time, as long as each layer is closed in at its sides. The first layer that
   * opens to the side (a balloon's open skirt) is where the hot air ends. A roof whose top layer isn't closed in
   * holds nothing. Burners under the same balloon share it.
   */
  function findBalloons(s: SubLevel, burners: Part[]): Balloon[] {
    const w = s.world, env = envelopeIds();
    const [bx0, by0, bz0, bx1, by1, bz1] = s.bounds;
    const airtight = (v: number) => {
      const id = v & 0xfff;
      if (!id) return false;
      if (env.has(id)) return true;
      const d = mc.BLOCKS[id];
      return !!d && d.solid && d.opaque;
    };
    const key = (x: number, y: number, z: number) => (x - bx0) + (z - bz0) * 4096 + y * 16777216;
    const inside = (x: number, y: number, z: number) => x >= bx0 && x <= bx1 && z >= bz0 && z <= bz1 && y >= by0 && y <= by1;
    const roofed = (x: number, y: number, z: number) => { for (let yy = y + 1; yy <= by1; yy++) if (airtight(w.get(x, yy, z))) return true; return false; };
    const LIMIT = 8000;
    const out: Balloon[] = [];
    const owner = new Map<number, Balloon>();
    for (const b of burners) {
      // up the chimney to the roof
      let ry = b.y + 1;
      while (ry <= by1 && !airtight(w.get(b.x, ry, b.z))) ry++;
      if (ry > by1 || ry === b.y + 1) { out.push({ cap: 0, cx: 0, cy: 0, cz: 0, leak: ry > by1, burners: [b] }); continue; }
      const top = ry - 1;
      const joined = owner.get(key(b.x, top, b.z));
      if (joined) { joined.burners.push(b); continue; }
      const bl: Balloon = { cap: 0, cx: 0, cy: 0, cz: 0, leak: false, burners: [b] };
      const region = new Set<number>();
      // everything under the roof the hot air can rise into: sideways and up, never below the top layer
      const fill = (seeds: [number, number, number][], minY: number, up: boolean): [number, number, number][] | null => {
        const got: [number, number, number][] = [], q = [...seeds], seen = new Set<number>(seeds.map(([x, y, z]) => key(x, y, z)));
        while (q.length) {
          const [x, y, z] = q.pop()!;
          if (!inside(x, y, z) || !roofed(x, y, z)) return null;
          got.push([x, y, z]);
          if (got.length + region.size > LIMIT) return null;
          for (const [dx, dy, dz] of up ? [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]] : [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
            const nx = x + dx, ny = y + dy, nz = z + dz;
            if (ny < minY) continue;
            const k = key(nx, ny, nz);
            if (seen.has(k) || region.has(k)) continue;
            seen.add(k);
            if (!airtight(w.get(nx, ny, nz))) q.push([nx, ny, nz]);
          }
        }
        return got;
      };
      const cells: [number, number, number][] = [];
      const first = fill([[b.x, top, b.z]], top, true);
      if (!first) { bl.leak = true; out.push(bl); continue; }
      for (const [x, y, z] of first) { region.add(key(x, y, z)); cells.push([x, y, z]); }
      // then down, a closed-in layer at a time, to the burner
      let layer = first.filter(([, y]) => y === top);
      for (let y = top - 1; y > b.y; y--) {
        const seeds = layer.filter(([x, , z]) => !airtight(w.get(x, y, z))).map(([x, , z]) => [x, y, z] as [number, number, number]);
        if (!seeds.length) break;
        const got = fill(seeds, y, false);
        if (!got) break;
        for (const [x, yy, z] of got) { region.add(key(x, yy, z)); cells.push([x, yy, z]); }
        layer = got;
      }
      let sx = 0, sy = 0, sz = 0;
      for (const [x, y, z] of cells) { sx += x + 0.5; sy += y + 0.5; sz += z + 0.5; owner.set(key(x, y, z), bl); }
      bl.cap = cells.length; bl.cx = sx / cells.length; bl.cy = sy / cells.length; bl.cz = sz / cells.length;
      // other burners under the same roof join it (found by the cell over them)
      for (let y = b.y + 1; y <= top; y++) owner.set(key(b.x, y, b.z), bl);
      out.push(bl);
    }
    return out;
  }

  // ------------------------------------------------------------------ the helm
  helmChannel.onServer((d, player, game) => {
    const m = d as HelmMsg;
    const pl = [...pilots.values()].find((p) => p.player === player);
    if (!pl) return;
    if (m.leave) { pilots.delete(pl.ship.id); return; }
    const n = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
    pl.c = { fw: n(m.fw, -1, 1), st: n(m.st, -1, 1), up: n(m.up, 0, 1), dn: n(m.dn, 0, 1) };
    pl.at = game.ticks;
  });
  // pilots who walked off, went quiet or lost their ship let go
  mod.on('serverTick', (game: Game) => {
    for (const [id, p] of pilots) {
      const s = p.ship;
      const h = s.removed ? null : s.toWorld(p.helm[0] + 0.5, p.helm[1] + 0.5, p.helm[2] + 0.5);
      const far = !h || Math.hypot(p.player.x - h.x, p.player.y - h.y, p.player.z - h.z) > 8;
      if (s.removed || p.player.removed || p.player.dead || far || game.ticks - p.at > 60 || (s.world.get(p.helm[0], p.helm[1], p.helm[2]) & 0xfff) !== refs.helm.id) {
        pilots.delete(id);
        helmChannel.toPlayer(p.player, { ship: 0 });
      }
    }
  });

  return {
    propTick, burnerTick, note,
    takeHelm(c: BlockCtx & { player: Player }) {
      const s = c.game.sublevels.containing(c.x, c.y, c.z);
      if (!s) { c.game.ui.hud.actionBar('§eThe helm steers a sub-level: assemble the ship first (Physics Assembler)'); return; }
      const cur = pilotOf(s);
      if (cur && cur.player !== c.player) { c.game.ui.hud.actionBar('§eSomeone else is at the helm'); return; }
      if (cur) { pilots.delete(s.id); helmChannel.toPlayer(c.player, { ship: 0 }); return; }
      // one ship per pilot
      for (const [id, p] of pilots) if (p.player === c.player) pilots.delete(id);
      pilots.set(s.id, { player: c.player, ship: s, helm: [c.x, c.y, c.z], meta: c.meta, c: { fw: 0, st: 0, up: 0, dn: 0 }, at: c.game.ticks });
      helmChannel.toPlayer(c.player, { ship: s.id, x: c.x, y: c.y, z: c.z });
    },
    grab(game: Game, player: Player, sneaking: boolean) {
      const t = game.target;
      if (!t?.ship) return false;
      if (sneaking) {
        game.sublevels.anchor(t.ship, !t.ship.anchored);
        game.ui.hud.actionBar(t.ship.anchored ? '§bAnchored in place' : '§bLet go');
        return true;
      }
      if (t.ship.anchored) game.sublevels.anchor(t.ship, false);
      grabs.set(player, { ship: t.ship, l: [t.hx, t.hy, t.hz], dist: Math.max(2, t.t) });
      return true;
    },
    release(player: Player) { grabs.delete(player); },
    holding(player: Player) { return grabs.has(player); },
  };
}

export { OPP6 };
