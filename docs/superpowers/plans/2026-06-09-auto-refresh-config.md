# Auto-refresh project config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daemon's process-mutating routes (`up`, `down`, `restart`) automatically re-read `.forge/config.json` from disk before acting, so edits to env / command / process list take effect on the next forge command without an explicit `forge reload`.

**Architecture:** Add a small `refreshProjectConfig` helper that reads `<project.path>/.forge/config.json` and updates the registry entry; on parse failure it logs and returns the last-known-good entry. Five route handlers in `processes.js` swap their existing `registry.get(name)` lookup for this helper. The per-process `restart` route also gains an `writeEnvFile` call to mirror what `up` already does. The `processManager.down` function gains a final live-map sweep so processes removed from `config.json` since last refresh still get killed.

**Tech Stack:** Node.js (CommonJS), Express + supertest for route tests, Jest for unit tests. Existing daemon at `src/daemon/`. Tests at `test/`.

**Spec:** `docs/superpowers/specs/2026-06-09-auto-refresh-config-design.md`

---

## File Structure

- **Create** `src/daemon/refresh-project.js` — the `refreshProjectConfig` helper. One exported function, no state.
- **Create** `test/refresh-project.test.js` — unit tests for the helper using a temp dir for the fake config.
- **Modify** `src/daemon/api/processes.js` — five route handlers swap `registry.get` for `refreshProjectConfig`; restart route adds env-file write.
- **Modify** `test/api/processes.test.js` — new integration tests writing a real `config.json` to a temp dir and asserting the mocked `processManager` receives the fresh config.
- **Modify** `src/daemon/process-manager.js` — `down`'s first branch ends with a live-map sweep.
- **Modify** `test/process-manager.test.js` — new test for the sweep.

No file is reorganized. No new dependencies.

---

## Pre-flight

- [ ] **Step 0: Run the existing test suite once to establish baseline**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npm test
```

Expected: all existing tests pass. Note any pre-existing failures (none should exist; flag if they do).

---

## Task 1: `refreshProjectConfig` helper with unit tests

A tiny pure-ish function with a fs.readFileSync call. TDD: write the tests first, then the helper.

**Files:**
- Create: `test/refresh-project.test.js`
- Create: `src/daemon/refresh-project.js`

- [ ] **Step 1: Write the failing test file**

Create `/Users/mikewilliams/Source/brutalsystems/forge/test/refresh-project.test.js` with:

```js
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createRegistry } = require('../src/daemon/registry');
const { refreshProjectConfig } = require('../src/daemon/refresh-project');

let projectPath;
let registryPath;
let registry;

beforeEach(() => {
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-refresh-test-'));
  fs.mkdirSync(path.join(projectPath, '.forge'));
  registryPath = path.join(os.tmpdir(), `forge-refresh-registry-${Date.now()}-${Math.random()}.json`);
  registry = createRegistry(registryPath);
});

afterEach(() => {
  fs.rmSync(projectPath, { recursive: true, force: true });
  if (fs.existsSync(registryPath)) fs.unlinkSync(registryPath);
});

function writeConfig(obj) {
  fs.writeFileSync(path.join(projectPath, '.forge', 'config.json'), JSON.stringify(obj));
}

test('returns null when project is not in the registry', () => {
  const result = refreshProjectConfig(registry, 'unknown', () => {});
  expect(result).toBeNull();
});

test('reads fresh config from disk and updates the registry on success', () => {
  registry.add('sai', { path: projectPath, config: { name: 'sai', processes: [] }, allocations: {} });
  writeConfig({ name: 'sai', processes: [{ name: 'api', command: 'updated' }] });

  const result = refreshProjectConfig(registry, 'sai', () => {});

  expect(result.config.processes).toEqual([{ name: 'api', command: 'updated' }]);
  // Registry must also be updated, not just the return value
  expect(registry.get('sai').config.processes).toEqual([{ name: 'api', command: 'updated' }]);
});

test('falls back to existing registry entry when config.json is missing', () => {
  registry.add('sai', { path: projectPath, config: { name: 'sai', processes: [{ name: 'stale', command: 'old' }] }, allocations: {} });
  // No config.json on disk

  const logged = [];
  const result = refreshProjectConfig(registry, 'sai', msg => logged.push(msg));

  expect(result.config.processes).toEqual([{ name: 'stale', command: 'old' }]);
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatch(/Could not refresh config for "sai"/);
  expect(logged[0]).toMatch(/Using last-known config/);
});

test('falls back to existing registry entry when config.json is malformed JSON', () => {
  registry.add('sai', { path: projectPath, config: { name: 'sai', processes: [{ name: 'stale' }] }, allocations: {} });
  fs.writeFileSync(path.join(projectPath, '.forge', 'config.json'), '{not valid json');

  const logged = [];
  const result = refreshProjectConfig(registry, 'sai', msg => logged.push(msg));

  expect(result.config.processes).toEqual([{ name: 'stale' }]);
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatch(/Could not refresh config for "sai"/);
});

test('preserves non-config fields when refreshing (allocations untouched)', () => {
  registry.add('sai', {
    path: projectPath,
    config: { name: 'sai', processes: [] },
    allocations: { ports: { api: 4444 }, services: { mongo: 'mongodb://x' } },
  });
  writeConfig({ name: 'sai', processes: [{ name: 'api', command: 'new' }] });

  const result = refreshProjectConfig(registry, 'sai', () => {});

  expect(result.allocations).toEqual({ ports: { api: 4444 }, services: { mongo: 'mongodb://x' } });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/refresh-project.test.js
```

Expected: fails with "Cannot find module '../src/daemon/refresh-project'".

- [ ] **Step 3: Create the helper**

Create `/Users/mikewilliams/Source/brutalsystems/forge/src/daemon/refresh-project.js`:

```js
const fs = require('fs');
const path = require('path');

function refreshProjectConfig(registry, projectName, log = console.warn) {
  const entry = registry.get(projectName);
  if (!entry) return null;
  const configPath = path.join(entry.path, '.forge', 'config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const fresh = JSON.parse(raw);
    registry.update(projectName, { config: fresh });
    return registry.get(projectName);
  } catch (err) {
    log(`[forge] Could not refresh config for "${projectName}" from disk: ${err.message}. Using last-known config.`);
    return entry;
  }
}

module.exports = { refreshProjectConfig };
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/refresh-project.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && git add src/daemon/refresh-project.js test/refresh-project.test.js && git commit -m "feat(daemon): add refreshProjectConfig helper"
```

Do NOT `git add -A` / `git add .` — there are unrelated dirty files (`README.md`, `src/daemon/services/drivers/mongo.js`, `docs/superpowers/plans/2026-06-03-linux-support.md`) that must NOT be staged.

---

## Task 2: Wire the helper into the five process-mutating routes

Each route's first line changes from `registry.get(...)` to `refreshProjectConfig(registry, ...)`. New integration tests prove that a mutated `config.json` actually reaches `processManager`.

**Files:**
- Modify: `src/daemon/api/processes.js`
- Modify: `test/api/processes.test.js`

- [ ] **Step 1: Add a setup helper to `test/api/processes.test.js` that writes a real config.json**

Open `/Users/mikewilliams/Source/brutalsystems/forge/test/api/processes.test.js`. Find the existing `setup()` function (around line 30). Just below `setup()`, add a new helper that creates a real on-disk project directory and registers it:

```js
function setupWithDisk() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-route-test-'));
  fs.mkdirSync(path.join(projectDir, '.forge'));
  const initialConfig = {
    name: 'sai',
    envFile: false,
    processes: [{ name: 'api', command: 'npm start', cwd: '.', ports: [3000], portEnv: 'PORT' }],
    services: {},
  };
  fs.writeFileSync(path.join(projectDir, '.forge', 'config.json'), JSON.stringify(initialConfig));

  const tmpRegistry = path.join(os.tmpdir(), `forge-routes-test-${Date.now()}-${Math.random()}.json`);
  const registry = createRegistry(tmpRegistry);
  const portAllocator = createPortAllocator();
  const serviceManager = createServiceManager([]);
  const processManager = makeMockProcessManager();

  registry.add('sai', {
    path: projectDir,
    config: initialConfig,
    allocations: { ports: { api: 3000 }, services: {} },
  });
  const { app } = createServer({ registry, portAllocator, serviceManager, processManager });

  const cleanup = () => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    if (fs.existsSync(tmpRegistry)) fs.unlinkSync(tmpRegistry);
  };
  currentCleanup = cleanup;

  function rewriteConfig(updater) {
    const next = updater(JSON.parse(JSON.stringify(initialConfig)));
    fs.writeFileSync(path.join(projectDir, '.forge', 'config.json'), JSON.stringify(next));
  }

  return { app, processManager, rewriteConfig, projectDir };
}
```

- [ ] **Step 2: Add failing tests proving the routes refresh from disk**

Still in `test/api/processes.test.js`, append the following tests at the end of the file:

```js
test('POST /processes/up reads fresh config from disk before spawning', async () => {
  const { app, processManager, rewriteConfig } = setupWithDisk();
  rewriteConfig(c => {
    c.processes[0].env = { NEW_VAR: 'fresh' };
    return c;
  });
  const res = await request(app).post('/api/projects/sai/processes/up');
  expect(res.status).toBe(200);
  const procsPassed = processManager.up.mock.calls[0][1];
  expect(procsPassed[0].env).toEqual({ NEW_VAR: 'fresh' });
});

test('POST /processes/down reads fresh config from disk', async () => {
  const { app, processManager, rewriteConfig } = setupWithDisk();
  rewriteConfig(c => {
    c.processes.push({ name: 'worker', command: 'node worker.js', cwd: '.', ports: [] });
    return c;
  });
  const res = await request(app).post('/api/projects/sai/processes/down');
  expect(res.status).toBe(200);
  const procsPassed = processManager.down.mock.calls[0][1];
  expect(procsPassed.map(p => p.name)).toEqual(['api', 'worker']);
});

test('POST /processes/:name/up reads fresh config from disk', async () => {
  const { app, processManager, rewriteConfig } = setupWithDisk();
  rewriteConfig(c => {
    c.processes[0].env = { FROM_DISK: 'yes' };
    return c;
  });
  const res = await request(app).post('/api/projects/sai/processes/api/up');
  expect(res.status).toBe(200);
  const procsPassed = processManager.startProcess.mock.calls[0][2];
  expect(procsPassed[0].env).toEqual({ FROM_DISK: 'yes' });
});

test('POST /processes/:name/restart reads fresh config from disk', async () => {
  const { app, processManager, rewriteConfig } = setupWithDisk();
  rewriteConfig(c => {
    c.processes[0].env = { JOBS_SERVICE_URL: 'http://jobs:5000' };
    return c;
  });
  const res = await request(app).post('/api/projects/sai/processes/api/restart');
  expect(res.status).toBe(200);
  const procsPassed = processManager.restart.mock.calls[0][2];
  expect(procsPassed[0].env).toEqual({ JOBS_SERVICE_URL: 'http://jobs:5000' });
});

test('POST /processes/:name/down reads fresh config from disk', async () => {
  const { app, processManager, rewriteConfig } = setupWithDisk();
  // Just verify the route still 200s and calls stopProcess; semantics are unchanged.
  rewriteConfig(c => c);
  const res = await request(app).post('/api/projects/sai/processes/api/down');
  expect(res.status).toBe(200);
  expect(processManager.stopProcess).toHaveBeenCalledWith('sai', 'api');
});

test('routes fall back to registry config when config.json is missing', async () => {
  const { app, processManager, projectDir } = setupWithDisk();
  fs.unlinkSync(path.join(projectDir, '.forge', 'config.json'));
  const res = await request(app).post('/api/projects/sai/processes/up');
  expect(res.status).toBe(200);
  const procsPassed = processManager.up.mock.calls[0][1];
  // Registry was seeded with the original `initialConfig` — fallback uses that.
  expect(procsPassed[0].name).toBe('api');
  expect(procsPassed[0].env).toBeUndefined();
});
```

- [ ] **Step 3: Run the new tests, verify they fail**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/api/processes.test.js
```

Expected: the 6 new tests fail because the routes still use `registry.get`, so disk edits don't reach `processManager`. The existing tests should still pass.

- [ ] **Step 4: Wire the helper into all five routes in `src/daemon/api/processes.js`**

Open `/Users/mikewilliams/Source/brutalsystems/forge/src/daemon/api/processes.js`. At the top, alongside the existing requires, add the helper import:

```js
const { Router } = require('express');
const { writeEnvFile } = require('../../cli/env-file');
const { refreshProjectConfig } = require('../refresh-project');
```

For each of the five routes below, change the first line from `const project = registry.get(req.params.name);` to `const project = refreshProjectConfig(registry, req.params.name);`. All other code in each handler is unchanged.

Routes to update (search for each by its URL path):
- `router.post('/up', async (req, res) => {` — line ~15
- `router.post('/down', async (req, res) => {` — line ~66
- `router.post('/:processName/up', async (req, res) => {` — line ~73
- `router.post('/:processName/down', (req, res) => {` — line ~87
- `router.post('/:processName/restart', (req, res) => {` — line ~102

Do NOT change the non-mutating routes (`router.get('/', ...)` and `router.get('/:processName/logs', ...)`). They stay on `registry.get` to keep the dashboard's polling cheap.

- [ ] **Step 5: Run the tests, verify all pass**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/api/processes.test.js
```

Expected: all tests (existing + 6 new) pass.

- [ ] **Step 6: Run the full suite to confirm nothing else broke**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && git add src/daemon/api/processes.js test/api/processes.test.js && git commit -m "feat(daemon): auto-refresh project config on up/down/restart routes"
```

---

## Task 3: `processManager.down` sweeps live processes after the dependency-ordered shutdown

When a process is removed from `config.json` and the route refreshes, the fresh config no longer lists it — so the existing dependency-ordered branch wouldn't kill it. Add a sweep at the end of that branch that kills anything still alive in the live map for the project.

**Files:**
- Modify: `src/daemon/process-manager.js`
- Modify: `test/process-manager.test.js`

- [ ] **Step 1: Write the failing test**

Open `/Users/mikewilliams/Source/brutalsystems/forge/test/process-manager.test.js`. Find a logical place near the existing `down()` tests and add:

```js
test('down() sweeps live processes that are no longer in the passed config list', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  expect(pm.isRunning('sai', 'api')).toBe(true);
  expect(pm.isRunning('sai', 'worker')).toBe(true);

  // Caller passes a list that no longer includes "worker" (e.g. config was edited
  // to remove it). The sweep should still kill it.
  const trimmed = processConfigs.filter(p => p.name !== 'worker');
  await pm.down('sai', trimmed);

  expect(pm.isRunning('sai', 'api')).toBe(false);
  expect(pm.isRunning('sai', 'worker')).toBe(false);
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/process-manager.test.js -t "sweeps live processes"
```

Expected: fails because `worker` is still running after `down()` was called with a trimmed list.

- [ ] **Step 3: Add the sweep to `process-manager.js`**

Open `/Users/mikewilliams/Source/brutalsystems/forge/src/daemon/process-manager.js`. Find the `down` function (around line 230). Its first branch ends like this:

```js
    async down(projectName, processConfigs) {
      if (processConfigs?.length) {
        const waves = buildStartOrder(processConfigs);
        for (const wave of [...waves].reverse()) {
          const exitPromises = [];
          for (const proc of wave) {
            const k = key(projectName, proc.name);
            const record = processes.get(k);
            if (!record) continue;
            if (record.ptyProcess) {
              // ...
            }
            emit(k, { type: 'status', status: 'stopped' });
            processes.delete(k);
          }
          if (exitPromises.length > 0) await Promise.all(exitPromises);
        }
      } else {
        for (const k of [...processes.keys()]) {
          if (k.startsWith(`${projectName}:`)) {
            killOne(projectName, k.slice(projectName.length + 1));
          }
        }
      }
    },
```

Add a sweep immediately after the `for (const wave of [...waves].reverse())` loop, inside the `if (processConfigs?.length)` branch. The sweep kills any remaining live keys for this project that weren't in the wave order:

```js
    async down(projectName, processConfigs) {
      if (processConfigs?.length) {
        const waves = buildStartOrder(processConfigs);
        for (const wave of [...waves].reverse()) {
          const exitPromises = [];
          for (const proc of wave) {
            const k = key(projectName, proc.name);
            const record = processes.get(k);
            if (!record) continue;
            if (record.ptyProcess) {
              const pgid = record.pid;
              exitPromises.push(new Promise(resolve => {
                const timer = setTimeout(resolve, 5000);
                record.ptyProcess.onExit(async () => {
                  clearTimeout(timer);
                  // Wait for grandchildren (e.g. vite spawned by yarn) to die too —
                  // PTY onExit only fires when the direct child exits, not descendants.
                  if (pgid) await waitForPgroupDead(pgid);
                  resolve();
                });
                if (pgid) { try { process.kill(-pgid, 'SIGTERM'); } catch {} }
                try { record.ptyProcess.kill(); } catch {}
              }));
            }
            emit(k, { type: 'status', status: 'stopped' });
            processes.delete(k);
          }
          if (exitPromises.length > 0) await Promise.all(exitPromises);
        }
        // Sweep: kill any live processes for this project that weren't in the
        // passed config list (e.g. processes removed from config.json since the
        // last refresh). killOne is idempotent on already-deleted keys.
        for (const k of [...processes.keys()]) {
          if (k.startsWith(`${projectName}:`)) {
            killOne(projectName, k.slice(projectName.length + 1));
          }
        }
      } else {
        for (const k of [...processes.keys()]) {
          if (k.startsWith(`${projectName}:`)) {
            killOne(projectName, k.slice(projectName.length + 1));
          }
        }
      }
    },
```

The full body of the wave loop is unchanged from the original — I've shown it complete so you can confirm nothing else moves. The new lines are only the sweep at the end of the `if` branch.

- [ ] **Step 4: Run the test, verify it passes**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/process-manager.test.js
```

Expected: all tests in this file pass (including the new sweep test and the existing down tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && git add src/daemon/process-manager.js test/process-manager.test.js && git commit -m "fix(daemon): down() sweeps live processes removed from config"
```

---

## Task 4: Restart route writes the env file

The `up` route writes the env file before spawning so processes see updated values via the env file as well as the inline `env` block. `restart` doesn't currently — fix it so a restarted process with an edited env block also sees the new values via the env file.

**Files:**
- Modify: `src/daemon/api/processes.js`
- Modify: `test/api/processes.test.js`

- [ ] **Step 1: Write the failing test**

Open `/Users/mikewilliams/Source/brutalsystems/forge/test/api/processes.test.js`. Append:

```js
test('POST /processes/:name/restart writes the env file with fresh config', async () => {
  const { app, projectDir, rewriteConfig } = setupWithDisk();
  // Make envFile a real path so writeEnvFile actually writes
  rewriteConfig(c => {
    c.envFile = '.env.forge';
    c.processes[0].env = { CUSTOM_KEY: 'after_restart' };
    return c;
  });
  const res = await request(app).post('/api/projects/sai/processes/api/restart');
  expect(res.status).toBe(200);

  const envPath = path.join(projectDir, '.env.forge');
  expect(fs.existsSync(envPath)).toBe(true);
  const envContents = fs.readFileSync(envPath, 'utf8');
  expect(envContents).toMatch(/CUSTOM_KEY=after_restart/);
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/api/processes.test.js -t "writes the env file with fresh config"
```

Expected: fails — the env file doesn't exist because the restart route doesn't write it.

- [ ] **Step 3: Add the env-file write to the restart route**

In `/Users/mikewilliams/Source/brutalsystems/forge/src/daemon/api/processes.js`, find the restart route. After Task 2 it currently reads:

```jsx
  router.post('/:processName/restart', (req, res) => {
    const project = refreshProjectConfig(registry, req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    processManager.restart(
      req.params.name, req.params.processName,
      project.config?.processes ?? [], project.allocations ?? {}, project.path, project.config?.services ?? {}
    );
    res.json({ ok: true, project: req.params.name, process: req.params.processName });
  });
```

Change to (inserting the env-file write between the 404 check and the restart call):

```jsx
  router.post('/:processName/restart', (req, res) => {
    const project = refreshProjectConfig(registry, req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });

    // Write env file with fresh config + current allocations before respawning,
    // so processes see the same values via the env file as via the inline env block.
    const envFilename = project.config?.envFile ?? '.env.forge';
    if (envFilename !== false) {
      writeEnvFile(project.path, envFilename, project.allocations ?? {}, project.config);
    }

    processManager.restart(
      req.params.name, req.params.processName,
      project.config?.processes ?? [], project.allocations ?? {}, project.path, project.config?.services ?? {}
    );
    res.json({ ok: true, project: req.params.name, process: req.params.processName });
  });
```

The `writeEnvFile` import already exists at the top of the file (line 3 — `const { writeEnvFile } = require('../../cli/env-file');`).

- [ ] **Step 4: Run the test, verify it passes**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/api/processes.test.js -t "writes the env file with fresh config"
```

Expected: passes.

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && git add src/daemon/api/processes.js test/api/processes.test.js && git commit -m "feat(daemon): rewrite env file on per-process restart"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npm test
```

Expected: all green.

- [ ] **Step 2: Manual smoke test (user-facing)**

This is for the user to do — the user will reload the running daemon (`launchctl kickstart -k gui/$(id -u)/com.forge.daemon` per `CLAUDE.md`) and walk through:

- Pick a running project. Edit a process's `env` block in `.forge/config.json` (add `MY_TEST=hello`).
- Run `forge restart <processName>`. The process respawns; running `env | grep MY_TEST` inside that process's terminal in the dashboard shows the new var.
- Add a brand-new process to `.forge/config.json`. Run `forge up`. The new process starts without an explicit `forge reload` first.
- Remove a process from `.forge/config.json`. Run `forge down`. The removed process is killed even though it's no longer in config.

- [ ] **Step 3: Final status check**

```bash
git status
```

Should show only the unrelated pre-existing dirty files (`README.md`, `mongo.js`, `2026-06-03-linux-support.md`). Nothing else uncommitted.
