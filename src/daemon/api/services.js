const { Router } = require('express');
const { findFreePort } = require('../services/instance-store');

const KNOWN_TYPES = ['mongo', 'postgres', 'redis', 'rabbitmq'];

function createServicesRoutes({ serviceManager, registry, instanceStore, driverFactories = {} }) {
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

  if (instanceStore) {
    router.get('/instances', (_req, res) => {
      const all = instanceStore.getAll();
      res.json(Object.entries(all).map(([key, cfg]) => ({ key, ...cfg })));
    });

    router.post('/instances', async (req, res) => {
      const { type, instance, port: requestedPort, options = {} } = req.body;
      if (!type || !instance) {
        return res.status(400).json({ error: 'type and instance are required' });
      }
      if (!KNOWN_TYPES.includes(type)) {
        return res.status(400).json({ error: `Unknown service type "${type}"` });
      }
      const key = `${type}:${instance}`;
      if (instanceStore.has(key)) {
        return res.status(409).json({ error: `Instance "${key}" is already registered` });
      }
      try {
        const port = requestedPort ?? await findFreePort(27100);
        const containerName = `forge-${type}-${instance}`;
        const config = { type, instance, port, options };
        instanceStore.set(key, config);
        if (driverFactories[type]) {
          const driver = driverFactories[type]({ name: key, containerName, port, ...options });
          serviceManager.registerDriver(driver);
        }
        res.json({ ok: true, key, port });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    router.patch('/instances/:key', (req, res) => {
      const { key } = req.params;
      if (!instanceStore.has(key)) {
        return res.status(404).json({ error: `Instance "${key}" not found` });
      }
      try {
        const existing = instanceStore.get(key);
        instanceStore.set(key, { ...existing, ...req.body });
        res.json({ ok: true, key });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    router.delete('/instances/:key', async (req, res) => {
      const { key } = req.params;
      if (!instanceStore.has(key)) {
        return res.status(404).json({ error: `Instance "${key}" not found` });
      }
      try {
        instanceStore.remove(key);
        res.json({ ok: true, key });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  return router;
}

module.exports = { createServicesRoutes };
