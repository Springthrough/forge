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

  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const projectName = url.searchParams.get('project');
    const processName = url.searchParams.get('process');

    if (!projectName || !processName) {
      ws.send(JSON.stringify({ type: 'error', message: 'project and process query params required' }));
      ws.close();
      return;
    }

    const project = reg.get(projectName);
    if (!project) {
      ws.send(JSON.stringify({ type: 'error', message: `Project "${projectName}" not found` }));
      ws.close();
      return;
    }

    // Send current status and buffered output
    const status = pm.isRunning(projectName, processName) ? 'running' : 'stopped';
    ws.send(JSON.stringify({ type: 'status', status }));

    const buffered = pm.getBuffer(projectName, processName).join('\r\n');
    if (buffered) ws.send(JSON.stringify({ type: 'output', data: buffered }));

    // Subscribe to future events
    const relay = (event) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    };
    pm.subscribe(projectName, processName, relay);

    ws.on('message', (raw) => {
      try {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'input')  pm.sendInput(projectName, processName, msg.data);
        if (msg.type === 'resize') pm.resize(projectName, processName, msg.cols, msg.rows);
        if (msg.type === 'start') {
          const p = reg.get(projectName);
          if (p) pm.startProcess(projectName, processName, p.config?.processes ?? [], p.allocations ?? {}, p.path);
        }
        if (msg.type === 'stop') pm.stopProcess(projectName, processName);
      } catch (err) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    ws.on('close', () => pm.unsubscribe(projectName, processName, relay));
  });

  return { app, server, wss, registry: reg, portAllocator: alloc, serviceManager: svcMgr, processManager: pm };
}

if (require.main === module) {
  const { server } = createServer();
  server.listen(FORGE_PORT, () => {
    console.log(`Forge daemon listening on port ${FORGE_PORT}`);
  });
}

module.exports = { createServer };
