const chalk = require('chalk');
const { FORGE_PORT } = require('../../constants');
const client = require('../client');

async function resolveProject(nameArg) {
  if (nameArg) return nameArg;
  const projects = await client.getProjects().catch(() => []);
  const match = projects.find(p => p.path === process.cwd());
  if (!match) throw new Error('No project found for current directory. Pass a project name or run from a registered project.');
  return match.name;
}

module.exports = function registerLogs(program) {
  program
    .command('logs <process> [project]')
    .description('Show output for a process. Use -f to stream live.')
    .option('-f, --follow', 'Stream live output')
    .option('-n, --lines <n>', 'Number of lines to show from buffer', '100')
    .action(async (processName, projectArg, opts) => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }

      let projectName;
      try {
        projectName = await resolveProject(projectArg);
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }

      if (!opts.follow) {
        let result;
        try {
          result = await client.getLogs(projectName, processName, parseInt(opts.lines, 10));
        } catch (err) {
          console.error(chalk.red(`Failed to get logs: ${err.message}`));
          process.exit(1);
        }
        if (result.lines.length === 0) {
          console.log(chalk.dim('(no output buffered)'));
        } else {
          process.stdout.write(result.lines.join('\r\n') + '\n');
        }
        return;
      }

      // --follow: connect via WebSocket and stream output
      const { WebSocket } = require('ws');
      const enc = encodeURIComponent;
      const url = `ws://localhost:${FORGE_PORT}?project=${enc(projectName)}&process=${enc(processName)}`;
      const ws = new WebSocket(url);

      ws.on('error', (err) => {
        console.error(chalk.red(`WebSocket error: ${err.message}`));
        process.exit(1);
      });

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'output') process.stdout.write(msg.data);
        if (msg.type === 'status') process.stderr.write(chalk.dim(`[${processName} ${msg.status}]\n`));
        if (msg.type === 'error') console.error(chalk.red(msg.message));
      });

      ws.on('close', () => process.exit(0));

      process.on('SIGINT', () => { ws.close(); process.exit(0); });
    });
};
