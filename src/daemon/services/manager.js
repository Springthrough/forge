function createServiceManager(drivers = []) {
  const byName = new Map(drivers.map(d => [d.name, d]));
  const started = new Set();

  async function ensureStarted(driver, opts) {
    if (started.has(driver.name)) return;
    await driver.start();
    const { pollInterval = 1000, maxAttempts = 30 } = opts ?? {};
    let healthy = false;
    for (let i = 0; i < maxAttempts; i++) {
      if (await driver.healthCheck()) { healthy = true; break; }
      if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, pollInterval));
    }
    if (!healthy) throw new Error(`Service "${driver.name}" did not become healthy`);
    started.add(driver.name);
  }

  return {
    restoreFromRegistry(projects) {
      for (const driver of byName.values()) {
        driver.restoreFromRegistry(projects);
      }
    },

    async provision(projectName, servicesConfig, opts) {
      const connectionStrings = {};
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

    async getStatus() {
      const statuses = [];
      for (const driver of byName.values()) {
        const healthy = await driver.healthCheck();
        statuses.push({ name: driver.name, containerName: driver.containerName, healthy });
      }
      return statuses;
    },
  };
}

module.exports = { createServiceManager };
