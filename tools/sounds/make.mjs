#!/usr/bin/env node
// Makes the game's vanilla sound set from a Java Edition sound pack: only the sounds the game plays (the table in
// vanilla.mjs), re-encoded small with ffmpeg. Mojang's audio isn't kept in git: the output folder is ignored, and a
// game without it plays its own synthesised sounds.
//
//   node tools/sounds/make.mjs <pack>/assets/minecraft/sounds [--out public/sounds] [--sfx-kbps 32] [--music-kbps 32] [--no-music]
//
// Output:
// - sfx-<hash>.bin: every sound effect, mono Opus (Ogg), in one file with an index (see src/game/soundbank.ts).
//   Downloaded once and kept for offline play; each sound is decoded the first time it plays.
// - music/<name>-<hash>.ogg: each music track, stereo Opus, streamed only when it plays.
// - index.json: names the two above.
import { SOUNDS, MUSIC, filesOf } from './vanilla.mjs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const out = path.resolve(flag('--out', 'public/sounds'));
const sfxKbps = Number(flag('--sfx-kbps', 32));
const musicKbps = Number(flag('--music-kbps', 32));
const noMusic = args.includes('--no-music') && args.splice(args.indexOf('--no-music'), 1);
const src = args[0] && path.resolve(args[0]);
if (!src || !fs.existsSync(src)) {
  console.error('usage: node tools/sounds/make.mjs <pack>/assets/minecraft/sounds [--out public/sounds] [--sfx-kbps 32] [--music-kbps 32] [--no-music]');
  process.exit(1);
}
const file = (f) => path.join(src, f + '.ogg');

// ------------------------------------------------------------------ check the table against the pack
const missing = [];
for (const [name, d] of Object.entries(SOUNDS)) {
  if (d.alias && !SOUNDS[d.alias]) missing.push(`${name}: alias of unknown '${d.alias}'`);
  if (d.alias && SOUNDS[d.alias].alias) missing.push(`${name}: alias of an alias`);
  for (const f of filesOf(d.files)) if (!fs.existsSync(file(f))) missing.push(`${name}: ${f}.ogg`);
}
if (!noMusic) for (const f of Object.values(MUSIC).flatMap(filesOf)) if (!fs.existsSync(file(f))) missing.push(`music: ${f}.ogg`);
if (missing.length) {
  console.error('missing from the pack:\n  ' + missing.join('\n  '));
  process.exit(1);
}

/** ffmpeg's output for one file. */
function encode(f, channels, kbps) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file(f), '-map_metadata', '-1', '-ac', String(channels), '-ar', '48000',
      '-c:a', 'libopus', '-b:a', kbps + 'k', '-vbr', 'on', '-compression_level', '10', '-application', 'audio',
      '-fflags', '+bitexact', '-flags:a', '+bitexact', '-f', 'ogg', '-']);
    const chunks = [];
    let err = '';
    p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', (c) => (err += c));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg ${f}: ${err.trim()}`))));
  });
}

/** Run jobs a few at a time. */
async function pool(items, fn) {
  const res = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(2, os.cpus().length) }, async () => {
    while (next < items.length) { const i = next++; res[i] = await fn(items[i], i); }
  }));
  return res;
}

const hash = (b) => createHash('sha256').update(b).digest('hex').slice(0, 10);
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
const t0 = Date.now();
fs.mkdirSync(out, { recursive: true });
const keep = new Set(['index.json']);

// ------------------------------------------------------------------ sound effects: one bank
const files = [...new Set(Object.values(SOUNDS).flatMap((d) => filesOf(d.files)))];
const encoded = await pool(files, (f) => encode(f, 1, sfxKbps));
const blobOf = new Map(files.map((f, i) => [f, i]));
const blobs = [];
let off = 0;
for (const b of encoded) { blobs.push([off, b.length]); off += b.length; }
const sounds = {};
for (const [name, d] of Object.entries(SOUNDS)) {
  const base = d.alias ? SOUNDS[d.alias] : d;
  const e = { v: filesOf(base.files).map((f) => blobOf.get(f)) };
  const vol = (d.vol ?? 1) * (d.alias ? base.vol ?? 1 : 1), pitch = (d.pitch ?? 1) * (d.alias ? base.pitch ?? 1 : 1);
  if (vol !== 1) e.vol = vol;
  if (pitch !== 1) e.pitch = pitch;
  sounds[name] = e;
}
const header = Buffer.from(JSON.stringify({ v: 1, sounds, blobs }));
const head = Buffer.alloc(8);
head.write('MCSB', 0, 'ascii');
head.writeUInt32LE(header.length, 4);
const bank = Buffer.concat([head, header, ...encoded]);
const bankName = `sfx-${hash(bank)}.bin`;
fs.writeFileSync(path.join(out, bankName), bank);
keep.add(bankName);
const srcBytes = files.reduce((n, f) => n + fs.statSync(file(f)).size, 0);
console.log(`sound effects: ${Object.keys(SOUNDS).length} names, ${files.length} files, ${kb(srcBytes)} -> ${kb(bank.length)} (${bankName}, Opus ${sfxKbps} kbps mono)`);

// ------------------------------------------------------------------ music: a file per track
const music = {};
if (!noMusic) {
  fs.mkdirSync(path.join(out, 'music'), { recursive: true });
  const tracks = Object.entries(MUSIC).flatMap(([kind, pats]) => filesOf(pats).map((f) => ({ kind, f })));
  let before = 0, after = 0;
  await pool(tracks, async ({ kind, f }) => {
    const b = await encode(f, 2, musicKbps);
    const name = `music/${path.basename(f)}-${hash(b)}.ogg`;
    fs.writeFileSync(path.join(out, name), b);
    keep.add(name);
    (music[kind] ??= []).push(name);
    before += fs.statSync(file(f)).size;
    after += b.length;
  });
  for (const k of Object.keys(music)) music[k].sort();
  console.log(`music: ${tracks.length} tracks, ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB (Opus ${musicKbps} kbps stereo, streamed one track at a time)`);
}

fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({
  v: 1,
  credit: 'Sounds and music: Minecraft, by Mojang Studios (from a vanilla sound pack)',
  sfx: bankName,
  sfxSize: bank.length,
  music,
}, null, 1) + '\n');

// what an earlier run made and this one didn't
for (const f of [...fs.readdirSync(out).filter((f) => f !== 'music'), ...(fs.existsSync(path.join(out, 'music')) ? fs.readdirSync(path.join(out, 'music')).map((f) => 'music/' + f) : [])]) {
  if (!keep.has(f)) fs.rmSync(path.join(out, f));
}
console.log(`wrote ${path.relative(process.cwd(), out)}/ in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
