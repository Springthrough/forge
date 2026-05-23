const { createPostgresDriver } = require('../../../src/daemon/services/drivers/postgres');

test('createPostgresDriver accepts custom port and containerName', () => {
  const driver = createPostgresDriver({ port: 5433, containerName: 'forge-postgres-2' });
  expect(driver.port).toBe(5433);
  expect(driver.containerName).toBe('forge-postgres-2');
});

test('createPostgresDriver with custom name uses it as driver name', () => {
  const driver = createPostgresDriver({ name: 'postgres:analytics', port: 5433, containerName: 'forge-postgres-analytics' });
  expect(driver.name).toBe('postgres:analytics');
});
