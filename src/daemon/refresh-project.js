const fs = require('fs');
const path = require('path');

function refreshProjectConfig(registry, projectName, log = console.warn) {
  const entry = registry.get(projectName);
  if (!entry) return null;
  const configPath = path.join(entry.path, '.forge', 'config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const fresh = JSON.parse(raw);
    registry.update(projectName, { config: fresh });
    return registry.get(projectName);
  } catch (err) {
    log(`[forge] Could not refresh config for "${projectName}" from disk: ${err.message}. Using last-known config.`);
    return entry;
  }
}

module.exports = { refreshProjectConfig };
