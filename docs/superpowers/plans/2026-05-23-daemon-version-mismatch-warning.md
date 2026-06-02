# Daemon Version Mismatch Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn the user in `forge version` and `forge reload` when the running daemon's version differs from the installed forge version.

**Architecture:** `GET /api/health` already returns `{ ok: true, version }`. Both commands call `client.health()` and compare the daemon's version against the local `package.json` version. If they differ, a yellow warning is printed with a hint to run `forge restart`. No daemon changes needed.

**Tech Stack:** Node.js, Jest (tests), chalk (output)

---

## Files

- Modify: `src/cli/commands/version.js`
- Modify: `src/cli/commands/reload.js`
- Create: `test/cli/version.test.js`
- Create: `test/cli/reload.test.js`

---

### Task 1: Add mismatch warning to `forge version`

**Files:**
- Modify: `src/cli/commands/version.js`
- Create: `test/cli/version.test.js`

The action currently calls `client.isDaemonRunning()` (boolean). Replace that with `client.health()` — if it resolves, the daemon is running and we have its version; if it throws, the daemon is stopped. Export the action as `runVersion` for testability.

- [ ] **Step 1: Write the failing tests**

Create `test/cli/version.test.js`:

```js
jest.mock('../../src/cli/client');
const client = require('../../src/cli/client');
const { runVersion } = require('../../src/cli/commands/version');

describe('forge version', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
    jest.clearAllMocks();
  });

  test('shows running status when daemon is up and versions match', async () => {
    const { version } = require('../../package.json');
    client.health.mockResolvedValue({ ok: true, version });
    await runVersion();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('running');
    expect(logSpy.mock.calls[0][0]).not.toContain('⚠');
  });

  test('shows stopped status when daemon is not running', async () => {
    client.health.mockRejectedValue(new Error('connection refused'));
    await runVersion();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('stopped');
    expect(logSpy.mock.calls[0][0]).not.toContain('⚠');
  });

  test('shows mismatch warning when daemon version differs from installed version', async () => {
    client.health.mockResolvedValue({ ok: true, version: '0.3.0' });
    await runVersion();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain('running');
    expect(output).toContain('⚠');
    expect(output).toContain('0.3.0');
    expect(output).toContain('forge restart');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest test/cli/version.test.js --no-coverage
```

Expected: FAIL — `runVersion` is not exported from `version.js`.

- [ ] **Step 3: Update `src/cli/commands/version.js`**

Replace the entire file:

```js
const chalk = require('chalk');
const { version } = require('../../../package.json');
const client = require('../client');

async function runVersion() {
  let daemonVersion = null;
  try {
    const health = await client.health();
    daemonVersion = health.version;
  } catch {
    // daemon not running
  }

  const running = daemonVersion !== null;
  let line = `forge ${chalk.bold(version)}  daemon ${running ? chalk.green('running') : chalk.dim('stopped')}`;

  if (running && daemonVersion !== version) {
    line += chalk.yellow(`  ⚠ daemon is v${daemonVersion} — run \`forge restart\` to apply updates`);
  }

  console.log(line);
}

module.exports = function registerVersion(program) {
  program
    .command('version')
    .description('Show forge version and daemon status')
    .action(runVersion);
};

module.exports.runVersion = runVersion;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest test/cli/version.test.js --no-coverage
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/version.js test/cli/version.test.js
git commit -m "feat: warn in forge version when daemon version differs from installed"
```

---

### Task 2: Add mismatch warning to `forge reload`

**Files:**
- Modify: `src/cli/commands/reload.js`
- Create: `test/cli/reload.test.js`

After the daemon-running check passes, call `client.health()` to get the daemon's version and compare it against the local version. Print a yellow warning if they differ, then continue with the reload.

- [ ] **Step 1: Write the failing test**

Create `test/cli/reload.test.js`:

```js
jest.mock('../../src/cli/client');
jest.mock('fs');
jest.mock('../../src/cli/env-file', () => ({
  writeEnvFile: jest.fn(),
  ensureGitignored: jest.fn().mockReturnValue('exists'),
}));
jest.mock('../../src/cli/claude-md', () => ({
  writeClaude: jest.fn(),
  hasForgeSection: jest.fn().mockReturnValue(false),
}));
const client = require('../../src/cli/client');
const fs = require('fs');
const path = require('path');

// Import after mocks are set up
const registerReload = require('../../src/cli/commands/reload');

// We test the version-mismatch warning in isolation by mocking all other dependencies
// and verifying console.warn is called when versions differ.

describe('forge reload — version mismatch warning', () => {
  let warnSpy;
  let logSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    logSpy = jest.spyOn(console, 'log').mockImplementation();

    // Simulate a valid .forge/config.json
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      name: 'test-project',
      processes: [],
    }));

    // Daemon is running
    client.isDaemonRunning.mockResolvedValue(true);

    // syncProject returns minimal valid result
    client.syncProject.mockResolvedValue({
      allocations: { ports: {} },
      warnings: [],
    });

    // health returns a stale version by default — overridden in match test
    const { version } = require('../../package.json');
    client.health.mockResolvedValue({ ok: true, version: '0.0.0-stale' });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('warns when daemon version differs from installed version', async () => {
    // Build a minimal commander program and run the action
    const { Command } = require('commander');
    const program = new Command();
    registerReload(program);
    await program.parseAsync(['node', 'forge', 'reload'], { from: 'user' });

    const warned = warnSpy.mock.calls.some(
      ([msg]) => typeof msg === 'string' && msg.includes('⚠') && msg.includes('forge restart')
    );
    expect(warned).toBe(true);
  });

  test('does not warn when daemon version matches installed version', async () => {
    const { version } = require('../../package.json');
    client.health.mockResolvedValue({ ok: true, version });

    const { Command } = require('commander');
    const program = new Command();
    registerReload(program);
    await program.parseAsync(['node', 'forge', 'reload'], { from: 'user' });

    const warned = warnSpy.mock.calls.some(
      ([msg]) => typeof msg === 'string' && msg.includes('⚠')
    );
    expect(warned).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx jest test/cli/reload.test.js --no-coverage
```

Expected: FAIL — reload doesn't call `client.health()` yet.

- [ ] **Step 3: Update `src/cli/commands/reload.js`**

Add `version` import at the top and the health check after the running check. Replace lines 1–26 (keep the rest of the action unchanged):

```js
// src/cli/commands/reload.js
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { version } = require('../../../package.json');
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

      const health = await client.health();
      if (health.version !== version) {
        console.warn(chalk.yellow(`  ⚠ Daemon is running v${health.version} but forge v${version} is installed — run \`forge restart\` to apply code changes.`));
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
      for (const proc of config.processes ?? []) {
        if (proc.envFile) ensureGitignored(cwd, proc.envFile);
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

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest test/cli/reload.test.js --no-coverage
```

Expected: 2 tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/reload.js test/cli/reload.test.js
git commit -m "feat: warn in forge reload when daemon version differs from installed"
```
