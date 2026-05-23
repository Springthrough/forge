const chalk = require('chalk');
const client = require('../client');

const KNOWN_TYPES = ['mongo', 'postgres', 'redis', 'rabbitmq'];

module.exports = function registerService(program) {
  const service = program
    .command('service')
    .description('Manage named shared service instances');

  service
    .command('list')
    .description('List all custom service instances')
    .action(async () => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      const instances = await client.listInstances();
      if (instances.length === 0) {
        console.log(chalk.dim('No custom service instances configured.'));
        return;
      }
      for (const inst of instances) {
        const opts = Object.entries(inst.options ?? {})
          .filter(([, v]) => v)
          .map(([k]) => chalk.cyan(k))
          .join(', ');
        console.log(
          `${chalk.bold(inst.key)}  ${chalk.dim(`port ${inst.port}`)}${opts ? `  ${opts}` : ''}`
        );
      }
    });

  service
    .command('add <type> <name>')
    .description('Add a named service instance (e.g. forge service add mongo rs)')
    .option('--port <port>', 'Port to bind (default: auto-assigned)', parseInt)
    .option('--replica-set', 'Enable MongoDB replica set mode (mongo only)')
    .action(async (type, name, opts) => {
      if (!KNOWN_TYPES.includes(type)) {
        console.error(chalk.red(`Unknown service type "${type}". Valid types: ${KNOWN_TYPES.join(', ')}`));
        process.exit(1);
      }
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      const result = await client.addInstance(type, name, { port: opts.port, replicaSet: opts.replicaSet });
      if (result.error) {
        console.error(chalk.red(result.error));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Added ${chalk.bold(result.key)} on port ${result.port}`));
      console.log(chalk.dim(`  Reference in .forge/config.json as "${result.key}"`));
    });

  service
    .command('remove <type> <name>')
    .description('Remove a named service instance')
    .action(async (type, name) => {
      const key = `${type}:${name}`;
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      const result = await client.removeInstance(key);
      if (result.error) {
        console.error(chalk.red(result.error));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Removed ${chalk.bold(key)}`));
    });

  service
    .command('configure <type> <name>')
    .description('Update options for a named service instance')
    .option('--port <port>', 'Change the bound port', parseInt)
    .option('--replica-set', 'Enable MongoDB replica set mode')
    .option('--no-replica-set', 'Disable MongoDB replica set mode')
    .action(async (type, name, opts) => {
      const key = `${type}:${name}`;
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }
      const updates = {};
      if (opts.port !== undefined) updates.port = opts.port;
      if (opts.replicaSet !== undefined) updates.options = { replicaSet: opts.replicaSet };
      const result = await client.configureInstance(key, updates);
      if (result.error) {
        console.error(chalk.red(result.error));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Updated ${chalk.bold(key)}`));
    });
};
