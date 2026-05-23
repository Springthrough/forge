// src/cli/commands/init.js
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

function detectProjectName(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) return pkg.name;
    } catch {}
  }
  return path.basename(dir);
}

async function runInit(dir) {
  const configPath = path.join(dir, '.forge', 'config.json');

  if (fs.existsSync(configPath)) {
    throw new Error(`.forge/config.json already exists in ${dir}`);
  }

  const name = detectProjectName(dir);

  const config = {
    name,
    envFile: '.env.forge',
    processes: [
      {
        name: 'api',
        command: 'npm start',
        cwd: '.',
        ports: [3000, 3001, 3002],
        portEnv: 'PORT',
      },
    ],
    services: {},
  };

  fs.mkdirSync(path.join(dir, '.forge'), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

module.exports = function registerInit(program) {
  program
    .command('init')
    .description('Create a .forge/config.json template in the current directory')
    .action(async () => {
      const cwd = process.cwd();
      try {
        await runInit(cwd);
        console.log(chalk.green('✓ Created .forge/config.json'));
        console.log('');
        console.log('  Edit it to define your processes and services, then run:');
        console.log(chalk.dim('  forge add') + '    — registers project and offers to write CLAUDE.md');
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
};

module.exports.runInit = runInit;
