const chalk = require('chalk');
const client = require('../client');

module.exports = function registerEnv(program) {
  program
    .command('env <project>')
    .description('Print allocated env vars for a project')
    .action(async (projectName) => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      let project;
      try {
        project = await client.getProject(projectName);
      } catch {
        console.error(chalk.red(`Project "${projectName}" not found`));
        process.exit(1);
      }
      const config = project.config ?? {};
      const alloc = project.allocations ?? {};
      for (const [svc, url] of Object.entries(alloc.services ?? {})) {
        const svcCfg = config.services?.[svc] ?? {};
        if (svcCfg.env) console.log(`${svcCfg.env}=${url}`);
        if (svc === 'redis' && svcCfg.prefix && svcCfg.prefixEnv) {
          console.log(`${svcCfg.prefixEnv}=${svcCfg.prefix}`);
        }
      }
      for (const proc of config.processes ?? []) {
        const port = alloc.ports?.[proc.name];
        if (proc.portEnv && port != null) {
          console.log(`${proc.portEnv}=${port}  # ${proc.name}`);
        }
      }
    });
};
