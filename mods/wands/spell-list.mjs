// Writes SPELLS.md, the complete spell reference, straight from the catalogue (spells.ts and catalog/*.ts), so the
// list can't drift from the code. Run it after adding or changing a spell:
//
//   node mods/wands/spell-list.mjs           rewrite SPELLS.md
//   node mods/wands/spell-list.mjs --check   exit 1 if SPELLS.md is out of date
//
// Needs Node 22.18 or newer (it loads the .ts files directly; Node strips the types). Not part of the mod's bundle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const { SPELLS, TYPE_ORDER, TYPE_NAMES, makeProj, BASE } = await import('./spells.ts');

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const sign = (n) => (n > 0 ? `+${n}` : String(n));
const num = (n) => String(Math.round(n * 1000) / 1000);
const timing = (s) => [s.delay ? `delay ${sign(s.delay)}` : '', s.reload ? `recharge ${sign(s.reload)}` : ''].filter(Boolean).join(', ') || '-';
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const rule = (r) => `${r.on}: ${r.n ?? 1}x ${r.spell === 'self' ? 'copy of itself' : `\`${r.spell}\``}${r.dir && r.dir !== 'same' ? ` ${r.dir}${r.cone ? ` ${r.cone}deg` : ''}` : ''}${r.every ? ` every ${r.every}t` : ''}${r.max ? ` (max ${r.max})` : ''}${r.speed !== undefined ? ` speed x${r.speed}` : ''}`;

// ---- where each spell is defined (file and line), for "Defined in"
const files = fs.readdirSync(path.join(dir, 'catalog')).filter((f) => f.endsWith('.ts')).map((f) => ({ f: `catalog/${f}`, lines: fs.readFileSync(path.join(dir, 'catalog', f), 'utf8').split('\n') }));
function defLine(s) {
  const [, pre, suf] = s.id.match(/^(\w+?)_(\d+)$/) ?? [];
  for (const { f, lines } of files) {
    // the defining call: the id followed by the spell's name
    let i = lines.findIndex((l) => l.includes(`'${s.id}', '`) || l.includes(`'${s.id}', "`));
    if (i < 0 && pre) i = lines.findIndex((l) => l.startsWith(`${pre}(${suf},`));
    if (i >= 0) return { f, n: i + 1, text: lines[i].trim() };
  }
  return null;
}

/** A projectile's numbers and behaviour that differ from a plain one, in reading order. */
function projLine(p) {
  const out = [];
  if (p.dmg) out.push(`dmg ${num(p.dmg)}`);
  if (p.crit) out.push(`crit ${Math.round(p.crit * 100)}%`);
  if (p.heal) out.push(`heals ${num(p.heal)}`);
  if (p.lifeSteal) out.push(`life steal ${num(p.lifeSteal)}`);
  if (p.explR) out.push(`explodes r${num(p.explR)} dmg ${num(p.explDmg)}${p.terrain ? ` terrain ${num(p.terrain)}` : ''}`);
  if (p.elec) out.push(`shock ${num(p.elec)}`);
  if (p.aura) out.push(`hurts within ${num(p.aura)}`);
  if (p.digHard) out.push(p.digR ? `digs ball r${num(p.digR)} (hardness <= ${num(p.digHard)})` : `digs ${p.digCount} blocks (hardness <= ${num(p.digHard)})`);
  if (p.eater) out.push('eats blocks it passes');
  out.push(`speed ${num(p.speed)}`, `life ${p.life}`);
  if (p.speed) out.push(`range ~${Math.round(p.speed * p.life)}`);
  if (p.spread) out.push(`spread ${sign(p.spread)}`);
  if (p.gravity) out.push(`gravity ${num(p.gravity)}`);
  if (p.drag !== BASE.drag) out.push(`drag ${num(p.drag)}`);
  if (p.bounces) out.push(p.bounces >= 999 ? `bounces (keeps ${num(p.bounceKeep)})` : `bounces ${p.bounces}`);
  if (p.fuse) out.push('fuse: ends only when its life runs out');
  if (p.dormant) out.push('dormant: set off by explosions');
  if (p.pierce) out.push('pierces');
  if (p.ghost) out.push('ghost (passes blocks)');
  if (p.selfHit) out.push('can hurt its caster');
  if (p.fire) out.push('sets alight');
  if (p.freeze) out.push('freezes');
  if (p.homing) out.push(`homing ${num(p.homing)}`);
  if (p.path !== 'straight') out.push(`path ${p.path}`);
  if (p.steer.length) out.push(`steer ${p.steer.join('+')}`);
  if (p.orbit) out.push(`orbits ${p.orbit.around} r${num(p.orbit.r)}`);
  if (p.sky) out.push('falls from the sky onto the aim point');
  if (p.aim) out.push('appears at the aim point');
  for (const r of p.spawns) out.push(`casts on ${rule(r)}`);
  for (const [st, t] of p.inflict) out.push(`inflicts ${st} ${t}t`);
  if (p.critOn.length) out.push(`always crits on ${p.critOn.join('/')}`);
  for (const e of p.explodeOn) out.push(`explodes on ${e.status} (r${e.r} dmg ${e.dmg})`);
  if (p.arcs.length) out.push(`arcs: ${p.arcs.join('/')}`);
  if (p.trails.length) out.push(`trails: ${p.trails.join('/')}`);
  if (p.transmute.length) out.push(`transmutes: ${p.transmute.join('/')}`);
  if (p.shield) out.push('knocks projectiles away');
  if (p.invisible) out.push('invisible');
  if (p.fizzle) out.push(`fizzles ${Math.round(p.fizzle * 100)}%`);
  const data = Object.entries(p.data);
  if (data.length) out.push(`data ${data.map(([k, v]) => `${k}=${v}`).join(' ')}`);
  return out;
}

function special(s) {
  const out = [];
  if (s.trigger) out.push(s.trigger === 'timer' ? `**trigger: timer ${s.timer}t**` : `**trigger: ${s.trigger}**`);
  if (s.count) out.push(`**${s.count} projectiles per card**`);
  if (s.triggerDraw) out.push(`carries ${s.triggerDraw} spells`);
  for (const k of ['tick', 'hit', 'touch', 'play', 'cast']) if (s[k]) out.push(`\`${k}\``);
  if (s.passive) out.push(`passive: ${s.passive}`);
  if (s.marker) out.push(`marker: ${s.marker}`);
  if (s.hidden) out.push('hidden (helper, no item)');
  return out.join(', ') || '-';
}

/** What a modifier does to a projectile: applied to a probe, and the differences listed. */
function modEffect(s) {
  if (!s.mod) return '-';
  const fresh = () => makeProj({ id: 'probe', name: '', type: 'projectile', desc: '', mana: 0, tier: 0, icon: { g: '', c: '' }, proj: { dmg: 10, explR: 2, explDmg: 10, life: 20, speed: 1, size: 0.15 } });
  const a = fresh(), b = fresh();
  s.mod(a); s.mod(b);
  const ref = fresh();
  const changes = [];
  const random = JSON.stringify(a) !== JSON.stringify(b);
  for (const k of Object.keys(ref)) {
    if (k === 'spell') continue;
    const x = ref[k], y = a[k];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    if (random && JSON.stringify(a[k]) !== JSON.stringify(b[k])) { changes.push(`${k} random`); continue; }
    if (typeof x === 'number' && typeof y === 'number') changes.push(`${k} ${num(x)}->${num(y)}`);
    else if (Array.isArray(y)) {
      const added = y.slice(x.length);
      changes.push(`${k} +${added.map((v) => (typeof v === 'object' && v && 'on' in v ? `[${rule(v)}]` : JSON.stringify(v))).join(', ')}`);
    } else if (k === 'color') changes.push(`color ${hex(y)}`);
    else changes.push(`${k} ${JSON.stringify(y)}`);
  }
  return changes.join('; ') || '(no projectile change)';
}

function formation(s) {
  const out = [];
  if (s.formation) out.push('formation ' + s.formation.map(([y, p]) => (p ? `(${num(y)},${num(p)})` : num(y))).join(' / ') + ' deg');
  if (s.scatter) out.push(`${sign(s.scatter)} deg spread`);
  return out.join(', ') || 'same direction';
}

const row = (cells) => `| ${cells.map(esc).join(' | ')} |`;
const head = (cells) => `${row(cells)}\n|${cells.map(() => '---').join('|')}|`;
const where = (s) => { const d = defLine(s); return d ? `${d.f.replace('catalog/', '')}:${d.n}` : '-'; };

const visible = SPELLS.filter((s) => !s.hidden);
const out = [
  '# Wands: every spell',
  '',
  '<!-- generated by spell-list.mjs from spells.ts and catalog/*.ts: edit those, then rerun it (node mods/wands/spell-list.mjs) -->',
  '',
  `${visible.length} spells you can hold (${TYPE_ORDER.map((t) => `${visible.filter((s) => s.type === t).length} ${TYPE_NAMES[t].toLowerCase()}`).join(', ')}), ` +
  `plus ${SPELLS.length - visible.length} hidden helpers (projectiles other spells make). See [README.md](README.md) for how casting works and how to add spells.`,
  '',
  '- **Ids.** The item of a spell is `wands:<id>`. The **Def** column is where it is defined (`catalog/<file>:<line>`).',
  '- **Units.** Mana is per cast. Delay and recharge are ticks added to the wand\'s (20 ticks = 1 s). Uses are per wand slot, one back every 300 ticks. Damage is in half-hearts; speed in blocks per tick; life in ticks; range = speed x life (before gravity).',
  '- **Abbreviations.** `t` = ticks. `casts on X: ...` = a spawn rule (it casts that spell when X happens: bounce, end, block, entity, tick, down, slow, kill). `inflicts S 200t` = puts condition S on what it hits for 200 ticks.',
  '- **Modifiers** are described by what they change on a probe projectile (dmg 10, explosion r2 dmg 10, life 20, speed 1): `field old->new`, or `field +added` for lists.',
  '- **Noita.** Every visible spell is a spell from Noita and wears its icon (`noita` names it when the names differ), except Lava, Sand and Snow, which are this mod\'s own.',
];

for (const t of TYPE_ORDER) {
  const list = SPELLS.filter((s) => s.type === t);
  out.push('', `## ${TYPE_NAMES[t]} (${list.filter((s) => !s.hidden).length})`, '');
  if (t === 'projectile' || t === 'static' || t === 'material') {
    out.push(head(['id', 'Name', 'Tier', 'Mana', 'Timing', 'Uses', 'Projectile', 'Special', 'Def', 'Description']));
    for (const s of list) {
      const desc = s.play && !s.proj ? `${s.desc} (casts another spell: see its code below)` : s.desc;
      const pl = s.play && !s.proj ? '-' : projLine(makeProj(s)).join(', ') + `, visual \`${makeProj(s).visual}\`, colour ${hex(makeProj(s).color)}`;
      out.push(row([`\`${s.id}\``, s.name, s.tier, s.mana, timing(s), s.uses ?? '-', pl, special(s), where(s), desc]));
    }
  } else if (t === 'modifier') {
    out.push(head(['id', 'Name', 'Tier', 'Mana', 'Timing', 'Uses', 'Effect on each projectile', 'Special', 'Def', 'Description']));
    for (const s of list) out.push(row([`\`${s.id}\``, s.name, s.tier, s.mana, timing(s), s.uses ?? '-', modEffect(s), special(s), where(s), s.desc]));
  } else if (t === 'multicast') {
    out.push(head(['id', 'Name', 'Tier', 'Mana', 'Timing', 'Uses', 'Draws', 'Layout', 'Def', 'Description']));
    for (const s of list) out.push(row([`\`${s.id}\``, s.name, s.tier, s.mana, timing(s), s.uses ?? '-', s.draw ?? 2, formation(s), where(s), s.desc]));
  } else {
    out.push(head(['id', 'Name', 'Tier', 'Mana', 'Timing', 'Uses', 'Special', 'Def', 'Description']));
    for (const s of list) out.push(row([`\`${s.id}\``, s.name, s.tier, s.mana, timing(s), s.uses ?? '-', special(s), where(s), s.desc]));
  }
}

// ---- the code behind spells whose behaviour isn't all in their numbers
/** Function source back at the left margin: the closing brace's indent comes off every line after the first. */
const dedent = (src) => {
  const lines = src.split('\n');
  const ind = lines.length > 1 ? lines[lines.length - 1].match(/^ */)[0].length : 0;
  return lines.map((l, i) => (i ? l.slice(Math.min(ind, l.match(/^ */)[0].length)) : l)).join('\n');
};
out.push('', '## Spell code', '',
  'Spells with code of their own, as written (server only, except `play` and `cast`, which also run in the editor\'s preview):',
  '',
  '- `tick(l, w)` runs every tick of flight, `hit(l, h, w)` when the projectile ends, `touch(l, e, w)` when it hits a creature (before damage). `l` is the projectile (`Live`), `h` where and why it ended (`HitInfo`), `w` the `SpellWorld`.',
  '- `play(c, shot)` is a card\'s own logic and `cast(c, shot)` a modifier\'s effect on the cast (`c` is the `CastCtx`).',
  '- Free names (`t`, `n`, `kind`, `status`, `block`, `from`, `spell`...) come from the helper call that defined the spell: its definition line is shown under the code.',
  '- `isCopy(s)` is true for copy spells (Alpha, Gamma, Omega, Mu, Tau, Phi, Sigma, Zeta, Spell Duplication, Divide By, Random, Copy Random), which never copy each other. `landing(h)` is the open block in front of what was hit.');
const seen = new Map();
for (const s of SPELLS) {
  const fns = ['tick', 'hit', 'touch', 'play', 'cast'].filter((k) => typeof s[k] === 'function');
  if (!fns.length) continue;
  // Node strips types to blanks: close the gaps they leave
  const code = fns.map((k) => { const src = dedent(s[k].toString()).replace(/ +([,)])/g, '$1'); return src.startsWith(k) ? src : `${k}: ${src}`; }).join('\n');
  const d = defLine(s);
  // many spells share a helper's code: show it once, then point to it
  const prev = seen.get(code);
  out.push('', `**\`${s.id}\`** (${s.name})`, '');
  if (prev) out.push(`Same code as \`${prev}\`.`);
  else { out.push('```ts', code, '```'); seen.set(code, s.id); }
  if (d) out.push(`Defined at \`${d.f}:${d.n}\`: \`${esc(d.text.length > 400 ? d.text.slice(0, 400) + '...' : d.text)}\``);
}

// ---- what new spells can use
const art = fs.readFileSync(path.join(dir, 'art.ts'), 'utf8');
const glyphs = [...art.slice(art.indexOf('const G: Record')).matchAll(/^ {2}(\w+): \(p/gm)].map((m) => `\`${m[1]}\``);
const defs = fs.readFileSync(path.join(dir, 'spelldefs.ts'), 'utf8');
const union = (name) => [...(defs.match(new RegExp(`export type ${name} =([\\s\\S]*?);`))?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => `\`${m[1]}\``).join(', ');
out.push('', '## Building blocks for new spells', '',
  `- **Visuals** (\`proj.visual\`, drawn in \`fx.ts\`): ${union('Visual')}. \`icon\` draws the spell's Noita icon as a sprite (\`sprite\` borrows another spell's).`,
  `- **Paths** (\`proj.path\`, \`motion.ts\`): ${union('Path')}.`,
  `- **Steering** (\`proj.steer\`): ${union('Steer')}.`,
  `- **Conditions** (\`inflict\`, \`critOn\`, \`explodeOn\`, \`SpellWorld.status\`): ${union('Status')}.`,
  `- **Card art glyphs** (\`icon.g\`, painted in \`art.ts\`, used only when there's no Noita icon): ${glyphs.join(', ')}.`,
  '- **Material blocks** (`blocks.ts`): `wands:acid`, `wands:oil`, `wands:blood`, `wands:slime`, `wands:toxic`, `wands:alcohol`, `wands:urine`, `wands:gunpowder`, `wands:cement`, `wands:gas`, `wands:magic_wall`.',
  '');

const text = out.join('\n');
const file = path.join(dir, 'SPELLS.md');
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (cur !== text) { console.error('SPELLS.md is out of date: run node mods/wands/spell-list.mjs'); process.exit(1); }
  console.log('SPELLS.md up to date');
} else {
  fs.writeFileSync(file, text);
  console.log(`wrote ${SPELLS.length} spells into SPELLS.md (${text.length} bytes)`);
}
