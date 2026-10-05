// The client side: moving parts (propeller blades, gyroscope rings, burner flames), the helm (steering with the
// movement keys while standing at it), and the flight readouts on the HUD.
import type { ModContext, Channel, RenderContext, Mat4, Box, Client, SubLevel } from '../sdk';
import type { Refs } from './blocks';
import type { HelmMsg, HelmSet, Telemetry, BurnerTile } from './flight';
import { paint } from './art';

export function setupClient(mod: ModContext, refs: Refs, helm: Channel<HelmMsg | HelmSet>) {
  const mc = mod.mc, M = mc.math;
  paint(mod);
  mod.client.creativeTab('aero', 'Aeronautics', () => refs.assembler.id, () => [
    mod.stack(refs.assembler), mod.stack(refs.helm), mod.stack(refs.propeller), mod.stack(refs.burner), mod.stack(refs.levitite), mod.stack(refs.gyro),
    ...refs.envelopes.map((e) => mod.stack(e)), mod.stack(refs.staff),
  ]);

  // ------------------------------------------------------------------ moving parts
  const m: Mat4 = M.mat4();
  /** Turn a box authored around +y to a 6-way facing, after spinning it `a` radians about that axis. */
  const facingSpin = (facing: number, a: number, out: Mat4) => {
    M.identity(out);
    M.translate(out, out, 0.5, 0.5, 0.5);
    if (facing === 0) M.rotateX(out, out, Math.PI);
    else if (facing === 2) M.rotateX(out, out, -Math.PI / 2);
    else if (facing === 3) M.rotateX(out, out, Math.PI / 2);
    else if (facing === 4) M.rotateZ(out, out, Math.PI / 2);
    else if (facing === 5) M.rotateZ(out, out, -Math.PI / 2);
    M.rotateY(out, out, a);
    M.translate(out, out, -0.5, -0.5, -0.5);
    return out;
  };
  /** Each spinning part's angle, advanced by its speed as frames go by. */
  const spins = new WeakMap<object, { a: number; t: number }>();
  const angle = (r: RenderContext, tile: object, degPerTick: number) => {
    let s = spins.get(tile);
    if (!s) spins.set(tile, (s = { a: 0, t: r.time }));
    s.a = (s.a + ((r.time - s.t) * degPerTick * Math.PI) / 180) % (Math.PI * 2);
    s.t = r.time;
    return s.a;
  };
  const all = (i: number) => [i, i, i, i, i, i];

  mod.client.tileRenderer(refs.propeller, (r, t, x, y, z, v) => {
    const p = Number(t.p ?? 0);
    // blades behind the casing (the side air is blown out of)
    const a = angle(r, t, p * 3);
    const blade = all(r.tex('aeronautics:blade')), brass = all(r.tex('aeronautics:brass'));
    const bl: Box[] = [{ x0: 6, y0: -4, z0: 6, x1: 10, y1: 0, z1: 10, tex: brass }];
    for (let i = 0; i < 4; i++) {
      // a blade along +z, pitched a little, turned to its place round the hub
      const s = Math.sin((i * Math.PI) / 2), c = Math.cos((i * Math.PI) / 2);
      if (Math.abs(s) < 0.5) bl.push({ x0: 7, y0: -3.2 + (c > 0 ? 0.4 : 0), z0: c > 0 ? 10 : -14, x1: 9, y1: -2.2 + (c > 0 ? 0.4 : 0), z1: c > 0 ? 30 : 6, tex: blade });
      else bl.push({ x0: s > 0 ? 10 : -14, y0: -3.2 + (s > 0 ? 0 : 0.4), z0: 7, x1: s > 0 ? 30 : 6, y1: -2.2 + (s > 0 ? 0 : 0.4), z1: 9, tex: blade });
    }
    r.boxes(bl, x, y, z, facingSpin((v >>> 12) & 7, a, m), r.light(x, y, z));
  });
  mod.client.tileRenderer(refs.gyro, (r, t, x, y, z) => {
    const a = angle(r, t, 25);
    const ring = all(r.tex('aeronautics:brass'));
    r.boxes([
      { x0: 3, y0: 7, z0: 3, x1: 13, y1: 9, z1: 4, tex: ring }, { x0: 3, y0: 7, z0: 12, x1: 13, y1: 9, z1: 13, tex: ring },
      { x0: 3, y0: 7, z0: 4, x1: 4, y1: 9, z1: 12, tex: ring }, { x0: 12, y0: 7, z0: 4, x1: 13, y1: 9, z1: 12, tex: ring },
      { x0: 7, y0: 3, z0: 7, x1: 9, y1: 14, z1: 9, tex: all(r.tex('aeronautics:casing')) },
    ], x, y, z, facingSpin(1, a, m));
  });
  mod.client.tileRenderer(refs.burner, (r, t, x, y, z) => {
    const out = Number(t.out ?? 0);
    if (!out) return;
    const flick = 0.85 + 0.15 * Math.sin(r.time * 1.7 + x * 3 + z);
    r.billboard(x + 0.5, y + 0.95 + out / 60, z + 0.5, (0.35 + out / 30) * flick, r.tex('particle_flame'), 0xffffff, [15, 15]);
  });

  // ------------------------------------------------------------------ the helm
  let piloting: { ship: number; x: number; y: number; z: number } | null = null;
  let sent = '', sentAt = 0;
  const leave = (client: Client) => {
    if (!piloting) return;
    helm.toServer({ leave: true });
    piloting = null;
    mod.client.setView(null);
    client.ui.hud.actionBar('§7You let go of the helm');
  };
  helm.onClient((d, client) => {
    const msg = d as HelmSet;
    if (!msg.ship) {
      if (piloting) { piloting = null; mod.client.setView(null); client.ui.hud.actionBar('§7You let go of the helm'); }
      return;
    }
    piloting = { ship: msg.ship, x: msg.x ?? 0, y: msg.y ?? 0, z: msg.z ?? 0 };
    client.ui.hud.actionBar('§bAt the helm: W/S throttle, A/D turn, jump/sneak up and down, R to let go');
    mod.client.setView({
      touchPad: true,
      move(inp, cl) {
        const q = (v: number) => (v > 0.3 ? 1 : v < -0.3 ? -1 : 0);
        const c = { fw: q(inp.forward), st: q(inp.strafe), up: inp.jump ? 1 : 0, dn: inp.sneak ? 1 : 0 };
        const k = JSON.stringify(c);
        // what changed now, and the same again now and then so the server knows we're still there
        if (k !== sent || cl.ticks - sentAt >= 10) { helm.toServer(c); sent = k; sentAt = cl.ticks; }
        return { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
      },
    });
  });
  mod.on('clientJoin', () => { piloting = null; });
  mod.client.keybind('leaveHelm', 'KeyR', (client) => leave(client));
  mod.client.touchButton('leave_helm', { label: 'Let go', visible: () => !!piloting, onPress: (client) => leave(client) });

  // ------------------------------------------------------------------ readouts
  const compass = (deg: number) => ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'][(((Math.round(deg / 45) % 8) + 8) % 8)];
  const shipById = (client: Client, id: number) => client.world?.ships.find((s: SubLevel) => s.id === id) ?? null;
  mod.on('hudRender', ({ ctx, client, width }) => {
    if (client.hideHud || client.ui.screen) return;
    const g = client.ui.gui;
    const lines: [string, string][] = [];
    const s = piloting ? shipById(client, piloting.ship) : client.player ? mc.ridingShip(client.player) : null;
    if (s) {
      const tel = (s.data.aero ?? {}) as Partial<Telemetry>;
      const speed = Math.hypot(s.lin[0], s.lin[1], s.lin[2]);
      // the way it's going (over the ground)
      const hs = Math.hypot(s.lin[0], s.lin[2]);
      const heading = hs > 0.3 ? `, going ${compass((Math.atan2(-s.lin[0], s.lin[2]) * 180) / Math.PI)}` : '';
      lines.push([`${s.label || 'Sub-level'}: ${speed.toFixed(1)} m/s, climbing ${s.lin[1].toFixed(1)}, height ${s.y.toFixed(0)}${heading}`, '#FFFFFF']);
      const lift = (tel.lift ?? 0) + (tel.lev ?? 0);
      if (tel.burners || tel.lev) lines.push([`Lift ${lift.toFixed(0)} of ${s.mass.toFixed(0)} kpg${tel.burners ? `, hot air ${Math.round(tel.gas ?? 0)}/${Math.round(tel.cap ?? 0)}` : ''}${tel.leak ? ' §c(the balloon leaks)' : ''}`, lift >= s.mass ? '#80FF80' : '#FFD080']);
      if (tel.props) lines.push([`${tel.props} propeller${tel.props > 1 ? 's' : ''}, pushing ${(tel.thrust ?? 0).toFixed(0)} kpg`, '#C0E0FF']);
      if (piloting) lines.push(['W/S throttle  A/D turn  jump/sneak up/down  R let go', '#A0A0A0']);
    }
    // what's under the crosshair
    const tg = client.target;
    if (tg && client.world) {
      const v = client.world.get(tg.x, tg.y, tg.z), id = v & 0xfff;
      const tile = client.world.getTile(tg.x, tg.y, tg.z) as Record<string, unknown> | undefined;
      if (id === refs.burner.id && tile) {
        const b = tile as unknown as BurnerTile;
        lines.push([`Burner: heat ${b.out}/15 (set to ${b.lvl}), hot air ${Math.round(b.gas ?? 0)}${b.cap ? '/' + Math.round(b.cap) : ''}${b.leak ? ' §c- no envelope above, or it leaks' : ''}`, '#FFB060']);
      } else if (id === refs.propeller.id && tile) lines.push([`Propeller: ${Math.abs(Number(tile.p ?? 0))}/15${Number(tile.p) < 0 ? ' (reversed)' : ''}${tg.ship ? '' : ' - only pushes on a sub-level'}`, '#C0E0FF']);
      else if (id === refs.assembler.id) lines.push([tg.ship ? 'Physics Assembler: use to land (it has to be level)' : 'Physics Assembler: use to lift what it\'s part of', '#9FE8FF']);
      else if (id === refs.helm.id) lines.push([tg.ship ? 'Helm: use to steer' : 'Helm: works on a sub-level', '#E0C090']);
    }
    let y = 22;
    for (const [t, col] of lines) {
      const w = g.font.width(t.replace(/§./g, ''));
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(Math.round(width / 2 - w / 2 - 2), y - 1, w + 4, 10);
      g.text(ctx, t, Math.round(width / 2 - w / 2), y, col);
      y += 11;
    }
  });
}
