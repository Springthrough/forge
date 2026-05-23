const chalk = require('chalk');
const { version } = require('../../../package.json');
const client = require('../client');

async function runVersion() {
  let daemonRunning = false;
  let daemonVersion = null;
  try {
    const health = await client.health();
    daemonRunning = true;
    daemonVersion = health.version ?? null;
  } catch {
    // daemon not running
  }

  let line = `forge ${chalk.bold(version)}  daemon ${daemonRunning ? chalk.green('running') : chalk.dim('stopped')}`;

  if (daemonRunning && daemonVersion !== null && daemonVersion !== version) {
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
