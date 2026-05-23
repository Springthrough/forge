# Service Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `forge services up/down` for standalone service control, prevent auto-stop on project down, and allow `forge service configure mongo --replica-set` to override the default built-in mongo instance.

**Architecture:** Five tasks in dependency order — service manager methods first, then API routes, then CLI wiring, then built-in override support. All new behaviour is test-driven. Tests use mock drivers (no Docker required).

**Tech Stack:** Node.js, Express, Jest, Supertest, Commander.js

---

## File Map

| File | What changes |
|------|-------------|
| `src/daemon/services/manager.js` | Add `startByName`, `stopByName`; remove `stopUnused` |
| `src/daemon/api/processes.js` | Remove `stopUnused` call from project down handler |
| `src/daemon/api/services.js` | Remove active-project filter from `GET /`; add 4 up/down routes; PATCH becomes upsert for built-in keys |
| `src/daemon/server.js` | Pass `processManager` to `createServicesRoutes`; extract + export `buildDriverList`; handle built-in overrides |
| `src/cli/client.js` | Add `startServices(name?)`, `stopServices(name?)` |
| `src/cli/commands/services.js` | Add `up [name]` and `down [name]` subcommands |
| `src/cli/commands/service.js` | Make `[name]` optional in `configure`; key = type when name absent |
| `test/services/manager.test.js` | Add stop to mock driver; add 4 tests for `startByName`/`stopByName` |
| `test/api/processes.test.js` | Add regression test: project down does not stop services |
| `test/api/services.test.js` | Add processManager support to helper; add 7 tests for up/down routes; add upsert test |
| `test/api/server.test.js` | New file; unit tests for `buildDriverList` |

---

## Task 1: Service manager `startByName` / `stopByName`

**Files:**
- Modify: `test/services/manager.test.js`
- Modify: `src/daemon/services/manager.js`

- [ ] **Step 1: Add `stop` to `makeMockDriver` in manager.test.js**

The current mock is missing `stop`. Add it so `stopByName` tests can spy on it.

```js
// In test/services/manager.test.js — update makeMockDriver
function makeMockDriver(name, healthy = true) {
  return {
    name,
    containerName: `forge-${name}`,
    image: `${name}:latest`,
    port: 9999,
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    healthCheck: jest.fn().mockResolvedValue(healthy),
    provision: jest.fn().mockResolvedValue(undefined),
    connectionString: jest.fn().mockReturnValue(`${name}://localhost/testdb`),
    deprovision: jest.fn().mockResolvedValue(undefined),
    restoreFromRegistry: jest.fn(),
  };
}
```

- [ ] **Step 2: Write 4 failing tests**

Append to `test/services/manager.test.js`:

```js
test('startByName starts the named driver', async () => {
  const mongo = makeMockDriver('mongo');
  const manager = createServiceManager([mongo]);
  await manager.startByName('mongo');
  expect(mongo.start).toHaveBeenCalledTimes(1);
});

test('startByName throws for unknown driver name', async () => {
  const manager = createServiceManager([]);
  await expect(manager.startByName('mongo')).rejects.toThrow('No driver for service "mongo"');
});

test('stopByName stops the named driver', async () => {
  const mongo = makeMockDriver('mongo');
  const manager = createServiceManager([mongo]);
  await manager.startByName('mongo');
  await manager.stopByName('mongo');
  expect(mongo.stop).toHaveBeenCalledTimes(1);
});

test('stopByName throws for unknown driver name', async () => {
  const manager = createServiceManager([]);
  await expect(manager.stopByName('mongo')).rejects.toThrow('No driver for service "mongo"');
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx jest --testPathPattern manager --no-coverage
```

Expected: 4 failures — `startByName is not a function`, `stopByName is not a function`.

- [ ] **Step 4: Implement `startByName` and `stopByName` in manager.js**

In `src/daemon/services/manager.js`, add two methods to the returned object (after `getStatus`):

```js
async startByName(name) {
  const driver = byName.get(name);
  if (!driver) throw new Error(`No driver for service "${name}"`);
  await ensureStarted(driver);
},

async stopByName(name) {
  const driver = byName.get(name);
  if (!driver) throw new Error(`No driver for service "${name}"`);
  await driver.stop();
  started.delete(name);
},
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx jest --testPathPattern manager --no-coverage
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/services/manager.js test/services/manager.test.js
git commit -m "feat: add startByName and stopByName to service manager"
```

---

## Task 2: Remove auto-stop on project down + fix `GET /api/services`

**Files:**
- Modify: `test/api/processes.test.js`
- Modify: `src/daemon/api/processes.js`
- Modify: `src/daemon/services/manager.js`
- Modify: `src/daemon/api/services.js`

The existing test `GET /api/services returns health status for each driver` in `test/api/services.test.js` is currently **failing** because `GET /` filters results to services declared by registered projects (no projects = empty result). Removing the filter will fix it as a side effect of this task.

- [ ] **Step 1: Write a failing regression test in processes.test.js**

This test verifies that bringing a project down does NOT stop shared services.

Add after the existing imports in `test/api/processes.test.js`:

```js
const { createServiceManager } = require('../../src/daemon/services/manager');
```

Then append at the bottom of the file:

```js
test('POST down does not stop shared services', async () => {
  const tmpPath2 = path.join(os.tmpdir(), `forge-proc-nosvc-${Date.now()}.json`);
  const reg2 = createRegistry(tmpPath2);
  const mongoDriver = {
    name: 'mongo',
    containerName: 'forge-mongo',
    port: 27017,
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    healthCheck: jest.fn().mockResolvedValue(true),
    provision: jest.fn().mockResolvedValue(undefined),
    connectionString: jest.fn().mockReturnValue('mongodb://localhost/test'),
    deprovision: jest.fn().mockResolvedValue(undefined),
    restoreFromRegistry: jest.fn(),
  };
  const svcMgr2 = createServiceManager([mongoDriver]);
  reg2.add('sai', {
    path: '/projects/sai',
    config: { name: 'sai', processes: [], services: { mongo: { db: 'sai' } } },
    allocations: { ports: {}, services: { mongo: 'mongodb://localhost/sai' } },
  });
  const { app: app2 } = createServer({
    registry: reg2,
    portAllocator: createPortAllocator(),
    serviceManager: svcMgr2,
    processManager: makeMockProcessManager(),
  });
  await request(app2).post('/api/projects/sai/processes/down').expect(200);
  expect(mongoDriver.stop).not.toHaveBeenCalled();
  fs.unlinkSync(tmpPath2);
});
```

- [ ] **Step 2: Run tests to confirm regression test fails**

```bash
npx jest --testPathPattern processes --no-coverage
```

Expected: 1 new failure — `stop` called when it should not be (because `stopUnused` currently invokes it).

Actually: the `stopUnused` call in processes.js checks for other projects using the service. With only one project in this test and no "other" projects, `stillNeeded` is false, so `driver.stop()` IS called. The test will fail as expected.

- [ ] **Step 3: Remove `stopUnused` call from `src/daemon/api/processes.js`**

Find the `router.post('/down', ...)` handler. Remove the `stopUnused` block entirely:

```js
// Before — remove these lines:
try {
  await serviceManager.stopUnused(project.config?.services ?? {}, registry.getAll(), req.params.name);
} catch (err) {
  // Non-fatal — processes are already stopped
  console.error(`Failed to stop unused services: ${err.message}`);
}
```

The handler becomes:

```js
router.post('/down', async (req, res) => {
  const project = registry.get(req.params.name);
  if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
  processManager.down(req.params.name);
  res.json({ ok: true, project: req.params.name });
});
```

- [ ] **Step 4: Remove `stopUnused` from `src/daemon/services/manager.js`**

Delete the entire `stopUnused` method from the returned object — it is no longer called anywhere:

```js
// Remove this entire method:
async stopUnused(servicesConfig, allProjects, excludeProjectName) {
  for (const serviceName of Object.keys(servicesConfig ?? {})) {
    const driver = byName.get(serviceName);
    if (!driver) continue;
    const stillNeeded = Object.entries(allProjects).some(
      ([name, project]) => name !== excludeProjectName && project.config?.services?.[serviceName]
    );
    if (!stillNeeded) {
      await driver.stop();
      started.delete(serviceName);
    }
  }
},
```

- [ ] **Step 5: Fix `GET /` filter in `src/daemon/api/services.js`**

Replace the current filtered `GET /` handler:

```js
// Remove:
router.get('/', async (_req, res) => {
  const projects = Object.values(registry.getAll());
  const active = new Set(
    projects.flatMap(p => Object.keys(p.config?.services ?? {}))
  );
  const all = await serviceManager.getStatus();
  res.json(all.filter(s => active.has(s.name)));
});

// Replace with:
router.get('/', async (_req, res) => {
  const all = await serviceManager.getStatus();
  res.json(all);
});
```

- [ ] **Step 6: Run tests to confirm all pass**

```bash
npx jest --testPathPattern "processes|services" --no-coverage
```

Expected: all pass — regression test now passes (stop not called), and the previously failing `GET /api/services returns health status for each driver` now passes too.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/api/processes.js src/daemon/services/manager.js src/daemon/api/services.js test/api/processes.test.js
git commit -m "feat: services persist through project down; GET /services shows all"
```

---

## Task 3: Services up/down API routes

**Files:**
- Modify: `test/api/services.test.js`
- Modify: `src/daemon/api/services.js`
- Modify: `src/daemon/server.js`

- [ ] **Step 1: Add processManager support to test helper + add `stop` to mock driver**

In `test/api/services.test.js`, update `makeMockDriver` to include `stop`, add a mock process manager helper, and add a new `tmpServerFull` helper:

```js
// Update makeMockDriver — add stop:
function makeMockDriver(name, healthy) {
  return {
    name,
    containerName: `forge-${name}`,
    image: `${name}:latest`,
    port: 9999,
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    healthCheck: jest.fn().mockResolvedValue(healthy),
    provision: jest.fn().mockResolvedValue(undefined),
    connectionString: jest.fn().mockReturnValue(`${name}://localhost/db`),
    deprovision: jest.fn().mockResolvedValue(undefined),
    restoreFromRegistry: jest.fn(),
  };
}

// Add after tmpServerWithStore:
function makeMockProcessManager(runningProjects = new Set()) {
  return {
    getStatuses: jest.fn((projectName, processes) =>
      processes.map(p => ({
        name: p.name,
        status: runningProjects.has(projectName) ? 'running' : 'stopped',
        pid: null,
        uptime: 0,
      }))
    ),
    up: jest.fn(), down: jest.fn(), restart: jest.fn(),
    isRunning: jest.fn(() => false), getBuffer: jest.fn(() => []),
    subscribe: jest.fn(), unsubscribe: jest.fn(),
    sendInput: jest.fn(), resize: jest.fn(), killAll: jest.fn(),
    startProcess: jest.fn(), stopProcess: jest.fn(),
  };
}

function tmpServerWithPM(drivers, instanceData = {}, runningProjects = new Set()) {
  const regPath = path.join(os.tmpdir(), `forge-svc-pm-${Date.now()}-${Math.random()}.json`);
  const storePath = path.join(os.tmpdir(), `forge-store-pm-${Date.now()}-${Math.random()}.json`);
  const store = createInstanceStore(storePath);
  for (const [key, cfg] of Object.entries(instanceData)) store.set(key, cfg);
  const processManager = makeMockProcessManager(runningProjects);
  const { app } = createServer({
    registry: createRegistry(regPath),
    portAllocator: createPortAllocator(),
    serviceManager: createServiceManager(drivers),
    instanceStore: store,
    processManager,
  });
  return {
    app,
    cleanup: () => {
      if (fs.existsSync(regPath)) fs.unlinkSync(regPath);
      if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
    },
  };
}
```

- [ ] **Step 2: Write 7 failing tests for up/down routes**

Append to `test/api/services.test.js`:

```js
// ── services up/down routes ──────────────────────────────────────────────────

test('POST /api/services/up starts all drivers', async () => {
  const mongo = makeMockDriver('mongo', true);
  const redis = makeMockDriver('redis', true);
  const { app, cleanup } = tmpServerWithPM([mongo, redis]);
  const res = await request(app).post('/api/services/up');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.started).toEqual(expect.arrayContaining(['mongo', 'redis']));
  expect(mongo.start).toHaveBeenCalledTimes(1);
  expect(redis.start).toHaveBeenCalledTimes(1);
  cleanup();
});

test('POST /api/services/up/:name starts only the named driver', async () => {
  const mongo = makeMockDriver('mongo', true);
  const redis = makeMockDriver('redis', true);
  const { app, cleanup } = tmpServerWithPM([mongo, redis]);
  const res = await request(app).post('/api/services/up/mongo');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(mongo.start).toHaveBeenCalledTimes(1);
  expect(redis.start).not.toHaveBeenCalled();
  cleanup();
});

test('POST /api/services/up/:name returns 404 for unknown service', async () => {
  const { app, cleanup } = tmpServerWithPM([]);
  const res = await request(app).post('/api/services/up/unknown');
  expect(res.status).toBe(404);
  cleanup();
});

test('POST /api/services/down stops services not used by running projects', async () => {
  const mongo = makeMockDriver('mongo', true);
  const redis = makeMockDriver('redis', true);
  const { app, cleanup } = tmpServerWithPM([mongo, redis]);
  const res = await request(app).post('/api/services/down');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.stopped).toEqual(expect.arrayContaining(['mongo', 'redis']));
  expect(res.body.blocked).toEqual([]);
  expect(mongo.stop).toHaveBeenCalledTimes(1);
  expect(redis.stop).toHaveBeenCalledTimes(1);
  cleanup();
});

test('POST /api/services/down blocks services used by a running project', async () => {
  const mongo = makeMockDriver('mongo', true);
  const regPath = path.join(os.tmpdir(), `forge-svc-block-${Date.now()}.json`);
  const storePath = path.join(os.tmpdir(), `forge-store-block-${Date.now()}.json`);
  const store = createInstanceStore(storePath);
  const reg = createRegistry(regPath);
  reg.add('sai', {
    path: '/projects/sai',
    config: {
      name: 'sai',
      processes: [{ name: 'api', command: 'node server.js', cwd: '.', ports: [], portEnv: 'PORT' }],
      services: { mongo: { db: 'sai' } },
    },
    allocations: { ports: {}, services: {} },
  });
  const pm = makeMockProcessManager(new Set(['sai']));
  const { app } = createServer({
    registry: reg,
    portAllocator: createPortAllocator(),
    serviceManager: createServiceManager([mongo]),
    instanceStore: store,
    processManager: pm,
  });
  const res = await request(app).post('/api/services/down');
  expect(res.status).toBe(200);
  expect(res.body.blocked).toHaveLength(1);
  expect(res.body.blocked[0].name).toBe('mongo');
  expect(res.body.blocked[0].reason).toMatch(/sai/);
  expect(mongo.stop).not.toHaveBeenCalled();
  if (fs.existsSync(regPath)) fs.unlinkSync(regPath);
  if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
});

test('POST /api/services/down/:name stops a named service', async () => {
  const redis = makeMockDriver('redis', true);
  const { app, cleanup } = tmpServerWithPM([redis]);
  const res = await request(app).post('/api/services/down/redis');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(redis.stop).toHaveBeenCalledTimes(1);
  cleanup();
});

test('POST /api/services/down/:name returns 409 when a running project needs it', async () => {
  const mongo = makeMockDriver('mongo', true);
  const regPath = path.join(os.tmpdir(), `forge-svc-409-${Date.now()}.json`);
  const storePath = path.join(os.tmpdir(), `forge-store-409-${Date.now()}.json`);
  const store = createInstanceStore(storePath);
  const reg = createRegistry(regPath);
  reg.add('sai', {
    path: '/projects/sai',
    config: {
      name: 'sai',
      processes: [{ name: 'api', command: 'node server.js', cwd: '.', ports: [], portEnv: 'PORT' }],
      services: { mongo: { db: 'sai' } },
    },
    allocations: { ports: {}, services: {} },
  });
  const pm = makeMockProcessManager(new Set(['sai']));
  const { app } = createServer({
    registry: reg,
    portAllocator: createPortAllocator(),
    serviceManager: createServiceManager([mongo]),
    instanceStore: store,
    processManager: pm,
  });
  const res = await request(app).post('/api/services/down/mongo');
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/sai/);
  expect(mongo.stop).not.toHaveBeenCalled();
  if (fs.existsSync(regPath)) fs.unlinkSync(regPath);
  if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx jest --testPathPattern services --no-coverage
```

Expected: 7 new failures — routes don't exist yet.

- [ ] **Step 4: Add routes to `src/daemon/api/services.js`**

Update the function signature and add a helper + four routes. The full updated file:

```js
const { Router } = require('express');
const { findFreePort } = require('../services/instance-store');

const KNOWN_TYPES = ['mongo', 'postgres', 'redis', 'rabbitmq'];

const BUILT_IN_DEFAULT_PORTS = {
  mongo: 27017,
  redis: 6379,
  postgres: 5432,
  rabbitmq: 5672,
};

function createServicesRoutes({ serviceManager, registry, instanceStore, driverFactories = {}, processManager }) {
  const router = Router();

  function getRunningProjectServices() {
    const blocked = new Map(); // serviceName -> projectName
    if (!processManager) return blocked;
    for (const [projectName, project] of Object.entries(registry.getAll())) {
      const statuses = processManager.getStatuses(projectName, project.config?.processes ?? []);
      if (statuses.some(s => s.status === 'running')) {
        for (const svcName of Object.keys(project.config?.services ?? {})) {
          if (!blocked.has(svcName)) blocked.set(svcName, projectName);
        }
      }
    }
    return blocked;
  }

  router.get('/', async (_req, res) => {
    const all = await serviceManager.getStatus();
    res.json(all);
  });

  router.get('/catalog', (_req, res) => {
    res.json(serviceManager.getCatalog());
  });

  router.post('/up', async (req, res) => {
    const names = serviceManager.getCatalog();
    const errors = [];
    for (const name of names) {
      try {
        await serviceManager.startByName(name);
      } catch (err) {
        errors.push({ name, error: err.message });
      }
    }
    if (errors.length > 0) {
      return res.status(500).json({ ok: false, errors });
    }
    res.json({ ok: true, started: names });
  });

  router.post('/up/:name', async (req, res) => {
    const { name } = req.params;
    if (!serviceManager.getCatalog().includes(name)) {
      return res.status(404).json({ error: `Service "${name}" not found` });
    }
    try {
      await serviceManager.startByName(name);
      res.json({ ok: true, started: [name] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/down', async (req, res) => {
    const blocked = getRunningProjectServices();
    const names = serviceManager.getCatalog();
    const stopped = [];
    const blockedList = [];
    for (const name of names) {
      if (blocked.has(name)) {
        blockedList.push({ name, reason: `project ${blocked.get(name)} is up` });
        continue;
      }
      try {
        await serviceManager.stopByName(name);
        stopped.push(name);
      } catch {
        // ignore — container may not be running
      }
    }
    res.json({ ok: true, stopped, blocked: blockedList });
  });

  router.post('/down/:name', async (req, res) => {
    const { name } = req.params;
    if (!serviceManager.getCatalog().includes(name)) {
      return res.status(404).json({ error: `Service "${name}" not found` });
    }
    const blocked = getRunningProjectServices();
    if (blocked.has(name)) {
      return res.status(409).json({ error: `Cannot stop ${name}: project ${blocked.get(name)} is up` });
    }
    try {
      await serviceManager.stopByName(name);
      res.json({ ok: true, stopped: [name] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  if (instanceStore) {
    router.get('/instances', (_req, res) => {
      const all = instanceStore.getAll();
      res.json(Object.entries(all).map(([key, cfg]) => ({ key, ...cfg })));
    });

    router.post('/instances', async (req, res) => {
      const { type, instance, port: requestedPort, options = {} } = req.body;
      if (!type || !instance) {
        return res.status(400).json({ error: 'type and instance are required' });
      }
      if (!KNOWN_TYPES.includes(type)) {
        return res.status(400).json({ error: `Unknown service type "${type}". Valid types: ${KNOWN_TYPES.join(', ')}` });
      }
      const key = `${type}:${instance}`;
      if (instanceStore.has(key)) {
        return res.status(409).json({ error: `Instance "${key}" is already registered` });
      }
      try {
        const port = requestedPort ?? await findFreePort(27100);
        const containerName = `forge-${type}-${instance}`;
        const config = { type, instance, port, options };
        instanceStore.set(key, config);
        if (driverFactories[type]) {
          const driver = driverFactories[type]({ name: key, containerName, port, ...options });
          serviceManager.registerDriver(driver);
        }
        res.json({ ok: true, key, port });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    router.patch('/instances/:key', (req, res) => {
      const { key } = req.params;
      const isBuiltIn = KNOWN_TYPES.includes(key);
      if (!isBuiltIn && !instanceStore.has(key)) {
        return res.status(404).json({ error: `Instance "${key}" not found` });
      }
      try {
        const defaultPort = BUILT_IN_DEFAULT_PORTS[key];
        const existing = instanceStore.get(key) ?? (isBuiltIn ? { type: key, port: defaultPort, options: {} } : {});
        instanceStore.set(key, { ...existing, ...req.body });
        res.json({ ok: true, key });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    router.delete('/instances/:key', async (req, res) => {
      const { key } = req.params;
      if (!instanceStore.has(key)) {
        return res.status(404).json({ error: `Instance "${key}" not found` });
      }
      try {
        instanceStore.remove(key);
        res.json({ ok: true, key });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  return router;
}

module.exports = { createServicesRoutes };
```

- [ ] **Step 5: Pass `processManager` to `createServicesRoutes` in `src/daemon/server.js`**

Find this line:

```js
app.use('/api/services', createServicesRoutes({ serviceManager: svcMgr, registry: reg, instanceStore: store, driverFactories: DRIVER_FACTORIES }));
```

Replace with:

```js
app.use('/api/services', createServicesRoutes({ serviceManager: svcMgr, registry: reg, instanceStore: store, driverFactories: DRIVER_FACTORIES, processManager: pm }));
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npx jest --testPathPattern services --no-coverage
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/api/services.js src/daemon/server.js test/api/services.test.js
git commit -m "feat: add POST /api/services/up and /down routes with running-project guard"
```

---

## Task 4: Client methods + CLI `services up/down`

**Files:**
- Modify: `src/cli/client.js`
- Modify: `src/cli/commands/services.js`

No new unit tests needed — the CLI commands are thin wrappers around the already-tested API.

- [ ] **Step 1: Add `startServices` and `stopServices` to `src/cli/client.js`**

Add after the existing `getServices` line:

```js
getServices:     ()                => call('GET',    '/api/services'),
startServices:   (name)            => call('POST',   name ? `/api/services/up/${enc(name)}` : '/api/services/up'),
stopServices:    (name)            => call('POST',   name ? `/api/services/down/${enc(name)}` : '/api/services/down'),
```

- [ ] **Step 2: Rewrite `src/cli/commands/services.js`**

Replace the entire file with:

```js
const chalk = require('chalk');
const client = require('../client');

module.exports = function registerServices(program) {
  const services = program
    .command('services')
    .description('Manage shared service containers');

  // Bare: forge services — show status
  services.action(async () => {
    if (!await client.isDaemonRunning()) {
      console.error(chalk.red('Forge daemon is not running.'));
      process.exit(1);
    }
    const list = await client.getServices();
    if (list.length === 0) {
      console.log(chalk.dim('No shared services registered.'));
      return;
    }
    for (const svc of list) {
      const status = svc.healthy
        ? chalk.green('● healthy')
        : chalk.red('✗ unhealthy');
      console.log(`${status}  ${chalk.bold(svc.name)}  ${chalk.dim(svc.containerName)}`);
    }
  });

  // forge services up [name]
  services
    .command('up [name]')
    .description('Start one or all shared services')
    .action(async (name) => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      try {
        const result = await client.startServices(name);
        if (!result.ok) {
          for (const e of result.errors ?? []) {
            console.error(chalk.red(`✗ ${e.name}: ${e.error}`));
          }
          process.exit(1);
        }
        for (const n of result.started ?? []) {
          console.log(chalk.green(`✓ ${chalk.bold(n)}`) + chalk.dim('  started'));
        }
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // forge services down [name]
  services
    .command('down [name]')
    .description('Stop one or all shared services (blocked if a running project needs it)')
    .action(async (name) => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      try {
        const result = await client.stopServices(name);
        for (const n of result.stopped ?? []) {
          console.log(chalk.green(`✓ ${chalk.bold(n)}`) + chalk.dim('  stopped'));
        }
        for (const b of result.blocked ?? []) {
          console.error(chalk.red(`✗ ${chalk.bold(b.name)}: ${b.reason}`));
        }
        if ((result.blocked ?? []).length > 0) process.exit(1);
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
};
```

- [ ] **Step 3: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/cli/client.js src/cli/commands/services.js
git commit -m "feat: forge services up/down CLI subcommands"
```

---

## Task 5: Built-in service configuration overrides

**Files:**
- Create: `test/api/server.test.js`
- Modify: `src/daemon/server.js`
- Modify: `test/api/services.test.js`
- Modify: `src/cli/commands/service.js`

This task enables `forge service configure mongo --replica-set` (no instance name) to override the default built-in mongo container config, stored in the instance store and applied when the server next builds its driver list.

- [ ] **Step 1: Write failing unit tests for `buildDriverList` in a new test file**

Create `test/api/server.test.js`:

```js
const os = require('os');
const fs = require('fs');
const path = require('path');
const { buildDriverList } = require('../../src/daemon/server');
const { createInstanceStore } = require('../../src/daemon/services/instance-store');

function tmpStore(data = {}) {
  const p = path.join(os.tmpdir(), `forge-server-test-${Date.now()}-${Math.random()}.json`);
  const store = createInstanceStore(p);
  for (const [key, cfg] of Object.entries(data)) store.set(key, cfg);
  return { store, cleanup: () => fs.existsSync(p) && fs.unlinkSync(p) };
}

const defaultMongo = { name: 'mongo', containerName: 'forge-mongo' };
const defaultRedis = { name: 'redis', containerName: 'forge-redis' };

test('buildDriverList returns default drivers when instance store is empty', () => {
  const { store, cleanup } = tmpStore();
  const mongoFactory = jest.fn();
  const drivers = buildDriverList(store, { mongo: mongoFactory }, [defaultMongo, defaultRedis]);
  expect(mongoFactory).not.toHaveBeenCalled();
  expect(drivers).toEqual([defaultMongo, defaultRedis]);
  cleanup();
});

test('buildDriverList replaces built-in singleton with factory-built driver when store has override', () => {
  const overrideDriver = { name: 'mongo', containerName: 'forge-mongo', replicaSet: true };
  const mongoFactory = jest.fn().mockReturnValue(overrideDriver);
  const { store, cleanup } = tmpStore({
    mongo: { type: 'mongo', port: 27017, options: { replicaSet: true } },
  });
  const drivers = buildDriverList(store, { mongo: mongoFactory }, [defaultMongo, defaultRedis]);
  expect(mongoFactory).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'mongo', containerName: 'forge-mongo', port: 27017, replicaSet: true })
  );
  expect(drivers).toContain(overrideDriver);
  expect(drivers).toContain(defaultRedis);
  expect(drivers).not.toContain(defaultMongo);
  expect(drivers).toHaveLength(2);
  cleanup();
});

test('buildDriverList includes both default drivers and named custom instances', () => {
  const rsDriver = { name: 'mongo:rs', containerName: 'forge-mongo-rs' };
  const mongoFactory = jest.fn().mockReturnValue(rsDriver);
  const { store, cleanup } = tmpStore({
    'mongo:rs': { type: 'mongo', instance: 'rs', port: 27100, options: { replicaSet: true } },
  });
  const drivers = buildDriverList(store, { mongo: mongoFactory }, [defaultMongo, defaultRedis]);
  expect(mongoFactory).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'mongo:rs', containerName: 'forge-mongo-rs', port: 27100 })
  );
  expect(drivers).toContain(defaultMongo);
  expect(drivers).toContain(defaultRedis);
  expect(drivers).toContain(rsDriver);
  expect(drivers).toHaveLength(3);
  cleanup();
});

test('buildDriverList skips instances with unknown type', () => {
  const { store, cleanup } = tmpStore({
    'cassandra:main': { type: 'cassandra', instance: 'main', port: 9042, options: {} },
  });
  const drivers = buildDriverList(store, { mongo: jest.fn() }, [defaultMongo]);
  expect(drivers).toEqual([defaultMongo]);
  cleanup();
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern server --no-coverage
```

Expected: `buildDriverList is not a function` or not exported.

- [ ] **Step 3: Extract and export `buildDriverList` in `src/daemon/server.js`**

Add the constant and function before `createServer`, then update `createServer` to use it. Also update `module.exports`.

Add at the top of the file (after the `require` statements):

```js
const BUILT_IN_NAMES = new Set(['mongo', 'postgres', 'redis', 'rabbitmq']);

const DEFAULT_DRIVERS = [
  require('./services/drivers/mongo'),
  require('./services/drivers/redis'),
  require('./services/drivers/postgres'),
  require('./services/drivers/rabbitmq'),
];

function buildDriverList(instanceStore, driverFactories, defaultDrivers) {
  const instances = instanceStore.getAll();
  const overriddenBuiltIns = new Set(
    Object.keys(instances).filter(k => defaultDrivers.some(d => d.name === k))
  );

  const customAndOverrides = Object.entries(instances)
    .map(([key, cfg]) => {
      const isBuiltIn = defaultDrivers.some(d => d.name === key);
      const type = isBuiltIn ? key : cfg.type;
      const factory = driverFactories[type];
      if (!factory) return null;
      const containerName = isBuiltIn
        ? `forge-${key}`
        : `forge-${cfg.type}-${cfg.instance}`;
      return factory({ name: key, containerName, port: cfg.port, ...(cfg.options ?? {}) });
    })
    .filter(Boolean);

  return [
    ...defaultDrivers.filter(d => !overriddenBuiltIns.has(d.name)),
    ...customAndOverrides,
  ];
}
```

Update `createServer` to replace the current `buildCustomDrivers` call. Find this block:

```js
const store = instanceStore ?? createInstanceStore();
const customDrivers = buildCustomDrivers(store);
const svcMgr = serviceManager ?? createServiceManager([
  require('./services/drivers/mongo'),
  require('./services/drivers/redis'),
  require('./services/drivers/postgres'),
  require('./services/drivers/rabbitmq'),
  ...customDrivers,
]);
```

Replace with:

```js
const store = instanceStore ?? createInstanceStore();
const svcMgr = serviceManager ?? createServiceManager(
  buildDriverList(store, DRIVER_FACTORIES, DEFAULT_DRIVERS)
);
```

Remove the old `buildCustomDrivers` function entirely.

Update `module.exports` at the bottom:

```js
module.exports = { createServer, buildDriverList };
```

- [ ] **Step 4: Run server tests to confirm they pass**

```bash
npx jest --testPathPattern server --no-coverage
```

Expected: all 4 pass.

- [ ] **Step 5: Write failing test for `PATCH /instances/:key` upsert on built-in key**

Append to `test/api/services.test.js`:

```js
test('PATCH /api/services/instances/:key creates built-in override when key does not exist', async () => {
  const { app, cleanup } = tmpServerWithStore([]);
  const res = await request(app)
    .patch('/api/services/instances/mongo')
    .send({ options: { replicaSet: true } });
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  const listRes = await request(app).get('/api/services/instances');
  const entry = listRes.body.find(i => i.key === 'mongo');
  expect(entry).toBeDefined();
  expect(entry.port).toBe(27017);
  expect(entry.options.replicaSet).toBe(true);
  cleanup();
});

test('PATCH /api/services/instances/:key returns 404 for unknown named instance', async () => {
  const { app, cleanup } = tmpServerWithStore([]);
  const res = await request(app)
    .patch('/api/services/instances/mongo:unknown')
    .send({ options: { replicaSet: true } });
  expect(res.status).toBe(404);
  cleanup();
});
```

- [ ] **Step 6: Run tests to confirm new PATCH tests fail**

```bash
npx jest --testPathPattern services --no-coverage
```

Expected: 2 new failures — `PATCH /instances/mongo` currently returns 404 for new built-in keys.

The `PATCH /instances/:key` route was already updated in Task 3 Step 4 to handle built-in upserts — re-run to confirm the logic is already in place.

If tests pass immediately (because Task 3 already included the upsert logic), no further change is needed here. If they fail, verify the `PATCH` handler in `src/daemon/api/services.js` matches the code written in Task 3 Step 4.

- [ ] **Step 7: Write failing test for CLI `configure` with no instance name**

This is a unit test for the route behaviour (the CLI is a thin wrapper). Append to `test/api/services.test.js`:

```js
test('PATCH /api/services/instances/mongo can be called without prior existence (built-in default)', async () => {
  const { app, cleanup } = tmpServerWithStore([]);
  // First call creates the record
  await request(app)
    .patch('/api/services/instances/mongo')
    .send({ options: { replicaSet: true } })
    .expect(200);
  // Second call updates it
  const res = await request(app)
    .patch('/api/services/instances/mongo')
    .send({ options: { replicaSet: false } });
  expect(res.status).toBe(200);
  const listRes = await request(app).get('/api/services/instances');
  const entry = listRes.body.find(i => i.key === 'mongo');
  expect(entry.options.replicaSet).toBe(false);
  cleanup();
});
```

- [ ] **Step 8: Run all services tests**

```bash
npx jest --testPathPattern services --no-coverage
```

Expected: all pass.

- [ ] **Step 9: Update `src/cli/commands/service.js` — make `[name]` optional in `configure`**

Find:

```js
service
  .command('configure <type> <name>')
  .description('Update options for a named service instance')
  .option('--port <port>', 'Change the bound port', parseInt)
  .option('--replica-set', 'Enable MongoDB replica set mode')
  .option('--no-replica-set', 'Disable MongoDB replica set mode')
  .action(async (type, name, opts) => {
    const key = `${type}:${name}`;
    if (!await client.isDaemonRunning()) {
      console.error(chalk.red('Forge daemon is not running.'));
      process.exit(1);
    }
    const updates = {};
    if (opts.port !== undefined) updates.port = opts.port;
    if (opts.replicaSet !== undefined) updates.options = { replicaSet: opts.replicaSet };
    const result = await client.configureInstance(key, updates);
    if (result.error) {
      console.error(chalk.red(result.error));
      process.exit(1);
    }
    console.log(chalk.green(`✓ Updated ${chalk.bold(key)}`));
  });
```

Replace with:

```js
service
  .command('configure <type> [name]')
  .description('Update options for a service instance (omit name to configure the built-in default)')
  .option('--port <port>', 'Change the bound port', parseInt)
  .option('--replica-set', 'Enable MongoDB replica set mode')
  .option('--no-replica-set', 'Disable MongoDB replica set mode')
  .action(async (type, name, opts) => {
    const key = name ? `${type}:${name}` : type;
    if (!await client.isDaemonRunning()) {
      console.error(chalk.red('Forge daemon is not running.'));
      process.exit(1);
    }
    const updates = {};
    if (opts.port !== undefined) updates.port = opts.port;
    if (opts.replicaSet !== undefined) updates.options = { replicaSet: opts.replicaSet };
    const result = await client.configureInstance(key, updates);
    if (result.error) {
      console.error(chalk.red(result.error));
      process.exit(1);
    }
    console.log(chalk.green(`✓ Updated ${chalk.bold(key)}`));
    if (!name) {
      console.log(chalk.dim(`  Run 'forge services down ${type} && forge services up ${type}' to apply.`));
    }
  });
```

- [ ] **Step 10: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add src/daemon/server.js src/daemon/api/services.js src/cli/commands/service.js test/api/server.test.js test/api/services.test.js
git commit -m "feat: built-in service config overrides via forge service configure <type>"
```

---

## Self-Review

**Spec coverage check:**
- Goal 1 (no auto-stop on project down) → Task 2 ✓
- Goal 2 (`forge services up [name]`) → Tasks 3 + 4 ✓
- Goal 3 (`forge services down [name]` with guard) → Tasks 3 + 4 ✓
- Goal 4 (`forge services` shows all) → Task 2 ✓
- Goal 5 (`forge service configure mongo --replica-set`) → Task 5 ✓
- `PATCH /instances/:key` upsert for built-ins → Task 5 ✓
- `buildCustomDrivers` handles built-in overrides → Task 5 ✓

**Type consistency:**
- `startByName(name)` used in Task 1 (impl), Task 3 (routes) — consistent ✓
- `stopByName(name)` used in Task 1 (impl), Task 3 (routes) — consistent ✓
- `getCatalog()` already exists on service manager — used in Task 3 routes ✓
- `getRunningProjectServices()` defined and used within `createServicesRoutes` closure — consistent ✓
- `buildDriverList(instanceStore, driverFactories, defaultDrivers)` — matches test call signature ✓
- `BUILT_IN_DEFAULT_PORTS` used in PATCH handler, keys match `KNOWN_TYPES` ✓

**Placeholder scan:** No TBDs, TODOs, or "add appropriate X" patterns found.
