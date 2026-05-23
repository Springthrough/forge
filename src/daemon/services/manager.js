function createServiceManager(drivers = []) {
  const byName = new Map(drivers.map(d => [d.name, d]));
  const started = new Set();

  async function ensureStarted(driver, opts) {
    if (started.has(driver.name) && await driver.healthCheck()) return;
    started.delete(driver.name);
    await driver.start();
    const { pollInterval = 1000, maxAttempts = 30 } = opts ?? {};
    let healthy = false;
    for (let i = 0; i < maxAttempts; i++) {
      if (await driver.healthCheck()) { healthy = true; break; }
      if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, pollInterval));
    }
    if (!healthy) throw new Error(`Service "${driver.name}" did not become healthy`);
    started.add(driver.name);
    if (driver.postStart) await driver.postStart();
  }

  return {
    registerDriver(driver) {
      if (byName.has(driver.name)) throw new Error(`Driver "${driver.name}" is already registered`);
      byName.set(driver.name, driver);
    },

    restoreFromRegistry(projects) {
      for (const driver of byName.values()) {
        driver.restoreFromRegistry(projects);
      }
    },

    async provision(projectName, servicesConfig, opts) {
      const connectionStrings = {};
      // TODO: provision is not atomic — if a later driver fails, earlier drivers are not
      // rolled back. Acceptable while mongo.provision is a no-op and redis.provision is
      // an in-memory Map.set. Add rollback before any driver gains destructive state.
      for (const [serviceName, cfg] of Object.entries(servicesConfig ?? {})) {
        const driver = byName.get(serviceName);
        if (!driver) throw new Error(`No driver for service "${serviceName}"`);
        await ensureStarted(driver, opts);
        await driver.provision(projectName, cfg);
        connectionStrings[serviceName] = driver.connectionString(projectName, cfg);
      }
      return connectionStrings;
    },

    async deprovision(projectName, servicesConfig) {
      for (const serviceName of Object.keys(servicesConfig ?? {})) {
        const driver = byName.get(serviceName);
        if (driver) await driver.deprovision(projectName);
      }
    },

    getCatalog() {
      return [...byName.keys()];
    },

    async ensureServicesRunning(servicesConfig) {
      for (const serviceName of Object.keys(servicesConfig ?? {})) {
        const driver = byName.get(serviceName);
        if (driver) await ensureStarted(driver);
      }
    },

    async stopUnused(servicesConfig, allProjects, excludeProjectName) {
      for (const serviceName of Object.keys(servicesConfig ?? {})) {
        const driver = byName.get(serviceName);
        if (!driver) continue;
        const stillNeeded = Object.entries(allProjects).some(
          ([name, project]) => name !== excludeProjectName && project.config?.services?.[serviceName]
        );
        if (!stillNeeded) {
          await driver.stop();
          started.delete(serviceName);
        }
      }
    },

    async getStatus() {
      const statuses = [];
      for (const driver of byName.values()) {
        const healthy = await driver.healthCheck();
        statuses.push({ name: driver.name, containerName: driver.containerName, healthy });
      }
      return statuses;
    },

    async startByName(name) {
      const driver = byName.get(name);
      if (!driver) throw new Error(`No driver for service "${name}"`);
      await ensureStarted(driver);
    },

    async stopByName(name) {
      const driver = byName.get(name);
      if (!driver) throw new Error(`No driver for service "${name}"`);
      await driver.stop();
      started.delete(name);
    },
  };
}

module.exports = { createServiceManager };
