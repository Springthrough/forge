const chalk = require('chalk');
const { version } = require('../../../package.json');
const client = require('../client');

async function runVersion() {
  let daemonVersion = null;
  try {
    const health = await client.health();
    daemonVersion = health.version ?? null;
  } catch {
    // daemon not running
  }

  const running = daemonVersion !== null;
  let line = `forge ${chalk.bold(version)}  daemon ${running ? chalk.green('running') : chalk.dim('stopped')}`;

  if (running && daemonVersion !== version) {
    line += chalk.yellow(`  ⚠ daemon is v${daemonVersion} — run \`forge restart\` to apply updates`);
  }

  console.log(line);
}

module.exports = function registerVersion(program) {
  program
    .command('version')
    .description('Show forge version and daemon status')
    .action(runVersion);
};

module.exports.runVersion = runVersion;
