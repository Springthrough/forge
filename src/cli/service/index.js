// src/cli/service/index.js
function getServiceImpl(platform = process.platform) {
  if (platform === 'darwin') return require('./launchd');
  if (platform === 'linux')  return require('./systemd');
  throw new Error(`forge does not yet support ${platform}`);
}

module.exports = { getServiceImpl };
