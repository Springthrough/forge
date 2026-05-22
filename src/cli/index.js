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

program.parseAsync(process.argv).catch(err => {
  console.error(err.message);
  process.exit(1);
});
