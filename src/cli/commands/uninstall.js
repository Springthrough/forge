// src/cli/commands/uninstall.js
const chalk = require('chalk');
const { getServiceImpl } = require('../service');

module.exports = function registerUninstall(program) {
  program
    .command('uninstall')
    .description('Stop the daemon and remove the user service')
    .action(async () => {
      let service;
      try {
        service = getServiceImpl();
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }

      if (!service.isInstalled()) {
        console.log(chalk.dim('Forge daemon is not installed.'));
        return;
      }
      service.uninstall();
      console.log(chalk.green('✓ Forge daemon stopped and removed'));
      console.log(chalk.dim('  Registry and logs in ~/.forge/ are preserved.'));
    });
};
