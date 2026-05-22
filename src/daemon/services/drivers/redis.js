const { ensureContainerRunning, checkTcpHealth } = require('../docker');

const NAME = 'redis';
const CONTAINER_NAME = 'forge-redis';
const IMAGE = 'redis:7';
const PORT = 6379;

function createRedisDriver() {
  // projectName → database number (1–63). Database 0 is reserved.
  const dbNumbers = new Map();

  function nextAvailableDb() {
    const used = new Set(dbNumbers.values());
    for (let n = 1; n <= 63; n++) {
      if (!used.has(n)) return n;
    }
    throw new Error('All 63 Redis databases are allocated');
  }

  return {
    name: NAME,
    containerName: CONTAINER_NAME,
    image: IMAGE,
    port: PORT,

    async start() {
      await ensureContainerRunning({
        image: IMAGE,
        name: CONTAINER_NAME,
        port: PORT,
        // Override default of 16 databases to support up to 63 projects
        cmd: ['redis-server', '--databases', '64'],
      });
    },

    async healthCheck() {
      return checkTcpHealth('127.0.0.1', PORT);
    },

    async provision(projectName, _cfg) {
      if (dbNumbers.has(projectName)) return; // idempotent
      dbNumbers.set(projectName, nextAvailableDb());
    },

    connectionString(projectName, _cfg) {
      const n = dbNumbers.get(projectName);
      if (n == null) throw new Error(`No Redis allocation for project "${projectName}"`);
      return `redis://localhost:${PORT}/${n}`;
    },

    async deprovision(projectName) {
      dbNumbers.delete(projectName);
    },

    restoreFromRegistry(projects) {
      for (const [name, project] of Object.entries(projects)) {
        const url = project.allocations?.services?.redis;
        if (!url) continue;
        // Parse db number from "redis://localhost:6379/N"
        const match = url.match(/\/(\d+)$/);
        if (match) dbNumbers.set(name, parseInt(match[1], 10));
      }
    },
  };
}

// Export singleton for production use. Tests use createRedisDriver() directly for isolated state.
module.exports = createRedisDriver();
module.exports.createRedisDriver = createRedisDriver;
