# Per-Process envFile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a process config entry in `.forge/config.json` to declare an optional `envFile` path; forge reads that file at spawn time and merges its vars into the process env, letting each project supply per-project secrets without committing them to config.

**Architecture:** A new shared `src/parse-env-file.js` utility handles `.env` file parsing (used by both daemon and CLI). `process-manager.js` reads the file in `startOne` after `proc.env` so the override file wins. `forge add` / `forge up` auto-gitignore declared `envFile` paths. `forge env` lists override files and their keys.

**Tech Stack:** Node.js, Jest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/parse-env-file.js` | Parse `.env`-format files into `{KEY: value}` maps |
| Modify | `src/daemon/process-manager.js` | Read `proc.envFile` in `startOne`, merge vars last |
| Modify | `src/cli/commands/add.js` | Gitignore each process's `envFile` after registration |
| Modify | `src/cli/commands/up.js` | Gitignore each process's `envFile` on `forge up` |
| Modify | `src/cli/commands/env.js` | Show Override files section in output |
| Create | `test/parse-env-file.test.js` | Unit tests for `parseEnvFile` |
| Modify | `test/process-manager.test.js` | Tests for envFile injection and merge order |

---

## Task 1: `parseEnvFile` utility

**Files:**
- Create: `src/parse-env-file.js`
- Create: `test/parse-env-file.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/parse-env-file.test.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const { parseEnvFile } = require('../src/parse-env-file');

function tmpFile(content) {
  const p = path.join(os.tmpdir(), `forge-parseenv-${Date.now()}-${Math.random()}.env`);
  fs.writeFileSync(p, content);
  return p;
}

test('returns null for a file that does not exist', () => {
  expect(parseEnvFile('/nonexistent/path/file.env')).toBeNull();
});

test('parses KEY=VALUE pairs into an object', () => {
  const file = tmpFile('SOME_SECRET=abc123\nOTHER_VAR=xyz\n');
  expect(parseEnvFile(file)).toEqual({ SOME_SECRET: 'abc123', OTHER_VAR: 'xyz' });
});

test('ignores lines beginning with #', () => {
  const file = tmpFile('# this is a comment\nKEY=value\n');
  expect(parseEnvFile(file)).toEqual({ KEY: 'value' });
});

test('ignores blank lines', () => {
  const file = tmpFile('\nKEY=value\n\n');
  expect(parseEnvFile(file)).toEqual({ KEY: 'value' });
});

test('strips surrounding double quotes from values', () => {
  const file = tmpFile('KEY="quoted value"\n');
  expect(parseEnvFile(file)).toEqual({ KEY: 'quoted value' });
});

test('strips surrounding single quotes from values', () => {
  const file = tmpFile("KEY='single quoted'\n");
  expect(parseEnvFile(file)).toEqual({ KEY: 'single quoted' });
});

test('preserves = characters inside values', () => {
  const file = tmpFile('KEY=val=ue\n');
  expect(parseEnvFile(file)).toEqual({ KEY: 'val=ue' });
});

test('returns empty object for a file with only comments and blanks', () => {
  const file = tmpFile('# comment\n\n# another\n');
  expect(parseEnvFile(file)).toEqual({});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/parse-env-file.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../src/parse-env-file'`

- [ ] **Step 3: Implement `parseEnvFile`**

```js
// src/parse-env-file.js
const fs = require('fs');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const result = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    let v = trimmed.slice(eqIdx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    result[k] = v;
  }
  return result;
}

module.exports = { parseEnvFile };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/parse-env-file.test.js --no-coverage
```

Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/parse-env-file.js test/parse-env-file.test.js
git commit -m "feat: add parseEnvFile utility for .env-format file parsing"
```

---

## Task 2: Wire `envFile` into the process manager

**Files:**
- Modify: `src/daemon/process-manager.js`
- Modify: `test/process-manager.test.js`

The env merge order in `startOne` is:
1. Service URL vars (from allocations)
2. `proc.env` (static defaults in config)
3. Port var (`portEnv`)
4. `envFile` vars — **highest priority**, merged last

- [ ] **Step 1: Write the failing tests**

Add these tests to the bottom of `test/process-manager.test.js`:

```js
const os = require('os');
const fs = require('fs');

test('envFile vars are injected into the spawned process env', () => {
  const envFilePath = path.join(os.tmpdir(), `forge-envfile-test-${Date.now()}.env`);
  fs.writeFileSync(envFilePath, 'SECRET_KEY=abc123\nOTHER=xyz\n');
  const configs = [{ name: 'api', command: 'npm start', cwd: '.', ports: [], envFile: envFilePath }];
  pm.up('sai', configs, {}, '/projects/sai');
  expect(spawnCalls[0].env.SECRET_KEY).toBe('abc123');
  expect(spawnCalls[0].env.OTHER).toBe('xyz');
  fs.unlinkSync(envFilePath);
});

test('envFile vars override proc.env when the same key appears in both', () => {
  const envFilePath = path.join(os.tmpdir(), `forge-envfile-test-${Date.now()}.env`);
  fs.writeFileSync(envFilePath, 'KEY=from_file\n');
  const configs = [{ name: 'api', command: 'npm start', cwd: '.', ports: [], env: { KEY: 'from_config' }, envFile: envFilePath }];
  pm.up('sai', configs, {}, '/projects/sai');
  expect(spawnCalls[0].env.KEY).toBe('from_file');
  fs.unlinkSync(envFilePath);
});

test('missing envFile is silently skipped — process still spawns', () => {
  const configs = [{ name: 'api', command: 'npm start', cwd: '.', ports: [], envFile: '/nonexistent/path.env' }];
  expect(() => pm.up('sai', configs, {}, '/projects/sai')).not.toThrow();
  expect(spawnCalls).toHaveLength(1);
});

test('missing envFile does not inject any extra vars', () => {
  const configs = [{ name: 'api', command: 'npm start', cwd: '.', ports: [], envFile: '/nonexistent/path.env' }];
  pm.up('sai', configs, {}, '/projects/sai');
  expect(Object.keys(spawnCalls[0].env)).toHaveLength(0);
});

test('envFile path is resolved relative to projectPath', () => {
  const projectPath = os.tmpdir();
  const relPath = `forge-envfile-rel-${Date.now()}.env`;
  const absPath = path.join(projectPath, relPath);
  fs.writeFileSync(absPath, 'REL_VAR=resolved\n');
  const configs = [{ name: 'api', command: 'npm start', cwd: '.', ports: [], envFile: relPath }];
  pm.up('sai', configs, {}, projectPath);
  expect(spawnCalls[0].env.REL_VAR).toBe('resolved');
  fs.unlinkSync(absPath);
});
```

Note: `path` is already imported at the top of `test/process-manager.test.js` — check if it is; if not, add `const path = require('path');` at the top.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/process-manager.test.js --no-coverage
```

Expected: FAIL — the 5 new tests fail because `proc.envFile` is not used yet.

- [ ] **Step 3: Update `startOne` in `process-manager.js`**

Add the require at the top of the file (after the existing `const path = require('path');`):

```js
const { parseEnvFile } = require('../parse-env-file');
```

Then in `startOne`, add the envFile block after the port injection (line 45). The full `startOne` env-building section becomes:

```js
const env = {};
for (const [svcName, url] of Object.entries(allocations?.services ?? {})) {
  const envVar = (servicesConfig ?? {})[svcName]?.env;
  if (envVar) env[envVar] = url;
}
Object.assign(env, proc.env ?? {});
const port = allocations?.ports?.[proc.name];
if (port !== undefined && proc.portEnv) env[proc.portEnv] = String(port);

if (proc.envFile) {
  const overrides = parseEnvFile(path.resolve(projectPath, proc.envFile));
  if (overrides) Object.assign(env, overrides);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/process-manager.test.js --no-coverage
```

Expected: PASS (all tests including existing ones)

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npx jest --no-coverage
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/daemon/process-manager.js test/process-manager.test.js
git commit -m "feat: process-manager reads envFile and merges vars at spawn time"
```

---

## Task 3: Auto-gitignore `envFile` paths on `forge add` and `forge up`

**Files:**
- Modify: `src/cli/commands/add.js`
- Modify: `src/cli/commands/up.js`

No new tests needed — `ensureGitignored` is already unit-tested in `test/env-file.test.js`. These changes are wiring-only.

- [ ] **Step 1: Update `add.js`**

In `src/cli/commands/add.js`, import `ensureGitignored` alongside `writeEnvFile` (it is already imported — check the existing import line):

```js
const { writeEnvFile, ensureGitignored } = require('../env-file');
```

After the existing `ensureGitignored(cwd, envFile)` call (around line 51), add:

```js
for (const proc of config.processes ?? []) {
  if (proc.envFile) ensureGitignored(cwd, proc.envFile);
}
```

- [ ] **Step 2: Update `up.js`**

In `src/cli/commands/up.js`, import `ensureGitignored` alongside `writeEnvFile`:

```js
const { writeEnvFile, ensureGitignored } = require('../env-file');
```

In `startProject`, after the `writeEnvFile(...)` call, add:

```js
for (const proc of project.config?.processes ?? []) {
  if (proc.envFile) ensureGitignored(project.path, proc.envFile);
}
```

The full updated `startProject` function:

```js
async function startProject(project) {
  if (project.config?.envFile !== false) {
    writeEnvFile(
      project.path,
      project.config?.envFile ?? '.env.forge',
      project.allocations,
      project.config
    );
  }
  for (const proc of project.config?.processes ?? []) {
    if (proc.envFile) ensureGitignored(project.path, proc.envFile);
  }
  await client.upProject(project.name);
  console.log(chalk.green(`✓ ${project.name}`) + chalk.dim('  started'));
}
```

- [ ] **Step 3: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/add.js src/cli/commands/up.js
git commit -m "feat: auto-gitignore process envFile paths on forge add and forge up"
```

---

## Task 4: Show `envFile` info in `forge env`

**Files:**
- Modify: `src/cli/commands/env.js`

No new tests — `forge env` is a display-only command with no unit tests in the suite.

- [ ] **Step 1: Update `env.js`**

Replace the entire file content with:

```js
const path = require('path');
const chalk = require('chalk');
const client = require('../client');
const { parseEnvFile } = require('../../parse-env-file');

module.exports = function registerEnv(program) {
  program
    .command('env [project]')
    .description('Show env vars forge injects for a project (defaults to CWD project)')
    .action(async (projectName) => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }

      let resolvedName = projectName;
      if (!resolvedName) {
        const projects = await client.getProjects().catch(() => []);
        const cwd = process.cwd();
        const match = projects.find(p => p.path === cwd);
        if (!match) {
          console.error(chalk.red('No project found for current directory. Pass a project name or run from a registered project.'));
          process.exit(1);
        }
        resolvedName = match.name;
      }

      let project;
      try {
        project = await client.getProject(resolvedName);
      } catch {
        console.error(chalk.red(`Project "${resolvedName}" not found`));
        process.exit(1);
      }

      const config = project.config ?? {};
      const alloc = project.allocations ?? {};

      const serviceLines = [];
      for (const [svc, url] of Object.entries(alloc.services ?? {})) {
        const svcCfg = config.services?.[svc] ?? {};
        if (svcCfg.env) {
          serviceLines.push(`  ${chalk.cyan(svcCfg.env)}=${url}`);
        } else {
          serviceLines.push(`  ${chalk.yellow(`# ${svc} has no "env" key — connection string not injected`)}`);
        }
      }

      const processLines = [];
      for (const proc of config.processes ?? []) {
        const port = alloc.ports?.[proc.name];
        if (proc.portEnv && port != null) {
          processLines.push(`  ${chalk.cyan(proc.portEnv)}=${port}  ${chalk.dim(`# ${proc.name}`)}`);
        }
      }

      const overrideLines = [];
      for (const proc of config.processes ?? []) {
        if (!proc.envFile) continue;
        const absPath = path.resolve(project.path, proc.envFile);
        const vars = parseEnvFile(absPath);
        if (vars === null) {
          overrideLines.push(`  ${chalk.dim(proc.name)}  ${chalk.dim(proc.envFile)}  ${chalk.yellow('✗  (file not found)')}`);
        } else {
          const keys = Object.keys(vars);
          const keyInfo = keys.length > 0 ? `  ${chalk.dim(`[${keys.join(', ')}]`)}` : '';
          overrideLines.push(`  ${chalk.dim(proc.name)}  ${chalk.dim(proc.envFile)}  ${chalk.green('✓')}${keyInfo}`);
        }
      }

      const hasOutput = serviceLines.length > 0 || processLines.length > 0 || overrideLines.length > 0;
      if (!hasOutput) {
        console.log(chalk.dim('No env vars allocated for this project.'));
        return;
      }

      if (serviceLines.length > 0) {
        console.log(chalk.bold('Services:'));
        for (const l of serviceLines) console.log(l);
      }
      if (processLines.length > 0) {
        if (serviceLines.length > 0) console.log('');
        console.log(chalk.bold('Processes:'));
        for (const l of processLines) console.log(l);
      }
      if (overrideLines.length > 0) {
        if (serviceLines.length > 0 || processLines.length > 0) console.log('');
        console.log(chalk.bold('Override files:'));
        for (const l of overrideLines) console.log(l);
      }
    });
};
```

Note: The import path `../../parse-env-file` is correct — `env.js` is at `src/cli/commands/env.js`, so `../../` reaches `src/`, and `parse-env-file` is at `src/parse-env-file.js`.

- [ ] **Step 2: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/env.js
git commit -m "feat: forge env shows override files and their declared keys"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|-------------|------|
| `envFile` field on process config, relative path to project root | Task 2 (`path.resolve(projectPath, proc.envFile)`) |
| Parse standard `.env` format (KEY=VALUE, comments, blank lines, quotes) | Task 1 |
| Merge order: service URLs < proc.env < portEnv < envFile | Task 2 |
| Missing envFile silently skipped | Task 1 (`parseEnvFile` returns null), Task 2 (null check) |
| Auto-gitignore on `forge add` | Task 3 |
| Auto-gitignore on `forge up` | Task 3 |
| `forge env` Override files section | Task 4 |

### Potential gaps

- **No `$VAR` interpolation inside envFile values** — out of scope per spec. Literal values only.
- **Multiple envFiles per process** — out of scope. Single `envFile` field only.
- **`ensureGitignored` when `.gitignore` doesn't exist** — returns `'no-gitignore'` and logs a warning. This is existing behaviour, not new, and is already tested.
