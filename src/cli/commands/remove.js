const chalk = require('chalk');
const client = require('../client');

module.exports = function registerRemove(program) {
  program
    .command('remove [project]')
    .description('Unregister a project and release its ports (defaults to CWD project)')
    .action(async (projectName) => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }

      let resolvedName = projectName;
      if (!resolvedName) {
        const projects = await client.getProjects().catch(() => []);
        const match = projects.find(p => p.path === process.cwd());
        if (!match) {
          console.error(chalk.red('No project found for current directory. Pass a project name or run from a registered project.'));
          process.exit(1);
        }
        resolvedName = match.name;
      }

      try {
        await client.removeProject(resolvedName);
        console.log(chalk.green(`✓ Removed ${resolvedName}`));
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
};
