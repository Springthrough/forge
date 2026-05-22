const os = require('os');
const fs = require('fs');
const path = require('path');
const { createRegistry } = require('../src/daemon/registry');

let registryPath;
let registry;

beforeEach(() => {
  registryPath = path.join(os.tmpdir(), `forge-test-${Date.now()}.json`);
  registry = createRegistry(registryPath);
});

afterEach(() => {
  if (fs.existsSync(registryPath)) fs.unlinkSync(registryPath);
});

test('getAll returns empty object when file does not exist', () => {
  expect(registry.getAll()).toEqual({});
});

test('add writes a project to the registry', () => {
  registry.add('sai', { path: '/home/user/sai', allocations: {} });
  expect(registry.getAll().sai.path).toBe('/home/user/sai');
});

test('add sets addedAt as ISO timestamp', () => {
  registry.add('sai', { path: '/home/user/sai', allocations: {} });
  expect(registry.getAll().sai.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('get returns a single project by name', () => {
  registry.add('sai', { path: '/home/user/sai', allocations: {} });
  expect(registry.get('sai').path).toBe('/home/user/sai');
});

test('get returns null for unknown project', () => {
  expect(registry.get('unknown')).toBeNull();
});

test('remove deletes a project', () => {
  registry.add('sai', { path: '/home/user/sai', allocations: {} });
  registry.remove('sai');
  expect(registry.get('sai')).toBeNull();
});

test('update merges top-level keys into existing project', () => {
  registry.add('sai', { path: '/home/user/sai', allocations: { ports: {}, services: {} } });
  // Pass the full allocations object — update() is a shallow merge
  registry.update('sai', { allocations: { ports: { api: 4000 }, services: { mongo: 'mongodb://...' } } });
  const p = registry.get('sai');
  expect(p.allocations.ports.api).toBe(4000);
  expect(p.allocations.services.mongo).toBe('mongodb://...');
  expect(p.path).toBe('/home/user/sai');
});

test('update throws for unknown project', () => {
  expect(() => registry.update('unknown', {})).toThrow('"unknown"');
});

test('partial allocations update silently drops omitted keys (shallow merge — callers must pass complete allocations)', () => {
  registry.add('sai', { path: '/home/user/sai', allocations: { ports: { api: 4000 }, services: { mongo: 'x' } } });
  // Passing only ports drops services — this is expected behavior, not a bug
  registry.update('sai', { allocations: { ports: { api: 5000 } } });
  const p = registry.get('sai');
  expect(p.allocations.ports.api).toBe(5000);
  expect(p.allocations.services).toBeUndefined(); // shallow merge — services gone
});

test('data persists across registry instances', () => {
  registry.add('sai', { path: '/home/user/sai', allocations: {} });
  expect(createRegistry(registryPath).get('sai').path).toBe('/home/user/sai');
});

test('add throws if project already registered', () => {
  registry.add('sai', { path: '/home/user/sai', allocations: {} });
  expect(() => registry.add('sai', { path: '/other', allocations: {} })).toThrow('"sai"');
});

test('remove throws for unknown project', () => {
  expect(() => registry.remove('unknown')).toThrow('"unknown"');
});
