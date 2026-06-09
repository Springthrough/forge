const os = require('os');
const fs = require('fs');
const path = require('path');
const { createRegistry } = require('../src/daemon/registry');
const { refreshProjectConfig } = require('../src/daemon/refresh-project');

let projectPath;
let registryPath;
let registry;

beforeEach(() => {
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-refresh-test-'));
  fs.mkdirSync(path.join(projectPath, '.forge'));
  registryPath = path.join(os.tmpdir(), `forge-refresh-registry-${Date.now()}-${Math.random()}.json`);
  registry = createRegistry(registryPath);
});

afterEach(() => {
  fs.rmSync(projectPath, { recursive: true, force: true });
  if (fs.existsSync(registryPath)) fs.unlinkSync(registryPath);
});

function writeConfig(obj) {
  fs.writeFileSync(path.join(projectPath, '.forge', 'config.json'), JSON.stringify(obj));
}

test('returns null when project is not in the registry', () => {
  const result = refreshProjectConfig(registry, 'unknown', () => {});
  expect(result).toBeNull();
});

test('reads fresh config from disk and updates the registry on success', () => {
  registry.add('sai', { path: projectPath, config: { name: 'sai', processes: [] }, allocations: {} });
  writeConfig({ name: 'sai', processes: [{ name: 'api', command: 'updated' }] });

  const result = refreshProjectConfig(registry, 'sai', () => {});

  expect(result.config.processes).toEqual([{ name: 'api', command: 'updated' }]);
  expect(registry.get('sai').config.processes).toEqual([{ name: 'api', command: 'updated' }]);
});

test('falls back to existing registry entry when config.json is missing', () => {
  registry.add('sai', { path: projectPath, config: { name: 'sai', processes: [{ name: 'stale', command: 'old' }] }, allocations: {} });

  const logged = [];
  const result = refreshProjectConfig(registry, 'sai', msg => logged.push(msg));

  expect(result.config.processes).toEqual([{ name: 'stale', command: 'old' }]);
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatch(/Could not refresh config for "sai"/);
  expect(logged[0]).toMatch(/Using last-known config/);
});

test('falls back to existing registry entry when config.json is malformed JSON', () => {
  registry.add('sai', { path: projectPath, config: { name: 'sai', processes: [{ name: 'stale' }] }, allocations: {} });
  fs.writeFileSync(path.join(projectPath, '.forge', 'config.json'), '{not valid json');

  const logged = [];
  const result = refreshProjectConfig(registry, 'sai', msg => logged.push(msg));

  expect(result.config.processes).toEqual([{ name: 'stale' }]);
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatch(/Could not refresh config for "sai"/);
});

test('preserves non-config fields when refreshing (allocations untouched)', () => {
  registry.add('sai', {
    path: projectPath,
    config: { name: 'sai', processes: [] },
    allocations: { ports: { api: 4444 }, services: { mongo: 'mongodb://x' } },
  });
  writeConfig({ name: 'sai', processes: [{ name: 'api', command: 'new' }] });

  const result = refreshProjectConfig(registry, 'sai', () => {});

  expect(result.allocations).toEqual({ ports: { api: 4444 }, services: { mongo: 'mongodb://x' } });
});
