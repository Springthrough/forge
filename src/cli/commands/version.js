const chalk = require('chalk');
const { version } = require('../../../package.json');
const client = require('../client');

module.exports = function registerVersion(program) {
  program
    .command('version')
    .description('Show forge version and daemon status')
    .action(async () => {
      const daemonRunning = await client.isDaemonRunning();
      console.log(`forge ${chalk.bold(version)}  daemon ${daemonRunning ? chalk.green('running') : chalk.dim('stopped')}`);
    });
};
