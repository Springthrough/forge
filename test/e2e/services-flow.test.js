// test/e2e/services-flow.test.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createServer } = require('../../src/daemon/server');
const { createRegistry } = require('../../src/daemon/registry');
const { createPortAllocator } = require('../../src/daemon/port-allocator');
const { createServiceManager } = require('../../src/daemon/services/manager');
const { writeEnvFile } = require('../../src/cli/env-file');
const { findFreePort } = require('../helpers/find-free-port');

// Mock drivers — implement the full driver interface without Docker
function makeMockDriver(name, urlTemplate) {
  const provisioned = new Map();
  return {
    name,
    containerName: `forge-${name}`,
    image: `${name}:latest`,
    port: 9999,
    start: jest.fn().mockResolvedValue(undefined),
    healthCheck: jest.fn().mockResolvedValue(true),
    provision: jest.fn().mockImplementation((projectName) => {
      provisioned.set(projectName, true);
      return Promise.resolve();
    }),
    connectionString: jest.fn().mockImplementation((projectName) => urlTemplate(projectName)),
    deprovision: jest.fn().mockImplementation((projectName) => {
      provisioned.delete(projectName);
      return Promise.resolve();
    }),
    restoreFromRegistry: jest.fn(),
    _provisioned: provisioned,
  };
}

let httpServer;
let daemonPort;
let registryPath;
let projectDir;
let registry;
let mongoDriver;
let redisDriver;

beforeAll(async () => {
  const candidatePort = await findFreePort();

  registryPath = path.join(os.tmpdir(), `forge-svc-e2e-${Date.now()}.json`);
  projectDir = path.join(os.tmpdir(), `forge-svc-e2e-proj-${Date.now()}`);
  fs.mkdirSync(path.join(projectDir, '.forge'), { recursive: true });

  fs.writeFileSync(
    path.join(projectDir, '.forge', 'config.json'),
    JSON.stringify({
      name: 'sai',
      envFile: '.env.forge',
      processes: [
        { name: 'api', command: 'echo hi', cwd: '.', ports: [candidatePort], portEnv: 'PORT' },
      ],
      services: {
        mongo: { db: 'sai', env: 'DATABASE_URL' },
        redis: { env: 'REDIS_URL', prefix: 'sai', prefixEnv: 'REDIS_KEY_PREFIX' },
      },
    })
  );

  mongoDriver = makeMockDriver('mongo', (p) => `mongodb://localhost:27017/${p}`);
  redisDriver = makeMockDriver('redis', (_p) => `redis://localhost:6379/1`);
  const serviceManager = createServiceManager([mongoDriver, redisDriver]);

  registry = createRegistry(registryPath);
  const { app } = createServer({
    registry,
    portAllocator: createPortAllocator(),
    serviceManager,
  });
  httpServer = http.createServer(app);
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  daemonPort = httpServer.address().port;
});

afterAll(async () => {
  await new Promise(resolve => httpServer.close(resolve));
  fs.rmSync(projectDir, { recursive: true, force: true });
  if (fs.existsSync(registryPath)) fs.unlinkSync(registryPath);
});

test('register a project with services — provision is called on each driver', async () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(projectDir, '.forge', 'config.json'), 'utf8')
  );
  const res = await fetch(`http://127.0.0.1:${daemonPort}/api/projects/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...config, path: projectDir }),
  });
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(mongoDriver.provision).toHaveBeenCalledWith('sai', { db: 'sai', env: 'DATABASE_URL' });
  expect(redisDriver.provision).toHaveBeenCalledWith('sai', { env: 'REDIS_URL', prefix: 'sai', prefixEnv: 'REDIS_KEY_PREFIX' });
  expect(body.allocations.services.mongo).toBe('mongodb://localhost:27017/sai');
  expect(body.allocations.services.redis).toBe('redis://localhost:6379/1');
});

test('registration response persists connection strings in registry', () => {
  const project = registry.get('sai');
  expect(project).not.toBeNull();
  expect(project.allocations.services.mongo).toBe('mongodb://localhost:27017/sai');
  expect(project.allocations.services.redis).toBe('redis://localhost:6379/1');
});

test('writeEnvFile writes service connection strings using config env var names', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(projectDir, '.forge', 'config.json'), 'utf8')
  );
  const project = registry.get('sai');
  writeEnvFile(projectDir, config.envFile, project.allocations, config);

  const env = fs.readFileSync(path.join(projectDir, '.env.forge'), 'utf8');
  expect(env).toContain('DATABASE_URL=mongodb://localhost:27017/sai');
  expect(env).toContain('REDIS_URL=redis://localhost:6379/1');
  expect(env).toContain('REDIS_KEY_PREFIX=sai');
});

test('delete project calls deprovision on each service driver', async () => {
  const del = await fetch(`http://127.0.0.1:${daemonPort}/api/projects/sai`, {
    method: 'DELETE',
  });
  expect(del.status).toBe(200);
  expect(mongoDriver.deprovision).toHaveBeenCalledWith('sai');
  expect(redisDriver.deprovision).toHaveBeenCalledWith('sai');
  expect(registry.get('sai')).toBeNull();
});
