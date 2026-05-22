const request = require('supertest');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createServer } = require('../../src/daemon/server');
const { createRegistry } = require('../../src/daemon/registry');
const { createPortAllocator } = require('../../src/daemon/port-allocator');
const { createServiceManager } = require('../../src/daemon/services/manager');

function makeMockProcessManager() {
  return {
    up:           jest.fn(),
    down:         jest.fn(),
    restart:      jest.fn(),
    getStatuses:  jest.fn(() => [{ name: 'api', status: 'stopped', pid: null, uptime: 0 }]),
    isRunning:    jest.fn(() => false),
    getBuffer:    jest.fn(() => []),
    subscribe:    jest.fn(),
    unsubscribe:  jest.fn(),
    sendInput:    jest.fn(),
    resize:       jest.fn(),
    killAll:      jest.fn(),
    startProcess: jest.fn(),
    stopProcess:  jest.fn(),
  };
}

function setup() {
  const tmpPath = path.join(os.tmpdir(), `forge-processes-test-${Date.now()}-${Math.random()}.json`);
  const registry = createRegistry(tmpPath);
  const portAllocator = createPortAllocator();
  const serviceManager = createServiceManager([]);
  const processManager = makeMockProcessManager();
  registry.add('sai', {
    path: '/projects/sai',
    config: {
      name: 'sai',
      processes: [{ name: 'api', command: 'npm start', cwd: '.', ports: [3000], portEnv: 'PORT' }],
      services: {},
    },
    allocations: { ports: { api: 3000 }, services: {} },
  });
  const { app } = createServer({ registry, portAllocator, serviceManager, processManager });
  return { app, processManager, cleanup: () => fs.existsSync(tmpPath) && fs.unlinkSync(tmpPath) };
}

test('GET /api/projects/:name/processes returns process list', async () => {
  const { app } = setup();
  const res = await request(app).get('/api/projects/sai/processes');
  expect(res.status).toBe(200);
  expect(res.body.project).toBe('sai');
  expect(Array.isArray(res.body.processes)).toBe(true);
  expect(res.body.processes[0].name).toBe('api');
});

test('GET /api/projects/:name/processes returns 404 for unknown project', async () => {
  const { app } = setup();
  const res = await request(app).get('/api/projects/unknown/processes');
  expect(res.status).toBe(404);
});

test('POST /api/projects/:name/processes/up calls processManager.up', async () => {
  const { app, processManager } = setup();
  const res = await request(app).post('/api/projects/sai/processes/up');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(processManager.up).toHaveBeenCalledWith(
    'sai',
    expect.arrayContaining([expect.objectContaining({ name: 'api' })]),
    expect.objectContaining({ ports: { api: 3000 } }),
    '/projects/sai'
  );
});

test('POST /api/projects/:name/processes/up returns 404 for unknown project', async () => {
  const { app } = setup();
  const res = await request(app).post('/api/projects/unknown/processes/up');
  expect(res.status).toBe(404);
});

test('POST /api/projects/:name/processes/down calls processManager.down', async () => {
  const { app, processManager } = setup();
  const res = await request(app).post('/api/projects/sai/processes/down');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(processManager.down).toHaveBeenCalledWith('sai');
});

test('POST /api/projects/:name/processes/:proc/restart calls processManager.restart', async () => {
  const { app, processManager } = setup();
  const res = await request(app).post('/api/projects/sai/processes/api/restart');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(processManager.restart).toHaveBeenCalledWith(
    'sai', 'api', expect.any(Array), expect.any(Object), '/projects/sai'
  );
});

test('POST restart returns 404 for unknown project', async () => {
  const { app } = setup();
  const res = await request(app).post('/api/projects/unknown/processes/api/restart');
  expect(res.status).toBe(404);
});
