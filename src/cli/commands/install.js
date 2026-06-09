// src/cli/commands/install.js
const chalk = require('chalk');
const client = require('../client');
const { getServiceImpl } = require('../service');

module.exports = function registerInstall(program) {
  program
    .command('install')
    .description('Register forge as a user service and start the daemon')
    .action(async () => {
      let service;
      try {
        service = getServiceImpl();
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }

      console.log('Installing forge daemon...');
      service.install();

      // Poll up to 5s for daemon readiness
      let ready = false;
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (await client.isDaemonRunning()) { ready = true; break; }
      }

      if (!ready) {
        console.error(chalk.red('Daemon did not start within 5 seconds.'));
        console.error(chalk.dim('  Check: ~/.forge/daemon.error.log'));
        process.exit(1);
      }

      console.log(chalk.green('✓ Forge daemon installed and running'));
      console.log(chalk.dim('  Starts automatically on login.'));
    });
};
