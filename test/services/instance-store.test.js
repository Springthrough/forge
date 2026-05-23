const os = require('os');
const fs = require('fs');
const path = require('path');
const { createInstanceStore, findFreePort } = require('../../src/daemon/services/instance-store');

function tmpStore() {
  const p = path.join(os.tmpdir(), `forge-instance-store-test-${Date.now()}.json`);
  return { store: createInstanceStore(p), cleanup: () => fs.existsSync(p) && fs.unlinkSync(p) };
}

test('getAll returns empty object when file does not exist', () => {
  const { store, cleanup } = tmpStore();
  expect(store.getAll()).toEqual({});
  cleanup();
});

test('set and get round-trip', () => {
  const { store, cleanup } = tmpStore();
  store.set('mongo:rs', { type: 'mongo', instance: 'rs', port: 27842, options: { replicaSet: true } });
  expect(store.get('mongo:rs')).toEqual({ type: 'mongo', instance: 'rs', port: 27842, options: { replicaSet: true } });
  cleanup();
});

test('get returns null for unknown key', () => {
  const { store, cleanup } = tmpStore();
  expect(store.get('mongo:rs')).toBeNull();
  cleanup();
});

test('has returns true for existing key', () => {
  const { store, cleanup } = tmpStore();
  store.set('mongo:rs', { type: 'mongo', instance: 'rs', port: 27842, options: {} });
  expect(store.has('mongo:rs')).toBe(true);
  cleanup();
});

test('has returns false for missing key', () => {
  const { store, cleanup } = tmpStore();
  expect(store.has('mongo:rs')).toBe(false);
  cleanup();
});

test('remove deletes an existing key', () => {
  const { store, cleanup } = tmpStore();
  store.set('mongo:rs', { type: 'mongo', instance: 'rs', port: 27842, options: {} });
  store.remove('mongo:rs');
  expect(store.has('mongo:rs')).toBe(false);
  cleanup();
});

test('remove throws for unknown key', () => {
  const { store, cleanup } = tmpStore();
  expect(() => store.remove('mongo:rs')).toThrow('"mongo:rs" not found');
  cleanup();
});

test('set overwrites an existing key', () => {
  const { store, cleanup } = tmpStore();
  store.set('mongo:rs', { type: 'mongo', instance: 'rs', port: 27842, options: {} });
  store.set('mongo:rs', { type: 'mongo', instance: 'rs', port: 27900, options: { replicaSet: true } });
  expect(store.get('mongo:rs').port).toBe(27900);
  cleanup();
});

test('getAll returns all stored instances', () => {
  const { store, cleanup } = tmpStore();
  store.set('mongo:rs', { type: 'mongo', instance: 'rs', port: 27842, options: {} });
  store.set('postgres:analytics', { type: 'postgres', instance: 'analytics', port: 5433, options: {} });
  const all = store.getAll();
  expect(Object.keys(all)).toHaveLength(2);
  expect(all['mongo:rs'].port).toBe(27842);
  cleanup();
});

test('findFreePort returns a number', async () => {
  const port = await findFreePort(27100);
  expect(typeof port).toBe('number');
  expect(port).toBeGreaterThanOrEqual(27100);
});
