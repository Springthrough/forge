const { ensureContainerRunning, stopContainer, checkTcpHealth, execInContainer } = require('../docker');

const NAME = 'postgres';
const CONTAINER_NAME = 'forge-postgres';
const IMAGE = 'postgres:16';
const PORT = 5432;
const USER = 'postgres';
const PASSWORD = 'forge'; // intentionally weak — local Docker container only, never exposed externally

function sanitizeDbName(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '') || 'forge_db';
}

function createPostgresDriver({ name = NAME, containerName = CONTAINER_NAME, port = PORT } = {}) {
  const dbNames = new Map();

  return {
    name,
    containerName,
    image: IMAGE,
    port,

    async start() {
      await ensureContainerRunning({
        image: IMAGE,
        name: containerName,
        port,
        env: [`POSTGRES_PASSWORD=${PASSWORD}`],
      });
    },

    async healthCheck() {
      return checkTcpHealth('127.0.0.1', port);
    },

    async provision(projectName, cfg) {
      if (dbNames.has(projectName)) return;
      const db = cfg?.db || sanitizeDbName(projectName);
      // CREATE DATABASE is not transactional; ignore error if already exists.
      await execInContainer(containerName, [
        'psql', '-U', USER, '-c', `CREATE DATABASE "${db}"`,
      ]);
      dbNames.set(projectName, db);
    },

    connectionString(projectName, cfg) {
      const db = dbNames.get(projectName) ?? cfg?.db ?? sanitizeDbName(projectName);
      return `postgresql://${USER}:${PASSWORD}@localhost:${port}/${db}`;
    },

    async stop() {
      await stopContainer(containerName);
    },

    async deprovision(projectName) {
      dbNames.delete(projectName);
    },

    restoreFromRegistry(projects) {
      for (const [projectName, project] of Object.entries(projects)) {
        const url = project.allocations?.services?.[name];
        if (!url) continue;
        const match = url.match(/\/([^/]+)$/);
        if (match) dbNames.set(projectName, match[1]);
      }
    },
  };
}

module.exports = createPostgresDriver();
module.exports.createPostgresDriver = createPostgresDriver;
