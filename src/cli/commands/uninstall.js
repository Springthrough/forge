// src/cli/commands/uninstall.js
const chalk = require('chalk');

module.exports = function registerUninstall(program) {
  program
    .command('uninstall')
    .description('Stop the daemon and remove the launchd agent')
    .action(async () => {
      if (process.platform !== 'darwin') {
        console.error(chalk.red('forge uninstall currently only supports macOS (launchd)'));
        process.exit(1);
      }
      const { uninstall, PLIST_PATH } = require('../launchd');
      const fs = require('fs');
      if (!fs.existsSync(PLIST_PATH)) {
        console.log(chalk.dim('Forge daemon is not installed.'));
        return;
      }
      uninstall();
      console.log(chalk.green('✓ Forge daemon stopped and removed'));
      console.log(chalk.dim('  Registry and logs in ~/.forge/ are preserved.'));
    });
};
