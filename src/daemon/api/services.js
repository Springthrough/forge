// src/daemon/api/services.js
const { Router } = require('express');
function createServicesRoutes({ serviceManager, registry }) {
  const router = Router();

  router.get('/catalog', (_req, res) => {
    res.json(serviceManager.getCatalog());
  });

  router.get('/', async (_req, res) => {
    const projects = Object.values(registry.getAll());
    const active = new Set(
      projects.flatMap(p => Object.keys(p.config?.services ?? {}))
    );
    const all = await serviceManager.getStatus();
    res.json(all.filter(s => active.has(s.name)));
  });

  return router;
}
module.exports = { createServicesRoutes };
