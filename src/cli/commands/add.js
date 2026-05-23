// src/cli/commands/add.js
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const chalk = require('chalk');
const client = require('../client');
const { writeEnvFile, ensureGitignored } = require('../env-file');
const { writeClaude, hasForgeSection } = require('../claude-md');

function confirm(question) {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim() === '' || answer.trim().toLowerCase().startsWith('y'));
    });
  });
}

module.exports = function registerAdd(program) {
  program
    .command('add')
    .description('Register the project in the current directory with forge')
    .action(async () => {
      const cwd = process.cwd();
      const configPath = path.join(cwd, '.forge', 'config.json');

      if (!fs.existsSync(configPath)) {
        console.error(chalk.red(`No .forge/config.json found in ${cwd}`));
        process.exit(1);
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      if (!await client.isDaemonRunning()) {
        console.error(chalk.red('Forge daemon is not running. Run: forge install'));
        process.exit(1);
      }

      let result;
      try {
        result = await client.registerProject({ ...config, path: cwd });
      } catch (err) {
        if (err.status === 409) {
          console.error(chalk.red(`"${config.name}" is already registered. Run: forge sync`));
        } else {
          console.error(chalk.red(`Registration failed: ${err.message}`));
        }
        process.exit(1);
      }

      const envFile = config.envFile ?? '.env.forge';
      writeEnvFile(cwd, envFile, result.allocations, config);

      console.log(chalk.green(`✓ Registered ${config.name}`));
      if (Object.keys(result.allocations.ports).length) {
        console.log('\n  Allocated ports:');
        for (const [proc, port] of Object.entries(result.allocations.ports)) {
          console.log(chalk.dim(`    ${proc}: ${port}`));
        }
      }
      if (envFile !== false) {
        const gitignoreResult = ensureGitignored(cwd, envFile);
        if (gitignoreResult === 'added') console.log(chalk.dim(`\n  Wrote ${envFile} (added to .gitignore)`));
        else if (gitignoreResult === 'no-gitignore') console.log(chalk.dim(`\n  Wrote ${envFile}`) + chalk.yellow(` — add "${envFile}" to your .gitignore`));
        else console.log(chalk.dim(`\n  Wrote ${envFile}`));
      }
      for (const proc of config.processes ?? []) {
        if (proc.envFile) ensureGitignored(cwd, proc.envFile);
      }
      for (const w of result.warnings ?? []) {
        console.warn(chalk.yellow(`\n  ⚠ ${w}`));
      }

      try {
        if (hasForgeSection(cwd)) {
          writeClaude(cwd, config);
          console.log(chalk.dim('\n  Updated CLAUDE.md'));
        } else {
          const claudeExists = fs.existsSync(path.join(cwd, 'CLAUDE.md'));
          const q = claudeExists
            ? '\nAdd a forge section to existing CLAUDE.md for AI assistants? [Y/n] '
            : '\nWrite CLAUDE.md with forge context for AI assistants? [Y/n] ';
          if (await confirm(q)) {
            writeClaude(cwd, config);
            console.log(chalk.dim(`  ${claudeExists ? 'Updated' : 'Wrote'} CLAUDE.md`));
          }
        }
      } catch (err) {
        console.warn(chalk.yellow(`  ⚠ Could not write CLAUDE.md: ${err.message}`));
      }
    });
};
