const { createRabbitMQDriver } = require('../../../src/daemon/services/drivers/rabbitmq');

test('createRabbitMQDriver accepts custom port and containerName', () => {
  const driver = createRabbitMQDriver({ port: 5673, containerName: 'forge-rabbitmq-2' });
  expect(driver.port).toBe(5673);
  expect(driver.containerName).toBe('forge-rabbitmq-2');
});

test('createRabbitMQDriver with custom name uses it as driver name', () => {
  const driver = createRabbitMQDriver({ name: 'rabbitmq:events', port: 5673, containerName: 'forge-rabbitmq-events' });
  expect(driver.name).toBe('rabbitmq:events');
});
