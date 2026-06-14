const request = require('supertest');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createServer } = require('../../src/daemon/server');
const { createRegistry } = require('../../src/daemon/registry');
const { createPortAllocator } = require('../../src/daemon/port-allocator');
const { createServiceManager } = require('../../src/daemon/services/manager');
const { findFreePort } = require('../helpers/find-free-port');

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

let currentCleanup;

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
      envFile: false,
      processes: [{ name: 'api', command: 'npm start', cwd: '.', ports: [3000], portEnv: 'PORT' }],
      services: {},
    },
    allocations: { ports: { api: 3000 }, services: {} },
  });
  const { app } = createServer({ registry, portAllocator, serviceManager, processManager });
  const cleanup = () => fs.existsSync(tmpPath) && fs.unlinkSync(tmpPath);
  currentCleanup = cleanup;
  return { app, processManager, cleanup };
}

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

afterEach(() => {
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }
});

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
    '/projects/sai',
    expect.any(Object)
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
  expect(processManager.down).toHaveBeenCalledWith(
    'sai',
    expect.arrayContaining([expect.objectContaining({ name: 'api' })])
  );
});

test('POST /api/projects/:name/processes/:proc/restart calls processManager.restart', async () => {
  const { app, processManager } = setup();
  const res = await request(app).post('/api/projects/sai/processes/api/restart');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(processManager.restart).toHaveBeenCalledWith(
    'sai', 'api', expect.any(Array), expect.any(Object), '/projects/sai', expect.any(Object)
  );
});

test('POST restart returns 404 for unknown project', async () => {
  const { app } = setup();
  const res = await request(app).post('/api/projects/unknown/processes/api/restart');
  expect(res.status).toBe(404);
});

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
    config: { name: 'sai', envFile: false, processes: [], services: { mongo: { db: 'sai' } } },
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

test('POST up returns 500 when processManager.up throws', async () => {
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
  expect(procsPassed[0].name).toBe('api');
  expect(procsPassed[0].env).toBeUndefined();
});

test('POST /processes/up allocates a port for a process added to config after registration', async () => {
  const { app, processManager, rewriteConfig } = setupWithDisk();
  const newPort = await findFreePort();
  rewriteConfig(c => {
    c.processes.push({
      name: 'worker',
      command: 'node worker.js --port $PORT',
      cwd: '.',
      ports: [newPort],
      portEnv: 'PORT',
    });
    return c;
  });
  const res = await request(app).post('/api/projects/sai/processes/up');
  expect(res.status).toBe(200);
  const allocationsPassed = processManager.up.mock.calls[0][2];
  expect(allocationsPassed.ports).toHaveProperty('worker', newPort);
  expect(allocationsPassed.ports).toHaveProperty('api', 3000);
});

test('POST /processes/up writes portExportEnv for a newly-added process to the env file', async () => {
  const { app, projectDir, rewriteConfig } = setupWithDisk();
  const newPort = await findFreePort();
  rewriteConfig(c => {
    c.envFile = '.env.forge';
    c.processes.push({
      name: 'worker',
      command: 'node worker.js --port $PORT',
      cwd: '.',
      ports: [newPort],
      portEnv: 'PORT',
      portExportEnv: 'WORKER_PORT',
    });
    return c;
  });
  const res = await request(app).post('/api/projects/sai/processes/up');
  expect(res.status).toBe(200);
  const envPath = path.join(projectDir, '.env.forge');
  expect(fs.existsSync(envPath)).toBe(true);
  expect(fs.readFileSync(envPath, 'utf8')).toMatch(new RegExp(`WORKER_PORT=${newPort}`));
});

test('POST /processes/:name/restart writes the env file with fresh config', async () => {
  const { app, projectDir, rewriteConfig } = setupWithDisk();
  // Make envFile a real path so writeEnvFile actually writes
  rewriteConfig(c => {
    c.envFile = '.env.forge';
    c.processes[0].portExportEnv = 'API_PORT';
    return c;
  });
  const res = await request(app).post('/api/projects/sai/processes/api/restart');
  expect(res.status).toBe(200);

  const envPath = path.join(projectDir, '.env.forge');
  expect(fs.existsSync(envPath)).toBe(true);
  const envContents = fs.readFileSync(envPath, 'utf8');
  expect(envContents).toMatch(/API_PORT=3000/);
});
