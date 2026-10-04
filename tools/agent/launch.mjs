// Starting things for agents that have no game open: a dev server (if none is running) and a browser of their own
// that stays in the background (headless by default) with the game loaded, as a session like any other tab.
//
//   node tools/agent/launch.mjs --daemon --name bot ...   (what `mc launch` starts; it keeps the browser alive)
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, AGENT_DIR, servers, connect, AgentError } from './client.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function freePort(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

/** A dev server with the bridge: the running one, or a new one in the background. */
export async function ensureServer({ port } = {}) {
  // (dev servers only: `mc online` bridges don't serve the game)
  const running = servers().filter((x) => x.kind !== 'online');
  if (running.length && !port) return running.sort((a, b) => b.mtime - a.mtime)[0];
  if (port) { const s = running.find((x) => x.port === Number(port)); if (s) return s; }
  let p = Number(port ?? process.env.MC_PORT ?? 5180);
  if (!port) while (!(await freePort(p))) p++;
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  const log = fs.openSync(path.join(AGENT_DIR, `vite-${p}.log`), 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(p), '--strictPort'], { cwd: ROOT, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  for (let i = 0; i < 120; i++) {
    await wait(250);
    const s = servers().find((x) => x.port === p);
    if (s) return s;
    if (!alive(child.pid)) break;
  }
  throw new AgentError(`The dev server didn't start (see ${path.join(AGENT_DIR, `vite-${p}.log`)})`);
}

/** Browsers started by `mc launch` that are still running. */
export function browsers() {
  let files = [];
  try { files = fs.readdirSync(AGENT_DIR).filter((f) => /^browser-.*\.json$/.test(f)); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, f), 'utf8'));
      if (alive(b.pid)) out.push(b); else fs.unlinkSync(path.join(AGENT_DIR, f));
    } catch { /* gone */ }
  }
  return out;
}

/**
 * A background browser playing the game as a session named `name`; optionally installs mods and opens a world
 * (`world`: a saved one's name or id, or `new`: { name, seed, mode }).
 */
export async function launch({ name = 'agent', headed = false, width = 1280, height = 720, mods = [], port, world, newWorld } = {}) {
  if (!/^[\w-]{1,32}$/.test(name)) throw new AgentError('Session names: letters, digits, - and _');
  const server = await ensureServer({ port });
  let b = browsers().find((x) => x.name === name);
  if (!b) {
    const log = fs.openSync(path.join(AGENT_DIR, `browser-${name}.log`), 'a');
    const args = [fileURLToPath(import.meta.url), '--daemon', '--name', name, '--url', server.url, '--width', String(width), '--height', String(height)];
    if (headed) args.push('--headed');
    if (mods.length) args.push('--mods', mods.join(','));
    const child = spawn(process.execPath, args, { cwd: ROOT, detached: true, stdio: ['ignore', log, log] });
    child.unref();
    b = { pid: child.pid, name };
  }
  // its tab says hello as a session named after it
  const mc = await connect({ server });
  let sid = null;
  for (let i = 0; i < 160 && !sid; i++) {
    const list = await mc.sessions().catch(() => []);
    sid = list.find((s) => s.name === name)?.sid ?? null;
    if (!sid) {
      await wait(250);
      if (!alive(b.pid)) throw new AgentError(`The browser stopped (see ${path.join(AGENT_DIR, `browser-${name}.log`)})`);
    }
  }
  if (!sid) throw new AgentError('The game tab never connected');
  mc.session = sid;
  let opened = null;
  if (newWorld || world) opened = await mc.call('open', newWorld ? { new: newWorld } : { world }, { timeout: 120000 });
  return { session: sid, name, url: server.url, pid: b.pid, ...(opened ? { world: opened } : {}) };
}

export function stop(name) {
  let n = 0;
  for (const b of browsers()) {
    if (name && b.name !== name) continue;
    try { process.kill(b.pid, 'SIGTERM'); n++; } catch { /* gone */ }
  }
  return n;
}

/**
 * The bridge for the deployed game (tools/agent/online.mjs), started in the background if it isn't running.
 * Returns the pairing link to open the game with.
 */
export async function online({ port, site } = {}) {
  const { DEFAULT_PORT, DEFAULT_SITE, pairToken, pairLink } = await import('./online.mjs');
  const p = Number(port ?? DEFAULT_PORT), st = site ?? DEFAULT_SITE;
  let s = servers().find((x) => x.port === p && x.kind === 'online');
  if (!s) {
    fs.mkdirSync(AGENT_DIR, { recursive: true });
    const log = fs.openSync(path.join(AGENT_DIR, `online-${p}.log`), 'a');
    const child = spawn(process.execPath, [path.join(ROOT, 'tools/agent/online.mjs'), '--port', String(p), '--site', st], { cwd: ROOT, detached: true, stdio: ['ignore', log, log] });
    child.unref();
    for (let i = 0; i < 40 && !s; i++) {
      await wait(150);
      s = servers().find((x) => x.port === p && x.kind === 'online');
      if (!alive(child.pid)) throw new AgentError(`The bridge didn't start (see ${path.join(AGENT_DIR, `online-${p}.log`)})`);
    }
    if (!s) throw new AgentError('The bridge didn\'t start');
  }
  return { link: s.link ?? pairLink(st, p, pairToken()), port: p, pid: s.pid };
}

export function stopOnline() {
  let n = 0;
  for (const s of servers()) if (s.kind === 'online') { try { process.kill(s.pid, 'SIGTERM'); n++; } catch { /* gone */ } }
  return n;
}

// ------------------------------------------------------------------ the daemon: holds a browser open
async function daemon(argv) {
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const name = opt('name', 'agent'), url = opt('url'), headed = argv.includes('--headed');
  const width = Number(opt('width', 1280)), height = Number(opt('height', 720));
  const mods = (opt('mods', '') || '').split(',').filter(Boolean);
  const { chromium } = await import('playwright');
  const gl = process.platform === 'darwin' ? ['--use-gl=angle', '--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  // its own profile, so its saved worlds and installed mods are there next time
  const profile = path.join(AGENT_DIR, `profile-${name}`);
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: !headed, viewport: { width, height },
    args: [...gl, '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const file = path.join(AGENT_DIR, `browser-${name}.json`);
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, name, url, headed, started: Date.now() }));
  const bye = async () => { try { fs.unlinkSync(file); } catch { /* gone */ } await ctx.close().catch(() => {}); process.exit(0); };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('pageerror', (e) => console.log(new Date().toISOString(), 'pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log(new Date().toISOString(), 'console', m.text()); });
  page.on('crash', () => { console.log('page crashed: reloading'); page.reload().catch(() => {}); });
  ctx.on('close', () => { try { fs.unlinkSync(file); } catch { /* gone */ } process.exit(0); });
  await page.goto(url + '/');
  await page.waitForFunction(() => !!window.mods && !!window.game, null, { timeout: 60000 });
  if (mods.length) {
    const r = await page.evaluate(async (want) => {
      const idx = await (await fetch('/mods/index.json')).json();
      const out = [];
      for (const id of want) {
        const m = idx.mods.find((x) => x.id === id);
        if (!m) { out.push(`${id}: not in the repository`); continue; }
        try { await window.mods.installFromRepo(m); out.push(`${id}: installed`); } catch (e) { out.push(`${id}: ${e.message}`); }
      }
      return out;
    }, mods);
    console.log(r.join('\n'));
  }
  await page.goto(`${url}/?agent=${encodeURIComponent(name)}`);
  console.log(new Date().toISOString(), 'ready', name);
  // stay up until told to stop
  await new Promise(() => {});
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--daemon')) {
  daemon(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
