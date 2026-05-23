// src/cli/index.js
const { Command } = require('commander');
const { version } = require('../../package.json');

const program = new Command();
program.name('forge').description('Local dev orchestration daemon').version(version);

// Custom help: group root commands by lifecycle phase
program.configureHelp({
  formatHelp(cmd, helper) {
    const helpWidth = helper.helpWidth || 80;
    const indent = '  ';
    const gap = '  ';

    const cmds = helper.visibleCommands(cmd);
    const opts = helper.visibleOptions(cmd);
    const args = helper.visibleArguments(cmd);

    let termWidth = 0;
    for (const c of cmds) termWidth = Math.max(termWidth, helper.subcommandTerm(c).length);
    for (const o of opts) termWidth = Math.max(termWidth, helper.optionTerm(o).length);
    for (const a of args) termWidth = Math.max(termWidth, helper.argumentTerm(a).length);

    function item(term, description) {
      const descOffset = indent.length + termWidth + gap.length;
      return helper.wrap(indent + term.padEnd(termWidth) + gap + (description || ''), helpWidth, descOffset);
    }

    const out = [];
    out.push(`Usage: ${helper.commandUsage(cmd)}`, '');

    const desc = helper.commandDescription(cmd);
    if (desc) out.push(helper.wrap(desc, helpWidth, 0), '');

    if (args.length) {
      out.push('Arguments:');
      for (const a of args) out.push(item(helper.argumentTerm(a), helper.argumentDescription(a)));
      out.push('');
    }

    if (opts.length) {
      out.push('Options:');
      for (const o of opts) out.push(item(helper.optionTerm(o), helper.optionDescription(o)));
      out.push('');
    }

    if (cmds.length) {
      if (cmd.parent === null) {
        // Root command: group by lifecycle phase
        const GROUPS = [
          { title: 'Daemon', names: ['install', 'uninstall'] },
          { title: 'Project setup', names: ['init', 'add', 'extend', 'reload'] },
          { title: 'Daily use', names: ['up', 'down', 'restart', 'status', 'logs', 'env', 'open'] },
          { title: 'Services', names: ['service'] },
          { title: 'Project management', names: ['remove'] },
          { title: 'Info', names: ['version', 'help'] },
        ];
        const cmdMap = new Map(cmds.map(c => [c.name(), c]));
        for (const group of GROUPS) {
          const groupCmds = group.names.map(n => cmdMap.get(n)).filter(Boolean);
          if (!groupCmds.length) continue;
          out.push(`${group.title}:`);
          for (const c of groupCmds) out.push(item(helper.subcommandTerm(c), helper.subcommandDescription(c)));
          out.push('');
        }
      } else {
        // Subcommand: standard flat list
        out.push('Commands:');
        for (const c of cmds) out.push(item(helper.subcommandTerm(c), helper.subcommandDescription(c)));
        out.push('');
      }
    }

    return out.join('\n') + '\n';
  }
});

require('./commands/install')(program);
require('./commands/uninstall')(program);
require('./commands/init')(program);
require('./commands/add')(program);
require('./commands/extend')(program);
require('./commands/reload')(program);
require('./commands/up')(program);
require('./commands/down')(program);
require('./commands/restart')(program);
require('./commands/status')(program);
require('./commands/logs')(program);
require('./commands/env')(program);
require('./commands/open')(program);
require('./commands/service')(program);
require('./commands/remove')(program);
require('./commands/version')(program);

program.parseAsync(process.argv).catch(err => {
  console.error(err.message);
  process.exit(1);
});
