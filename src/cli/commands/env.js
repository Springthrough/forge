const path = require('path');
const chalk = require('chalk');
const client = require('../client');
const { parseEnvFile } = require('../../parse-env-file');

module.exports = function registerEnv(program) {
  program
    .command('env [project]')
    .description('Show env vars forge injects for a project (defaults to CWD project)')
    .action(async (projectName) => {
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }

      let resolvedName = projectName;
      if (!resolvedName) {
        const projects = await client.getProjects().catch(() => []);
        const cwd = process.cwd();
        const match = projects.find(p => p.path === cwd);
        if (!match) {
          console.error(chalk.red('No project found for current directory. Pass a project name or run from a registered project.'));
          process.exit(1);
        }
        resolvedName = match.name;
      }

      let project;
      try {
        project = await client.getProject(resolvedName);
      } catch {
        console.error(chalk.red(`Project "${resolvedName}" not found`));
        process.exit(1);
      }

      const config = project.config ?? {};
      const alloc = project.allocations ?? {};

      const serviceLines = [];
      for (const [svc, url] of Object.entries(alloc.services ?? {})) {
        const svcCfg = config.services?.[svc] ?? {};
        if (svcCfg.env) {
          serviceLines.push(`  ${chalk.cyan(svcCfg.env)}=${url}`);
        } else {
          serviceLines.push(`  ${chalk.yellow(`# ${svc} has no "env" key — connection string not injected`)}`);
        }
      }

      const processLines = [];
      for (const proc of config.processes ?? []) {
        const port = alloc.ports?.[proc.name];
        if (proc.portEnv && port != null) {
          processLines.push(`  ${chalk.cyan(proc.portEnv)}=${port}  ${chalk.dim(`# ${proc.name}`)}`);
        }
      }

      const overrideLines = [];
      for (const proc of config.processes ?? []) {
        if (!proc.envFile) continue;
        const absPath = path.resolve(project.path, proc.envFile);
        const vars = parseEnvFile(absPath);
        if (vars === null) {
          overrideLines.push(`  ${chalk.dim(proc.name)}  ${chalk.dim(proc.envFile)}  ${chalk.yellow('✗  (file not found)')}`);
        } else {
          const keys = Object.keys(vars);
          const keyInfo = keys.length > 0 ? `  ${chalk.dim(`[${keys.join(', ')}]`)}` : '';
          overrideLines.push(`  ${chalk.dim(proc.name)}  ${chalk.dim(proc.envFile)}  ${chalk.green('✓')}${keyInfo}`);
        }
      }

      const hasOutput = serviceLines.length > 0 || processLines.length > 0 || overrideLines.length > 0;
      if (!hasOutput) {
        console.log(chalk.dim('No env vars allocated for this project.'));
        return;
      }

      if (serviceLines.length > 0) {
        console.log(chalk.bold('Services:'));
        for (const l of serviceLines) console.log(l);
      }
      if (processLines.length > 0) {
        if (serviceLines.length > 0) console.log('');
        console.log(chalk.bold('Processes:'));
        for (const l of processLines) console.log(l);
      }
      if (overrideLines.length > 0) {
        if (serviceLines.length > 0 || processLines.length > 0) console.log('');
        console.log(chalk.bold('Override files:'));
        for (const l of overrideLines) console.log(l);
      }
    });
};
