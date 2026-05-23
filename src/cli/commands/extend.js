// src/cli/commands/extend.js
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

function extractTomlName(content) {
  for (const section of ['project', 'tool\\.poetry']) {
    const headerRe = new RegExp(`^\\[${section}\\]`, 'm');
    const headerMatch = headerRe.exec(content);
    if (!headerMatch) continue;
    const after = content.slice(headerMatch.index + headerMatch[0].length);
    const nextSection = after.search(/^\[[^\[]/m);
    const body = nextSection === -1 ? after : after.slice(0, nextSection);
    const nameMatch = body.match(/^name\s*=\s*["']([^"']+)["']/m);
    if (nameMatch) return nameMatch[1];
  }
  return null;
}

function extractTomlScripts(content) {
  for (const section of ['project\\.scripts', 'tool\\.poetry\\.scripts']) {
    const m = content.match(new RegExp(`\\[${section}\\]([^\\[]*)`, 's'));
    if (!m) continue;
    const scripts = {};
    for (const line of m[1].split('\n')) {
      const entry = line.match(/^\s*([\w][\w-]*)\s*=\s*["']([^"']+)["']/);
      if (entry) scripts[entry[1]] = entry[2];
    }
    if (Object.keys(scripts).length > 0) return scripts;
  }
  return {};
}

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

  // Python project detection
  const hasPyproject = fs.existsSync(path.join(dirPath, 'pyproject.toml'));
  const hasMakefile  = fs.existsSync(path.join(dirPath, 'Makefile'));
  const hasAppPy     = fs.existsSync(path.join(dirPath, 'app.py'));
  const hasMainPy    = fs.existsSync(path.join(dirPath, 'main.py'));

  if (hasPyproject || hasMakefile || hasAppPy || hasMainPy) {
    let name = path.basename(dirPath);
    const processes = [];

    if (hasPyproject) {
      const toml = fs.readFileSync(path.join(dirPath, 'pyproject.toml'), 'utf8');
      const extracted = extractTomlName(toml);
      if (extracted) name = extracted;
      for (const scriptName of Object.keys(extractTomlScripts(toml))) {
        processes.push({ name: scriptName, command: scriptName, cwd: '.', ports: [] });
      }
    }

    if (hasMakefile) {
      const makefile = fs.readFileSync(path.join(dirPath, 'Makefile'), 'utf8');
      const existingNames = new Set(processes.map(p => p.name));
      for (const target of ['run', 'start']) {
        if (!existingNames.has(target) && new RegExp(`^${target}\\s*:`, 'm').test(makefile)) {
          processes.push({ name: target, command: `make ${target}`, cwd: '.', ports: [] });
        }
      }
    }

    if (processes.length === 0) {
      if (hasAppPy)  processes.push({ name: 'app',  command: 'python app.py',  cwd: '.', ports: [] });
      else if (hasMainPy) processes.push({ name: 'main', command: 'python main.py', cwd: '.', ports: [] });
    }

    return { name, processes, services: {} };
  }

  throw new Error(`No recognized project config found in ${dirPath}`);
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
  const prevServiceKeys = new Set(Object.keys(currentConfig.services ?? {}));
  const addedServices = Object.keys(updated.services ?? {}).filter(s => !prevServiceKeys.has(s));

  fs.writeFileSync(currentConfigPath, JSON.stringify(updated, null, 2) + '\n');
  return { updated, addedCount, skippedCount, sourceConfig, addedServices };
}

module.exports = function registerExtend(program) {
  program
    .command('extend <path>')
    .description('Append processes from another project into the current .forge/config.json')
    .action(async (targetPath) => {
      const cwd = process.cwd();
      try {
        const { addedCount, skippedCount, sourceConfig, updated, addedServices } =
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
        if (addedServices.length > 0) {
          console.log('\n  Merged services:');
          for (const svc of addedServices) {
            const envVar = updated.services[svc]?.env;
            console.log(chalk.dim(`    ${svc}${envVar ? `  →  ${envVar}` : '  (no env key — add one)'}`));
          }
        }
        if (addedCount === 0 && skippedCount === 0 && addedServices.length === 0) {
          console.log(chalk.dim('\n  Nothing new to add from target directory'));
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
