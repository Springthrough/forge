// src/daemon/api/processes.js
const { Router } = require('express');

function createProcessRoutes({ registry, processManager, serviceManager }) {
  const router = Router({ mergeParams: true }); // makes :name from parent available

  router.get('/', (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    const statuses = processManager.getStatuses(req.params.name, project.config?.processes ?? []);
    res.json({ project: req.params.name, processes: statuses });
  });

  router.post('/up', async (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    try {
      await serviceManager.ensureServicesRunning(project.config?.services ?? {});
    } catch (err) {
      return res.status(500).json({ error: `Failed to start services: ${err.message}` });
    }
    processManager.up(req.params.name, project.config?.processes ?? [], project.allocations ?? {}, project.path, project.config?.services ?? {});
    res.json({ ok: true, project: req.params.name });
  });

  router.post('/down', async (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    processManager.down(req.params.name);
    res.json({ ok: true, project: req.params.name });
  });

  router.post('/:processName/up', (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    processManager.startProcess(
      req.params.name, req.params.processName,
      project.config?.processes ?? [], project.allocations ?? {}, project.path, project.config?.services ?? {}
    );
    res.json({ ok: true, project: req.params.name, process: req.params.processName });
  });

  router.post('/:processName/down', (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    processManager.stopProcess(req.params.name, req.params.processName);
    res.json({ ok: true, project: req.params.name, process: req.params.processName });
  });

  router.get('/:processName/logs', (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    const limit = req.query.lines ? parseInt(req.query.lines, 10) : 200;
    const lines = processManager.getBuffer(req.params.name, req.params.processName, limit);
    res.json({ project: req.params.name, process: req.params.processName, lines });
  });

  router.post('/:processName/restart', (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    processManager.restart(
      req.params.name, req.params.processName,
      project.config?.processes ?? [], project.allocations ?? {}, project.path, project.config?.services ?? {}
    );
    res.json({ ok: true, project: req.params.name, process: req.params.processName });
  });

  return router;
}

module.exports = { createProcessRoutes };
