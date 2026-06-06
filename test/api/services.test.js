const request = require('supertest');
const { createServer } = require('../../src/daemon/server');
const { createRegistry } = require('../../src/daemon/registry');
const { createPortAllocator } = require('../../src/daemon/port-allocator');
const { createServiceManager } = require('../../src/daemon/services/manager');
const { createInstanceStore } = require('../../src/daemon/services/instance-store');
const os = require('os');
const fs = require('fs');
const path = require('path');

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

function tmpServer(drivers) {
  const p = path.join(os.tmpdir(), `forge-svc-test-${Date.now()}.json`);
  const { app } = createServer({
    registry: createRegistry(p),
    portAllocator: createPortAllocator(),
    serviceManager: createServiceManager(drivers),
  });
  return { app, cleanup: () => fs.existsSync(p) && fs.unlinkSync(p) };
}

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

test('GET /api/services returns empty array when no drivers registered', async () => {
  const { app, cleanup } = tmpServer([]);
  const res = await request(app).get('/api/services');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
  cleanup();
});

test('GET /api/services returns health status for each driver', async () => {
  const mongo = makeMockDriver('mongo', true);
  const redis = makeMockDriver('redis', false);
  const { app, cleanup } = tmpServer([mongo, redis]);
  const res = await request(app).get('/api/services');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([
    { name: 'mongo', containerName: 'forge-mongo', healthy: true },
    { name: 'redis', containerName: 'forge-redis', healthy: false },
  ]);
  cleanup();
});

test('GET /api/services does not start drivers — only checks health', async () => {
  const mongo = makeMockDriver('mongo', true);
  const { app, cleanup } = tmpServer([mongo]);
  await request(app).get('/api/services');
  expect(mongo.start).not.toHaveBeenCalled();
  cleanup();
});

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

test('GET /api/services/instances includes built-in services from the catalog', async () => {
  const mongo = makeMockDriver('mongo', true);
  const redis = makeMockDriver('redis', true);
  const { app, cleanup } = tmpServerWithStore([mongo, redis]);
  const res = await request(app).get('/api/services/instances');
  expect(res.status).toBe(200);
  const keys = res.body.map(i => i.key);
  expect(keys).toEqual(expect.arrayContaining(['mongo', 'redis']));
  const mongoEntry = res.body.find(i => i.key === 'mongo');
  expect(mongoEntry.builtIn).toBe(true);
  expect(mongoEntry.type).toBe('mongo');
  expect(mongoEntry.instance).toBeNull();
  cleanup();
});

test('GET /api/services/instances surfaces driver port for built-ins when registered', async () => {
  const mongo = makeMockDriver('mongo', true); // mock driver port = 9999
  const { app, cleanup } = tmpServerWithStore([mongo]);
  const res = await request(app).get('/api/services/instances');
  const mongoEntry = res.body.find(i => i.key === 'mongo');
  expect(mongoEntry.port).toBe(9999);
  cleanup();
});

test('GET /api/services/instances includes healthy=true for healthy drivers', async () => {
  const mongo = makeMockDriver('mongo', true);
  const { app, cleanup } = tmpServerWithStore([mongo]);
  const res = await request(app).get('/api/services/instances');
  const mongoEntry = res.body.find(i => i.key === 'mongo');
  expect(mongoEntry.healthy).toBe(true);
  cleanup();
});

test('GET /api/services/instances includes healthy=false for unhealthy drivers', async () => {
  const redis = makeMockDriver('redis', false);
  const { app, cleanup } = tmpServerWithStore([redis]);
  const res = await request(app).get('/api/services/instances');
  const redisEntry = res.body.find(i => i.key === 'redis');
  expect(redisEntry.healthy).toBe(false);
  cleanup();
});

test('GET /api/services/instances returns healthy=null for stored instances without a registered driver', async () => {
  const { app, cleanup } = tmpServerWithStore([], {
    'mongo:rs': { type: 'mongo', instance: 'rs', port: 27842, options: {} },
  });
  const res = await request(app).get('/api/services/instances');
  const entry = res.body.find(i => i.key === 'mongo:rs');
  expect(entry.healthy).toBeNull();
  cleanup();
});

test('GET /api/services/instances merges built-ins and named instances, built-ins first', async () => {
  const mongo = makeMockDriver('mongo', true);
  const { app, cleanup } = tmpServerWithStore([mongo], {
    'mongo:rs': { type: 'mongo', instance: 'rs', port: 27842, options: { replicaSet: true } },
  });
  const res = await request(app).get('/api/services/instances');
  expect(res.body).toHaveLength(2);
  expect(res.body[0].key).toBe('mongo');
  expect(res.body[0].builtIn).toBe(true);
  expect(res.body[1].key).toBe('mongo:rs');
  expect(res.body[1].builtIn).toBe(false);
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

test('POST /api/services/instances returns 400 when type or instance is missing', async () => {
  const { app, cleanup } = tmpServerWithStore([]);
  const res = await request(app)
    .post('/api/services/instances')
    .send({ type: 'mongo' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/required/i);
  cleanup();
});

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

test('PATCH /api/services/instances/mongo can be patched twice (idempotent upsert)', async () => {
  const { app, cleanup } = tmpServerWithStore([]);
  await request(app)
    .patch('/api/services/instances/mongo')
    .send({ options: { replicaSet: true } })
    .expect(200);
  const res = await request(app)
    .patch('/api/services/instances/mongo')
    .send({ options: { replicaSet: false } });
  expect(res.status).toBe(200);
  const listRes = await request(app).get('/api/services/instances');
  const entry = listRes.body.find(i => i.key === 'mongo');
  expect(entry.options.replicaSet).toBe(false);
  cleanup();
});
