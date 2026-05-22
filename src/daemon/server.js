// src/daemon/server.js
const express = require('express');
const { FORGE_PORT } = require('../constants');
const { createRegistry } = require('./registry');
const { createPortAllocator } = require('./port-allocator');
const { createHealthRoutes } = require('./api/health');
const { createProjectRoutes } = require('./api/projects');

function createServer({ registry, portAllocator } = {}) {
  const reg = registry ?? createRegistry();
  const alloc = portAllocator ?? createPortAllocator();
  alloc.restoreFromRegistry(reg.getAll());

  const app = express();
  app.use(express.json());
  app.use('/api/health', createHealthRoutes());
  app.use('/api/projects', createProjectRoutes({ registry: reg, portAllocator: alloc }));

  return { app, registry: reg, portAllocator: alloc };
}

if (require.main === module) {
  const { app } = createServer();
  app.listen(FORGE_PORT, () => {
    console.log(`Forge daemon listening on port ${FORGE_PORT}`);
  });
}

module.exports = { createServer };
