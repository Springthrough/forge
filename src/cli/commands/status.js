const chalk = require('chalk');
const client = require('../client');

module.exports = function registerStatus(program) {
  program
    .command('status')
    .description('Show all registered projects and their allocations')
    .action(async () => {
      if (!await client.isDaemonRunning()) {
        console.log(chalk.red('Forge daemon is not running.'));
        return;
      }
      const projects = await client.getProjects();
      if (projects.length === 0) {
        console.log(chalk.dim('No projects registered. Run: forge add'));
        return;
      }
      for (const p of projects) {
        console.log(chalk.bold(p.name) + chalk.dim('  ' + p.path));
        for (const [proc, port] of Object.entries(p.allocations?.ports ?? {})) {
          console.log(chalk.dim(`  port  ${proc}: ${port}`));
        }
        for (const [svc, url] of Object.entries(p.allocations?.services ?? {})) {
          console.log(chalk.dim(`  svc   ${svc}: ${url}`));
        }
        console.log('');
      }
    });
};
