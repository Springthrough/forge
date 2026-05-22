const chalk = require('chalk');
const client = require('../client');

module.exports = function registerRemove(program) {
  program
    .command('remove <project>')
    .description('Unregister a project and release its ports')
    .action(async (projectName) => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      try {
        await client.removeProject(projectName);
        console.log(chalk.green(`✓ Removed ${projectName}`));
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
};
