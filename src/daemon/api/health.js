// src/daemon/api/health.js
const { Router } = require('express');
const { version } = require('../../../package.json');

function createHealthRoutes() {
  const router = Router();
  router.get('/', (_req, res) => res.json({ ok: true, version }));
  return router;
}

module.exports = { createHealthRoutes };
