# dependsOn Startup Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `dependsOn` and `waitFor` fields to process configs so forge starts processes in dependency order, polling TCP or waiting for exit-0 before starting dependents.

**Architecture:** Four tasks in dependency order — pure graph resolver first, then process manager rewrite (async `startOne`, readiness helpers, wave-based `up()`, dep-aware `startProcess()`), then API async wiring, then README update. All new behaviour is test-driven. Readiness helpers are injected so tests never open real TCP connections.

**Tech Stack:** Node.js, Jest, node-pty (via mock), net module

---

## File Map

| File | What changes |
|------|-------------|
| `src/daemon/dependency-resolver.js` | New — `buildStartOrder`, cycle detection, topological sort |
| `src/daemon/process-manager.js` | `startOne` async; `pollPort`/`waitForExit` helpers; `up()` wave loop; `startProcess()` ancestor resolution; inject options |
| `src/daemon/api/processes.js` | Await `processManager.up()` and `processManager.startProcess()`; wrap in try-catch for 500 on cycle |
| `test/dependency-resolver.test.js` | New — pure unit tests for graph logic |
| `test/process-manager.test.js` | Add `await` to all existing `pm.up()` calls; add new ordering/readiness tests |
| `test/api/processes.test.js` | Add test: `up` route returns 500 when `up()` throws |
| `README.md` | Remove "Future" framing; document `dependsOn`/`waitFor` in config reference |

---

## Task 1: `dependency-resolver.js` — pure graph module

**Files:**
- Create: `test/dependency-resolver.test.js`
- Create: `src/daemon/dependency-resolver.js`

- [ ] **Step 1: Write 6 failing tests**

Create `test/dependency-resolver.test.js`:

```js
const { buildStartOrder } = require('../src/daemon/dependency-resolver');

function waveNames(waves) {
  return waves.map(wave => wave.map(p => p.name).sort());
}

test('no dependsOn: all processes land in wave 0', () => {
  const configs = [
    { name: 'api', command: 'a' },
    { name: 'worker', command: 'b' },
  ];
  const waves = buildStartOrder(configs);
  expect(waves).toHaveLength(1);
  expect(waveNames(waves)[0]).toEqual(['api', 'worker']);
});

test('linear chain: each process in its own wave', () => {
  const configs = [
    { name: 'migrate', command: 'a' },
    { name: 'api', command: 'b', dependsOn: ['migrate'] },
    { name: 'app', command: 'c', dependsOn: ['api'] },
  ];
  expect(waveNames(buildStartOrder(configs))).toEqual([['migrate'], ['api'], ['app']]);
});

test('diamond: shared dep in wave 0, two dependents in wave 1, final in wave 2', () => {
  const configs = [
    { name: 'db', command: 'd' },
    { name: 'api', command: 'a', dependsOn: ['db'] },
    { name: 'ws',  command: 'w', dependsOn: ['db'] },
    { name: 'app', command: 'ap', dependsOn: ['api', 'ws'] },
  ];
  const waves = waveNames(buildStartOrder(configs));
  expect(waves[0]).toEqual(['db']);
  expect(waves[1]).toEqual(['api', 'ws']);
  expect(waves[2]).toEqual(['app']);
});

test('direct cycle throws containing both process names', () => {
  const configs = [
    { name: 'a', command: 'a', dependsOn: ['b'] },
    { name: 'b', command: 'b', dependsOn: ['a'] },
  ];
  expect(() => buildStartOrder(configs)).toThrow(/Cycle detected in dependsOn.*a.*b|Cycle detected in dependsOn.*b.*a/);
});

test('indirect cycle (A→B→C→A) throws', () => {
  const configs = [
    { name: 'a', command: 'a', dependsOn: ['c'] },
    { name: 'b', command: 'b', dependsOn: ['a'] },
    { name: 'c', command: 'c', dependsOn: ['b'] },
  ];
  expect(() => buildStartOrder(configs)).toThrow('Cycle detected in dependsOn');
});

test('unknown dep throws with process name and dep name', () => {
  const configs = [
    { name: 'app', command: 'a', dependsOn: ['nonexistent'] },
  ];
  expect(() => buildStartOrder(configs)).toThrow('Process "app" depends on unknown process "nonexistent"');
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern dependency-resolver --no-coverage
```

Expected: 6 failures — `Cannot find module '../src/daemon/dependency-resolver'`.

- [ ] **Step 3: Implement `dependency-resolver.js`**

Create `src/daemon/dependency-resolver.js`:

```js
function buildStartOrder(processConfigs) {
  const byName = new Map(processConfigs.map(p => [p.name, p]));

  for (const proc of processConfigs) {
    for (const dep of proc.dependsOn ?? []) {
      if (!byName.has(dep)) {
        throw new Error(`Process "${proc.name}" depends on unknown process "${dep}"`);
      }
    }
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(processConfigs.map(p => [p.name, WHITE]));
  const stack = [];

  function dfs(name) {
    color.set(name, GRAY);
    stack.push(name);
    for (const dep of byName.get(name)?.dependsOn ?? []) {
      if (color.get(dep) === GRAY) {
        const idx = stack.indexOf(dep);
        const cycle = [...stack.slice(idx), dep];
        throw new Error(`Cycle detected in dependsOn: ${cycle.join(' → ')}`);
      }
      if (color.get(dep) === WHITE) dfs(dep);
    }
    stack.pop();
    color.set(name, BLACK);
  }

  for (const proc of processConfigs) {
    if (color.get(proc.name) === WHITE) dfs(proc.name);
  }

  const waves = [];
  const placed = new Set();
  while (placed.size < processConfigs.length) {
    const wave = processConfigs.filter(p =>
      !placed.has(p.name) && (p.dependsOn ?? []).every(d => placed.has(d))
    );
    waves.push(wave);
    for (const p of wave) placed.add(p.name);
  }

  return waves;
}

module.exports = { buildStartOrder };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest --testPathPattern dependency-resolver --no-coverage
```

Expected: all 6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/dependency-resolver.js test/dependency-resolver.test.js
git commit -m "feat: add dependency-resolver with topological sort and cycle detection"
```

---

## Task 2: `process-manager.js` — async `startOne`, readiness helpers, wave `up()`, dep-aware `startProcess()`

**Files:**
- Modify: `src/daemon/process-manager.js`
- Modify: `test/process-manager.test.js`

This task rewrites `process-manager.js` in full. `startOne` becomes async, `up()` and `startProcess()` become async. Because `up()` is now async, all existing tests that call `pm.up()` without `await` will stop working — update them first.

- [ ] **Step 1: Add `await` to all existing `pm.up()` and `pm.startProcess()` calls in the test file**

Open `test/process-manager.test.js`. Every test that calls `pm.up(...)` or `pm.startProcess(...)` must be made `async` and have `await` added. Apply these changes to the existing tests:

```js
// Change every test like this:
test('up() spawns one PTY per process config', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  expect(spawnCalls).toHaveLength(2);
});

test('up() injects portEnv into PTY env', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  const api = spawnCalls.find(c => c.command === 'npm start');
  expect(api.env.PORT).toBe('3000');
});

test('up() does not inject portEnv when port is absent', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  const worker = spawnCalls.find(c => c.command === 'node worker.js');
  expect(worker.env).not.toHaveProperty('PORT');
});

test('up() resolves cwd relative to projectPath', async () => {
  const configs = [{ name: 'api', command: 'npm start', cwd: 'packages/api', ports: [] }];
  await pm.up('sai', configs, {}, '/projects/sai');
  expect(spawnCalls[0].cwd).toBe('/projects/sai/packages/api');
});

test('up() skips already-running processes', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  expect(spawnCalls).toHaveLength(2);
});

test('isRunning() returns true after up()', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  expect(pm.isRunning('sai', 'api')).toBe(true);
});

test('down() stops all processes for a project', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  pm.down('sai');
  expect(pm.isRunning('sai', 'api')).toBe(false);
  expect(pm.isRunning('sai', 'worker')).toBe(false);
});

test('down() does not affect other projects', async () => {
  await pm.up('sai',    processConfigs, allocations, '/projects/sai');
  await pm.up('cleome', processConfigs, allocations, '/projects/cleome');
  pm.down('sai');
  expect(pm.isRunning('cleome', 'api')).toBe(true);
});

test('getStatuses() shows running after up()', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  const s = pm.getStatuses('sai', processConfigs);
  expect(s.find(p => p.name === 'api').status).toBe('running');
});

test('getStatuses() shows stopped after clean exit', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  spawnCalls[0].mock.exit(0);
  const s = pm.getStatuses('sai', processConfigs);
  expect(s.find(p => p.name === 'api').status).toBe('stopped');
});

test('getStatuses() shows crashed after non-zero exit', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  spawnCalls[0].mock.exit(1);
  const s = pm.getStatuses('sai', processConfigs);
  expect(s.find(p => p.name === 'api').status).toBe('crashed');
});

test('subscribe() receives output events', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  const events = [];
  pm.subscribe('sai', 'api', e => events.push(e));
  spawnCalls[0].mock.emit('hello\n');
  expect(events).toHaveLength(1);
  expect(events[0]).toEqual({ type: 'output', data: 'hello\n' });
});

test('subscribe() receives status events on exit', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  const events = [];
  pm.subscribe('sai', 'api', e => events.push(e));
  spawnCalls[0].mock.exit(0);
  expect(events.some(e => e.type === 'status' && e.status === 'stopped')).toBe(true);
});

test('unsubscribe() stops receiving events', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  const events = [];
  const cb = e => events.push(e);
  pm.subscribe('sai', 'api', cb);
  pm.unsubscribe('sai', 'api', cb);
  spawnCalls[0].mock.emit('hello\n');
  expect(events).toHaveLength(0);
});

test('getBuffer() returns buffered output lines', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  spawnCalls[0].mock.emit('line one\nline two\n');
  const buf = pm.getBuffer('sai', 'api');
  expect(buf.join(' ')).toContain('line');
});

test('restart() respawns the process', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  pm.restart('sai', 'api', processConfigs, allocations, '/projects/sai');
  expect(spawnCalls).toHaveLength(3);
  expect(pm.isRunning('sai', 'api')).toBe(true);
});

test('killAll() stops every process across all projects', async () => {
  await pm.up('sai',    processConfigs, allocations, '/projects/sai');
  await pm.up('cleome', processConfigs, allocations, '/projects/cleome');
  pm.killAll();
  expect(pm.isRunning('sai',    'api')).toBe(false);
  expect(pm.isRunning('cleome', 'api')).toBe(false);
});

test('down() emits stopped status event to subscribers', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  const events = [];
  pm.subscribe('sai', 'api', e => events.push(e));
  pm.down('sai');
  expect(events.some(e => e.type === 'status' && e.status === 'stopped')).toBe(true);
});

test('killAll() cleans up listeners so no further events are emitted', async () => {
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  pm.killAll();
  const events = [];
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  pm.subscribe('sai', 'api', e => events.push(e));
  spawnCalls[2].mock.emit('hello\n');
  expect(events).toHaveLength(1);
});

test('envFile vars are injected into the spawned process env', async () => {
  const envFilePath = path.join(os.tmpdir(), `forge-envfile-test-${Date.now()}.env`);
  fs.writeFileSync(envFilePath, 'SECRET_KEY=abc123\nOTHER=xyz\n');
  const configs = [{ name: 'api', command: 'npm start', cwd: '.', ports: [], envFile: envFilePath }];
  await pm.up('sai', configs, {}, '/projects/sai');
  expect(spawnCalls[0].env.SECRET_KEY).toBe('abc123');
  expect(spawnCalls[0].env.OTHER).toBe('xyz');
  fs.unlinkSync(envFilePath);
});

test('envFile vars override proc.env when the same key appears in both', async () => {
  const envFilePath = path.join(os.tmpdir(), `forge-envfile-test-${Date.now()}.env`);
  fs.writeFileSync(envFilePath, 'KEY=from_file\n');
  const configs = [{ name: 'api', command: 'npm start', cwd: '.', ports: [], env: { KEY: 'from_config' }, envFile: envFilePath }];
  await pm.up('sai', configs, {}, '/projects/sai');
  expect(spawnCalls[0].env.KEY).toBe('from_file');
  fs.unlinkSync(envFilePath);
});

test('missing envFile is silently skipped — process still spawns', async () => {
  const configs = [{ name: 'api', command: 'npm start', cwd: '.', ports: [], envFile: '/nonexistent/path.env' }];
  await expect(pm.up('sai', configs, {}, '/projects/sai')).resolves.not.toThrow();
  expect(spawnCalls).toHaveLength(1);
});

test('missing envFile does not inject any extra vars', async () => {
  const configs = [{ name: 'api', command: 'npm start', cwd: '.', ports: [], envFile: '/nonexistent/path.env' }];
  await pm.up('sai', configs, {}, '/projects/sai');
  expect(Object.keys(spawnCalls[0].env)).toHaveLength(0);
});

test('envFile path is resolved relative to projectPath', async () => {
  const projectPath = os.tmpdir();
  const relPath = `forge-envfile-rel-${Date.now()}.env`;
  const absPath = path.join(projectPath, relPath);
  fs.writeFileSync(absPath, 'REL_VAR=resolved\n');
  const configs = [{ name: 'api', command: 'npm start', cwd: '.', ports: [], envFile: relPath }];
  await pm.up('sai', configs, {}, projectPath);
  expect(spawnCalls[0].env.REL_VAR).toBe('resolved');
  fs.unlinkSync(absPath);
});
```

- [ ] **Step 2: Run existing tests to confirm they still pass with the current implementation**

```bash
npx jest --testPathPattern "test/process-manager" --no-coverage
```

Expected: all existing tests pass (the async/await addition is backward-compatible since `up()` currently returns undefined, which is also what `await undefined` resolves to).

- [ ] **Step 3: Write 8 new failing tests for ordering, readiness, and error cases**

Append to `test/process-manager.test.js`:

```js
// ── dependsOn ordering and readiness ─────────────────────────────────────────

test('up() starts processes in dependency order', async () => {
  const order = [];
  const pm2 = createProcessManager({
    ptySpawn: (command) => {
      order.push(command);
      return makeMockPty();
    },
  });
  const configs = [
    { name: 'api', command: 'api' },
    { name: 'app', command: 'app', dependsOn: ['api'] },
  ];
  await pm2.up('sai', configs, {}, '/projects/sai');
  expect(order).toEqual(['api', 'app']);
});

test('up() awaits waitFor.port before starting dependent', async () => {
  const order = [];
  let resolvePoll;
  const pollPort = jest.fn().mockReturnValue(new Promise(r => { resolvePoll = r; }));
  const pm2 = createProcessManager({
    ptySpawn: (command) => { order.push(command); return makeMockPty(); },
    pollPort,
  });
  const configs = [
    { name: 'api', command: 'api', waitFor: { port: true, timeoutSeconds: 5 } },
    { name: 'app', command: 'app', dependsOn: ['api'] },
  ];
  const upPromise = pm2.up('sai', configs, { ports: { api: 3000 } }, '/projects/sai');
  // Flush microtasks so wave 0 (api) spawns
  await Promise.resolve();
  expect(order).toEqual(['api']);
  resolvePoll(true);
  await upPromise;
  expect(order).toEqual(['api', 'app']);
});

test('up() awaits waitFor.exit before starting dependent', async () => {
  const order = [];
  let resolveExit;
  const waitForExit = jest.fn().mockReturnValue(new Promise(r => { resolveExit = r; }));
  const pm2 = createProcessManager({
    ptySpawn: (command) => { order.push(command); return makeMockPty(); },
    waitForExit,
  });
  const configs = [
    { name: 'migrate', command: 'migrate', waitFor: { exit: true, timeoutSeconds: 30 } },
    { name: 'api',     command: 'api',     dependsOn: ['migrate'] },
  ];
  const upPromise = pm2.up('sai', configs, {}, '/projects/sai');
  await Promise.resolve();
  expect(order).toEqual(['migrate']);
  resolveExit(true);
  await upPromise;
  expect(order).toEqual(['migrate', 'api']);
});

test('up() emits warning to buffer and continues when waitFor.port times out', async () => {
  const pollPort = jest.fn().mockResolvedValue(false);
  const order = [];
  const pm2 = createProcessManager({
    ptySpawn: (command) => { order.push(command); return makeMockPty(); },
    pollPort,
  });
  const configs = [
    { name: 'api', command: 'api', waitFor: { port: true, timeoutSeconds: 5 } },
    { name: 'app', command: 'app', dependsOn: ['api'] },
  ];
  await pm2.up('sai', configs, { ports: { api: 3000 } }, '/projects/sai');
  // app still starts despite api not becoming ready
  expect(order).toEqual(['api', 'app']);
  const buf = pm2.getBuffer('sai', 'api', 20);
  expect(buf.join('\n')).toContain('[forge] Warning');
  expect(buf.join('\n')).toContain('api');
});

test('up() emits warning and continues when waitFor.exit process crashes', async () => {
  const waitForExit = jest.fn().mockResolvedValue(false);
  const order = [];
  const pm2 = createProcessManager({
    ptySpawn: (command) => { order.push(command); return makeMockPty(); },
    waitForExit,
  });
  const configs = [
    { name: 'migrate', command: 'migrate', waitFor: { exit: true, timeoutSeconds: 30 } },
    { name: 'api',     command: 'api',     dependsOn: ['migrate'] },
  ];
  await pm2.up('sai', configs, {}, '/projects/sai');
  expect(order).toEqual(['migrate', 'api']);
  const buf = pm2.getBuffer('sai', 'migrate', 20);
  expect(buf.join('\n')).toContain('[forge] Warning');
});

test('startProcess() auto-starts transitive dependencies first', async () => {
  const order = [];
  const pm2 = createProcessManager({
    ptySpawn: (command) => { order.push(command); return makeMockPty(); },
  });
  const configs = [
    { name: 'migrate', command: 'migrate' },
    { name: 'api',     command: 'api',     dependsOn: ['migrate'] },
    { name: 'app',     command: 'app',     dependsOn: ['api'] },
  ];
  await pm2.startProcess('sai', 'app', configs, {}, '/projects/sai');
  expect(order[0]).toBe('migrate');
  expect(order[1]).toBe('api');
  expect(order[2]).toBe('app');
});

test('up() throws on cycle in dependsOn', async () => {
  const pm2 = createProcessManager({ ptySpawn: () => makeMockPty() });
  const configs = [
    { name: 'a', command: 'a', dependsOn: ['b'] },
    { name: 'b', command: 'b', dependsOn: ['a'] },
  ];
  await expect(pm2.up('sai', configs, {}, '/projects/sai')).rejects.toThrow('Cycle detected');
});

test('startProcess() does not re-spawn already-running dependency', async () => {
  const pm2 = createProcessManager({
    ptySpawn: (command) => {
      spawnCalls.push({ command, mock: makeMockPty() });
      return spawnCalls[spawnCalls.length - 1].mock;
    },
  });
  const configs = [
    { name: 'api', command: 'api' },
    { name: 'app', command: 'app', dependsOn: ['api'] },
  ];
  // Start api standalone first
  await pm2.startProcess('sai', 'api', configs, {}, '/projects/sai');
  const countBefore = spawnCalls.length;
  // Now start app — api should not re-spawn
  await pm2.startProcess('sai', 'app', configs, {}, '/projects/sai');
  const newCommands = spawnCalls.slice(countBefore).map(c => c.command);
  expect(newCommands).not.toContain('api');
  expect(newCommands).toContain('app');
});
```

- [ ] **Step 4: Run new tests to confirm they fail**

```bash
npx jest --testPathPattern "test/process-manager" --no-coverage
```

Expected: 8 new failures — the ordering and injection logic does not exist yet.

- [ ] **Step 5: Replace `src/daemon/process-manager.js` with the full updated implementation**

Write the complete file:

```js
// src/daemon/process-manager.js
const path = require('path');
const net = require('net');
const { parseEnvFile } = require('../parse-env-file');
const { buildStartOrder } = require('./dependency-resolver');

const MAX_BUFFER = 200;

function defaultPollPort(port, timeoutMs) {
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      if (Date.now() >= deadline) return resolve(false);
      const socket = net.createConnection({ port, host: 'localhost' });
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => {
        socket.destroy();
        const remaining = deadline - Date.now();
        if (remaining <= 0) return resolve(false);
        setTimeout(attempt, Math.min(250, remaining));
      });
    }
    attempt();
  });
}

function defaultWaitForExit(ptyProc, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(false); }
    }, timeoutMs);
    ptyProc.onExit(({ exitCode }) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(exitCode === 0);
      }
    });
  });
}

function createProcessManager({ ptySpawn, pollPort, waitForExit } = {}) {
  const spawnFn = ptySpawn ?? function(command, env, cwd) {
    const pty = require('node-pty'); // lazy — not loaded in tests that inject ptySpawn
    const shell = process.env.SHELL || '/bin/zsh';
    return pty.spawn(shell, ['-c', command], {
      name: 'xterm-256color', cols: 120, rows: 30,
      cwd, env: { ...process.env, TERM: 'xterm-256color', ...env },
    });
  };
  const pollPortFn  = pollPort    ?? defaultPollPort;
  const waitForExitFn = waitForExit ?? defaultWaitForExit;

  // "project:process" → { status, startedAt, buffer, pid, ptyProcess }
  const processes = new Map();
  // "project:process" → Set<(event) => void>
  const listeners = new Map();

  const key = (proj, proc) => `${proj}:${proc}`;

  function emit(k, event) {
    for (const cb of (listeners.get(k) ?? [])) { try { cb(event); } catch {} }
  }

  function appendToBuffer(buffer, data) {
    const lines = data.split(/\r?\n/);
    if (buffer.length > 0 && lines.length > 0) buffer[buffer.length - 1] += lines.shift();
    buffer.push(...lines);
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  }

  async function startOne(projectName, proc, allocations, projectPath, servicesConfig) {
    const k = key(projectName, proc.name);
    if (processes.get(k)?.status === 'running') return;

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

    const cwd = path.resolve(projectPath, proc.cwd ?? '.');
    const record = { status: 'running', startedAt: Date.now(), buffer: [], pid: null, ptyProcess: null };
    processes.set(k, record);

    let ptyProc;
    try {
      ptyProc = spawnFn(proc.command, env, cwd);
    } catch (err) {
      record.status = 'crashed';
      record.startedAt = null;
      emit(k, { type: 'status', status: 'crashed' });
      emit(k, { type: 'output', data: `\r\n\x1b[31mFailed to start: ${err.message}\x1b[0m\r\n` });
      return;
    }

    record.pid = ptyProc.pid;
    record.ptyProcess = ptyProc;
    emit(k, { type: 'status', status: 'running' });

    ptyProc.onData((data) => {
      appendToBuffer(record.buffer, data);
      emit(k, { type: 'output', data });
    });

    ptyProc.onExit(({ exitCode }) => {
      const current = processes.get(k);
      if (!current || current.ptyProcess !== ptyProc) return;
      const status = exitCode === 0 ? 'stopped' : 'crashed';
      current.status = status;
      current.startedAt = null;
      current.ptyProcess = null;
      emit(k, { type: 'status', status });
    });

    if (proc.waitFor?.port) {
      const timeoutMs = (proc.waitFor.timeoutSeconds ?? 30) * 1000;
      if (port == null) {
        const msg = `[forge] Warning: "${proc.name}" has waitFor.port but no allocated port — treating as ready\r\n`;
        appendToBuffer(record.buffer, msg);
        emit(k, { type: 'output', data: msg });
      } else {
        const ready = await pollPortFn(port, timeoutMs);
        if (!ready) {
          const msg = `[forge] Warning: "${proc.name}" did not become ready within ${proc.waitFor.timeoutSeconds ?? 30}s — starting dependents anyway\r\n`;
          appendToBuffer(record.buffer, msg);
          emit(k, { type: 'output', data: msg });
        }
      }
    } else if (proc.waitFor?.exit) {
      const timeoutMs = (proc.waitFor.timeoutSeconds ?? 30) * 1000;
      const ready = await waitForExitFn(ptyProc, timeoutMs);
      if (!ready) {
        const msg = `[forge] Warning: "${proc.name}" did not complete successfully within ${proc.waitFor.timeoutSeconds ?? 30}s — starting dependents anyway\r\n`;
        appendToBuffer(record.buffer, msg);
        emit(k, { type: 'output', data: msg });
      }
    }
  }

  function killOne(projectName, processName) {
    const k = key(projectName, processName);
    const record = processes.get(k);
    if (record?.ptyProcess) { try { record.ptyProcess.kill(); } catch {} }
    emit(k, { type: 'status', status: 'stopped' });
    processes.delete(k);
  }

  return {
    async up(projectName, processConfigs, allocations, projectPath, servicesConfig) {
      const waves = buildStartOrder(processConfigs ?? []);
      for (const wave of waves) {
        await Promise.all(wave.map(proc =>
          startOne(projectName, proc, allocations ?? {}, projectPath, servicesConfig ?? {})
        ));
      }
    },

    down(projectName) {
      for (const k of [...processes.keys()]) {
        if (k.startsWith(`${projectName}:`)) {
          killOne(projectName, k.slice(projectName.length + 1));
        }
      }
    },

    async startProcess(projectName, processName, processConfigs, allocations, projectPath, servicesConfig) {
      const all = processConfigs ?? [];
      const proc = all.find(p => p.name === processName);
      if (!proc) return;

      const byName = new Map(all.map(p => [p.name, p]));
      const ancestors = new Set();
      function collectAncestors(name) {
        for (const dep of byName.get(name)?.dependsOn ?? []) {
          if (!ancestors.has(dep)) {
            ancestors.add(dep);
            collectAncestors(dep);
          }
        }
      }
      collectAncestors(processName);

      if (ancestors.size > 0) {
        const ancestorConfigs = all.filter(p => ancestors.has(p.name));
        const depWaves = buildStartOrder(ancestorConfigs);
        for (const wave of depWaves) {
          await Promise.all(wave.map(p =>
            startOne(projectName, p, allocations ?? {}, projectPath, servicesConfig ?? {})
          ));
        }
      }

      await startOne(projectName, proc, allocations ?? {}, projectPath, servicesConfig ?? {});
    },

    stopProcess(projectName, processName) {
      killOne(projectName, processName);
    },

    restart(projectName, processName, processConfigs, allocations, projectPath, servicesConfig) {
      killOne(projectName, processName);
      const proc = (processConfigs ?? []).find(p => p.name === processName);
      if (proc) startOne(projectName, proc, allocations ?? {}, projectPath, servicesConfig ?? {});
    },

    getStatuses(projectName, processConfigs) {
      return (processConfigs ?? []).map(proc => {
        const record = processes.get(key(projectName, proc.name));
        return {
          name: proc.name,
          status: record?.status ?? 'stopped',
          pid: record?.pid ?? null,
          uptime: record?.startedAt ? Math.floor((Date.now() - record.startedAt) / 1000) : 0,
        };
      });
    },

    isRunning(projectName, processName) {
      return processes.get(key(projectName, processName))?.status === 'running';
    },

    getBuffer(projectName, processName, lines = 50) {
      return (processes.get(key(projectName, processName))?.buffer ?? []).slice(-lines);
    },

    subscribe(projectName, processName, callback) {
      const k = key(projectName, processName);
      if (!listeners.has(k)) listeners.set(k, new Set());
      listeners.get(k).add(callback);
    },

    unsubscribe(projectName, processName, callback) {
      listeners.get(key(projectName, processName))?.delete(callback);
    },

    sendInput(projectName, processName, data) {
      processes.get(key(projectName, processName))?.ptyProcess?.write(data);
    },

    resize(projectName, processName, cols, rows) {
      processes.get(key(projectName, processName))?.ptyProcess?.resize(cols, rows);
    },

    killAll() {
      for (const [, record] of processes) {
        if (record?.ptyProcess) { try { record.ptyProcess.kill(); } catch {} }
      }
      processes.clear();
    },
  };
}

module.exports = { createProcessManager };
```

- [ ] **Step 6: Run all process-manager tests to confirm they all pass**

```bash
npx jest --testPathPattern "test/process-manager" --no-coverage
```

Expected: all tests pass (existing + 8 new).

- [ ] **Step 7: Commit**

```bash
git add src/daemon/process-manager.js test/process-manager.test.js
git commit -m "feat: async startOne with dependsOn wave ordering and readiness polling"
```

---

## Task 3: `processes.js` API — await + error handling

**Files:**
- Modify: `src/daemon/api/processes.js`
- Modify: `test/api/processes.test.js`

`processManager.up()` and `processManager.startProcess()` are now async. The API handlers must await them and surface errors (e.g., cycle detection) as 500 responses.

- [ ] **Step 1: Write a failing test for the 500 response on cycle**

In `test/api/processes.test.js`, add after the existing imports at the top and after the existing tests at the bottom:

At the top, the existing `makeMockProcessManager()` already has `up: jest.fn()`. We need a version where `up` rejects. Add this new helper and test at the bottom of the file:

```js
test('POST up returns 500 when processManager.up throws', async () => {
  const { app, cleanup } = setup();
  // Override up on the processManager to reject
  const { processManager } = setup();
  // Create a fresh setup with a throwing up()
  const tmpPath2 = path.join(os.tmpdir(), `forge-proc-err-${Date.now()}.json`);
  const registry2 = createRegistry(tmpPath2);
  registry2.add('sai', {
    path: '/projects/sai',
    config: {
      name: 'sai',
      envFile: false,
      processes: [{ name: 'api', command: 'npm start', cwd: '.', ports: [3000], portEnv: 'PORT' }],
      services: {},
    },
    allocations: { ports: { api: 3000 }, services: {} },
  });
  const throwingPM = {
    ...makeMockProcessManager(),
    up: jest.fn().mockRejectedValue(new Error('Cycle detected in dependsOn: a → b → a')),
  };
  const { createPortAllocator } = require('../../src/daemon/port-allocator');
  const { createServiceManager } = require('../../src/daemon/services/manager');
  const { app: app2 } = createServer({
    registry: registry2,
    portAllocator: createPortAllocator(),
    serviceManager: createServiceManager([]),
    processManager: throwingPM,
  });
  const res = await request(app2).post('/api/projects/sai/processes/up');
  expect(res.status).toBe(500);
  expect(res.body.error).toMatch(/Cycle detected/);
  fs.existsSync(tmpPath2) && fs.unlinkSync(tmpPath2);
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx jest --testPathPattern "test/api/processes" --no-coverage
```

Expected: 1 new failure — the route does not await `up()` and does not return 500 on rejection.

- [ ] **Step 3: Update `src/daemon/api/processes.js`**

In the `router.post('/up', ...)` handler, replace the final two lines:

```js
// Remove:
processManager.up(req.params.name, project.config?.processes ?? [], allocations, project.path, project.config?.services ?? {});
res.json({ ok: true, project: req.params.name, allocations });
```

Replace with:

```js
try {
  await processManager.up(req.params.name, project.config?.processes ?? [], allocations, project.path, project.config?.services ?? {});
} catch (err) {
  return res.status(500).json({ error: err.message });
}
res.json({ ok: true, project: req.params.name, allocations });
```

Also make the handler `async` — change the handler signature from:
```js
router.post('/up', async (req, res) => {
```
(it is already async — verify this is the case; if not, add `async`).

In the `router.post('/:processName/up', ...)` handler, replace:

```js
router.post('/:processName/up', (req, res) => {
  const project = registry.get(req.params.name);
  if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
  processManager.startProcess(
    req.params.name, req.params.processName,
    project.config?.processes ?? [], project.allocations ?? {}, project.path, project.config?.services ?? {}
  );
  res.json({ ok: true, project: req.params.name, process: req.params.processName });
});
```

With:

```js
router.post('/:processName/up', async (req, res) => {
  const project = registry.get(req.params.name);
  if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
  try {
    await processManager.startProcess(
      req.params.name, req.params.processName,
      project.config?.processes ?? [], project.allocations ?? {}, project.path, project.config?.services ?? {}
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  res.json({ ok: true, project: req.params.name, process: req.params.processName });
});
```

- [ ] **Step 4: Run all process API tests**

```bash
npx jest --testPathPattern "test/api/processes" --no-coverage
```

Expected: all pass.

- [ ] **Step 5: Run the full test suite to confirm nothing is broken**

```bash
npx jest --no-coverage
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/api/processes.js test/api/processes.test.js
git commit -m "feat: await processManager.up/startProcess in API; return 500 on cycle error"
```

---

## Task 4: README — document `dependsOn` and `waitFor`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the process fields table**

Find the process fields table in the config reference section. It currently ends after `env`. Add two new rows:

```markdown
| `dependsOn` | array | Names of processes that must be ready before this one starts. Processes are started in topological order — a cycle throws an error. |
| `waitFor` | object | Readiness condition used by dependent processes. `{ "port": true }` polls TCP on this process's allocated port. `{ "exit": true }` waits for exit code 0. Add `"timeoutSeconds": N` to override the 30-second default. Omit for immediate readiness (current default). |
```

- [ ] **Step 2: Replace the "Future" section with the implemented description**

Find and replace the entire section:

```markdown
## Future: `dependsOn` startup ordering

Currently all processes in a project start in parallel (config-array order, no readiness gating). For most setups this is fine: `.env.forge` is written with validated port values before any process spawns, so a Vite dev server reading `BACKEND_PORT` at startup gets the correct number even if the backend hasn't finished binding yet.

However, some scenarios genuinely require one process to be **ready** before another starts:

- A database migration runner that must complete before the API accepts traffic
- A code-generation step whose output a subsequent build step reads
- A process that reads a sibling's port from its **network response** rather than an env var (requires the sibling to be listening)

A future `dependsOn` field on process configs would address these cases:

```json
{
  "name": "app",
  "command": "yarn dev",
  "dependsOn": ["api"],
  "waitFor": { "port": "API_PORT", "timeoutSeconds": 30 }
}
```

With this, forge would start `api` first, poll until its port is accepting TCP connections, then start `app`. Without it, callers must either tolerate startup races or sequence `forge up` calls manually (`forge up api && forge up app`).
```

Replace with:

```markdown
## Process startup ordering with `dependsOn`

By default all processes in a project start in parallel. For most setups this is fine: `.env.forge` is written with correct port values before any process spawns. When you need stricter ordering, use `dependsOn` and `waitFor`:

```json
{
  "processes": [
    {
      "name": "migrate",
      "command": "node migrate.js",
      "waitFor": { "exit": true, "timeoutSeconds": 60 }
    },
    {
      "name": "api",
      "command": "node server.js",
      "ports": [3000],
      "portEnv": "PORT",
      "dependsOn": ["migrate"],
      "waitFor": { "port": true, "timeoutSeconds": 30 }
    },
    {
      "name": "app",
      "command": "yarn dev",
      "dependsOn": ["api"]
    }
  ]
}
```

`waitFor` lives on the **dependency** (the process being waited on) and describes when it is considered ready:

- `{ "port": true }` — polls TCP on this process's own allocated port until it accepts connections
- `{ "exit": true }` — waits for the process to exit with code 0
- `"timeoutSeconds"` — how long to wait before warning and proceeding (default 30)

`dependsOn` is a list of process names that must be ready before this process starts. A cycle in the dependency graph is an error — forge refuses to start and prints the cycle path.

`forge up <name>` also respects `dependsOn`: it starts all transitive dependencies first.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document dependsOn and waitFor in config reference"
```

---

## Self-Review

**Spec coverage check:**
- Config schema (`dependsOn`, `waitFor.port`, `waitFor.exit`, `timeoutSeconds`) → Task 4 (docs) + Task 2 (impl) ✓
- `dependency-resolver.js` with cycle detection and topological sort → Task 1 ✓
- `startOne` async with `pollPort`/`waitForExit` helpers → Task 2 ✓
- Wave-based `up()` → Task 2 ✓
- Ancestor-resolving `startProcess()` → Task 2 ✓
- Readiness failure warns + continues → Task 2 (impl + tests) ✓
- `waitFor.port` with no allocated port warns + continues → Task 2 ✓
- Already-running dep not re-spawned → Task 2 (test) ✓
- API returns 500 on cycle → Task 3 ✓
- README update → Task 4 ✓

**Placeholder scan:** No TBDs or incomplete steps.

**Type consistency:**
- `buildStartOrder(processConfigs)` — defined in Task 1, imported in Task 2 ✓
- `pollPort(port, timeoutMs)` / `waitForExit(ptyProc, timeoutMs)` — defined and used within Task 2 ✓
- `startProcess` signature unchanged: `(projectName, processName, processConfigs, allocations, projectPath, servicesConfig)` — Task 2 impl matches Task 3 API call ✓
- `up` signature unchanged: `(projectName, processConfigs, allocations, projectPath, servicesConfig)` — Task 2 impl matches Task 3 API call ✓
