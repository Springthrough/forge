// src/daemon/server.js
const express = require('express');
const http = require('http');
const { FORGE_PORT } = require('../constants');
const { createRegistry } = require('./registry');
const { createPortAllocator } = require('./port-allocator');
const { createServiceManager } = require('./services/manager');
const { createProcessManager } = require('./process-manager');
const { createHealthRoutes } = require('./api/health');
const { createProjectRoutes } = require('./api/projects');
const { createServicesRoutes } = require('./api/services');
const { createProcessRoutes } = require('./api/processes');

function createServer({ registry, portAllocator, serviceManager, processManager } = {}) {
  const reg = registry ?? createRegistry();
  const alloc = portAllocator ?? createPortAllocator();
  const svcMgr = serviceManager ?? createServiceManager([
    require('./services/drivers/mongo'),
    require('./services/drivers/redis'),
  ]);
  const pm = processManager ?? createProcessManager();

  alloc.restoreFromRegistry(reg.getAll());
  svcMgr.restoreFromRegistry(reg.getAll());

  const app = express();
  app.use(express.json());
  app.use('/api/health', createHealthRoutes());
  app.use('/api/projects', createProjectRoutes({ registry: reg, portAllocator: alloc, serviceManager: svcMgr }));
  app.use('/api/services', createServicesRoutes({ serviceManager: svcMgr }));
  app.use('/api/projects/:name/processes', createProcessRoutes({ registry: reg, processManager: pm }));

  const server = http.createServer(app);

  return { app, server, registry: reg, portAllocator: alloc, serviceManager: svcMgr, processManager: pm };
}

if (require.main === module) {
  const { server } = createServer();
  server.listen(FORGE_PORT, () => {
    console.log(`Forge daemon listening on port ${FORGE_PORT}`);
  });
}

module.exports = { createServer };
