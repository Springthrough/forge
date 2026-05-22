const { ensureContainerRunning, checkTcpHealth } = require('../docker');

const NAME = 'mongo';
const CONTAINER_NAME = 'forge-mongo';
const IMAGE = 'mongo:7';
const PORT = 27017;

function createMongoDriver() {
  return {
    name: NAME,
    containerName: CONTAINER_NAME,
    image: IMAGE,
    port: PORT,

    async start() {
      await ensureContainerRunning({ image: IMAGE, name: CONTAINER_NAME, port: PORT });
    },

    async healthCheck() {
      return checkTcpHealth('127.0.0.1', PORT);
    },

    // MongoDB creates databases lazily on first write — no provisioning needed.
    async provision(_projectName, _cfg) {},

    connectionString(projectName, cfg) {
      const db = cfg?.db || projectName;
      return `mongodb://localhost:${PORT}/${db}`;
    },

    // Destructive DB cleanup is deferred to a future plan.
    async deprovision(_projectName) {},

    restoreFromRegistry(_projects) {},
  };
}

// Export singleton for production use. Tests use createMongoDriver() for isolation.
module.exports = createMongoDriver();
module.exports.createMongoDriver = createMongoDriver;
