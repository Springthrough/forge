// src/cli/commands/extend.js
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

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

async function runExtend(targetPath, cwd) {
  const currentConfigPath = path.join(cwd, '.forge', 'config.json');
  if (!fs.existsSync(currentConfigPath)) {
    throw new Error(`No .forge/config.json found in ${cwd}. Run: forge init`);
  }

  const targetDir = path.resolve(cwd, targetPath);
  const currentConfig = JSON.parse(fs.readFileSync(currentConfigPath, 'utf8'));
  const sourceConfig = inspectDirectory(targetDir); // may throw

  const updated = buildExtendedConfig(currentConfig, sourceConfig, targetDir, cwd);
  const addedCount = updated.processes.length - (currentConfig.processes ?? []).length;
  const skippedCount = (sourceConfig.processes ?? []).length - addedCount;

  fs.writeFileSync(currentConfigPath, JSON.stringify(updated, null, 2) + '\n');
  return { updated, addedCount, skippedCount, sourceConfig };
}

module.exports = function registerExtend(program) {
  program
    .command('extend <path>')
    .description('Append processes from another project into the current .forge/config.json')
    .action(async (targetPath) => {
      const cwd = process.cwd();
      try {
        const { addedCount, skippedCount, sourceConfig, updated } =
          await runExtend(targetPath, cwd);

        console.log(chalk.green(
          `✓ Extended config with ${sourceConfig.name}`
        ));
        if (addedCount > 0) {
          console.log('\n  Added processes:');
          const added = updated.processes.slice(-(addedCount));
          for (const proc of added) {
            console.log(chalk.dim(`    ${proc.name}  (cwd: ${proc.cwd})`));
          }
        }
        if (skippedCount > 0) {
          console.log(chalk.dim(`\n  Skipped ${skippedCount} already-present process(es)`));
        }
        if (addedCount === 0 && skippedCount === 0) {
          console.log(chalk.dim('\n  No processes to add from target directory'));
        }
        console.log('');
        console.log('  Run ' + chalk.dim('forge sync') + ' to apply if already registered.');
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
};

module.exports.inspectDirectory = inspectDirectory;
module.exports.buildExtendedConfig = buildExtendedConfig;
module.exports.runExtend = runExtend;
