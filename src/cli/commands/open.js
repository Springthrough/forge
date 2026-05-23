// src/cli/commands/open.js
const { exec } = require('child_process');
const chalk = require('chalk');
const client = require('../client');
const { FORGE_PORT } = require('../../constants');

module.exports = function registerOpen(program) {
  program
    .command('open')
    .description('Open the Forge dashboard in the default browser')
    .action(async () => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running. Run: forge install'));
        process.exit(1);
      }
      const url = `http://localhost:${FORGE_PORT}`;
      const cmd = process.platform === 'darwin' ? 'open'
                : process.platform === 'win32'  ? 'start'
                :                                 'xdg-open';
      exec(`${cmd} ${url}`);
      console.log(chalk.green(`✓ Opening ${url}`));
    });
};
