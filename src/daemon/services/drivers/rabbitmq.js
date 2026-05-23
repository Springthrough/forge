const { ensureContainerRunning, stopContainer, checkTcpHealth, execInContainer } = require('../docker');

const NAME = 'rabbitmq';
const CONTAINER_NAME = 'forge-rabbitmq';
const IMAGE = 'rabbitmq:3';
const PORT = 5672;

function sanitizeVhost(name) {
  // vhost names may contain any characters but keep them filesystem-safe
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+/, '') || 'forge';
}

function createRabbitmqDriver({ name = NAME, containerName = CONTAINER_NAME, port = PORT } = {}) {
  const vhosts = new Map();

  return {
    name,
    containerName,
    image: IMAGE,
    port,

    async start() {
      await ensureContainerRunning({ image: IMAGE, name: containerName, port });
    },

    async healthCheck() {
      return checkTcpHealth('127.0.0.1', port);
    },

    async provision(projectName, cfg) {
      if (vhosts.has(projectName)) return;
      const vhost = cfg?.vhost || sanitizeVhost(projectName);
      // add_vhost exits non-zero if the vhost already exists — execInContainer ignores exit codes.
      await execInContainer(containerName, ['rabbitmqctl', 'add_vhost', vhost]);
      await execInContainer(containerName, [
        'rabbitmqctl', 'set_permissions', '-p', vhost, 'guest', '.*', '.*', '.*',
      ]);
      vhosts.set(projectName, vhost);
    },

    connectionString(projectName, cfg) {
      const vhost = vhosts.get(projectName) ?? cfg?.vhost ?? sanitizeVhost(projectName);
      return `amqp://guest:guest@localhost:${port}/${encodeURIComponent(vhost)}`;
    },

    async stop() {
      await stopContainer(containerName);
    },

    async deprovision(projectName) {
      vhosts.delete(projectName);
    },

    restoreFromRegistry(projects) {
      for (const [projectName, project] of Object.entries(projects)) {
        const url = project.allocations?.services?.[name];
        if (!url) continue;
        const match = url.match(/\/([^/]*)$/);
        if (match) vhosts.set(projectName, decodeURIComponent(match[1]));
      }
    },
  };
}

const createRabbitMQDriver = createRabbitmqDriver;

module.exports = createRabbitmqDriver();
module.exports.createRabbitmqDriver = createRabbitmqDriver;
module.exports.createRabbitMQDriver = createRabbitMQDriver;
