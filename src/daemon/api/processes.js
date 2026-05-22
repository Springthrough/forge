// src/daemon/api/processes.js
const { Router } = require('express');

function createProcessRoutes({ registry, processManager }) {
  const router = Router({ mergeParams: true }); // makes :name from parent available

  router.get('/', (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    const statuses = processManager.getStatuses(req.params.name, project.config?.processes ?? []);
    res.json({ project: req.params.name, processes: statuses });
  });

  router.post('/up', (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    processManager.up(req.params.name, project.config?.processes ?? [], project.allocations ?? {}, project.path);
    res.json({ ok: true, project: req.params.name });
  });

  router.post('/down', (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    processManager.down(req.params.name);
    res.json({ ok: true, project: req.params.name });
  });

  router.post('/:processName/restart', (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    processManager.restart(
      req.params.name, req.params.processName,
      project.config?.processes ?? [], project.allocations ?? {}, project.path
    );
    res.json({ ok: true, project: req.params.name, process: req.params.processName });
  });

  return router;
}

module.exports = { createProcessRoutes };
