// test/e2e/up-down-flow.test.js
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createServer } = require('../../src/daemon/server');
const { createRegistry } = require('../../src/daemon/registry');
const { createPortAllocator } = require('../../src/daemon/port-allocator');
const { createServiceManager } = require('../../src/daemon/services/manager');
const { createProcessManager } = require('../../src/daemon/process-manager');
const { findFreePort } = require('../helpers/find-free-port');

function bindPort(port) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(port, '127.0.0.1', () => resolve({ port, close: () => new Promise(r => s.close(r)) }));
    s.on('error', reject);
  });
}

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
      envFile: false,
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
    const { app, ptys, cleanup } = setup();
    try {
      await request(app).post('/api/projects/sai/processes/up').expect(200);

      const downRes = await request(app).post('/api/projects/sai/processes/down');
      expect(downRes.status).toBe(200);
      expect(downRes.body.ok).toBe(true);

      // Verify PTYs were actually killed
      expect(ptys.every(p => p.kill.mock.calls.length > 0)).toBe(true);

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

  test('POST /up returns allocations in response', async () => {
    const { app, cleanup } = setup();
    try {
      const res = await request(app).post('/api/projects/sai/processes/up').expect(200);
      expect(res.body.allocations).toBeDefined();
      expect(res.body.allocations.ports.api).toBe(3000);
    } finally {
      cleanup();
    }
  });
});

describe('port re-validation on up', () => {
  test('POST /up re-allocates stale port and updates registry', async () => {
    const tmp = makeTempRegistry();
    const { spawn, ptys } = makeMockPtySpawn();
    const processManager = createProcessManager({ ptySpawn: spawn });
    const portAllocator = createPortAllocator();
    const [preferred, fallback] = await Promise.all([findFreePort(), findFreePort()]);

    // Simulate stale registry: preferred port was allocated but is now occupied
    tmp.registry.add('myapp', {
      path: '/projects/myapp',
      config: {
        name: 'myapp',
        envFile: false,
        processes: [
          { name: 'api', command: 'node s.js', cwd: '.', ports: [preferred, fallback], portEnv: 'PORT' },
        ],
        services: {},
      },
      allocations: { ports: { api: preferred }, services: {} },
    });
    // Restore the stale reservation so portAllocator knows about it
    portAllocator.restoreFromRegistry(tmp.registry.getAll());

    const { app } = createServer({ registry: tmp.registry, portAllocator, serviceManager: noopServiceManager, processManager });

    // Occupy the preferred port so re-validation is forced
    const occupied = await bindPort(preferred);
    try {
      const res = await request(app).post('/api/projects/myapp/processes/up').expect(200);
      expect(res.body.allocations.ports.api).toBe(fallback);

      // Registry updated with new port
      expect(tmp.registry.get('myapp').allocations.ports.api).toBe(fallback);

      // Process injected with new port
      const apiPty = ptys.find(p => p.command === 'node s.js');
      expect(apiPty.env.PORT).toBe(String(fallback));
    } finally {
      await occupied.close();
      tmp.cleanup();
    }
  });

  test('POST /up writes env file with re-validated port before spawning', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-up-envfile-'));
    const tmp = makeTempRegistry();
    const { spawn } = makeMockPtySpawn();
    const processManager = createProcessManager({ ptySpawn: spawn });
    const portAllocator = createPortAllocator();
    const [preferred, fallback] = await Promise.all([findFreePort(), findFreePort()]);

    tmp.registry.add('myapp', {
      path: tmpDir,
      config: {
        name: 'myapp',
        envFile: '.env.forge',
        processes: [
          { name: 'api', command: 'node s.js', cwd: '.', ports: [preferred, fallback], portEnv: 'PORT', portExportEnv: 'MYAPP_API_PORT' },
        ],
        services: {},
      },
      allocations: { ports: { api: preferred }, services: {} },
    });
    portAllocator.restoreFromRegistry(tmp.registry.getAll());

    const { app } = createServer({ registry: tmp.registry, portAllocator, serviceManager: noopServiceManager, processManager });

    const occupied = await bindPort(preferred);
    try {
      await request(app).post('/api/projects/myapp/processes/up').expect(200);

      const envContent = fs.readFileSync(path.join(tmpDir, '.env.forge'), 'utf8');
      expect(envContent).toContain(`MYAPP_API_PORT=${fallback}`);
      expect(envContent).not.toContain(`MYAPP_API_PORT=${preferred}`);
    } finally {
      await occupied.close();
      tmp.cleanup();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
