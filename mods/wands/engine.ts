// How a wand fires, after Noita: the wand's spells are a deck of cards. Each cast draws "spells/cast" cards;
// a projectile goes into the cast, a modifier changes the whole cast and draws one more, a multicast draws
// several more, a trigger's projectile carries the next card as its payload. When the deck runs out mid-cast it
// wraps around once (what's already in hand can't be drawn again) and the wand recharges after the cast; once
// the deck is empty, the wand recharges too. Spells the wand can't afford are skipped for the next card.
//
// Pure logic: the server fires real wands with it, the editor runs it on a copy to preview a wand's casts.
import { SPELL_BY_ID, Shot, makeProj, cloneProj, type CastCtx, type CastEntry, type Proj, type SpellDef } from './spells';
import { wandSpells, type WandData } from './wand';

/** A wand's state between casts: its deck, mana and timers (the server keeps one per wand, by uid). */
export interface Runtime {
  deck: number[];
  discard: number[];
  mana: number;
  /** Ticks until it may cast again, and how long that wait was. */
  delay: number;
  delayTotal: number;
  /** Ticks of recharging left (the deck is back in order already), and the full time. */
  reload: number;
  reloadTotal: number;
  /** Server tick of the last catch-up (mana and timers run while the wand rests in a pocket). */
  at: number;
  /** Ticks toward the next use coming back to a limited spell. */
  usesClock: number;
  /** The wand layout this deck was built from (rebuilt when the wand is edited). */
  layout: string;
  /** Requirement - Every Other's switch. */
  toggle?: boolean;
}

/** Ticks per use regained by a limited spell. */
export const USE_REGEN = 300;

export const layoutKey = (w: WandData) => `${w.rev}|${w.s.cap}|${w.spells.join(',')}`;

function order(w: WandData, slots: number[], rand: () => number): number[] {
  const out = [...slots].sort((a, b) => a - b);
  if (w.s.shuffle) for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
const filledSlots = (w: WandData) => w.spells.flatMap((id, i) => (id && SPELL_BY_ID.has(id) ? [i] : []));

export function newRuntime(w: WandData, now: number, rand: () => number = Math.random): Runtime {
  return { deck: order(w, filledSlots(w), rand), discard: [], mana: w.s.mana, delay: 0, delayTotal: 0, reload: 0, reloadTotal: 0, at: now, usesClock: 0, layout: layoutKey(w) };
}

/** Let time pass for a wand: mana flows back, timers run down. Returns the uses regained (slots), if any. */
export function catchUp(w: WandData, rt: Runtime, now: number, rand: () => number = Math.random): number[] {
  const dt = Math.max(0, now - rt.at);
  rt.at = now;
  if (rt.layout !== layoutKey(w)) {
    // edited: a fresh deck, recharging (Noita: editing a wand reloads it)
    rt.deck = order(w, filledSlots(w), rand);
    rt.discard = [];
    rt.layout = layoutKey(w);
    rt.reload = rt.reloadTotal = Math.max(rt.reload, Math.min(20, Math.max(0, w.s.reload)));
  }
  rt.mana = Math.min(w.s.mana, rt.mana + (w.s.regen * dt) / 20);
  rt.delay = Math.max(0, rt.delay - dt);
  rt.reload = Math.max(0, rt.reload - dt);
  const regained: number[] = [];
  if (w.uses?.some((u, i) => u !== null && u < (SPELL_BY_ID.get(w.spells[i] ?? '')?.uses ?? 0))) {
    rt.usesClock += dt;
    while (rt.usesClock >= USE_REGEN) {
      rt.usesClock -= USE_REGEN;
      const i = w.uses.findIndex((u, k) => u !== null && u < (SPELL_BY_ID.get(w.spells[k] ?? '')?.uses ?? 0));
      if (i < 0) break;
      regained.push(i);
    }
  } else rt.usesClock = 0;
  return regained;
}

export const ready = (rt: Runtime) => rt.delay <= 0 && rt.reload <= 0;

export interface CastResult {
  shot: Shot;
  /** Slots played this cast, in order (always-cast spells are -1). */
  cards: number[];
  /** Mana spent (negative: gained). */
  mana: number;
  /** A spell was skipped for want of mana. */
  noMana: boolean;
  /** The wand started recharging after this cast. */
  reloaded: boolean;
  /** The deck went round once mid-cast. */
  wrapped?: boolean;
  /** Cards passed over unplayed (requirements). */
  skipped?: string[];
}

export interface FireOpts {
  rand(): number;
  /** Endless mana and uses (Spell Lab wands, creative previews). */
  infinite: boolean;
  /** Uses left in a slot, and spending one. */
  usesLeft(slot: number): number;
  spendUse(slot: number): void;
  /** What the caster brings to the cast: other wands' spells, health share, enemies near, projectiles out, gold. */
  others?: SpellDef[];
  health?: number;
  enemies?: number;
  flying?: number;
  gold?: number;
}

class Cast implements CastCtx {
  cards: number[] = [];
  hand: number[] = [];
  wrapped = false;
  refresh = false;
  noMana = false;
  spent = 0;
  private depth = 0;
  /** Nesting for the cast tree, and whether cards are being played as copies. */
  private level = 0;
  private copying = 0;
  skipped: string[] = [];
  /** The slot of the card being played (Spell Duplication looks before it). */
  private cur = -1;
  readonly spells: SpellDef[];
  readonly others: SpellDef[];
  readonly health: number;
  readonly enemies: number;
  readonly flying: number;
  readonly gold: number;
  constructor(private w: WandData, private rt: Runtime, private o: FireOpts) {
    this.spells = wandSpells(w);
    this.others = o.others ?? [];
    this.health = o.health ?? 1;
    this.enemies = o.enemies ?? 0;
    this.flying = o.flying ?? 0;
    this.gold = o.gold ?? 0;
  }
  rand() { return this.o.rand(); }
  get mana() { return this.o.infinite ? 1000 : this.rt.mana; }
  set mana(v: number) { if (!this.o.infinite) this.rt.mana = Math.max(0, v); }
  get before(): SpellDef[] { return this.w.spells.slice(0, Math.max(0, this.cur)).flatMap((id) => (id && SPELL_BY_ID.get(id) ? [SPELL_BY_ID.get(id)!] : [])); }
  everyOther() { this.rt.toggle = !this.rt.toggle; return this.rt.toggle; }
  peek(n: number): SpellDef[] {
    const out: SpellDef[] = [];
    for (const slot of [...this.rt.deck, ...(this.wrapped ? [] : this.rt.discard)]) {
      if (out.length >= n) break;
      const s = SPELL_BY_ID.get(this.w.spells[slot] ?? '');
      if (s) out.push(s);
    }
    return out;
  }
  skip(): SpellDef | null {
    const rt = this.rt;
    if (!rt.deck.length) return null;
    const slot = rt.deck.shift()!;
    this.hand.push(slot);
    const s = SPELL_BY_ID.get(this.w.spells[slot] ?? '') ?? null;
    if (s) this.skipped.push(s.id);
    return s;
  }

  /** The next card the wand can afford, or null when there's nothing left to draw this cast. */
  private next(): { slot: number; spell: SpellDef } | null {
    const rt = this.rt;
    for (;;) {
      if (!rt.deck.length) {
        // wrap around once: the discard pile goes back on the deck
        if (this.wrapped || !rt.discard.length) return null;
        this.wrapped = true;
        rt.deck = order(this.w, rt.discard, this.o.rand);
        rt.discard = [];
      }
      const slot = rt.deck.shift()!;
      this.hand.push(slot);
      const spell = SPELL_BY_ID.get(this.w.spells[slot] ?? '');
      if (!spell) continue;
      if (!this.o.infinite) {
        if (spell.uses && this.o.usesLeft(slot) <= 0) continue;
        if (spell.mana > rt.mana) { this.noMana = true; continue; }
        rt.mana = Math.min(this.w.s.mana, rt.mana - spell.mana);
        this.spent += spell.mana;
        if (spell.uses) this.o.spendUse(slot);
      }
      return { slot, spell };
    }
  }

  draw(shot: Shot, n: number) {
    for (let i = 0; i < n; i++) {
      const c = this.next();
      if (!c) return;
      this.cards.push(c.slot);
      this.cur = c.slot;
      this.playSpell(c.spell, shot);
    }
  }
  take(): SpellDef | null {
    const c = this.next();
    if (c) this.cards.push(c.slot);
    return c?.spell ?? null;
  }
  play(spell: SpellDef, shot: Shot) { this.copying++; this.playSpell(spell, shot); this.copying--; }

  playSpell(s: SpellDef, shot: Shot) {
    // copies of copies (Omega casting Alpha casting...) stop somewhere
    if (this.depth > 24 || shot.projs.length > 256) return;
    this.depth++;
    shot.castDelay += s.delay ?? 0;
    shot.recharge += s.reload ?? 0;
    const entry: CastEntry = { id: s.id, level: this.level, ...(this.copying ? { copy: true } : {}) };
    shot.log.push(entry);
    switch (s.type) {
      case 'projectile': case 'static': case 'material': {
        // cards with their own logic (random spells, notes) play it
        if (s.play) { this.level++; s.play(this, shot); this.level--; break; }
        // one card can make several projectiles (Triplicate Bolt); they share one payload
        const from = shot.projs.length, payload = s.trigger ? new Shot() : undefined;
        for (let k = 0; k < (s.count ?? 1); k++) { const p = makeProj(s); p.payload = payload; shot.projs.push(p); }
        entry.projs = Array.from({ length: shot.projs.length - from }, (_, k) => from + k);
        if (payload) { entry.payload = payload; this.draw(payload, s.triggerDraw ?? 1); }
        break;
      }
      case 'modifier':
        if (s.mod) shot.mods.push(s.mod);
        s.cast?.(this, shot);
        if (s.play) s.play(this, shot);
        else this.draw(shot, 1);
        break;
      case 'multicast': {
        const from = shot.projs.length;
        if (s.scatter) shot.spread += s.scatter;
        this.level++;
        this.draw(shot, s.draw ?? 2);
        this.level--;
        if (s.formation) shot.projs.slice(from).forEach((p, i) => {
          const f = s.formation![i % s.formation!.length];
          p.yawOff += f[0];
          p.pitchOff += f[1];
        });
        break;
      }
      case 'other': case 'utility': case 'passive':
        this.level++;
        if (s.play) s.play(this, shot);
        else this.draw(shot, 1);
        this.level--;
        break;
    }
    this.depth--;
  }
}

/** Fire a wand (when `ready`): returns the cast, and leaves the runtime counting down to the next one. */
export function fire(w: WandData, rt: Runtime, o: FireOpts): CastResult | null {
  if (!w.spells.some(Boolean) && !w.always.length) return null;
  const root = new Shot();
  root.castDelay = w.s.delay;
  root.recharge = w.s.reload;
  root.spread = w.s.spread;
  const c = new Cast(w, rt, o);
  // always-cast spells ride along with every cast, free
  for (const id of w.always) { const s = SPELL_BY_ID.get(id); if (s) { c.cards.push(-1); c.playSpell(s, root); } }
  c.draw(root, Math.max(1, w.s.multi));
  rt.discard.push(...c.hand);
  rt.delay = rt.delayTotal = Math.max(0, Math.round(root.castDelay));
  const reloaded = c.wrapped || c.refresh || !rt.deck.length;
  if (reloaded) {
    rt.deck = order(w, filledSlots(w), o.rand);
    rt.discard = [];
    rt.reload = rt.reloadTotal = c.refresh ? 0 : Math.max(0, Math.round(root.rechargeSet ?? root.recharge));
  }
  if (!c.cards.some((k) => k >= 0) && !w.always.length) return { shot: root, cards: [], mana: 0, noMana: c.noMana, reloaded, wrapped: c.wrapped, skipped: c.skipped };
  return { shot: root, cards: c.cards, mana: c.spent, noMana: c.noMana, reloaded, wrapped: c.wrapped, skipped: c.skipped };
}

/** Every projectile of a cast with its modifiers applied (a payload's modifiers apply when it's released). */
export function finalProjs(shot: Shot): Proj[] {
  // copies: a payload can be released more than once (copies of a triggered projectile), and each gets the mods once
  return shot.projs.map((p) => {
    const q = cloneProj(p);
    for (const m of shot.mods) m(q);
    return q;
  });
}

// ------------------------------------------------------------------ the editor's preview
export interface CastPreview { cards: number[]; mana: number; delay: number; damage: number; projs: number; noMana: boolean }
export interface CyclePreview { casts: CastPreview[]; seconds: number; mana: number; damage: number; reload: number }

/** Damage a cast would do if everything hit: projectiles, explosions, payloads. */
function shotDamage(shot: Shot, depth = 0): number {
  if (depth > 6) return 0;
  let d = 0;
  for (const p of finalProjs(shot)) {
    d += (p.dmg + p.explDmg + p.elec) * p.dmgMul * (1 + p.crit * 2);
    if (p.payload) d += shotDamage(p.payload, depth + 1);
  }
  return d;
}
const countProjs = (shot: Shot, depth = 0): number => (depth > 6 ? 0 : shot.projs.reduce((n, p) => n + 1 + (p.payload ? countProjs(p.payload, depth + 1) : 0), 0));

/** One full cycle of a wand, from full mana and a fresh deck, until it recharges. */
export function previewCycle(w: WandData): CyclePreview {
  let seed = 1234567;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rt = newRuntime(w, 0, rand);
  const uses = (w.uses ?? []).map((u) => u ?? 0);
  const o: FireOpts = { rand, infinite: !!w.inf, usesLeft: (i) => uses[i] ?? 0, spendUse: (i) => { uses[i] = (uses[i] ?? 0) - 1; } };
  const casts: CastPreview[] = [];
  let seconds = 0, mana = 0, damage = 0, reload = 0;
  for (let n = 0; n < 40; n++) {
    const r = fire(w, rt, o);
    if (!r) break;
    const dmg = shotDamage(r.shot);
    casts.push({ cards: r.cards, mana: r.mana, delay: rt.delayTotal, damage: dmg, projs: countProjs(r.shot), noMana: r.noMana });
    mana += r.mana;
    damage += dmg;
    if (r.reloaded) { reload = rt.reloadTotal; seconds += Math.max(rt.delayTotal, rt.reloadTotal) / 20; break; }
    seconds += rt.delayTotal / 20;
  }
  return { casts, seconds, mana, damage, reload };
}

// ------------------------------------------------------------------ the debug cast tree
const n2 = (v: number) => String(Math.round(v * 100) / 100);
/** A projectile in a line: its numbers after the block's modifiers. */
function projSummary(p: Proj): string {
  const out = [`dmg ${n2(p.dmg * p.dmgMul)}`, `spd ${n2(p.speed)}`, `life ${p.life}`];
  if (p.explR) out.push(`expl r${n2(p.explR)}/${n2(p.explDmg * p.dmgMul)}`);
  if (p.crit) out.push(`crit ${Math.round(p.crit * 100)}%`);
  if (p.homing) out.push(`homing ${n2(p.homing)}`);
  if (p.pierce) out.push('pierce');
  if (p.aura) out.push(`aura ${n2(p.aura)}`);
  if (p.bounces) out.push(`bounces ${p.bounces >= 999 ? 'inf' : p.bounces}`);
  if (p.spread) out.push(`spread ${n2(p.spread)}`);
  if (p.gravity) out.push(`grav ${n2(p.gravity)}`);
  if (p.path !== 'straight') out.push(p.path);
  if (p.steer.length) out.push(p.steer.join('+'));
  if (p.data.orbit !== undefined) out.push('orbiters');
  if (p.spawns.length) out.push(`casts on ${p.spawns.map((r) => r.on).join('/')}`);
  return out.join(', ');
}
const triggerName = (p: Proj) => (p.trigger === 'timer' ? `on timer ${p.timer}t` : p.trigger === 'expire' ? 'on expire' : 'on hit');
/** Projectiles a block makes, payloads included. */
export function countProjectiles(shot: Shot, depth = 0): number {
  return depth > 8 ? 0 : shot.projs.reduce((n, p, i) => n + 1 + (p.payload && shot.projs.findIndex((q) => q.payload === p.payload) === i ? countProjectiles(p.payload, depth + 1) : 0), 0);
}
/** A cast block as tree lines (ASCII: the game's font has no box-drawing characters). */
function blockLines(shot: Shot, prefix: string, depth: number): string[] {
  if (depth > 6) return [`${prefix}...`];
  const out: string[] = [];
  const fin = finalProjs(shot);
  const mods = shot.log.filter((e) => SPELL_BY_ID.get(e.id)?.type === 'modifier').map((e) => e.id);
  shot.log.forEach((e, i) => {
    const last = i === shot.log.length - 1, s = SPELL_BY_ID.get(e.id);
    const pad = prefix + '  '.repeat(e.level), stem = last ? '`- ' : '+- ';
    const kind = s?.type === 'modifier' ? `  [modifier: every projectile of this block]`
      : s?.type === 'multicast' ? `  [draws ${s.draw ?? 2}]` : '';
    out.push(`${pad}${stem}${e.id}${e.copy ? ' (copy)' : ''}${kind}`);
    const cont = pad + (last ? '   ' : '|  ');
    for (const k of e.projs ?? []) out.push(`${cont}  projectile[${k}]: ${projSummary(fin[k])}`);
    if (e.payload) {
      const p = fin[e.projs?.[0] ?? 0];
      out.push(`${cont}  ${p ? triggerName(p) : 'payload'}: ${countProjectiles(e.payload)} projectile(s), a block of its own`);
      out.push(...blockLines(e.payload, cont + '    ', depth + 1));
    }
  });
  if (mods.length && depth === 0) out.push(`${prefix}modifiers in this block: ${mods.join(', ')}`);
  return out;
}
/** The whole cast: what was drawn, what it made, what it cost, and where the deck stands. */
export function castTree(w: WandData, r: CastResult, deckBefore: number[], deckAfter: number[], delay: number, reload: number | null): string[] {
  const slot = (d: number[]) => (d.length ? `slot ${d[0] + 1}` : 'empty');
  const drawn = r.cards.filter((k) => k >= 0);
  const lines = [
    `Cast: ${drawn.length} card(s) drawn (slots ${drawn.map((k) => k + 1).join(',') || '-'}), ${r.shot.projs.length} projectile(s) now, ${countProjectiles(r.shot)} with payloads`,
    `  mana ${n2(r.mana)}, cast delay ${delay}t, recharge ${reload === null ? 'not yet' : `${reload}t`}${r.wrapped ? ', deck wrapped' : ''}${r.skipped?.length ? `, skipped ${r.skipped.join(',')}` : ''}`,
    `  deck: next ${slot(deckBefore)} -> ${slot(deckAfter)} (of ${w.spells.filter(Boolean).length} spells)`,
  ];
  return [...lines, ...blockLines(r.shot, '', 0)];
}

/** The casts of a wand from a fresh start, as trees: the same wand always gives the same trees (no shuffle luck). */
export function explainCycle(w: WandData, casts = 3): string[][] {
  let seed = 1234567;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rt = newRuntime(w, 0, rand);
  const uses = (w.uses ?? []).map((u) => u ?? 99);
  const o: FireOpts = { rand, infinite: true, usesLeft: (i) => uses[i] ?? 99, spendUse: () => {} };
  const out: string[][] = [];
  for (let n = 0; n < casts; n++) {
    const before = [...rt.deck];
    const r = fire(w, rt, o);
    if (!r) break;
    out.push(castTree(w, r, before, [...rt.deck], rt.delayTotal, r.reloaded ? rt.reloadTotal : null));
    rt.delay = rt.reload = 0;
  }
  return out;
}
