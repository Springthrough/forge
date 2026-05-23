const { Router } = require('express');
const { findFreePort } = require('../services/instance-store');

const KNOWN_TYPES = ['mongo', 'postgres', 'redis', 'rabbitmq'];

const BUILT_IN_DEFAULT_PORTS = {
  mongo: 27017,
  redis: 6379,
  postgres: 5432,
  rabbitmq: 5672,
};

function createServicesRoutes({ serviceManager, registry, instanceStore, driverFactories = {}, processManager }) {
  const router = Router();

  function getRunningProjectServices() {
    const blocked = new Map(); // serviceName -> projectName
    if (!processManager) return blocked;
    for (const [projectName, project] of Object.entries(registry.getAll())) {
      const statuses = processManager.getStatuses(projectName, project.config?.processes ?? []);
      if (statuses.some(s => s.status === 'running')) {
        for (const svcName of Object.keys(project.config?.services ?? {})) {
          if (!blocked.has(svcName)) blocked.set(svcName, projectName);
        }
      }
    }
    return blocked;
  }

  router.get('/', async (_req, res) => {
    const all = await serviceManager.getStatus();
    res.json(all);
  });

  router.get('/catalog', (_req, res) => {
    res.json(serviceManager.getCatalog());
  });

  router.post('/up', async (_req, res) => {
    const names = serviceManager.getCatalog();
    const errors = [];
    const started = [];
    for (const name of names) {
      try {
        await serviceManager.startByName(name);
        started.push(name);
      } catch (err) {
        errors.push({ name, error: err.message });
      }
    }
    if (errors.length > 0) {
      return res.status(500).json({ ok: false, started, errors });
    }
    res.json({ ok: true, started });
  });

  router.post('/up/:name', async (req, res) => {
    const { name } = req.params;
    if (!serviceManager.getCatalog().includes(name)) {
      return res.status(404).json({ error: `Service "${name}" not found` });
    }
    try {
      await serviceManager.startByName(name);
      res.json({ ok: true, started: [name] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/down', async (_req, res) => {
    const blocked = getRunningProjectServices();
    const names = serviceManager.getCatalog();
    const stopped = [];
    const blockedList = [];
    for (const name of names) {
      if (blocked.has(name)) {
        blockedList.push({ name, reason: `project ${blocked.get(name)} is up` });
        continue;
      }
      try {
        await serviceManager.stopByName(name);
        stopped.push(name);
      } catch {
        // ignore — container may not be running
      }
    }
    res.json({ ok: true, stopped, blocked: blockedList });
  });

  router.post('/down/:name', async (req, res) => {
    const { name } = req.params;
    if (!serviceManager.getCatalog().includes(name)) {
      return res.status(404).json({ error: `Service "${name}" not found` });
    }
    const blocked = getRunningProjectServices();
    if (blocked.has(name)) {
      return res.status(409).json({ error: `Cannot stop ${name}: project ${blocked.get(name)} is up` });
    }
    try {
      await serviceManager.stopByName(name);
      res.json({ ok: true, stopped: [name] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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
        return res.status(400).json({ error: `Unknown service type "${type}". Valid types: ${KNOWN_TYPES.join(', ')}` });
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
      const isBuiltIn = KNOWN_TYPES.includes(key);
      if (!isBuiltIn && !instanceStore.has(key)) {
        return res.status(404).json({ error: `Instance "${key}" not found` });
      }
      try {
        const defaultPort = BUILT_IN_DEFAULT_PORTS[key];
        const existing = instanceStore.get(key) ?? (isBuiltIn ? { type: key, port: defaultPort, options: {} } : {});
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
