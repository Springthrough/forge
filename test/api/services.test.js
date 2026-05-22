const request = require('supertest');
const { createServer } = require('../../src/daemon/server');
const { createRegistry } = require('../../src/daemon/registry');
const { createPortAllocator } = require('../../src/daemon/port-allocator');
const { createServiceManager } = require('../../src/daemon/services/manager');
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
