// test/e2e/up-down-flow.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createServer } = require('../../src/daemon/server');
const { createRegistry } = require('../../src/daemon/registry');
const { createPortAllocator } = require('../../src/daemon/port-allocator');
const { createServiceManager } = require('../../src/daemon/services/manager');
const { createProcessManager } = require('../../src/daemon/process-manager');

const noopServiceManager = createServiceManager([]);

function makeTempRegistry() {
  const registryPath = path.join(os.tmpdir(), `forge-up-down-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const registry = createRegistry(registryPath);
  return { registry, cleanup: () => { try { fs.unlinkSync(registryPath); } catch {} } };
}

function makeMockPtySpawn() {
  const ptys = [];
  function spawn(command, env, cwd) {
    let exitCb = null;
    const pty = {
      pid: Math.floor(Math.random() * 9000 + 1000),
      command,
      env,
      cwd,
      onData() {},
      onExit(cb) { exitCb = cb; },
      write: jest.fn(),
      resize: jest.fn(),
      kill: jest.fn(() => exitCb?.({ exitCode: 0 })),
    };
    ptys.push(pty);
    return pty;
  }
  return { spawn, ptys };
}

function setup() {
  const tmp = makeTempRegistry();
  const registry = tmp.registry;
  const { spawn, ptys } = makeMockPtySpawn();
  const processManager = createProcessManager({ ptySpawn: spawn });
  const { app } = createServer({
    registry,
    portAllocator: createPortAllocator(),
    serviceManager: noopServiceManager,
    processManager,
  });

  registry.add('sai', {
    path: '/projects/sai',
    config: {
      name: 'sai',
      processes: [
        { name: 'api',    command: 'node server.js',  cwd: '.', ports: [3000], portEnv: 'PORT' },
        { name: 'worker', command: 'node worker.js',  cwd: '.', ports: [] },
      ],
      services: {},
    },
    allocations: { ports: { api: 3000 }, services: {} },
  });

  return { app, processManager, ptys, cleanup: tmp.cleanup };
}

describe('up/down/restart flow', () => {
  test('POST /up starts all project processes and GET /processes shows running', async () => {
    const { app, cleanup } = setup();
    try {
      await request(app).post('/api/projects/sai/processes/up').expect(200);

      const res = await request(app).get('/api/projects/sai/processes');
      expect(res.status).toBe(200);
      expect(res.body.project).toBe('sai');
      expect(res.body.processes).toHaveLength(2);
      expect(res.body.processes.every(p => p.status === 'running')).toBe(true);
    } finally {
      cleanup();
    }
  });

  test('POST /up injects allocated port into PTY env', async () => {
    const { app, ptys, cleanup } = setup();
    try {
      await request(app).post('/api/projects/sai/processes/up').expect(200);
      const apiPty = ptys.find(p => p.command === 'node server.js');
      expect(apiPty).toBeDefined();
      expect(apiPty.env.PORT).toBe('3000');
    } finally {
      cleanup();
    }
  });

  test('POST /up is idempotent — second call does not re-spawn processes', async () => {
    const { app, ptys, cleanup } = setup();
    try {
      await request(app).post('/api/projects/sai/processes/up').expect(200);
      await request(app).post('/api/projects/sai/processes/up').expect(200);
      expect(ptys).toHaveLength(2); // not 4
    } finally {
      cleanup();
    }
  });

  test('POST /down stops all processes and GET /processes shows stopped', async () => {
    const { app, cleanup } = setup();
    try {
      await request(app).post('/api/projects/sai/processes/up').expect(200);
      await request(app).post('/api/projects/sai/processes/down').expect(200);

      const res = await request(app).get('/api/projects/sai/processes');
      expect(res.body.processes.every(p => p.status === 'stopped')).toBe(true);
    } finally {
      cleanup();
    }
  });

  test('POST /restart respawns a stopped process', async () => {
    const { app, ptys, cleanup } = setup();
    try {
      await request(app).post('/api/projects/sai/processes/up').expect(200);
      await request(app).post('/api/projects/sai/processes/api/restart').expect(200);
      expect(ptys).toHaveLength(3); // initial 2 + 1 restart

      const res = await request(app).get('/api/projects/sai/processes');
      expect(res.body.processes.find(p => p.name === 'api').status).toBe('running');
    } finally {
      cleanup();
    }
  });

  test('GET /processes returns 404 for unregistered project', async () => {
    const { app, cleanup } = setup();
    try {
      await request(app).get('/api/projects/unknown/processes').expect(404);
    } finally {
      cleanup();
    }
  });

  test('POST /up returns 404 for unregistered project', async () => {
    const { app, cleanup } = setup();
    try {
      await request(app).post('/api/projects/unknown/processes/up').expect(404);
    } finally {
      cleanup();
    }
  });
});
