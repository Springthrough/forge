const { createRedisDriver } = require('../../../src/daemon/services/drivers/redis');

test('allocates database 1 for the first project', async () => {
  const driver = createRedisDriver();
  await driver.provision('sai', {});
  expect(driver.connectionString('sai', {})).toBe('redis://localhost:6379/1');
});

test('allocates sequential database numbers for different projects', async () => {
  const driver = createRedisDriver();
  await driver.provision('sai', {});
  await driver.provision('cleome', {});
  expect(driver.connectionString('sai', {})).toBe('redis://localhost:6379/1');
  expect(driver.connectionString('cleome', {})).toBe('redis://localhost:6379/2');
});

test('provision is idempotent — same project does not get a second db number', async () => {
  const driver = createRedisDriver();
  await driver.provision('sai', {});
  await driver.provision('sai', {});
  await driver.provision('cleome', {});
  expect(driver.connectionString('cleome', {})).toBe('redis://localhost:6379/2');
});

test('deprovision releases the db number for reuse', async () => {
  const driver = createRedisDriver();
  await driver.provision('sai', {});
  await driver.deprovision('sai');
  await driver.provision('cleome', {});
  expect(driver.connectionString('cleome', {})).toBe('redis://localhost:6379/1');
});

test('restoreFromRegistry re-populates allocations from persisted connection strings', async () => {
  const driver = createRedisDriver();
  driver.restoreFromRegistry({
    sai:    { allocations: { services: { redis: 'redis://localhost:6379/1' } } },
    cleome: { allocations: { services: { redis: 'redis://localhost:6379/3' } } },
  });
  // Next allocation should skip 1 and 3; db 2 is the next free number
  await driver.provision('newproject', {});
  expect(driver.connectionString('newproject', {})).toBe('redis://localhost:6379/2');
});

test('restoreFromRegistry skips projects with no redis allocation', async () => {
  const driver = createRedisDriver();
  driver.restoreFromRegistry({
    sai: { allocations: { services: { mongo: 'mongodb://localhost/sai' } } },
  });
  await driver.provision('newproject', {});
  expect(driver.connectionString('newproject', {})).toBe('redis://localhost:6379/1');
});

test('connectionString throws for unprovisioned project', () => {
  const driver = createRedisDriver();
  expect(() => driver.connectionString('sai', {})).toThrow('"sai"');
});

test('driver has required interface fields', () => {
  const driver = createRedisDriver();
  expect(driver.name).toBe('redis');
  expect(driver.containerName).toBe('forge-redis');
  expect(driver.image).toContain('redis');
  expect(driver.port).toBe(6379);
});

test('createRedisDriver accepts custom port and containerName', () => {
  const driver = createRedisDriver({ port: 6380, containerName: 'forge-redis-2' });
  expect(driver.port).toBe(6380);
  expect(driver.containerName).toBe('forge-redis-2');
  expect(driver.name).toBe('redis');
});

test('createRedisDriver with custom name uses it as driver name', () => {
  const driver = createRedisDriver({ name: 'redis:cache', port: 6380, containerName: 'forge-redis-cache' });
  expect(driver.name).toBe('redis:cache');
});
