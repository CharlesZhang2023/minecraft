#!/usr/bin/env node
// mc: the game from a terminal. Reads and changes the world open in a browser tab served by the dev server (or a
// background browser of its own, `mc launch`). Every API method works as `mc <method> key=value ...`; the common
// ones also take plain arguments (`mc fill ~-3 ~-1 ~-3 ~3 ~-1 ~3 stone`). `mc help` lists them.
import fs from 'node:fs';
import path from 'node:path';
import { connect, spec, servers, saveSession, allSessions, AgentError, ROOT } from './client.mjs';
import { launch, stop, browsers, ensureServer, online, stopOnline } from './launch.mjs';

const argv = process.argv.slice(2);
const flags = { json: false, session: undefined, timeout: 120 };
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') flags.json = true;
  else if (a === '--session' || a === '-s') flags.session = argv[++i];
  else if (a === '--timeout') flags.timeout = Number(argv[++i]);
  else args.push(a);
}

/** Plain arguments each method takes, in order (`pos` takes three: x y z). */
const POSITIONAL = {
  block: ['pos'], set: ['pos', 'block'], fill: ['from', 'to', 'block', 'mode'], clone: ['from', 'to', 'dest'], read: ['from', 'to'],
  slice: ['from', 'to'], map: ['radius'], find: ['block', 'radius'], tp: ['pos'], face: ['at'], spawn: ['type', 'pos', 'count'],
  kill: ['type', 'radius'], entity: ['id'], command: ['cmd'], chat: ['msg'], undo: ['steps'], wait: ['seconds'], eval: ['code'],
  shape: ['kind', 'center', 'radius', 'block'], mark: ['from', 'to', 'label'], unmark: ['id'], open: ['world'], awake: ['on'],
  help: ['method'], catalog: ['kind', 'filter'], act: ['action', 'pos', 'face'], task: ['name', 'code', 'every'], surface: ['at'],
  entities: ['radius', 'type'], log: ['since'], container: ['pos'], count: ['from', 'to'], walk: ['to'],
};
const ALIASES = { cmd: 'command', say: 'chat', run: 'command', get: 'block', screenshot: 'shot', look: 'shot', pic: 'shot', ents: 'entities', js: 'eval', events: 'log', stat: 'status', st: 'status' };
const POS_KEYS = new Set(['pos', 'from', 'to', 'dest', 'center', 'at', 'lookAt', 'origin']);

const value = (s) => {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^[[{"]/.test(s)) { try { return JSON.parse(s); } catch { /* text */ } }
  return s;
};
const isCoord = (s) => /^~?-?\d*(\.\d+)?$/.test(s) && s !== '';

function parseParams(method, rest) {
  const params = {};
  const pos = POSITIONAL[method] ?? [];
  let k = 0;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const kv = /^([A-Za-z_][\w]*)=(.*)$/s.exec(a);
    if (kv) { params[kv[1]] = POS_KEYS.has(kv[1]) && !/^[[{]/.test(kv[2]) ? kv[2].replace(/,/g, ' ') : value(kv[2]); continue; }
    const key = pos[k++];
    if (!key) throw new AgentError(`Too many arguments for ${method} ('${a}'): use key=value`);
    // a position: three coordinates (or one "x,y,z" / JSON)
    if (POS_KEYS.has(key) && isCoord(a) && rest[i + 1] !== undefined && isCoord(rest[i + 1]) && rest[i + 2] !== undefined && isCoord(rest[i + 2])) {
      params[key] = `${a} ${rest[i + 1]} ${rest[i + 2]}`;
      i += 2;
    } else if (POS_KEYS.has(key) && /^[~\d.-]+,[~\d.-]+,[~\d.-]+$/.test(a)) params[key] = a.replace(/,/g, ' ');
    else params[key] = method === 'command' || method === 'chat' || method === 'eval' || key === 'block' || key === 'label' ? a : value(a);
  }
  return params;
}

/** JSON, but short arrays of plain values on one line. */
function pretty(v, ind = '') {
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (v.every((x) => x === null || typeof x !== 'object')) { const s = JSON.stringify(v); if (s.length < 100) return s; }
    return '[\n' + v.map((x) => ind + '  ' + pretty(x, ind + '  ')).join(',\n') + '\n' + ind + ']';
  }
  if (v && typeof v === 'object') {
    const e = Object.entries(v);
    if (!e.length) return '{}';
    const flat = JSON.stringify(v);
    if (flat.length < 90 && !flat.includes('{"', 1)) return flat;
    return '{\n' + e.map(([k, x]) => `${ind}  ${JSON.stringify(k)}: ${pretty(x, ind + '  ')}`).join(',\n') + '\n' + ind + '}';
  }
  return JSON.stringify(v);
}

function out(method, r, params) {
  if (flags.json) { console.log(JSON.stringify(r)); return; }
  if (method === 'shot') {
    const ext = r.mime === 'image/png' ? 'png' : 'jpg';
    const file = params.out ?? path.join(ROOT, 'output/agent', `shot-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log(`${file}  (${r.width}x${r.height}${r.note ? ', ' + r.note : ''})`);
    return;
  }
  if (r && typeof r === 'object' && typeof r.text === 'string') { console.log(r.text); return; }
  if (method === 'read' && r?.layers) {
    if (params.out) { fs.writeFileSync(params.out, JSON.stringify(r, null, 1)); console.log(`saved ${params.out}`); }
    console.log(`origin ${r.origin.join(' ')}  size ${r.size.join('x')} (x, y, z)  palette ${Object.entries(r.palette).map(([c, b]) => `${c}=${b}`).join('  ')}`);
    r.layers.forEach((L, i) => { console.log(`-- y=${r.origin[1] + i}`); for (const row of L) console.log(row); });
    return;
  }
  if (method === 'eval') {
    for (const l of r.printed ?? []) console.log(l);
    console.log(typeof r.result === 'string' ? r.result : pretty(r.result));
    return;
  }
  if (method === 'command') {
    const o = r.output;
    console.log((Array.isArray(o[0]) ? o.flat() : o).join('\n') || '(no output)');
    return;
  }
  if (method === 'log') {
    for (const e of r.events) console.log(`[${e.seq}] ${e.type}${e.text ? ': ' + e.text : ''}${Object.entries(e).filter(([k]) => !['seq', 't', 'type', 'text'].includes(k)).map(([k, x]) => ` ${k}=${JSON.stringify(x)}`).join('')}`);
    if (!r.events.length) console.log('(nothing new)');
    console.log(`cursor ${r.cursor}`);
    return;
  }
  console.log(pretty(r));
}

async function help(mc, method) {
  const { METHODS, POS_HELP } = await spec();
  if (method) {
    const m = METHODS[ALIASES[method] ?? method];
    if (!m) throw new AgentError(`No method '${method}'`);
    console.log(`mc ${method}${(POSITIONAL[method] ?? []).map((k) => ` [${k}]`).join('')} [key=value ...]\n\n${m.summary}\n`);
    for (const [k, p] of Object.entries(m.params)) console.log(`  ${k}${p.required ? ' (required)' : ''} [${p.type}]: ${p.desc}`);
    console.log(`\nReturns: ${m.returns}`);
    if (m.example) console.log(`Example: mc ${method} ${Object.entries(m.example).map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : `'${JSON.stringify(v)}'`}`).join(' ')}`);
    return;
  }
  console.log(`mc: drive the game in a browser tab (dev server only)

  mc status                         the world, the player, what's open
  mc map [radius]                   top-down text map around the player
  mc shot [view=iso center=x,y,z size=40 out=file.png]   a picture (prints the file)
  mc fill x y z x y z block [mode]  boxes; also set, build, shape, clone, read, undo
  mc cmd "/time set day"            game commands as the host
  mc eval 'return world.getId(0,64,0)'   JavaScript in the game tab (eval -f file.js)
  mc build file.json [origin=x,y,z] a text blueprint (the format \`read\` gives)
  mc log [--follow]                 chat, block changes, deaths...
  mc sessions | use <id>            game tabs connected (and which one to talk to)
  mc online [--port n] [stop|rotate]  the game on mc.iloveust.com: start the bridge, print the pairing link
  mc launch [name] [--headed] [--mods a,b] [--new seed=1 mode=creative] [--world name]
  mc stop [name]                    a background browser of its own
  mc help <method>                  details of one method

${POS_HELP}
Flags: --json (raw answers), --session <id>, --timeout <seconds>.

Methods:`);
  const groups = {};
  for (const [k, m] of Object.entries(METHODS)) (groups[m.group] ??= []).push([k, m]);
  for (const [g, list] of Object.entries(groups)) {
    console.log(`  ${g}`);
    for (const [k, m] of list) console.log(`    ${k.padEnd(10)} ${m.summary.split('. ')[0].slice(0, 100)}`);
  }
}

async function main() {
  let [cmd, ...rest] = args;
  if (!cmd || cmd === '--help' || cmd === '-h') return help();
  cmd = ALIASES[cmd] ?? cmd;
  // things that don't need a game tab
  if (cmd === 'launch') {
    const o = { name: 'agent', mods: [] };
    let nw = null;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--headed') o.headed = true;
      else if (a === '--mods') o.mods = rest[++i].split(',');
      else if (a === '--world') o.world = rest[++i];
      else if (a === '--port') o.port = Number(rest[++i]);
      else if (a === '--new') nw = {};
      else if (nw && /=/.test(a)) { const [k, v] = a.split('='); nw[k] = value(v); }
      else if (!a.startsWith('-')) o.name = a;
    }
    if (nw) o.newWorld = nw;
    const r = await launch(o);
    saveSession(r.session);
    console.log(pretty(r));
    console.log(`(mc now talks to session ${r.session}; \`mc stop ${o.name}\` closes it)`);
    return;
  }
  if (cmd === 'online') {
    if (rest[0] === 'stop') { const n = stopOnline(); console.log(`stopped ${n} bridge${n === 1 ? '' : 's'}`); return; }
    // a new pairing token: links handed out before stop working
    if (rest[0] === 'rotate') { stopOnline(); await new Promise((r) => setTimeout(r, 300)); fs.rmSync(path.join(ROOT, 'node_modules/.mc-agent/pair'), { force: true }); rest.shift(); }
    const o = {};
    for (let i = 0; i < rest.length; i++) { if (rest[i] === '--port') o.port = Number(rest[++i]); else if (rest[i] === '--site') o.site = rest[++i]; }
    const r = await online(o);
    saveSession(null);
    console.log(`The agent bridge is running on this computer (127.0.0.1:${r.port}). Open the game with this link (in Chrome or Edge):\n\n  ${r.link}\n\nThe tab shows a green "Agent" at the top right when it's connected; then mc (and Claude Code's minecraft tools) act on that world.\nThe tab stays paired until you close it (or add #agent=off). Stop the bridge with: mc online stop; mc online rotate makes a new link (old ones stop working). Keep the link private.`);
    return;
  }
  if (cmd === 'stop') { const n = stop(rest[0]); console.log(`stopped ${n} browser${n === 1 ? '' : 's'}`); return; }
  if (cmd === 'server') { const s = await ensureServer({ port: rest[0] }); console.log(pretty({ url: s.url, port: s.port, pid: s.pid })); return; }
  if (cmd === 'help' && !rest.length) return help();
  if (cmd === 'help') return help(null, rest[0]);
  const mc = await connect({ session: flags.session });
  if (cmd === 'sessions') {
    const list = await allSessions();
    const saved = mc.session;
    if (!list.length) console.log('No game tabs connected. Open the game from this dev server, or `mc launch`.');
    for (const s of list) console.log(`${s.sid === saved ? '*' : s.default && !saved ? '>' : ' '} ${s.sid}  ${s.name ? `[${s.name}] ` : ''}${s.world ?? '(title screen)'}${s.world && !s.host ? ' (guest)' : ''}${s.dimension && s.dimension !== 'overworld' ? ' ' + s.dimension : ''}${s.player ? ' at ' + s.player.join(' ') : ''}${s.visible ? '' : ' hidden'}${s.focused ? ' focused' : ''}${s.headless ? ' headless' : ''}${s.bridgeKind === 'online' ? `  (${s.url ?? 'online'})` : `  (dev ${s.bridge})`}`);
    console.log(`(dev servers: ${servers().map((s) => s.url).join(', ')}; background browsers: ${browsers().map((b) => b.name).join(', ') || 'none'})`);
    return;
  }
  if (cmd === 'use') { saveSession(rest[0]); console.log(rest[0] ? `talking to ${rest[0]}` : 'choosing a tab automatically'); return; }
  if (cmd === 'log' && rest.includes('--follow')) {
    let since = (await mc.call('log', { limit: 1 })).cursor;
    for (;;) {
      const r = await mc.call('log', { since, wait: 60 }, { timeout: 70000 });
      if (r.events.length) out('log', { ...r, cursor: undefined }, {}) ;
      since = r.cursor;
    }
  }
  if (cmd === 'eval' && rest[0] === '-f') rest = [fs.readFileSync(rest[1], 'utf8'), ...rest.slice(2)];
  if (cmd === 'build' && rest[0] && !rest[0].includes('=') && fs.existsSync(rest[0])) {
    const bp = JSON.parse(fs.readFileSync(rest[0], 'utf8'));
    const extra = parseParams('build', rest.slice(1));
    const r = await mc.call('build', { ...bp, ...extra }, { timeout: flags.timeout * 1000 });
    return out('build', r, {});
  }
  let file;
  if ((cmd === 'shot' || cmd === 'read') && rest.length && !rest[rest.length - 1].includes('=') && /\.(png|jpe?g|json)$/i.test(rest[rest.length - 1])) file = rest.pop();
  const params = parseParams(cmd, rest);
  if (file) params.out = file;
  if (cmd === 'shot' && params.out && /\.png$/i.test(params.out)) params.format ??= 'png';
  if (cmd === 'log') params.since = Number(params.since ?? 0);
  if (cmd === 'surface' && Array.isArray(params.at) && typeof params.at[0] === 'number' && params.at.length === 2) params.at = [params.at];
  const send = { ...params };
  delete send.out;
  const r = await mc.call(cmd, send, { timeout: flags.timeout * 1000 });
  out(cmd, r, params);
}

main().catch((e) => {
  if (flags.json) console.log(JSON.stringify({ error: e.message, ...(e.info ?? {}) }));
  else {
    console.error('mc: ' + e.message);
    if (e.info?.usage) console.error('parameters: ' + Object.entries(e.info.usage).map(([k, p]) => `${k}${p.required ? '*' : ''}`).join(' '));
  }
  process.exit(1);
});
