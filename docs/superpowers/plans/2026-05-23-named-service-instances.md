# Named Service Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to run multiple named instances of any shared service (mongo, postgres, redis, rabbitmq) with per-instance configuration including port overrides and MongoDB replica set mode.

**Architecture:** Named instances are stored in `~/.forge/services.json` (the instance store). Default instances (one per service type, well-known port) are hardcoded and not stored there. At daemon startup, custom instance configs are read from the store and turned into driver objects which are registered in the service manager alongside the defaults. Projects reference instances using `"type:instance"` keys in `.forge/config.json`. The `forge service` CLI subcommand manages instances via a new daemon API.

**Tech Stack:** Node.js, Express, Dockerode, Commander.js, Jest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/daemon/services/instance-store.js` | Read/write `~/.forge/services.json`; find free ports |
| Modify | `src/daemon/services/drivers/mongo.js` | Accept config (port, containerName, replicaSet); add `postStart()` |
| Modify | `src/daemon/services/drivers/postgres.js` | Accept config (port, containerName) |
| Modify | `src/daemon/services/drivers/redis.js` | Accept config (port, containerName) |
| Modify | `src/daemon/services/drivers/rabbitmq.js` | Accept config (port, containerName) |
| Modify | `src/daemon/services/manager.js` | Named-instance map keyed by full key; call `postStart()`; add `registerDriver()` |
| Modify | `src/daemon/api/services.js` | Add instance management routes (add, remove, configure, list) |
| Modify | `src/daemon/server.js` | Load instance store; build custom drivers; pass store to routes |
| Create | `src/cli/commands/service.js` | `forge service add|remove|configure|list` subcommands |
| Modify | `src/cli/index.js` | Register new `service` command |
| Create | `test/services/instance-store.test.js` | Instance store unit tests |
| Modify | `test/services/drivers/mongo.test.js` | Tests for config params and replicaSet |
| Modify | `test/services/manager.test.js` | Tests for named instances, postStart, registerDriver |
| Modify | `test/api/services.test.js` | Tests for new instance management routes |

---

## Task 1: Instance Store

**Files:**
- Create: `src/daemon/services/instance-store.js`
- Create: `test/services/instance-store.test.js`

Stores custom service instance configs in `~/.forge/services.json`. Default instances (mongo, redis, postgres, rabbitmq at their well-known ports) are NOT stored here — they're hardcoded in the server.

Instance store data shape:
```json
{
  "mongo:rs": {
    "type": "mongo",
    "instance": "rs",
    "port": 27842,
    "options": { "replicaSet": true }
  },
  "mongo:analytics": {
    "type": "mongo",
    "instance": "analytics",
    "port": 27843,
    "options": {}
  }
}
```

- [ ] **Step 1: Write failing tests**

```js
// test/services/instance-store.test.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createInstanceStore, findFreePort } = require('../../src/daemon/services/instance-store');

function tmpStore() {
  const p = path.join(os.tmpdir(), `forge-instance-store-test-${Date.now()}.json`);
  return { store: createInstanceStore(p), cleanup: () => fs.existsSync(p) && fs.unlinkSync(p) };
}

test('getAll returns empty object when file does not exist', () => {
  const { store, cleanup } = tmpStore();
  expect(store.getAll()).toEqual({});
  cleanup();
});

test('set and get round-trip', () => {
  const { store, cleanup } = tmpStore();
  store.set('mongo:rs', { type: 'mongo', instance: 'rs', port: 27842, options: { replicaSet: true } });
  expect(store.get('mongo:rs')).toEqual({ type: 'mongo', instance: 'rs', port: 27842, options: { replicaSet: true } });
  cleanup();
});

test('get returns null for unknown key', () => {
  const { store, cleanup } = tmpStore();
  expect(store.get('mongo:rs')).toBeNull();
  cleanup();
});

test('has returns true for existing key', () => {
  const { store, cleanup } = tmpStore();
  store.set('mongo:rs', { type: 'mongo', instance: 'rs', port: 27842, options: {} });
  expect(store.has('mongo:rs')).toBe(true);
  cleanup();
});

test('has returns false for missing key', () => {
  const { store, cleanup } = tmpStore();
  expect(store.has('mongo:rs')).toBe(false);
  cleanup();
});

test('remove deletes an existing key', () => {
  const { store, cleanup } = tmpStore();
  store.set('mongo:rs', { type: 'mongo', instance: 'rs', port: 27842, options: {} });
  store.remove('mongo:rs');
  expect(store.has('mongo:rs')).toBe(false);
  cleanup();
});

test('remove throws for unknown key', () => {
  const { store, cleanup } = tmpStore();
  expect(() => store.remove('mongo:rs')).toThrow('"mongo:rs" not found');
  cleanup();
});

test('set overwrites an existing key', () => {
  const { store, cleanup } = tmpStore();
  store.set('mongo:rs', { type: 'mongo', instance: 'rs', port: 27842, options: {} });
  store.set('mongo:rs', { type: 'mongo', instance: 'rs', port: 27900, options: { replicaSet: true } });
  expect(store.get('mongo:rs').port).toBe(27900);
  cleanup();
});

test('getAll returns all stored instances', () => {
  const { store, cleanup } = tmpStore();
  store.set('mongo:rs', { type: 'mongo', instance: 'rs', port: 27842, options: {} });
  store.set('postgres:analytics', { type: 'postgres', instance: 'analytics', port: 5433, options: {} });
  const all = store.getAll();
  expect(Object.keys(all)).toHaveLength(2);
  expect(all['mongo:rs'].port).toBe(27842);
  cleanup();
});

test('findFreePort returns a number', async () => {
  const port = await findFreePort(27100);
  expect(typeof port).toBe('number');
  expect(port).toBeGreaterThanOrEqual(27100);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/services/instance-store.test.js --no-coverage
```
Expected: FAIL — `Cannot find module '../../src/daemon/services/instance-store'`

- [ ] **Step 3: Implement instance store**

```js
// src/daemon/services/instance-store.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

const DEFAULT_PATH = path.join(os.homedir(), '.forge', 'services.json');

function findFreePort(startPort = 27100) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      const s = net.createServer();
      s.once('error', () => tryPort(port + 1));
      s.once('listening', () => s.close(() => resolve(port)));
      s.listen(port, '127.0.0.1');
    }
    tryPort(startPort);
  });
}

function createInstanceStore(storePath = DEFAULT_PATH) {
  function read() {
    if (!fs.existsSync(storePath)) return {};
    try {
      return JSON.parse(fs.readFileSync(storePath, 'utf8'));
    } catch {
      throw new Error(`Instance store file is malformed: ${storePath}`);
    }
  }

  function write(data) {
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
  }

  return {
    getAll: () => read(),

    get(key) {
      return read()[key] ?? null;
    },

    has(key) {
      return key in read();
    },

    set(key, config) {
      const all = read();
      all[key] = config;
      write(all);
    },

    remove(key) {
      const all = read();
      if (!(key in all)) throw new Error(`Instance "${key}" not found`);
      delete all[key];
      write(all);
    },
  };
}

module.exports = { createInstanceStore, findFreePort, DEFAULT_PATH };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/services/instance-store.test.js --no-coverage
```
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/daemon/services/instance-store.js test/services/instance-store.test.js
git commit -m "feat: add instance store for named service instance config"
```

---

## Task 2: Mongo Driver — Config Params and Replica Set

**Files:**
- Modify: `src/daemon/services/drivers/mongo.js`
- Modify: `test/services/drivers/mongo.test.js`

`createMongoDriver` now accepts a config object: `{ name, containerName, port, replicaSet }`. The existing singleton export calls `createMongoDriver({})` (all defaults). When `replicaSet: true`:
- Container starts with `Cmd: ['--replSet', 'rs0', '--bind_ip_all']`
- `postStart()` runs `rs.initiate()` inside the container
- `connectionString()` appends `?replicaSet=rs0`

- [ ] **Step 1: Write failing tests**

Add to `test/services/drivers/mongo.test.js`:

```js
// Add these tests after the existing ones:

test('createMongoDriver accepts custom port and containerName', () => {
  const driver = createMongoDriver({ port: 27842, containerName: 'forge-mongo-rs' });
  expect(driver.port).toBe(27842);
  expect(driver.containerName).toBe('forge-mongo-rs');
});

test('createMongoDriver with replicaSet:true has postStart method', () => {
  const driver = createMongoDriver({ replicaSet: true });
  expect(typeof driver.postStart).toBe('function');
});

test('createMongoDriver without replicaSet has no postStart method', () => {
  const driver = createMongoDriver({});
  expect(driver.postStart).toBeUndefined();
});

test('connectionString appends replicaSet param when replicaSet:true', () => {
  const driver = createMongoDriver({ port: 27842, replicaSet: true });
  expect(driver.connectionString('sai', { db: 'sai' }))
    .toBe('mongodb://localhost:27842/sai?replicaSet=rs0');
});

test('connectionString has no replicaSet param by default', () => {
  const driver = createMongoDriver({ port: 27017 });
  expect(driver.connectionString('sai', { db: 'sai' }))
    .toBe('mongodb://localhost:27017/sai');
});

test('named instance driver uses instance name as driver name', () => {
  const driver = createMongoDriver({ name: 'mongo:rs', containerName: 'forge-mongo-rs', port: 27842 });
  expect(driver.name).toBe('mongo:rs');
  expect(driver.containerName).toBe('forge-mongo-rs');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/services/drivers/mongo.test.js --no-coverage
```
Expected: FAIL — new tests fail because `createMongoDriver` ignores config

- [ ] **Step 3: Implement updated driver**

```js
// src/daemon/services/drivers/mongo.js
const { ensureContainerRunning, stopContainer, checkTcpHealth, execInContainer } = require('../docker');

const DEFAULT_NAME = 'mongo';
const DEFAULT_CONTAINER_NAME = 'forge-mongo';
const IMAGE = 'mongo:7';
const DEFAULT_PORT = 27017;

function createMongoDriver({ name = DEFAULT_NAME, containerName = DEFAULT_CONTAINER_NAME, port = DEFAULT_PORT, replicaSet = false } = {}) {
  const cmd = replicaSet ? ['--replSet', 'rs0', '--bind_ip_all'] : undefined;

  return {
    name,
    containerName,
    image: IMAGE,
    port,

    async start() {
      await ensureContainerRunning({ image: IMAGE, name: containerName, port, cmd });
    },

    async healthCheck() {
      return checkTcpHealth('127.0.0.1', port);
    },

    ...(replicaSet ? {
      async postStart() {
        await execInContainer(containerName, [
          'mongosh', '--eval',
          `rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:${port}'}]})`,
        ]);
      },
    } : {}),

    async provision(_projectName, _cfg) {},

    connectionString(projectName, cfg) {
      const db = cfg?.db || projectName;
      const suffix = replicaSet ? '?replicaSet=rs0' : '';
      return `mongodb://localhost:${port}/${db}${suffix}`;
    },

    async stop() {
      await stopContainer(containerName);
    },

    async deprovision(_projectName) {},

    restoreFromRegistry(_projects) {},
  };
}

module.exports = createMongoDriver();
module.exports.createMongoDriver = createMongoDriver;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/services/drivers/mongo.test.js --no-coverage
```
Expected: PASS (all tests including existing ones)

- [ ] **Step 5: Commit**

```bash
git add src/daemon/services/drivers/mongo.js test/services/drivers/mongo.test.js
git commit -m "feat: mongo driver accepts config params and supports replicaSet mode"
```

---

## Task 3: Other Drivers — Accept Port and ContainerName Config

**Files:**
- Modify: `src/daemon/services/drivers/postgres.js`
- Modify: `src/daemon/services/drivers/redis.js`
- Modify: `src/daemon/services/drivers/rabbitmq.js`

Each driver factory accepts `{ name, containerName, port }` with the existing hardcoded values as defaults. No new behavior, just parametrize the existing constants.

- [ ] **Step 1: Write failing tests**

Add to `test/services/drivers/redis.test.js` (check this file exists first — if it only tests the singleton, add cases for `createRedisDriver`):

```js
// Add to test/services/drivers/redis.test.js
const { createRedisDriver } = require('../../../src/daemon/services/drivers/redis');

test('createRedisDriver accepts custom port and containerName', () => {
  const driver = createRedisDriver({ port: 6380, containerName: 'forge-redis-2' });
  expect(driver.port).toBe(6380);
  expect(driver.containerName).toBe('forge-redis-2');
  expect(driver.name).toBe('redis');
});

test('createRedisDriver with custom name uses it as driver name', () => {
  const driver = createRedisDriver({ name: 'redis:cache', port: 6380, containerName: 'forge-redis-cache' });
  expect(driver.name).toBe('redis:cache');
});
```

Write similar tests for postgres and rabbitmq in their respective test files (create them if they do not exist at `test/services/drivers/postgres.test.js` and `test/services/drivers/rabbitmq.test.js`):

```js
// test/services/drivers/postgres.test.js
const { createPostgresDriver } = require('../../../src/daemon/services/drivers/postgres');

test('createPostgresDriver accepts custom port and containerName', () => {
  const driver = createPostgresDriver({ port: 5433, containerName: 'forge-postgres-2' });
  expect(driver.port).toBe(5433);
  expect(driver.containerName).toBe('forge-postgres-2');
});

test('createPostgresDriver with custom name uses it as driver name', () => {
  const driver = createPostgresDriver({ name: 'postgres:analytics', port: 5433, containerName: 'forge-postgres-analytics' });
  expect(driver.name).toBe('postgres:analytics');
});
```

```js
// test/services/drivers/rabbitmq.test.js
const { createRabbitMQDriver } = require('../../../src/daemon/services/drivers/rabbitmq');

test('createRabbitMQDriver accepts custom port and containerName', () => {
  const driver = createRabbitMQDriver({ port: 5673, containerName: 'forge-rabbitmq-2' });
  expect(driver.port).toBe(5673);
  expect(driver.containerName).toBe('forge-rabbitmq-2');
});

test('createRabbitMQDriver with custom name uses it as driver name', () => {
  const driver = createRabbitMQDriver({ name: 'rabbitmq:events', port: 5673, containerName: 'forge-rabbitmq-events' });
  expect(driver.name).toBe('rabbitmq:events');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/services/drivers/ --no-coverage
```
Expected: FAIL for the new tests (factories don't accept config yet)

- [ ] **Step 3: Update postgres driver**

In `src/daemon/services/drivers/postgres.js`, change `createPostgresDriver` from `function createPostgresDriver()` to `function createPostgresDriver({ name = NAME, containerName = CONTAINER_NAME, port = PORT } = {})`. Replace all references to the constants `NAME`, `CONTAINER_NAME`, `PORT` inside the returned object with the parameter variables:

```js
function createPostgresDriver({ name = NAME, containerName = CONTAINER_NAME, port = PORT } = {}) {
  const dbNames = new Map();

  return {
    name,
    containerName,
    image: IMAGE,
    port,

    async start() {
      await ensureContainerRunning({
        image: IMAGE,
        name: containerName,
        port,
        env: [`POSTGRES_PASSWORD=${PASSWORD}`],
      });
    },

    async healthCheck() {
      return checkTcpHealth('127.0.0.1', port);
    },

    async provision(projectName, cfg) {
      if (dbNames.has(projectName)) return;
      const db = cfg?.db || sanitizeDbName(projectName);
      await execInContainer(containerName, [
        'psql', '-U', USER, '-c', `CREATE DATABASE "${db}"`,
      ]);
      dbNames.set(projectName, db);
    },

    connectionString(projectName, cfg) {
      const db = dbNames.get(projectName) ?? cfg?.db ?? sanitizeDbName(projectName);
      return `postgresql://${USER}:${PASSWORD}@localhost:${port}/${db}`;
    },

    async stop() {
      await stopContainer(containerName);
    },

    async deprovision(projectName) {
      dbNames.delete(projectName);
    },

    restoreFromRegistry(projects) {
      for (const [projName, project] of Object.entries(projects)) {
        const url = project.allocations?.services?.[name];
        if (!url) continue;
        const match = url.match(/\/([^/]+)$/);
        if (match) dbNames.set(projName, match[1]);
      }
    },
  };
}

module.exports = createPostgresDriver();
module.exports.createPostgresDriver = createPostgresDriver;
```

- [ ] **Step 4: Update redis driver**

Read `src/daemon/services/drivers/redis.js` and apply the same pattern — add `{ name = NAME, containerName = CONTAINER_NAME, port = PORT } = {}` param to `createRedisDriver`, replace constant references inside with the params. Export `createRedisDriver` from the module. Ensure `restoreFromRegistry` uses the `name` param (not the hardcoded `NAME` constant) when looking up the service URL from project allocations.

- [ ] **Step 5: Update rabbitmq driver**

Read `src/daemon/services/drivers/rabbitmq.js` and apply the same pattern — add `{ name = NAME, containerName = CONTAINER_NAME, port = PORT } = {}` param to `createRabbitMQDriver`, replace constant references inside with the params. Export `createRabbitMQDriver` from the module.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx jest test/services/drivers/ --no-coverage
```
Expected: PASS (all driver tests)

- [ ] **Step 7: Run full test suite to check for regressions**

```bash
npx jest --no-coverage
```
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/daemon/services/drivers/postgres.js src/daemon/services/drivers/redis.js src/daemon/services/drivers/rabbitmq.js test/services/drivers/
git commit -m "feat: postgres, redis, rabbitmq drivers accept config params for named instances"
```

---

## Task 4: Service Manager — Named Instances, postStart, registerDriver

**Files:**
- Modify: `src/daemon/services/manager.js`
- Modify: `test/services/manager.test.js`

Changes:
1. `createServiceManager` still takes `drivers: Driver[]` — the key in the internal map is `driver.name` (which is now the full instance key, e.g. `"mongo:rs"`).
2. After a driver becomes healthy, if it has a `postStart()` method, call it.
3. Add `registerDriver(driver)` method to add a driver at runtime.
4. `stopUnused` already uses `serviceName` (the key from project config) to look up the driver — this still works because project config uses the same `"mongo:rs"` key.

- [ ] **Step 1: Write failing tests**

Add to `test/services/manager.test.js`:

```js
// Add these after existing tests:

test('provision calls postStart after driver becomes healthy', async () => {
  const mongo = {
    ...makeMockDriver('mongo'),
    postStart: jest.fn().mockResolvedValue(undefined),
  };
  const manager = createServiceManager([mongo]);
  await manager.provision('sai', { mongo: {} });
  expect(mongo.postStart).toHaveBeenCalledTimes(1);
});

test('provision does not call postStart again if driver already started', async () => {
  const mongo = {
    ...makeMockDriver('mongo'),
    postStart: jest.fn().mockResolvedValue(undefined),
  };
  const manager = createServiceManager([mongo]);
  await manager.provision('sai', { mongo: {} });
  await manager.provision('cleome', { mongo: {} });
  expect(mongo.postStart).toHaveBeenCalledTimes(1);
});

test('provision works for named instance keys like "mongo:rs"', async () => {
  const mongoRs = makeMockDriver('mongo:rs');
  const manager = createServiceManager([mongoRs]);
  const result = await manager.provision('sai', { 'mongo:rs': { db: 'sai' } });
  expect(mongoRs.start).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ 'mongo:rs': 'mongo:rs://localhost/testdb' });
});

test('registerDriver adds a new driver that can be used in provision', async () => {
  const manager = createServiceManager([]);
  const mongo = makeMockDriver('mongo:rs');
  manager.registerDriver(mongo);
  const result = await manager.provision('sai', { 'mongo:rs': {} });
  expect(mongo.start).toHaveBeenCalledTimes(1);
  expect(result['mongo:rs']).toBe('mongo:rs://localhost/testdb');
});

test('registerDriver throws if a driver with that name is already registered', () => {
  const mongo = makeMockDriver('mongo');
  const manager = createServiceManager([mongo]);
  expect(() => manager.registerDriver(makeMockDriver('mongo')))
    .toThrow('Driver "mongo" is already registered');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/services/manager.test.js --no-coverage
```
Expected: FAIL — `postStart` and `registerDriver` tests fail

- [ ] **Step 3: Implement changes**

```js
// src/daemon/services/manager.js
function createServiceManager(drivers = []) {
  const byName = new Map(drivers.map(d => [d.name, d]));
  const started = new Set();

  async function ensureStarted(driver, opts) {
    if (started.has(driver.name) && await driver.healthCheck()) return;
    started.delete(driver.name);
    await driver.start();
    const { pollInterval = 1000, maxAttempts = 30 } = opts ?? {};
    let healthy = false;
    for (let i = 0; i < maxAttempts; i++) {
      if (await driver.healthCheck()) { healthy = true; break; }
      if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, pollInterval));
    }
    if (!healthy) throw new Error(`Service "${driver.name}" did not become healthy`);
    if (driver.postStart) await driver.postStart();
    started.add(driver.name);
  }

  return {
    registerDriver(driver) {
      if (byName.has(driver.name)) throw new Error(`Driver "${driver.name}" is already registered`);
      byName.set(driver.name, driver);
    },

    restoreFromRegistry(projects) {
      for (const driver of byName.values()) {
        driver.restoreFromRegistry(projects);
      }
    },

    async provision(projectName, servicesConfig, opts) {
      const connectionStrings = {};
      for (const [serviceKey, cfg] of Object.entries(servicesConfig ?? {})) {
        const driver = byName.get(serviceKey);
        if (!driver) throw new Error(`No driver for service "${serviceKey}"`);
        await ensureStarted(driver, opts);
        await driver.provision(projectName, cfg);
        connectionStrings[serviceKey] = driver.connectionString(projectName, cfg);
      }
      return connectionStrings;
    },

    async deprovision(projectName, servicesConfig) {
      for (const serviceKey of Object.keys(servicesConfig ?? {})) {
        const driver = byName.get(serviceKey);
        if (driver) await driver.deprovision(projectName);
      }
    },

    getCatalog() {
      return [...byName.keys()];
    },

    async ensureServicesRunning(servicesConfig) {
      for (const serviceKey of Object.keys(servicesConfig ?? {})) {
        const driver = byName.get(serviceKey);
        if (driver) await ensureStarted(driver);
      }
    },

    async stopUnused(servicesConfig, allProjects, excludeProjectName) {
      for (const serviceKey of Object.keys(servicesConfig ?? {})) {
        const driver = byName.get(serviceKey);
        if (!driver) continue;
        const stillNeeded = Object.entries(allProjects).some(
          ([name, project]) => name !== excludeProjectName && project.config?.services?.[serviceKey]
        );
        if (!stillNeeded) {
          await driver.stop();
          started.delete(serviceKey);
        }
      }
    },

    async getStatus() {
      const statuses = [];
      for (const driver of byName.values()) {
        const healthy = await driver.healthCheck();
        statuses.push({ name: driver.name, containerName: driver.containerName, healthy });
      }
      return statuses;
    },
  };
}

module.exports = { createServiceManager };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/services/manager.test.js --no-coverage
```
Expected: PASS (all tests)

- [ ] **Step 5: Run full test suite**

```bash
npx jest --no-coverage
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/daemon/services/manager.js test/services/manager.test.js
git commit -m "feat: service manager supports named instances, postStart hooks, and registerDriver"
```

---

## Task 5: Services API — Instance Management Routes

**Files:**
- Modify: `src/daemon/api/services.js`
- Modify: `test/api/services.test.js`

Add instance management routes. The `createServicesRoutes` function now accepts `instanceStore` and a `driverFactories` map in addition to `serviceManager` and `registry`.

New routes:
- `GET /api/services/instances` — list all instances (defaults + custom)
- `POST /api/services/instances` — add a named instance
- `PATCH /api/services/instances/:key` — update instance config (port, options)
- `DELETE /api/services/instances/:key` — remove instance and stop its container

Default instances are represented as synthetic entries with `isDefault: true`.

- [ ] **Step 1: Write failing tests**

Add to `test/api/services.test.js`:

```js
// Add these imports at the top of the existing test file:
const { createInstanceStore } = require('../../src/daemon/services/instance-store');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Add this helper alongside tmpServer:
function tmpServerWithStore(drivers, instanceData = {}) {
  const regPath = path.join(os.tmpdir(), `forge-svc-test-${Date.now()}.json`);
  const storePath = path.join(os.tmpdir(), `forge-store-test-${Date.now()}.json`);
  const store = createInstanceStore(storePath);
  for (const [key, cfg] of Object.entries(instanceData)) store.set(key, cfg);
  const svcMgr = createServiceManager(drivers);
  const { app } = createServer({
    registry: createRegistry(regPath),
    portAllocator: createPortAllocator(),
    serviceManager: svcMgr,
    instanceStore: store,
  });
  return {
    app,
    cleanup: () => {
      if (fs.existsSync(regPath)) fs.unlinkSync(regPath);
      if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
    },
  };
}

// New tests:
test('GET /api/services/instances returns empty array when no custom instances', async () => {
  const { app, cleanup } = tmpServerWithStore([]);
  const res = await request(app).get('/api/services/instances');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
  cleanup();
});

test('GET /api/services/instances returns stored custom instances', async () => {
  const { app, cleanup } = tmpServerWithStore([], {
    'mongo:rs': { type: 'mongo', instance: 'rs', port: 27842, options: { replicaSet: true } },
  });
  const res = await request(app).get('/api/services/instances');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].key).toBe('mongo:rs');
  expect(res.body[0].port).toBe(27842);
  expect(res.body[0].options.replicaSet).toBe(true);
  cleanup();
});

test('POST /api/services/instances adds a new instance', async () => {
  const { app, cleanup } = tmpServerWithStore([]);
  const res = await request(app)
    .post('/api/services/instances')
    .send({ type: 'mongo', instance: 'rs', options: { replicaSet: true } });
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.key).toBe('mongo:rs');
  expect(typeof res.body.port).toBe('number');
  cleanup();
});

test('POST /api/services/instances returns 400 for unknown type', async () => {
  const { app, cleanup } = tmpServerWithStore([]);
  const res = await request(app)
    .post('/api/services/instances')
    .send({ type: 'cassandra', instance: 'main' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/unknown service type/i);
  cleanup();
});

test('POST /api/services/instances returns 409 if key already registered', async () => {
  const { app, cleanup } = tmpServerWithStore([], {
    'mongo:rs': { type: 'mongo', instance: 'rs', port: 27842, options: {} },
  });
  const res = await request(app)
    .post('/api/services/instances')
    .send({ type: 'mongo', instance: 'rs' });
  expect(res.status).toBe(409);
  cleanup();
});

test('DELETE /api/services/instances/:key removes the instance', async () => {
  const { app, cleanup } = tmpServerWithStore([], {
    'mongo:rs': { type: 'mongo', instance: 'rs', port: 27842, options: {} },
  });
  const res = await request(app).delete('/api/services/instances/mongo:rs');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  const listRes = await request(app).get('/api/services/instances');
  expect(listRes.body).toEqual([]);
  cleanup();
});

test('DELETE /api/services/instances/:key returns 404 for unknown key', async () => {
  const { app, cleanup } = tmpServerWithStore([]);
  const res = await request(app).delete('/api/services/instances/mongo:rs');
  expect(res.status).toBe(404);
  cleanup();
});

test('PATCH /api/services/instances/:key updates instance config', async () => {
  const { app, cleanup } = tmpServerWithStore([], {
    'mongo:rs': { type: 'mongo', instance: 'rs', port: 27842, options: {} },
  });
  const res = await request(app)
    .patch('/api/services/instances/mongo:rs')
    .send({ options: { replicaSet: true } });
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  const listRes = await request(app).get('/api/services/instances');
  expect(listRes.body[0].options.replicaSet).toBe(true);
  cleanup();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/api/services.test.js --no-coverage
```
Expected: FAIL — new routes don't exist yet

- [ ] **Step 3: Implement updated services routes**

```js
// src/daemon/api/services.js
const { Router } = require('express');
const { findFreePort } = require('../services/instance-store');

const KNOWN_TYPES = ['mongo', 'postgres', 'redis', 'rabbitmq'];

function createServicesRoutes({ serviceManager, registry, instanceStore, driverFactories = {} }) {
  const router = Router();

  router.get('/catalog', (_req, res) => {
    res.json(serviceManager.getCatalog());
  });

  router.get('/', async (_req, res) => {
    const projects = Object.values(registry.getAll());
    const active = new Set(
      projects.flatMap(p => Object.keys(p.config?.services ?? {}))
    );
    const all = await serviceManager.getStatus();
    res.json(all.filter(s => active.has(s.name)));
  });

  // Instance management — only available when instanceStore is provided
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
        return res.status(400).json({ error: `Unknown service type "${type}"` });
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
      if (!instanceStore.has(key)) {
        return res.status(404).json({ error: `Instance "${key}" not found` });
      }
      try {
        const existing = instanceStore.get(key);
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/api/services.test.js --no-coverage
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/api/services.js test/api/services.test.js
git commit -m "feat: services API instance management routes (add, list, configure, remove)"
```

---

## Task 6: Server Wiring

**Files:**
- Modify: `src/daemon/server.js`

Load the instance store at startup, build drivers for all stored custom instances, register them in the service manager, and pass the instance store and driver factories to `createServicesRoutes`.

- [ ] **Step 1: No new tests needed** — existing server tests will catch regressions. Run them now to confirm they pass before editing:

```bash
npx jest test/api/ --no-coverage
```
Expected: PASS

- [ ] **Step 2: Update server.js**

```js
// src/daemon/server.js
const express = require('express');
const http = require('http');
const { FORGE_PORT } = require('../constants');
const { createRegistry } = require('./registry');
const { createPortAllocator } = require('./port-allocator');
const { createServiceManager } = require('./services/manager');
const { createProcessManager } = require('./process-manager');
const { createHealthRoutes } = require('./api/health');
const { createProjectRoutes } = require('./api/projects');
const { createServicesRoutes } = require('./api/services');
const { createProcessRoutes } = require('./api/processes');
const { createInstanceStore } = require('./services/instance-store');
const path = require('path');
const fs = require('fs');

const DRIVER_FACTORIES = {
  mongo: require('./services/drivers/mongo').createMongoDriver,
  postgres: require('./services/drivers/postgres').createPostgresDriver,
  redis: require('./services/drivers/redis').createRedisDriver,
  rabbitmq: require('./services/drivers/rabbitmq').createRabbitMQDriver,
};

function buildCustomDrivers(instanceStore) {
  const instances = instanceStore.getAll();
  return Object.entries(instances).map(([key, cfg]) => {
    const factory = DRIVER_FACTORIES[cfg.type];
    if (!factory) return null;
    const containerName = `forge-${cfg.type}-${cfg.instance}`;
    return factory({ name: key, containerName, port: cfg.port, ...(cfg.options ?? {}) });
  }).filter(Boolean);
}

function createServer({ registry, portAllocator, serviceManager, processManager, instanceStore } = {}) {
  const reg = registry ?? createRegistry();
  const alloc = portAllocator ?? createPortAllocator();
  const store = instanceStore ?? createInstanceStore();
  const customDrivers = buildCustomDrivers(store);
  const svcMgr = serviceManager ?? createServiceManager([
    require('./services/drivers/mongo'),
    require('./services/drivers/redis'),
    require('./services/drivers/postgres'),
    require('./services/drivers/rabbitmq'),
    ...customDrivers,
  ]);
  const pm = processManager ?? createProcessManager();

  alloc.restoreFromRegistry(reg.getAll());
  svcMgr.restoreFromRegistry(reg.getAll());

  const app = express();
  app.use(express.json());
  app.use('/api/health', createHealthRoutes());
  app.use('/api/projects', createProjectRoutes({ registry: reg, portAllocator: alloc, serviceManager: svcMgr }));
  app.use('/api/services', createServicesRoutes({
    serviceManager: svcMgr,
    registry: reg,
    instanceStore: store,
    driverFactories: DRIVER_FACTORIES,
  }));
  app.use('/api/projects/:name/processes', createProcessRoutes({ registry: reg, processManager: pm, serviceManager: svcMgr }));

  const server = http.createServer(app);

  // ... rest of server.js unchanged (WebSocket setup, listen, etc.)
```

**Important:** Only replace the top portion of `createServer` up through the route mounting. The WebSocket setup, `listen` method, and `module.exports` at the bottom remain unchanged. Read the full file before editing to preserve those sections.

- [ ] **Step 3: Run full test suite**

```bash
npx jest --no-coverage
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/daemon/server.js
git commit -m "feat: server loads custom service instances from instance store at startup"
```

---

## Task 7: `forge service` CLI Subcommand

**Files:**
- Create: `src/cli/commands/service.js`

Subcommands:
- `forge service list` — print all custom instances with their port and options
- `forge service add <type> [name] [--port <port>] [--replica-set]` — add a named instance
- `forge service remove <type> <name>` — remove a named instance
- `forge service configure <type> <name> [--port <port>] [--replica-set]` — update options

All subcommands call the daemon via `client` (the existing HTTP client at `src/cli/client.js`). Read that file to understand the client API pattern before implementing.

- [ ] **Step 1: Read client.js to understand the HTTP call pattern**

```bash
cat src/cli/client.js
```

Then implement the new routes by following the same pattern as existing methods like `client.getServices()`.

- [ ] **Step 2: Add client methods for instance management**

In `src/cli/client.js`, add:

```js
async listInstances() {
  const res = await this.get('/api/services/instances');
  return res.json();
},

async addInstance(type, instance, { port, replicaSet } = {}) {
  const res = await this.post('/api/services/instances', {
    type,
    instance,
    ...(port ? { port } : {}),
    options: { ...(replicaSet ? { replicaSet: true } : {}) },
  });
  return res.json();
},

async removeInstance(key) {
  const res = await this.delete(`/api/services/instances/${encodeURIComponent(key)}`);
  return res.json();
},

async configureInstance(key, options) {
  const res = await this.patch(`/api/services/instances/${encodeURIComponent(key)}`, { options });
  return res.json();
},
```

Read `src/cli/client.js` first to ensure the `get`, `post`, `delete`, `patch` method names match what's already there.

- [ ] **Step 3: Implement `service.js` command**

```js
// src/cli/commands/service.js
const chalk = require('chalk');
const client = require('../client');

const KNOWN_TYPES = ['mongo', 'postgres', 'redis', 'rabbitmq'];

module.exports = function registerService(program) {
  const service = program
    .command('service')
    .description('Manage named shared service instances');

  service
    .command('list')
    .description('List all custom service instances')
    .action(async () => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      const instances = await client.listInstances();
      if (instances.length === 0) {
        console.log(chalk.dim('No custom service instances configured.'));
        return;
      }
      for (const inst of instances) {
        const opts = Object.entries(inst.options ?? {})
          .filter(([, v]) => v)
          .map(([k]) => chalk.cyan(k))
          .join(', ');
        console.log(
          `${chalk.bold(inst.key)}  ${chalk.dim(`port ${inst.port}`)}${opts ? `  ${opts}` : ''}`
        );
      }
    });

  service
    .command('add <type> <name>')
    .description('Add a named service instance (e.g. forge service add mongo rs)')
    .option('--port <port>', 'Port to bind (default: auto-assigned)', parseInt)
    .option('--replica-set', 'Enable MongoDB replica set mode (mongo only)')
    .action(async (type, name, opts) => {
      if (!KNOWN_TYPES.includes(type)) {
        console.error(chalk.red(`Unknown service type "${type}". Valid types: ${KNOWN_TYPES.join(', ')}`));
        process.exit(1);
      }
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      const result = await client.addInstance(type, name, { port: opts.port, replicaSet: opts.replicaSet });
      if (result.error) {
        console.error(chalk.red(result.error));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Added ${chalk.bold(result.key)} on port ${result.port}`));
      console.log(chalk.dim(`  Reference in .forge/config.json as "${result.key}"`));
    });

  service
    .command('remove <type> <name>')
    .description('Remove a named service instance')
    .action(async (type, name) => {
      const key = `${type}:${name}`;
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      const result = await client.removeInstance(key);
      if (result.error) {
        console.error(chalk.red(result.error));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Removed ${chalk.bold(key)}`));
    });

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
      const result = await client.configureInstance(key, updates.options ?? {});
      if (result.error) {
        console.error(chalk.red(result.error));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Updated ${chalk.bold(key)}`));
    });
};
```

- [ ] **Step 4: No automated tests for CLI output** — the CLI is thin glue over the daemon API which is fully tested. Manual smoke test after wiring.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/service.js src/cli/client.js
git commit -m "feat: forge service CLI subcommand (add, remove, configure, list)"
```

---

## Task 8: Wire CLI and Final Verification

**Files:**
- Modify: `src/cli/index.js`

- [ ] **Step 1: Register the new command**

In `src/cli/index.js`, add after the existing `require('./commands/services')(program);` line:

```js
require('./commands/service')(program);
```

- [ ] **Step 2: Run full test suite**

```bash
npx jest --no-coverage
```
Expected: PASS

- [ ] **Step 3: Verify CLI help output includes the new command**

```bash
node src/cli/index.js service --help
```
Expected: Shows `list`, `add`, `remove`, `configure` subcommands.

```bash
node src/cli/index.js service add --help
```
Expected: Shows `<type>`, `<name>`, `--port`, `--replica-set` options.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.js
git commit -m "feat: register forge service command in CLI"
```

---

## Task 9: README Documentation

**Files:**
- Modify: `README.md`

Add a section documenting named service instances. Place it after the existing shared services documentation.

- [ ] **Step 1: Add documentation**

Find the shared services section in README.md (search for `forge services` or the services table). Add after it:

```markdown
## Named Service Instances

By default, forge runs one container per service type on the well-known port. You can add named instances to run multiple configurations side by side — useful when some projects need MongoDB replica set mode (required for transactions/sessions) while others do not.

### Managing instances

```bash
# Add a replica-set enabled MongoDB instance (port auto-assigned)
forge service add mongo rs --replica-set

# Add a second Postgres on a specific port
forge service add postgres analytics --port 5433

# List all custom instances
forge service list

# Update an instance's options
forge service configure mongo rs --replica-set

# Remove an instance
forge service remove mongo rs
```

### Referencing an instance in a project

In `.forge/config.json`, use `"type:instance"` as the service key:

```json
{
  "name": "sai",
  "services": {
    "mongo:rs": {
      "db": "sai",
      "env": "MONGODB_URL"
    }
  }
}
```

The connection string written to `.env.forge` will include `?replicaSet=rs0` automatically when the instance was created with `--replica-set`.

### MongoDB replica set (transactions and sessions)

A single-node replica set satisfies Mongo's requirement for multi-document transactions and change streams without the overhead of a real multi-member replica set:

```bash
forge service add mongo rs --replica-set
```

forge starts the container with `--replSet rs0 --bind_ip_all` and runs `rs.initiate()` automatically after the container is healthy.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document named service instances and forge service command"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|-------------|------|
| `forge service add <type> [name] [--port] [--replica-set]` | Task 7 |
| `forge service remove <type> <name>` | Task 7 |
| `forge service configure <type> <name>` | Task 7 |
| `forge service list` | Task 7 |
| Default instance = well-known port, not stored | Task 6 (hardcoded defaults) |
| Named instances use forge-allocated port | Task 5 (`findFreePort`) |
| User can specify explicit port | Task 5, 7 (`--port`) |
| `"mongo:rs"` key syntax in project config | Task 4 (manager parses keys as-is) |
| MongoDB `--replSet rs0 --bind_ip_all` | Task 2 |
| `rs.initiate()` post-start | Task 2, 4 |
| Connection string appends `?replicaSet=rs0` | Task 2 |
| Multiple instances of same type on different ports | Task 1, 5, 6 |
| Persist instances across daemon restarts | Task 1, 6 |
| Register new driver at runtime (no daemon restart required) | Task 4 (`registerDriver`) |

### Potential gaps

- **`forge service configure` changing port**: The `PATCH` route updates the stored config but does NOT restart the container. The user would need to restart forge for a port change to take effect. This is acceptable for now — a warning in the CLI output would be a nice addition.
- **Removing an instance does not stop the container**: The `DELETE` route removes from the store but does not call `driver.stop()`. The container continues running until forge restarts or the user stops it manually via Docker. This is intentional (safe default) — add a `--stop` flag later if needed.
- **`restoreFromRegistry` for named instances**: Named instance drivers are created with `name: "mongo:rs"`. The `restoreFromRegistry` in each driver looks up `project.allocations.services["mongo:rs"]` — this matches how projects store their service URLs. This is correct.
