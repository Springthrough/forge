const { ensureContainerRunning, stopContainer, checkTcpHealth, execInContainer } = require('../docker');

const NAME = 'postgres';
const CONTAINER_NAME = 'forge-postgres';
const IMAGE = 'postgres:16';
const PORT = 5432;
const USER = 'postgres';
const PASSWORD = 'forge';

function sanitizeDbName(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '') || 'forge_db';
}

function createPostgresDriver() {
  const dbNames = new Map();

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
        env: [`POSTGRES_PASSWORD=${PASSWORD}`],
      });
    },

    async healthCheck() {
      return checkTcpHealth('127.0.0.1', PORT);
    },

    async provision(projectName, cfg) {
      if (dbNames.has(projectName)) return;
      const db = cfg?.db || sanitizeDbName(projectName);
      // CREATE DATABASE is not transactional; ignore error if already exists.
      await execInContainer(CONTAINER_NAME, [
        'psql', '-U', USER, '-c', `CREATE DATABASE "${db}"`,
      ]);
      dbNames.set(projectName, db);
    },

    connectionString(projectName, cfg) {
      const db = dbNames.get(projectName) ?? cfg?.db ?? sanitizeDbName(projectName);
      return `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${db}`;
    },

    async stop() {
      await stopContainer(CONTAINER_NAME);
    },

    async deprovision(projectName) {
      dbNames.delete(projectName);
    },

    restoreFromRegistry(projects) {
      for (const [name, project] of Object.entries(projects)) {
        const url = project.allocations?.services?.postgres;
        if (!url) continue;
        const match = url.match(/\/([^/]+)$/);
        if (match) dbNames.set(name, match[1]);
      }
    },
  };
}

module.exports = createPostgresDriver();
module.exports.createPostgresDriver = createPostgresDriver;
