const fs = require('fs');
const path = require('path');

const START = '<!-- forge:start -->';
const END = '<!-- forge:end -->';

function generateForgeSection(config) {
  const processes = config.processes ?? [];
  const services = Object.keys(config.services ?? {});

  const rows = processes.map(p => `| ${p.name} | \`forge logs ${p.name}\` |`).join('\n');

  const servicesPart = services.length
    ? `\n**Services** (${services.join(', ')})\n- \`forge service\` — check health\n- \`forge service up <name>\` / \`forge service down <name>\``
    : '';

  const processesPart = processes.length
    ? `**Logs**
- \`forge logs <process>\` — last 100 lines (buffered)
- \`forge logs <process> -f\` — live follow
- \`forge logs <process> -n 200\` — more lines

Processes in this project:
| Process | Logs |
|---------|------|
${rows}

`
    : '';

  return `${START}
## Forge (process manager)

This project runs under forge. Use forge commands — not systemd, PM2, or direct
process commands.

**Status / control**
- \`forge status\` — all registered projects and process states
- \`forge up\` / \`forge down\` / \`forge restart\` — start, stop, restart this project
- \`forge open\` — web dashboard at http://localhost:2525

${processesPart}**Environment**
- \`forge env\` — show all env vars forge injects for this project
- \`.env.forge\` — generated file with service URLs and exported port vars;
  processes must load this themselves (forge does not auto-inject it)
${servicesPart}
${END}`;
}

function hasForgeSection(projectPath) {
  const claudePath = path.join(projectPath, 'CLAUDE.md');
  if (!fs.existsSync(claudePath)) return false;
  return fs.readFileSync(claudePath, 'utf8').includes(START);
}

function writeClaude(projectPath, config) {
  const claudePath = path.join(projectPath, 'CLAUDE.md');
  const section = generateForgeSection(config);

  if (!fs.existsSync(claudePath)) {
    fs.writeFileSync(claudePath, section + '\n');
    return;
  }

  let content = fs.readFileSync(claudePath, 'utf8');
  if (content.includes(START)) {
    content = content.replace(/<!-- forge:start -->[\s\S]*?<!-- forge:end -->/, section);
  } else {
    content = content.trimEnd() + '\n\n' + section + '\n';
  }
  fs.writeFileSync(claudePath, content);
}

module.exports = { generateForgeSection, hasForgeSection, writeClaude };
