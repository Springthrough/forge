// src/cli/commands/up.js
const chalk = require('chalk');
const client = require('../client');
const { ensureGitignored } = require('../env-file');
const { FORGE_PORT } = require('../../constants');

async function startProject(project) {
  for (const proc of project.config?.processes ?? []) {
    if (proc.envFile) ensureGitignored(project.path, proc.envFile);
  }
  await client.upProject(project.name);
  console.log(chalk.green(`✓ ${project.name}`) + chalk.dim('  started'));
}

async function runUp(projectName) {
  if (!await client.isDaemonRunning()) {
    console.error(chalk.red('Forge daemon is not running. Run: forge install'));
    process.exit(1);
  }
  try {
    if (projectName) {
      const project = await client.getProject(projectName);
      await startProject(project);
    } else {
      const projects = await client.getProjects();
      if (projects.length === 0) {
        console.log(chalk.dim('No projects registered. Run: forge add'));
        return;
      }
      const cwd = process.cwd();
      const cwdProject = projects.find(p => p.path === cwd);
      if (cwdProject) {
        await startProject(cwdProject);
      } else {
        for (const project of projects) {
          await startProject(project);
        }
      }
    }
    console.log(chalk.dim('  Dashboard  ') + chalk.cyan(`http://localhost:${FORGE_PORT}`));
  } catch (err) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }
}

module.exports = function registerUp(program) {
  program
    .command('up [project]')
    .description('Start processes for a project (or all registered projects)')
    .action(runUp);
};

module.exports.runUp = runUp;
