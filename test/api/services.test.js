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
