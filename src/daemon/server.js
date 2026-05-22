// src/daemon/server.js
const express = require('express');
const { FORGE_PORT } = require('../constants');
const { createRegistry } = require('./registry');
const { createPortAllocator } = require('./port-allocator');
const { createServiceManager } = require('./services/manager');
const { createHealthRoutes } = require('./api/health');
const { createProjectRoutes } = require('./api/projects');
const { createServicesRoutes } = require('./api/services');

function createServer({ registry, portAllocator, serviceManager } = {}) {
  const reg = registry ?? createRegistry();
  const alloc = portAllocator ?? createPortAllocator();
  const svcMgr = serviceManager ?? createServiceManager([
    require('./services/drivers/mongo'),
    require('./services/drivers/redis'),
  ]);

  alloc.restoreFromRegistry(reg.getAll());
  svcMgr.restoreFromRegistry(reg.getAll());

  const app = express();
  app.use(express.json());
  app.use('/api/health', createHealthRoutes());
  app.use('/api/projects', createProjectRoutes({ registry: reg, portAllocator: alloc, serviceManager: svcMgr }));
  app.use('/api/services', createServicesRoutes({ serviceManager: svcMgr }));

  return { app, registry: reg, portAllocator: alloc, serviceManager: svcMgr };
}

if (require.main === module) {
  const { app } = createServer();
  app.listen(FORGE_PORT, () => {
    console.log(`Forge daemon listening on port ${FORGE_PORT}`);
  });
}

module.exports = { createServer };
