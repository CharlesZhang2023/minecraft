// Writes tools/agent/API.md from the method catalogue (src/agent/spec.ts). `--check` fails if it's out of date.
import fs from 'node:fs';
import path from 'node:path';
import { spec, ROOT } from './client.mjs';

const { METHODS, POS_HELP } = await spec();
const groups = { session: 'Session and world', chat: 'Commands, chat and events', blocks: 'Blocks', look: 'Looking', entities: 'Entities', player: 'The player', code: 'Code' };
let md = `# Agent API reference\n\nGenerated from \`src/agent/spec.ts\` by \`node tools/agent/api-doc.mjs\`; see [README.md](README.md) for how to connect.\n\n${POS_HELP}\n\n`;
md += 'Every method answers JSON. Call one with `mc <method> key=value ...`, the MCP tool `call` (`{ "method": ..., "params": {...} }`), `await mc.call(method, params)` from Node, or `await api.<method>(params)` inside `mc eval`.\n\n';
for (const [g, title] of Object.entries(groups)) {
  md += `## ${title}\n\n`;
  for (const [name, m] of Object.entries(METHODS).filter(([, m]) => m.group === g)) {
    md += `### \`${name}\`${m.writes ? ' (changes the world)' : ''}\n\n${m.summary}\n\n`;
    const ps = Object.entries(m.params);
    if (ps.length) {
      md += '| Parameter | Type | |\n|---|---|---|\n';
      for (const [k, p] of ps) md += `| \`${k}\`${p.required ? ' **required**' : ''} | ${p.type} | ${p.desc.replace(/\|/g, '\\|')} |\n`;
      md += '\n';
    }
    md += `Returns ${m.returns.replace(/\|/g, '\\|')}.\n\n`;
    if (m.example) md += `\`\`\`json\n${JSON.stringify(m.example)}\n\`\`\`\n\n`;
  }
}
const file = path.join(ROOT, 'tools/agent/API.md');
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (cur !== md) { console.error('tools/agent/API.md is out of date: run node tools/agent/api-doc.mjs'); process.exit(1); }
  console.log('API.md is up to date');
} else {
  fs.writeFileSync(file, md);
  console.log(`wrote ${file} (${Object.keys(METHODS).length} methods)`);
}
