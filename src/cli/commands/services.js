const chalk = require('chalk');
const client = require('../client');

module.exports = function registerServices(program) {
  program
    .command('services')
    .description('Show shared service container health')
    .action(async () => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      const services = await client.getServices();
      if (services.length === 0) {
        console.log(chalk.dim('No shared services registered.'));
        return;
      }
      for (const svc of services) {
        const status = svc.healthy
          ? chalk.green('● healthy')
          : chalk.red('✗ unhealthy');
        console.log(`${status}  ${chalk.bold(svc.name)}  ${chalk.dim(svc.containerName)}`);
      }
    });
};
