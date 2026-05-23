const chalk = require('chalk');
const client = require('../client');

module.exports = function registerServices(program) {
  const services = program
    .command('services')
    .description('Manage shared service containers');

  // Bare: forge services — show status
  services.action(async () => {
    if (!await client.isDaemonRunning()) {
      console.error(chalk.red('Forge daemon is not running.'));
      process.exit(1);
    }
    const list = await client.getServices();
    if (list.length === 0) {
      console.log(chalk.dim('No shared services registered.'));
      return;
    }
    for (const svc of list) {
      const status = svc.healthy
        ? chalk.green('● healthy')
        : chalk.red('✗ unhealthy');
      console.log(`${status}  ${chalk.bold(svc.name)}  ${chalk.dim(svc.containerName)}`);
    }
  });

  // forge services up [name]
  services
    .command('up [name]')
    .description('Start one or all shared services')
    .action(async (name) => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      try {
        const result = await client.startServices(name);
        if (!result.ok) {
          for (const e of result.errors ?? []) {
            console.error(chalk.red(`✗ ${e.name}: ${e.error}`));
          }
          process.exit(1);
        }
        for (const n of result.started ?? []) {
          console.log(chalk.green(`✓ ${chalk.bold(n)}`) + chalk.dim('  started'));
        }
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // forge services down [name]
  services
    .command('down [name]')
    .description('Stop one or all shared services (blocked if a running project needs it)')
    .action(async (name) => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      try {
        const result = await client.stopServices(name);
        for (const n of result.stopped ?? []) {
          console.log(chalk.green(`✓ ${chalk.bold(n)}`) + chalk.dim('  stopped'));
        }
        for (const b of result.blocked ?? []) {
          console.error(chalk.red(`✗ ${chalk.bold(b.name)}: ${b.reason}`));
        }
        if ((result.blocked ?? []).length > 0) process.exit(1);
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
};
