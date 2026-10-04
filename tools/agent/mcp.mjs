#!/usr/bin/env node
// An MCP server (stdio) giving AI agents the game as tools: look at it (pictures, text maps), change it (blocks,
// blueprints, shapes, commands, code) and follow what happens. It talks to a game tab through the dev server's
// agent bridge, like the `mc` command; `launch` starts a dev server and a background browser if none is running.
// Registered for Claude Code in .mcp.json at the repository root.
import readline from 'node:readline';
import { connect, spec, allSessions, AgentError } from './client.mjs';
import { launch, online } from './launch.mjs';

const { METHODS, POS_HELP } = await spec();

const INSTRUCTIONS = `Tools for the Minecraft clone in this repository: they act on the world open in a browser tab of the dev server (the person's own tab, or a background one from \`launch\`).
${POS_HELP}
Good habits: start with \`status\` (where the player is, the world, what's open), then \`map\` (text) or \`look\` (a picture) to see the area. Find ground height with \`call\` method=surface. Build with \`build\` (text blueprints: layers bottom-up, rows north→south, characters west→east; ' ' leaves a block alone, '.' makes air), \`fill\`, \`shape\` and \`set\`; check the result with \`look\` (view=orbit or iso around it) and fix it; \`undo\` takes back block changes. Blocks have names like stone, oak_planks, glass, and states like oak_stairs[facing=east,half=top]. \`mark\` (through \`call\`) outlines an area for the people playing. Talk to them with \`call\` method=chat. \`eval\` runs JavaScript inside the game for anything the tools don't cover.
If no game tab is connected: for the person's own game on https://mc.iloveust.com use \`online\` and give them the link it returns to open (their tab then connects to this computer); for a world of your own, \`launch\` opens one in a background browser.`;

/** JSON Schema for a parameter of the catalogue. */
function schema(p) {
  const d = { description: p.desc };
  switch (p.type) {
    case 'pos': return { ...d, anyOf: [{ type: 'array', items: { type: ['number', 'string'] }, minItems: 3, maxItems: 3 }, { type: 'string' }, { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } }] };
    case 'any': return d;
    default: return { ...d, type: p.type };
  }
}
function inputSchema(method, only) {
  const m = METHODS[method];
  const props = {}, req = [];
  for (const [k, p] of Object.entries(m.params)) {
    if (only && !only.includes(k)) continue;
    props[k] = schema(p);
    if (p.required) req.push(k);
  }
  return { type: 'object', properties: props, ...(req.length ? { required: req } : {}) };
}
const describe = (method, extra = '') => METHODS[method].summary + (extra ? '\n' + extra : '') + `\nReturns ${METHODS[method].returns}.`;

/** The tools: the everyday methods each get one; `call` reaches all of them. */
const TOOLS = [
  { name: 'status', method: 'status', description: describe('status') },
  { name: 'look', method: 'shot', description: describe('shot', 'Returns the picture itself. Use view=orbit (center, distance, side) or view=iso (center, size) to check a build; view=top (cut=y for a floor plan). Add grid=8 to see x,z coordinates in the picture.') },
  { name: 'map', method: 'map', description: describe('map') },
  { name: 'command', method: 'command', description: describe('command') },
  { name: 'build', method: 'build', description: describe('build', 'Tip: draw walls with the palette, use "." where air must be (inside rooms), keep doors as lower halves only (the upper half is added).') },
  { name: 'fill', method: 'fill', description: describe('fill') },
  { name: 'set', method: 'set', description: describe('set') },
  { name: 'shape', method: 'shape', description: describe('shape') },
  { name: 'read', method: 'read', description: describe('read') },
  { name: 'entities', method: 'entities', description: describe('entities') },
  { name: 'undo', method: 'undo', description: describe('undo') },
  { name: 'log', method: 'log', description: describe('log') },
  { name: 'eval', method: 'eval', description: describe('eval') },
  {
    name: 'call', description: `Any method of the game's agent API by name (with its parameters as \`params\`). Methods:\n${Object.entries(METHODS).map(([k, m]) => `- ${k}(${Object.keys(m.params).join(', ')}): ${m.summary}`).join('\n')}`,
    inputSchema: { type: 'object', properties: { method: { type: 'string', enum: Object.keys(METHODS) }, params: { type: 'object', description: 'The method\'s parameters' } }, required: ['method'] },
  },
  {
    name: 'launch', description: 'Open the game in a background browser of its own (and start the dev server if needed), optionally creating or opening a world. Use it when no game tab is connected, or to have a world of your own. Its tab becomes the one the other tools talk to.',
    inputSchema: {
      type: 'object', properties: {
        name: { type: 'string', description: 'Session name (default "agent")' },
        new: { type: 'object', description: 'Create a world: { name?, seed?, mode?: "creative" | "survival" }' },
        world: { type: 'string', description: 'Open this saved world (name or id) instead' },
        mods: { type: 'array', items: { type: 'string' }, description: 'Mod ids to install from the repository (e.g. ["overseer"])' },
        headed: { type: 'boolean', description: 'Show the browser window' },
      },
    },
  },
  {
    name: 'online', description: 'Let the tools reach the person\'s game on the deployed site (https://mc.iloveust.com): starts the agent bridge on this computer (if needed) and returns the pairing link. Give the link to the person to open in their browser (Chrome/Edge); once their tab shows "● Agent", every tool acts on their world. Nothing runs on the game\'s server.',
    inputSchema: { type: 'object', properties: { port: { type: 'number', description: 'Local port (default 47821)' }, site: { type: 'string', description: 'The game\'s address (default https://mc.iloveust.com)' } } },
  },
  {
    name: 'sessions', description: 'Game tabs connected (the person\'s and background ones) and which one the tools talk to; `use` picks one.',
    inputSchema: { type: 'object', properties: { use: { type: 'string', description: 'Session id (or name) to talk to from now on' } } },
  },
].map((t) => ({ ...t, inputSchema: t.inputSchema ?? inputSchema(t.method) }));

let mc = null;
let session;
async function client() {
  if (!mc) mc = await connect({ session });
  return mc;
}

const text = (s) => ({ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 1) });

async function run(name, args = {}) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new AgentError(`No tool '${name}'`);
  if (name === 'launch') {
    const r = await launch({ name: args.name ?? 'agent', headed: !!args.headed, mods: args.mods ?? [], world: args.world, newWorld: args.new ?? (args.world ? undefined : { name: 'Agent World', mode: 'creative' }) });
    session = r.session;
    mc = null;
    return [text(r)];
  }
  if (name === 'online') {
    const r = await online({ port: args.port, site: args.site });
    mc = null;
    const list = (await allSessions()).filter((x) => x.bridgeKind === 'online');
    return [text({ ...r, connectedTabs: list.length, next: list.length ? 'A tab is connected: the other tools act on it.' : 'Ask the person to open the link in their browser; then call `sessions` to see their tab.' })];
  }
  if (name === 'sessions') {
    if (args.use) { session = args.use; mc = null; }
    return [text({ talkingTo: session ?? '(automatic: the open world the person is looking at)', sessions: await allSessions() })];
  }
  const c = await client();
  const method = tool.method ?? args.method;
  const params = tool.method ? args : args.params ?? {};
  if (!METHODS[method]) throw new AgentError(`No method '${method}'`);
  const r = await c.call(method, params, { timeout: method === 'log' || method === 'wait' ? 330000 : 180000 });
  if (method === 'shot') return [{ type: 'image', data: r.data, mimeType: r.mime }, text(`${r.view} view, ${r.width}x${r.height}${r.note ? ' — ' + r.note : ''}`)];
  if (r && typeof r === 'object' && typeof r.text === 'string') return [text(r.text)];
  if (method === 'read') return [text(`origin ${r.origin.join(' ')}, size ${r.size.join('x')} (x, y, z). Layers bottom-up, rows north→south, characters west→east. Same format as build.\n` + JSON.stringify({ palette: r.palette, layers: r.layers }))];
  if (method === 'eval') return [text(r.printed?.length ? { printed: r.printed, result: r.result } : r.result ?? null)];
  return [text(r)];
}

// ------------------------------------------------------------------ JSON-RPC over stdio
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    switch (method) {
      case 'initialize':
        return reply({
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'minecraft', title: 'Minecraft (this repository\'s game)', version: '1.0.0' },
          instructions: INSTRUCTIONS,
        });
      case 'notifications/initialized': case 'notifications/cancelled': return;
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS.map(({ name, description, inputSchema: s }) => ({ name, description, inputSchema: s })) });
      case 'tools/call': {
        try {
          const content = await run(params?.name, params?.arguments ?? {});
          return reply({ content });
        } catch (e) {
          const usage = e.info?.usage ? `\nParameters: ${JSON.stringify(e.info.usage)}` : '';
          const hint = e.info?.code === 'no-server' || e.info?.code === 'no-session' ? '\n(Use the `launch` tool to open the game in a background browser.)' : '';
          mc = e.info?.code === 'no-server' ? null : mc;
          return reply({ content: [text(`Error: ${e.message}${usage}${hint}`)], isError: true });
        }
      }
      default:
        if (id !== undefined) return fail(-32601, `Method not found: ${method}`);
    }
  } catch (e) {
    fail(-32603, e.message);
  }
});
rl.on('close', () => process.exit(0));
