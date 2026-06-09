// src/cli/service/index.js
function getServiceImpl(platform = process.platform) {
  if (platform === 'darwin') return require('./launchd');
  if (platform === 'linux')  return require('./systemd');
  if (platform === 'win32')  return require('./win-task');
  throw new Error(`forge does not yet support ${platform}`);
}

module.exports = { getServiceImpl };
