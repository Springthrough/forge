// src/daemon/api/services.js
const { Router } = require('express');
function createServicesRoutes({ serviceManager }) {
  const router = Router();
  router.get('/', async (_req, res) => {
    res.json(await serviceManager.getStatus());
  });
  return router;
}
module.exports = { createServicesRoutes };
