// src/cli/commands/status.js
const chalk = require('chalk');
const client = require('../client');

module.exports = function registerStatus(program) {
  program
    .command('status')
    .description('Show all registered projects and their process status')
    .action(async () => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      const projects = await client.getProjects();
      if (projects.length === 0) {
        console.log(chalk.dim('No projects registered. Run: forge add'));
        return;
      }
      for (const p of projects) {
        console.log(chalk.bold(p.name) + chalk.dim('  ' + p.path));

        let processes = [];
        try { processes = (await client.getProcesses(p.name)).processes ?? []; } catch {}
        for (const proc of processes) {
          const statusColor = proc.status === 'running' ? chalk.green
                            : proc.status === 'crashed' ? chalk.red
                            :                             chalk.dim;
          const portInfo = p.allocations?.ports?.[proc.name]
            ? chalk.dim(` :${p.allocations.ports[proc.name]}`)
            : '';
          const uptimeInfo = proc.status === 'running' && proc.uptime > 0
            ? chalk.dim(`  up ${proc.uptime}s`)
            : '';
          console.log(`  ${statusColor(proc.status.padEnd(8))} ${proc.name}${portInfo}${uptimeInfo}`);
        }

        for (const [svc, url] of Object.entries(p.allocations?.services ?? {})) {
          console.log(chalk.dim(`  svc   ${svc}: ${url}`));
        }
        console.log('');
      }
    });
};
