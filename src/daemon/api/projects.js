// src/daemon/api/projects.js
const { Router } = require('express');

function createProjectRoutes({ registry, portAllocator, serviceManager }) {
  const router = Router();

  async function allocatePorts(config) {
    const ports = {};
    for (const proc of config.processes ?? []) {
      ports[proc.name] = await portAllocator.reserve(config.name, proc.name, proc.ports);
    }
    return ports;
  }

  router.get('/', (_req, res) => {
    const all = registry.getAll();
    res.json(Object.entries(all).map(([name, data]) => ({ name, ...data })));
  });

  router.post('/register', async (req, res) => {
    const config = req.body;
    if (!config?.name) return res.status(400).json({ error: 'name is required' });
    const reserved = new Set(['up', 'down']);
    const badProc = (config.processes ?? []).find(p => reserved.has(p.name));
    if (badProc) {
      return res.status(400).json({ error: `Process name "${badProc.name}" is reserved` });
    }
    if (registry.get(config.name)) {
      return res.status(409).json({ error: `"${config.name}" is already registered` });
    }
    try {
      const ports = await allocatePorts(config);
      const services = await serviceManager.provision(config.name, config.services ?? {});
      const allocations = { ports, services };
      registry.add(config.name, { path: config.path, config, allocations });
      res.json({ ok: true, name: config.name, allocations });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:name', (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    res.json({ name: req.params.name, ...project });
  });

  router.delete('/:name', async (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) {
      return res.status(404).json({ error: `"${req.params.name}" not found` });
    }
    try {
      await serviceManager.deprovision(req.params.name, project.config?.services ?? {});
      portAllocator.releaseAll(req.params.name);
      registry.remove(req.params.name);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:name/sync', async (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    try {
      // TODO: safer sync would allocate-new into staging first, then deprovision-old,
      // so a bad config doesn't leave the project without allocations. Acceptable now
      // while provision is cheap and recoverable; revisit before adding stateful drivers.
      await serviceManager.deprovision(req.params.name, project.config?.services ?? {});
      portAllocator.releaseAll(req.params.name);
      const ports = await allocatePorts({ ...req.body, name: req.params.name });
      const services = await serviceManager.provision(req.params.name, req.body.services ?? {});
      const allocations = { ports, services };
      registry.update(req.params.name, { config: req.body, allocations });
      res.json({ ok: true, name: req.params.name, allocations });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createProjectRoutes };
