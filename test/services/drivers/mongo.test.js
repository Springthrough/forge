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
