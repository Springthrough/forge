const { createServiceManager } = require('../../src/daemon/services/manager');

function makeMockDriver(name, healthy = true) {
  return {
    name,
    containerName: `forge-${name}`,
    image: `${name}:latest`,
    port: 9999,
    start: jest.fn().mockResolvedValue(undefined),
    healthCheck: jest.fn().mockResolvedValue(healthy),
    provision: jest.fn().mockResolvedValue(undefined),
    connectionString: jest.fn().mockReturnValue(`${name}://localhost/testdb`),
    deprovision: jest.fn().mockResolvedValue(undefined),
    restoreFromRegistry: jest.fn(),
  };
}

test('provision starts driver on first use and returns connection strings', async () => {
  const mongo = makeMockDriver('mongo');
  const manager = createServiceManager([mongo]);
  const result = await manager.provision('sai', { mongo: { db: 'sai' } });
  expect(mongo.start).toHaveBeenCalledTimes(1);
  expect(mongo.provision).toHaveBeenCalledWith('sai', { db: 'sai' });
  expect(mongo.connectionString).toHaveBeenCalledWith('sai', { db: 'sai' });
  expect(result).toEqual({ mongo: 'mongo://localhost/testdb' });
});

test('provision does not restart a driver already started', async () => {
  const mongo = makeMockDriver('mongo');
  const manager = createServiceManager([mongo]);
  await manager.provision('sai', { mongo: {} });
  await manager.provision('cleome', { mongo: {} });
  expect(mongo.start).toHaveBeenCalledTimes(1);
});

test('provision throws for unknown service name', async () => {
  const manager = createServiceManager([]);
  await expect(manager.provision('sai', { rabbitmq: {} }))
    .rejects.toThrow('No driver for service "rabbitmq"');
});

test('provision throws if driver does not become healthy', async () => {
  const broken = makeMockDriver('broken', false);
  const manager = createServiceManager([broken]);
  await expect(
    manager.provision('sai', { broken: {} }, { pollInterval: 0, maxAttempts: 2 })
  ).rejects.toThrow('did not become healthy');
});

test('deprovision calls driver.deprovision for each declared service', async () => {
  const mongo = makeMockDriver('mongo');
  const redis = makeMockDriver('redis');
  const manager = createServiceManager([mongo, redis]);
  await manager.deprovision('sai', { mongo: { db: 'sai' }, redis: {} });
  expect(mongo.deprovision).toHaveBeenCalledWith('sai');
  expect(redis.deprovision).toHaveBeenCalledWith('sai');
});

test('deprovision skips services with no registered driver', async () => {
  const manager = createServiceManager([]);
  await expect(manager.deprovision('sai', { rabbitmq: {} })).resolves.not.toThrow();
});

test('restoreFromRegistry calls each driver', () => {
  const mongo = makeMockDriver('mongo');
  const manager = createServiceManager([mongo]);
  const projects = { sai: { allocations: { services: { mongo: 'mongodb://localhost/sai' } } } };
  manager.restoreFromRegistry(projects);
  expect(mongo.restoreFromRegistry).toHaveBeenCalledWith(projects);
});

test('getStatus returns health for all drivers without starting them', async () => {
  const mongo = makeMockDriver('mongo', true);
  const redis = makeMockDriver('redis', false);
  const manager = createServiceManager([mongo, redis]);
  const status = await manager.getStatus();
  expect(mongo.start).not.toHaveBeenCalled();
  expect(status).toEqual([
    { name: 'mongo', containerName: 'forge-mongo', healthy: true },
    { name: 'redis', containerName: 'forge-redis', healthy: false },
  ]);
});

test('provision with empty services config is a no-op', async () => {
  const mongo = makeMockDriver('mongo');
  const manager = createServiceManager([mongo]);
  const result = await manager.provision('sai', {});
  expect(mongo.start).not.toHaveBeenCalled();
  expect(result).toEqual({});
});

test('provision calls postStart after driver becomes healthy', async () => {
  const mongo = {
    ...makeMockDriver('mongo'),
    postStart: jest.fn().mockResolvedValue(undefined),
  };
  const manager = createServiceManager([mongo]);
  await manager.provision('sai', { mongo: {} });
  expect(mongo.postStart).toHaveBeenCalledTimes(1);
});

test('provision does not call postStart again if driver already started', async () => {
  const mongo = {
    ...makeMockDriver('mongo'),
    postStart: jest.fn().mockResolvedValue(undefined),
  };
  const manager = createServiceManager([mongo]);
  await manager.provision('sai', { mongo: {} });
  await manager.provision('cleome', { mongo: {} });
  expect(mongo.postStart).toHaveBeenCalledTimes(1);
});

test('provision works for named instance keys like "mongo:rs"', async () => {
  const mongoRs = makeMockDriver('mongo:rs');
  const manager = createServiceManager([mongoRs]);
  const result = await manager.provision('sai', { 'mongo:rs': { db: 'sai' } });
  expect(mongoRs.start).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ 'mongo:rs': 'mongo:rs://localhost/testdb' });
});

test('registerDriver adds a new driver that can be used in provision', async () => {
  const manager = createServiceManager([]);
  const mongo = makeMockDriver('mongo:rs');
  manager.registerDriver(mongo);
  const result = await manager.provision('sai', { 'mongo:rs': {} });
  expect(mongo.start).toHaveBeenCalledTimes(1);
  expect(result['mongo:rs']).toBe('mongo:rs://localhost/testdb');
});

test('registerDriver throws if a driver with that name is already registered', () => {
  const mongo = makeMockDriver('mongo');
  const manager = createServiceManager([mongo]);
  expect(() => manager.registerDriver(makeMockDriver('mongo')))
    .toThrow('Driver "mongo" is already registered');
});
