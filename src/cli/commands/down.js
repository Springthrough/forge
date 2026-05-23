// src/cli/commands/down.js
const chalk = require('chalk');
const client = require('../client');

module.exports = function registerDown(program) {
  program
    .command('down [project]')
    .description('Stop processes for a project (or all registered projects)')
    .action(async (projectName) => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running. Run: forge install'));
        process.exit(1);
      }
      try {
        if (projectName) {
          await client.downProject(projectName);
          console.log(chalk.green(`✓ ${projectName}`) + chalk.dim('  stopped'));
        } else {
          const projects = await client.getProjects();
          if (projects.length === 0) {
            console.log(chalk.dim('No projects registered.'));
            return;
          }
          for (const project of projects) {
            await client.downProject(project.name);
            console.log(chalk.green(`✓ ${project.name}`) + chalk.dim('  stopped'));
          }
        }
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
};
