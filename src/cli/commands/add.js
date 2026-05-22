// src/cli/commands/add.js
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const client = require('../client');
const { writeEnvFile } = require('../env-file');

module.exports = function registerAdd(program) {
  program
    .command('add')
    .description('Register the project in the current directory with forge')
    .action(async () => {
      const cwd = process.cwd();
      const configPath = path.join(cwd, '.forge', 'config.json');

      if (!fs.existsSync(configPath)) {
        console.error(chalk.red(`No .forge/config.json found in ${cwd}`));
        process.exit(1);
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running. Run: forge install'));
        process.exit(1);
      }

      let result;
      try {
        result = await client.registerProject({ ...config, path: cwd });
      } catch (err) {
        if (err.status === 409) {
          console.error(chalk.red(`"${config.name}" is already registered. Run: forge sync`));
        } else {
          console.error(chalk.red(`Registration failed: ${err.message}`));
        }
        process.exit(1);
      }

      const envFile = config.envFile ?? '.env.forge';
      writeEnvFile(cwd, envFile, result.allocations, config);

      console.log(chalk.green(`✓ Registered ${config.name}`));
      if (Object.keys(result.allocations.ports).length) {
        console.log('\n  Allocated ports:');
        for (const [proc, port] of Object.entries(result.allocations.ports)) {
          console.log(chalk.dim(`    ${proc}: ${port}`));
        }
      }
      if (envFile !== false) {
        console.log(chalk.dim(`\n  Wrote ${envFile}`));
      }
    });
};
