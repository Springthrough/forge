// src/cli/commands/reload.js
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { version } = require('../../../package.json');
const client = require('../client');
const { writeEnvFile, ensureGitignored } = require('../env-file');
const { writeClaude, hasForgeSection } = require('../claude-md');

module.exports = function registerReload(program) {
  program
    .command('reload')
    .alias('sync')
    .description('Re-read .forge/config.json and apply changes to the daemon')
    .action(async () => {
      const cwd = process.cwd();
      const configPath = path.join(cwd, '.forge', 'config.json');
      if (!fs.existsSync(configPath)) {
        console.error(chalk.red(`No .forge/config.json found in ${cwd}`));
        process.exit(1);
      }
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running.'));
        process.exit(1);
      }

      let health = {};
      try { health = await client.health(); } catch { /* skip version check if health call fails */ }
      if ((health.version ?? null) !== null && health.version !== version) {
        console.warn(chalk.yellow(`  ⚠ Daemon is running v${health.version} but forge v${version} is installed — run \`forge restart\` to apply code changes.`));
      }

      let result;
      try {
        result = await client.syncProject(config.name, { ...config, path: cwd });
      } catch (err) {
        console.error(chalk.red(`Reload failed: ${err.message}`));
        process.exit(1);
      }
      const envFile = config.envFile ?? '.env.forge';
      writeEnvFile(cwd, envFile, result.allocations, config);
      console.log(chalk.green(`✓ Reloaded ${config.name}`));
      for (const [proc, port] of Object.entries(result.allocations.ports)) {
        console.log(chalk.dim(`  ${proc}: ${port}`));
      }
      if (envFile !== false) {
        const gitignoreResult = ensureGitignored(cwd, envFile);
        if (gitignoreResult === 'added') console.log(chalk.dim(`  Wrote ${envFile} (added to .gitignore)`));
        else if (gitignoreResult === 'no-gitignore') console.log(chalk.dim(`  Wrote ${envFile}`) + chalk.yellow(` — add "${envFile}" to your .gitignore`));
        else console.log(chalk.dim(`  Wrote ${envFile}`));
      }
      for (const proc of config.processes ?? []) {
        if (proc.envFile) ensureGitignored(cwd, proc.envFile);
      }
      for (const w of result.warnings ?? []) {
        console.warn(chalk.yellow(`\n  ⚠ ${w}`));
      }

      if (hasForgeSection(cwd)) {
        try {
          writeClaude(cwd, config);
          console.log(chalk.dim('  Updated CLAUDE.md'));
        } catch (err) {
          console.warn(chalk.yellow(`  ⚠ Could not update CLAUDE.md: ${err.message}`));
        }
      }
    });
};
