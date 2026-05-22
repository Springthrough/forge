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

function buildExtendedConfig(currentConfig, sourceConfig, sourceDir, currentDir) {
  const sourceName = sourceConfig.name;
  const existingNames = new Set((currentConfig.processes ?? []).map(p => p.name));

  const newProcesses = (sourceConfig.processes ?? [])
    .filter(proc => !existingNames.has(`${sourceName}:${proc.name}`))
    .map(proc => {
      const absProcessDir = path.resolve(sourceDir, proc.cwd ?? '.');
      const relCwd = path.relative(currentDir, absProcessDir);
      return { ...proc, name: `${sourceName}:${proc.name}`, cwd: relCwd === '' ? '.' : relCwd };
    });

  const mergedServices = {
    ...(sourceConfig.services ?? {}),
    ...(currentConfig.services ?? {}), // current wins on collision
  };

  return {
    ...currentConfig,
    processes: [...(currentConfig.processes ?? []), ...newProcesses],
    services: mergedServices,
  };
}

module.exports = function registerExtend(program) {
  // placeholder — wired up in Task 3
};

module.exports.inspectDirectory = inspectDirectory;
module.exports.buildExtendedConfig = buildExtendedConfig;
