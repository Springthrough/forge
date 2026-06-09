// src/daemon/api/processes.js
const { Router } = require('express');
const { writeEnvFile } = require('../../cli/env-file');
const { refreshProjectConfig } = require('../refresh-project');

function createProcessRoutes({ registry, processManager, serviceManager, portAllocator }) {
  const router = Router({ mergeParams: true }); // makes :name from parent available

  router.get('/', (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    const statuses = processManager.getStatuses(req.params.name, project.config?.processes ?? []);
    res.json({ project: req.params.name, processes: statuses });
  });

  router.post('/up', async (req, res) => {
    const project = refreshProjectConfig(registry, req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    try {
      await serviceManager.ensureServicesRunning(project.config?.services ?? {});
    } catch (err) {
      return res.status(500).json({ error: `Failed to start services: ${err.message}` });
    }

    // Re-validate registered ports — they may have been claimed since forge add/reload.
    // Only revalidate processes that aren't already running (no-op for idempotent calls).
    const ports = { ...(project.allocations?.ports ?? {}) };
    let anyChanged = false;
    if (portAllocator) {
      for (const proc of project.config?.processes ?? []) {
        if (ports[proc.name] == null || !proc.ports?.length) continue;
        if (processManager.isRunning(req.params.name, proc.name)) continue;
        try {
          const fresh = await portAllocator.revalidate(req.params.name, proc.name, proc.ports);
          if (fresh !== null && fresh !== ports[proc.name]) {
            ports[proc.name] = fresh;
            anyChanged = true;
          }
        } catch (err) {
          return res.status(500).json({ error: `Port allocation failed for ${proc.name}: ${err.message}` });
        }
      }
    }

    const allocations = anyChanged
      ? { ...project.allocations, ports }
      : project.allocations ?? {};

    if (anyChanged) {
      registry.update(req.params.name, { allocations });
    }

    // Write env file with validated allocations before spawning so processes read correct values.
    const envFilename = project.config?.envFile ?? '.env.forge';
    if (envFilename !== false) {
      writeEnvFile(project.path, envFilename, allocations, project.config);
    }

    try {
      await processManager.up(req.params.name, project.config?.processes ?? [], allocations, project.path, project.config?.services ?? {});
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ ok: true, project: req.params.name, allocations });
  });

  router.post('/down', async (req, res) => {
    const project = refreshProjectConfig(registry, req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    await processManager.down(req.params.name, project.config?.processes);
    res.json({ ok: true, project: req.params.name });
  });

  router.post('/:processName/up', async (req, res) => {
    const project = refreshProjectConfig(registry, req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    try {
      await processManager.startProcess(
        req.params.name, req.params.processName,
        project.config?.processes ?? [], project.allocations ?? {}, project.path, project.config?.services ?? {}
      );
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ ok: true, project: req.params.name, process: req.params.processName });
  });

  router.post('/:processName/down', (req, res) => {
    const project = refreshProjectConfig(registry, req.params.name);
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
    const project = refreshProjectConfig(registry, req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });

    // Write env file with fresh config + current allocations before respawning,
    // so processes see the same values via the env file as via the inline env block.
    const envFilename = project.config?.envFile ?? '.env.forge';
    if (envFilename !== false) {
      writeEnvFile(project.path, envFilename, project.allocations ?? {}, project.config);
    }

    processManager.restart(
      req.params.name, req.params.processName,
      project.config?.processes ?? [], project.allocations ?? {}, project.path, project.config?.services ?? {}
    );
    res.json({ ok: true, project: req.params.name, process: req.params.processName });
  });

  return router;
}

module.exports = { createProcessRoutes };
