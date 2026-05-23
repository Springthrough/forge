# CLAUDE.md Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `forge add` offers to write a CLAUDE.md with project-specific forge context; `forge reload` silently keeps it current; `forge init` hints that this is coming.

**Architecture:** A new `src/cli/claude-md.js` module handles all file generation and detection logic. Three existing CLI commands (`add`, `reload`, `init`) get minimal additions that delegate to it.

**Tech Stack:** Node.js, Jest (existing test runner), Node built-in `readline` for the Y/n prompt.

---

## File Map

| File | Change |
|------|--------|
| `src/cli/claude-md.js` | **Create** — `generateForgeSection`, `writeClaude`, `hasForgeSection` |
| `test/claude-md.test.js` | **Create** — unit tests for the above |
| `src/cli/commands/add.js` | **Modify** — add Y/n prompt + CLAUDE.md write after success output |
| `src/cli/commands/reload.js` | **Modify** — silently update CLAUDE.md if forge section exists |
| `src/cli/commands/init.js` | **Modify** — update next-steps hint to mention CLAUDE.md |

---

### Task 1: Write failing tests for `claude-md.js`

**Files:**
- Create: `test/claude-md.test.js`

- [ ] **Step 1: Create the test file**

```javascript
// test/claude-md.test.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const { generateForgeSection, writeClaude, hasForgeSection } = require('../src/cli/claude-md');

let dir;

beforeEach(() => {
  dir = path.join(os.tmpdir(), `forge-claude-md-test-${Date.now()}`);
  fs.mkdirSync(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const config = {
  processes: [{ name: 'api' }, { name: 'ui' }],
  services: { mongo: {}, redis: {} },
};

test('generateForgeSection includes process names in table', () => {
  const section = generateForgeSection(config);
  expect(section).toContain('| api | `forge logs api` |');
  expect(section).toContain('| ui | `forge logs ui` |');
});

test('generateForgeSection includes service names', () => {
  const section = generateForgeSection(config);
  expect(section).toContain('**Services** (mongo, redis)');
});

test('generateForgeSection omits services section when config has no services', () => {
  const section = generateForgeSection({ processes: [{ name: 'api' }], services: {} });
  expect(section).not.toContain('**Services**');
});

test('generateForgeSection is wrapped in markers', () => {
  const section = generateForgeSection(config);
  expect(section).toContain('<!-- forge:start -->');
  expect(section).toContain('<!-- forge:end -->');
});

test('hasForgeSection returns false when no CLAUDE.md exists', () => {
  expect(hasForgeSection(dir)).toBe(false);
});

test('hasForgeSection returns false when CLAUDE.md has no forge markers', () => {
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My Project\n\nSome content.\n');
  expect(hasForgeSection(dir)).toBe(false);
});

test('hasForgeSection returns true when forge markers are present', () => {
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '<!-- forge:start -->\n## Forge\n<!-- forge:end -->\n');
  expect(hasForgeSection(dir)).toBe(true);
});

test('writeClaude creates CLAUDE.md when none exists', () => {
  writeClaude(dir, config);
  expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(true);
  const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  expect(content).toContain('<!-- forge:start -->');
  expect(content).toContain('forge logs api');
});

test('writeClaude appends forge section to existing CLAUDE.md without markers', () => {
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My Project\n\nSome content.\n');
  writeClaude(dir, config);
  const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  expect(content).toContain('# My Project');
  expect(content).toContain('<!-- forge:start -->');
  expect(content).toContain('forge logs api');
});

test('writeClaude preserves content above the forge section', () => {
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My Project\n\nSome content.\n');
  writeClaude(dir, config);
  const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  expect(content.indexOf('# My Project')).toBeLessThan(content.indexOf('<!-- forge:start -->'));
});

test('writeClaude replaces existing forge section — only one marker pair after two writes', () => {
  writeClaude(dir, config);
  writeClaude(dir, config);
  const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  const count = (content.match(/<!-- forge:start -->/g) ?? []).length;
  expect(count).toBe(1);
});

test('writeClaude updates process list when config changes between writes', () => {
  writeClaude(dir, config);
  writeClaude(dir, { processes: [{ name: 'server' }], services: {} });
  const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  expect(content).toContain('forge logs server');
  expect(content).not.toContain('forge logs api');
});
```

- [ ] **Step 2: Run tests to confirm they fail (module not found)**

```bash
npx jest test/claude-md.test.js --no-coverage
```

Expected: all tests fail with `Cannot find module '../src/cli/claude-md'`

---

### Task 2: Implement `src/cli/claude-md.js`

**Files:**
- Create: `src/cli/claude-md.js`

- [ ] **Step 1: Create the module**

```javascript
// src/cli/claude-md.js
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

  return `${START}
## Forge (process manager)

This project runs under forge. Use forge commands — not systemd, PM2, or direct
process commands.

**Status / control**
- \`forge status\` — all registered projects and process states
- \`forge up\` / \`forge down\` / \`forge restart\` — start, stop, restart this project
- \`forge open\` — web dashboard at http://localhost:2525

**Logs**
- \`forge logs <process>\` — last 100 lines (buffered)
- \`forge logs <process> -f\` — live follow
- \`forge logs <process> -n 200\` — more lines

Processes in this project:
| Process | Logs |
|---------|------|
${rows}

**Environment**
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
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
npx jest test/claude-md.test.js --no-coverage
```

Expected: all 12 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/cli/claude-md.js test/claude-md.test.js
git commit -m "feat: add claude-md module — generate and update CLAUDE.md forge section"
```

---

### Task 3: Wire `forge add` to prompt and write CLAUDE.md

**Files:**
- Modify: `src/cli/commands/add.js`

- [ ] **Step 1: Replace the file with the updated version**

```javascript
// src/cli/commands/add.js
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const chalk = require('chalk');
const client = require('../client');
const { writeEnvFile, ensureGitignored } = require('../env-file');
const { writeClaude, hasForgeSection } = require('../claude-md');

function confirm(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim() === '' || answer.trim().toLowerCase().startsWith('y'));
    });
  });
}

module.exports = function registerAdd(program) {
  program
    .command('add')
    .description('Register the project in the current directory with forge')
    .action(async () => {
      const cwd = process.cwd();
      const configPath = path.join(cwd, '.forge', 'config.json');

      if (!fs.existsSync(configPath)) {
        console.error(chalk.red(`No .forge/config.json found in ${cwd}`));
        process.exit(1);
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running. Run: forge install'));
        process.exit(1);
      }

      let result;
      try {
        result = await client.registerProject({ ...config, path: cwd });
      } catch (err) {
        if (err.status === 409) {
          console.error(chalk.red(`"${config.name}" is already registered. Run: forge sync`));
        } else {
          console.error(chalk.red(`Registration failed: ${err.message}`));
        }
        process.exit(1);
      }

      const envFile = config.envFile ?? '.env.forge';
      writeEnvFile(cwd, envFile, result.allocations, config);

      console.log(chalk.green(`✓ Registered ${config.name}`));
      if (Object.keys(result.allocations.ports).length) {
        console.log('\n  Allocated ports:');
        for (const [proc, port] of Object.entries(result.allocations.ports)) {
          console.log(chalk.dim(`    ${proc}: ${port}`));
        }
      }
      if (envFile !== false) {
        const gitignoreResult = ensureGitignored(cwd, envFile);
        if (gitignoreResult === 'added') console.log(chalk.dim(`\n  Wrote ${envFile} (added to .gitignore)`));
        else if (gitignoreResult === 'no-gitignore') console.log(chalk.dim(`\n  Wrote ${envFile}`) + chalk.yellow(` — add "${envFile}" to your .gitignore`));
        else console.log(chalk.dim(`\n  Wrote ${envFile}`));
      }
      for (const w of result.warnings ?? []) {
        console.warn(chalk.yellow(`\n  ⚠ ${w}`));
      }

      try {
        if (hasForgeSection(cwd)) {
          writeClaude(cwd, config);
          console.log(chalk.dim('\n  Updated CLAUDE.md'));
        } else {
          const claudeExists = fs.existsSync(path.join(cwd, 'CLAUDE.md'));
          const q = claudeExists
            ? '\nAdd a forge section to existing CLAUDE.md for AI assistants? [Y/n] '
            : '\nWrite CLAUDE.md with forge context for AI assistants? [Y/n] ';
          if (await confirm(q)) {
            writeClaude(cwd, config);
            console.log(chalk.dim(`  ${claudeExists ? 'Updated' : 'Wrote'} CLAUDE.md`));
          }
        }
      } catch (err) {
        console.warn(chalk.yellow(`  ⚠ Could not write CLAUDE.md: ${err.message}`));
      }
    });
};
```

- [ ] **Step 2: Run the full test suite to confirm nothing is broken**

```bash
npx jest --no-coverage
```

Expected: all tests pass (the `add` command is not unit tested — the daemon integration tests cover it at a higher level)

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/add.js
git commit -m "feat: forge add prompts to write CLAUDE.md after registration"
```

---

### Task 4: Wire `forge reload` to silently update CLAUDE.md

**Files:**
- Modify: `src/cli/commands/reload.js`

- [ ] **Step 1: Replace the file with the updated version**

```javascript
// src/cli/commands/reload.js
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const client = require('../client');
const { writeEnvFile, ensureGitignored } = require('../env-file');
const { writeClaude, hasForgeSection } = require('../claude-md');

module.exports = function registerReload(program) {
  program
    .command('reload')
    .alias('sync')
    .description('Re-read .forge/config.json and apply changes to the daemon')
    .action(async () => {
      const cwd = process.cwd();
      const configPath = path.join(cwd, '.forge', 'config.json');
      if (!fs.existsSync(configPath)) {
        console.error(chalk.red(`No .forge/config.json found in ${cwd}`));
        process.exit(1);
      }
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      let result;
      try {
        result = await client.syncProject(config.name, { ...config, path: cwd });
      } catch (err) {
        console.error(chalk.red(`Reload failed: ${err.message}`));
        process.exit(1);
      }
      const envFile = config.envFile ?? '.env.forge';
      writeEnvFile(cwd, envFile, result.allocations, config);
      console.log(chalk.green(`✓ Reloaded ${config.name}`));
      for (const [proc, port] of Object.entries(result.allocations.ports)) {
        console.log(chalk.dim(`  ${proc}: ${port}`));
      }
      if (envFile !== false) {
        const gitignoreResult = ensureGitignored(cwd, envFile);
        if (gitignoreResult === 'added') console.log(chalk.dim(`  Wrote ${envFile} (added to .gitignore)`));
        else if (gitignoreResult === 'no-gitignore') console.log(chalk.dim(`  Wrote ${envFile}`) + chalk.yellow(` — add "${envFile}" to your .gitignore`));
        else console.log(chalk.dim(`  Wrote ${envFile}`));
      }
      for (const w of result.warnings ?? []) {
        console.warn(chalk.yellow(`\n  ⚠ ${w}`));
      }

      if (hasForgeSection(cwd)) {
        try {
          writeClaude(cwd, config);
          console.log(chalk.dim('  Updated CLAUDE.md'));
        } catch (err) {
          console.warn(chalk.yellow(`  ⚠ Could not update CLAUDE.md: ${err.message}`));
        }
      }
    });
};
```

- [ ] **Step 2: Run the full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/reload.js
git commit -m "feat: forge reload silently updates CLAUDE.md forge section"
```

---

### Task 5: Update `forge init` next-steps hint

**Files:**
- Modify: `src/cli/commands/init.js`

- [ ] **Step 1: Update the console output in `init.js`**

Replace the existing success output block (lines 52–56):

```javascript
// old
console.log(chalk.green('✓ Created .forge/config.json'));
console.log('');
console.log('  Edit it to define your processes and services, then run:');
console.log(chalk.dim('  forge add'));
```

With:

```javascript
// new
console.log(chalk.green('✓ Created .forge/config.json'));
console.log('');
console.log('  Edit it to define your processes and services, then run:');
console.log(chalk.dim('  forge add') + '    — registers project and offers to write CLAUDE.md');
```

- [ ] **Step 2: Run the existing `init` tests to confirm nothing broke**

```bash
npx jest test/cli/init.test.js --no-coverage
```

Expected: all tests pass

- [ ] **Step 3: Run the full test suite one final time**

```bash
npx jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/init.js
git commit -m "feat: forge init hints that forge add will offer to write CLAUDE.md"
```
