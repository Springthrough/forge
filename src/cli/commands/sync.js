const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const client = require('../client');
const { writeEnvFile } = require('../env-file');

module.exports = function registerSync(program) {
  program
    .command('sync')
    .description('Re-read .forge/config.json from CWD and update port allocations')
    .action(async () => {
      const cwd = process.cwd();
      const configPath = path.join(cwd, '.forge', 'config.json');
      if (!fs.existsSync(configPath)) {
        console.error(chalk.red(`No .forge/config.json found in ${cwd}`));
        process.exit(1);
      }
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      let result;
      try {
        result = await client.syncProject(config.name, { ...config, path: cwd });
      } catch (err) {
        console.error(chalk.red(`Sync failed: ${err.message}`));
        process.exit(1);
      }
      const envFile = config.envFile ?? '.env.forge';
      writeEnvFile(cwd, envFile, result.allocations, config);
      console.log(chalk.green(`✓ Synced ${config.name}`));
      for (const [proc, port] of Object.entries(result.allocations.ports)) {
        console.log(chalk.dim(`  ${proc}: ${port}`));
      }
      if (envFile !== false) console.log(chalk.dim(`  Wrote ${envFile}`));
    });
};
