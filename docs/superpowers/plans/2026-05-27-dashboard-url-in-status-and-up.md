# Dashboard URL in forge status and forge up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Dashboard  http://localhost:2525` footer line to the output of `forge status` and `forge up` so users can click directly into the web UI.

**Architecture:** Both CLI commands are modified to import `FORGE_PORT` from `src/constants.js` and print the dashboard URL after their success output. Each command's action handler is extracted to a named exported function (following the `version.js` pattern) so tests can call it directly without Commander.

**Tech Stack:** Node.js, chalk, Jest

---

### Task 1: Refactor and update `forge status`

**Files:**
- Modify: `src/cli/commands/status.js`
- Create: `test/cli/status.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/cli/status.test.js`:

```js
jest.mock('../../src/cli/client');
const client = require('../../src/cli/client');
const { runStatus } = require('../../src/cli/commands/status');

describe('forge status', () => {
  let logSpy, errorSpy, exitSpy;

  beforeEach(() => {
    logSpy   = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
    exitSpy  = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    jest.clearAllMocks();
  });

  test('shows dashboard URL when projects exist', async () => {
    client.isDaemonRunning.mockResolvedValue(true);
    client.getProjects.mockResolvedValue([
      { name: 'myapp', path: '/projects/myapp', allocations: { ports: {}, services: {} }, config: { processes: [] } },
    ]);
    client.getProcesses.mockResolvedValue({ processes: [] });

    await runStatus();

    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).toContain('http://localhost:');
    expect(allOutput).toContain('Dashboard');
  });

  test('does not show dashboard URL when no projects registered', async () => {
    client.isDaemonRunning.mockResolvedValue(true);
    client.getProjects.mockResolvedValue([]);

    await runStatus();

    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).not.toContain('http://localhost:');
  });

  test('does not show dashboard URL when daemon is not running', async () => {
    client.isDaemonRunning.mockResolvedValue(false);

    await expect(runStatus()).rejects.toThrow('exit');

    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).not.toContain('http://localhost:');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/cli/status.test.js --no-coverage
```

Expected: FAIL — `runStatus is not a function` or similar.

- [ ] **Step 3: Update `src/cli/commands/status.js`**

Replace the entire file with:

```js
// src/cli/commands/status.js
const chalk = require('chalk');
const client = require('../client');
const { FORGE_PORT } = require('../constants');

async function runStatus() {
  if (!await client.isDaemonRunning()) {
    console.error(chalk.red('Forge daemon is not running.'));
    process.exit(1);
  }
  const projects = await client.getProjects();
  if (projects.length === 0) {
    console.log(chalk.dim('No projects registered. Run: forge add'));
    return;
  }
  for (const p of projects) {
    console.log(chalk.bold(p.name) + chalk.dim('  ' + p.path));

    let processes = [];
    try { processes = (await client.getProcesses(p.name)).processes ?? []; } catch {}
    for (const proc of processes) {
      const statusColor = proc.status === 'running' ? chalk.green
                        : proc.status === 'crashed' ? chalk.red
                        :                             chalk.dim;
      const portInfo = p.allocations?.ports?.[proc.name]
        ? chalk.dim(` :${p.allocations.ports[proc.name]}`)
        : '';
      const uptimeInfo = proc.status === 'running' && proc.uptime > 0
        ? chalk.dim(`  up ${proc.uptime}s`)
        : '';
      console.log(`  ${statusColor(proc.status.padEnd(8))} ${proc.name}${portInfo}${uptimeInfo}`);
    }

    for (const [svc, url] of Object.entries(p.allocations?.services ?? {})) {
      console.log(chalk.dim(`  svc   ${svc}: ${url}`));
    }
    console.log('');
  }
  console.log(chalk.dim('  Dashboard  ') + chalk.cyan(`http://localhost:${FORGE_PORT}`));
}

module.exports = function registerStatus(program) {
  program
    .command('status')
    .description('Show all registered projects and their process status')
    .action(runStatus);
};

module.exports.runStatus = runStatus;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/cli/status.test.js --no-coverage
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/status.js test/cli/status.test.js
git commit -m "feat: show dashboard URL footer in forge status"
```

---

### Task 2: Refactor and update `forge up`

**Files:**
- Modify: `src/cli/commands/up.js`
- Create: `test/cli/up.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/cli/up.test.js`:

```js
jest.mock('../../src/cli/client');
jest.mock('../../src/cli/env-file', () => ({ ensureGitignored: jest.fn() }));
const client = require('../../src/cli/client');
const { runUp } = require('../../src/cli/commands/up');

const fakeProject = (name) => ({
  name,
  path: `/projects/${name}`,
  config: { processes: [] },
});

describe('forge up', () => {
  let logSpy, errorSpy, exitSpy;

  beforeEach(() => {
    logSpy   = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
    exitSpy  = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    jest.clearAllMocks();
  });

  test('shows dashboard URL after starting a named project', async () => {
    client.isDaemonRunning.mockResolvedValue(true);
    client.getProject.mockResolvedValue(fakeProject('myapp'));
    client.upProject.mockResolvedValue({});

    await runUp('myapp');

    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).toContain('myapp');
    expect(allOutput).toContain('http://localhost:');
    expect(allOutput).toContain('Dashboard');
  });

  test('shows dashboard URL once when starting all projects', async () => {
    client.isDaemonRunning.mockResolvedValue(true);
    client.getProjects.mockResolvedValue([fakeProject('a'), fakeProject('b')]);
    client.upProject.mockResolvedValue({});

    await runUp(undefined);

    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).toContain('http://localhost:');
    // URL appears exactly once
    expect((allOutput.match(/http:\/\/localhost:/g) ?? []).length).toBe(1);
  });

  test('does not show dashboard URL when no projects registered', async () => {
    client.isDaemonRunning.mockResolvedValue(true);
    client.getProjects.mockResolvedValue([]);

    await runUp(undefined);

    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).not.toContain('http://localhost:');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/cli/up.test.js --no-coverage
```

Expected: FAIL — `runUp is not a function` or similar.

- [ ] **Step 3: Update `src/cli/commands/up.js`**

Replace the entire file with:

```js
// src/cli/commands/up.js
const chalk = require('chalk');
const client = require('../client');
const { ensureGitignored } = require('../env-file');
const { FORGE_PORT } = require('../constants');

async function startProject(project) {
  for (const proc of project.config?.processes ?? []) {
    if (proc.envFile) ensureGitignored(project.path, proc.envFile);
  }
  await client.upProject(project.name);
  console.log(chalk.green(`✓ ${project.name}`) + chalk.dim('  started'));
}

async function runUp(projectName) {
  if (!await client.isDaemonRunning()) {
    console.error(chalk.red('Forge daemon is not running. Run: forge install'));
    process.exit(1);
  }
  try {
    if (projectName) {
      const project = await client.getProject(projectName);
      await startProject(project);
    } else {
      const projects = await client.getProjects();
      if (projects.length === 0) {
        console.log(chalk.dim('No projects registered. Run: forge add'));
        return;
      }
      const cwd = process.cwd();
      const cwdProject = projects.find(p => p.path === cwd);
      if (cwdProject) {
        await startProject(cwdProject);
      } else {
        for (const project of projects) {
          await startProject(project);
        }
      }
    }
    console.log(chalk.dim('  Dashboard  ') + chalk.cyan(`http://localhost:${FORGE_PORT}`));
  } catch (err) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }
}

module.exports = function registerUp(program) {
  program
    .command('up [project]')
    .description('Start processes for a project (or all registered projects)')
    .action(runUp);
};

module.exports.runUp = runUp;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/cli/up.test.js --no-coverage
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npx jest --no-coverage
```

Expected: All tests pass (no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/up.js test/cli/up.test.js
git commit -m "feat: show dashboard URL footer in forge up"
```
