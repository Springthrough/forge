// src/cli/commands/up.js
const chalk = require('chalk');
const client = require('../client');
const { writeEnvFile } = require('../env-file');

async function startProject(project) {
  if (project.config?.envFile !== false) {
    writeEnvFile(
      project.path,
      project.config?.envFile ?? '.env.forge',
      project.allocations,
      project.config
    );
  }
  await client.upProject(project.name);
  console.log(chalk.green(`✓ ${project.name}`) + chalk.dim('  started'));
}

module.exports = function registerUp(program) {
  program
    .command('up [project]')
    .description('Start processes for a project (or all registered projects)')
    .action(async (projectName) => {
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
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
};
