const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_PATH = path.join(os.homedir(), '.forge', 'registry.json');

function createRegistry(registryPath = DEFAULT_PATH) {
  function read() {
    if (!fs.existsSync(registryPath)) return {};
    try {
      return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    } catch {
      throw new Error(`Registry file is malformed: ${registryPath}`);
    }
  }

  function write(data) {
    const dir = path.dirname(registryPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(data, null, 2));
  }

  return {
    getAll: () => read(),

    get(name) {
      return read()[name] ?? null;
    },

    add(name, data) {
      const all = read();
      if (all[name]) throw new Error(`Project "${name}" is already registered`);
      all[name] = { ...data, addedAt: new Date().toISOString() };
      write(all);
    },

    // Shallow merge at the top level. Callers must pass the complete
    // value for any nested object (e.g. full allocations, not just ports).
    update(name, data) {
      const all = read();
      if (!all[name]) throw new Error(`Project "${name}" not registered`);
      all[name] = { ...all[name], ...data };
      write(all);
    },

    remove(name) {
      const all = read();
      if (!all[name]) throw new Error(`Project "${name}" not registered`);
      delete all[name];
      write(all);
    },
  };
}

module.exports = { createRegistry, DEFAULT_PATH };
