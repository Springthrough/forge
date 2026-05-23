const { createMongoDriver } = require('../../../src/daemon/services/drivers/mongo');

test('connectionString returns mongodb URL with database from config', () => {
  const driver = createMongoDriver();
  expect(driver.connectionString('sai', { db: 'sai' }))
    .toBe('mongodb://localhost:27017/sai');
});

test('connectionString uses project name as db if config.db is not set', () => {
  const driver = createMongoDriver();
  expect(driver.connectionString('cleome', {}))
    .toBe('mongodb://localhost:27017/cleome');
});

test('provision resolves without error (no-op — MongoDB creates DBs lazily)', async () => {
  const driver = createMongoDriver();
  await expect(driver.provision('sai', { db: 'sai' })).resolves.not.toThrow();
});

test('deprovision resolves without error (destructive cleanup deferred to future plan)', async () => {
  const driver = createMongoDriver();
  await expect(driver.deprovision('sai')).resolves.not.toThrow();
});

test('restoreFromRegistry is a no-op (mongo has no allocation state)', () => {
  const driver = createMongoDriver();
  expect(() => driver.restoreFromRegistry({ sai: {} })).not.toThrow();
});

test('driver has required interface fields', () => {
  const driver = createMongoDriver();
  expect(driver.name).toBe('mongo');
  expect(driver.containerName).toBe('forge-mongo');
  expect(driver.image).toContain('mongo');
  expect(driver.port).toBe(27017);
  expect(typeof driver.start).toBe('function');
  expect(typeof driver.healthCheck).toBe('function');
});

test('createMongoDriver accepts custom port and containerName', () => {
  const driver = createMongoDriver({ port: 27842, containerName: 'forge-mongo-rs' });
  expect(driver.port).toBe(27842);
  expect(driver.containerName).toBe('forge-mongo-rs');
});

test('createMongoDriver with replicaSet:true has postStart method', () => {
  const driver = createMongoDriver({ replicaSet: true });
  expect(typeof driver.postStart).toBe('function');
});

test('createMongoDriver without replicaSet has no postStart method', () => {
  const driver = createMongoDriver({});
  expect(driver.postStart).toBeUndefined();
});

test('connectionString appends replicaSet param when replicaSet:true', () => {
  const driver = createMongoDriver({ port: 27842, replicaSet: true });
  expect(driver.connectionString('sai', { db: 'sai' }))
    .toBe('mongodb://localhost:27842/sai?replicaSet=rs0');
});

test('connectionString has no replicaSet param by default', () => {
  const driver = createMongoDriver({ port: 27017 });
  expect(driver.connectionString('sai', { db: 'sai' }))
    .toBe('mongodb://localhost:27017/sai');
});

test('named instance driver uses instance name as driver name', () => {
  const driver = createMongoDriver({ name: 'mongo:rs', containerName: 'forge-mongo-rs', port: 27842 });
  expect(driver.name).toBe('mongo:rs');
  expect(driver.containerName).toBe('forge-mongo-rs');
});
