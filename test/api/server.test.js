const os = require('os');
const fs = require('fs');
const path = require('path');
const { buildDriverList } = require('../../src/daemon/server');
const { createInstanceStore } = require('../../src/daemon/services/instance-store');

function tmpStore(data = {}) {
  const p = path.join(os.tmpdir(), `forge-server-test-${Date.now()}-${Math.random()}.json`);
  const store = createInstanceStore(p);
  for (const [key, cfg] of Object.entries(data)) store.set(key, cfg);
  return { store, cleanup: () => fs.existsSync(p) && fs.unlinkSync(p) };
}

const defaultMongo = { name: 'mongo', containerName: 'forge-mongo' };
const defaultRedis = { name: 'redis', containerName: 'forge-redis' };

test('buildDriverList returns default drivers when instance store is empty', () => {
  const { store, cleanup } = tmpStore();
  const mongoFactory = jest.fn();
  const drivers = buildDriverList(store, { mongo: mongoFactory }, [defaultMongo, defaultRedis]);
  expect(mongoFactory).not.toHaveBeenCalled();
  expect(drivers).toEqual([defaultMongo, defaultRedis]);
  cleanup();
});

test('buildDriverList replaces built-in singleton with factory-built driver when store has override', () => {
  const overrideDriver = { name: 'mongo', containerName: 'forge-mongo', replicaSet: true };
  const mongoFactory = jest.fn().mockReturnValue(overrideDriver);
  const { store, cleanup } = tmpStore({
    mongo: { type: 'mongo', port: 27017, options: { replicaSet: true } },
  });
  const drivers = buildDriverList(store, { mongo: mongoFactory }, [defaultMongo, defaultRedis]);
  expect(mongoFactory).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'mongo', containerName: 'forge-mongo', port: 27017, replicaSet: true })
  );
  expect(drivers).toContain(overrideDriver);
  expect(drivers).toContain(defaultRedis);
  expect(drivers).not.toContain(defaultMongo);
  expect(drivers).toHaveLength(2);
  cleanup();
});

test('buildDriverList includes both default drivers and named custom instances', () => {
  const rsDriver = { name: 'mongo:rs', containerName: 'forge-mongo-rs' };
  const mongoFactory = jest.fn().mockReturnValue(rsDriver);
  const { store, cleanup } = tmpStore({
    'mongo:rs': { type: 'mongo', instance: 'rs', port: 27100, options: { replicaSet: true } },
  });
  const drivers = buildDriverList(store, { mongo: mongoFactory }, [defaultMongo, defaultRedis]);
  expect(mongoFactory).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'mongo:rs', containerName: 'forge-mongo-rs', port: 27100 })
  );
  expect(drivers).toContain(defaultMongo);
  expect(drivers).toContain(defaultRedis);
  expect(drivers).toContain(rsDriver);
  expect(drivers).toHaveLength(3);
  cleanup();
});

test('buildDriverList skips instances with unknown type', () => {
  const { store, cleanup } = tmpStore({
    'cassandra:main': { type: 'cassandra', instance: 'main', port: 9042, options: {} },
  });
  const drivers = buildDriverList(store, { mongo: jest.fn() }, [defaultMongo]);
  expect(drivers).toEqual([defaultMongo]);
  cleanup();
});
