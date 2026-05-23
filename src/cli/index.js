// src/cli/index.js
const { Command } = require('commander');
const { version } = require('../../package.json');

const program = new Command();
program.name('forge').description('Local dev orchestration daemon').version(version);

require('./commands/install')(program);
require('./commands/uninstall')(program);
require('./commands/add')(program);
require('./commands/status')(program);
require('./commands/remove')(program);
require('./commands/sync')(program);
require('./commands/env')(program);
require('./commands/services')(program);
require('./commands/service')(program);
require('./commands/init')(program);
require('./commands/extend')(program);
require('./commands/up')(program);
require('./commands/down')(program);
require('./commands/open')(program);
require('./commands/logs')(program);
require('./commands/version')(program);

program.parseAsync(process.argv).catch(err => {
  console.error(err.message);
  process.exit(1);
});
