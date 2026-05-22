// src/cli/commands/extend.js
const fs = require('fs');
const path = require('path');

function inspectDirectory(dirPath) {
  const configPath = path.join(dirPath, '.forge', 'config.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  const pkgPath = path.join(dirPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch {}
    const name = pkg.name ?? path.basename(dirPath);
    const processes = [];
    if (pkg.scripts?.start) {
      processes.push({ name: 'start', command: 'npm start', cwd: '.', ports: [] });
    }
    if (pkg.scripts?.dev) {
      processes.push({ name: 'dev', command: 'npm run dev', cwd: '.', ports: [] });
    }
    return { name, processes, services: {} };
  }

  throw new Error(`No .forge/config.json or package.json found in ${dirPath}`);
}

module.exports = function registerExtend(program) {
  // placeholder — wired up in Task 3
};

module.exports.inspectDirectory = inspectDirectory;
