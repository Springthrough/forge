const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

const DEFAULT_PATH = path.join(os.homedir(), '.forge', 'services.json');

function findFreePort(startPort = 27100) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      const s = net.createServer();
      s.once('error', (err) => {
        if (err.code === 'EADDRINUSE') return tryPort(port + 1);
        reject(err);
      });
      s.once('listening', () => s.close(() => resolve(port)));
      s.listen(port, '127.0.0.1');
    }
    tryPort(startPort);
  });
}

function createInstanceStore(storePath = DEFAULT_PATH) {
  function read() {
    if (!fs.existsSync(storePath)) return {};
    try {
      return JSON.parse(fs.readFileSync(storePath, 'utf8'));
    } catch {
      throw new Error(`Instance store file is malformed: ${storePath}`);
    }
  }

  function write(data) {
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
  }

  return {
    getAll: () => read(),

    get(key) {
      return read()[key] ?? null;
    },

    has(key) {
      return key in read();
    },

    set(key, config) {
      const all = read();
      all[key] = config;
      write(all);
    },

    remove(key) {
      const all = read();
      if (!(key in all)) throw new Error(`Instance "${key}" not found`);
      delete all[key];
      write(all);
    },
  };
}

module.exports = { createInstanceStore, findFreePort, DEFAULT_PATH };
