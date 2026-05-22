// src/cli/launchd.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { FORGE_PORT } = require('../constants');

const LABEL = 'com.forge.daemon';
const FORGE_DIR = path.join(os.homedir(), '.forge');
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

function generatePlist(daemonScript) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${daemonScript}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FORGE_PORT</key><string>${FORGE_PORT}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(FORGE_DIR, 'daemon.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(FORGE_DIR, 'daemon.error.log')}</string>
</dict>
</plist>`;
}

function install() {
  const daemonScript = path.resolve(__dirname, '../../src/daemon/server.js');

  // Create ~/.forge/ before writing the plist — launchd requires the log
  // directory to exist when it starts the daemon for the first time.
  fs.mkdirSync(FORGE_DIR, { recursive: true });

  const plistDir = path.dirname(PLIST_PATH);
  fs.mkdirSync(plistDir, { recursive: true });
  fs.writeFileSync(PLIST_PATH, generatePlist(daemonScript));

  try { execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'ignore' }); } catch {}
  execSync(`launchctl load "${PLIST_PATH}"`);
}

function uninstall() {
  if (!fs.existsSync(PLIST_PATH)) return;
  try { execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'ignore' }); } catch {}
  fs.unlinkSync(PLIST_PATH);
}

module.exports = { install, uninstall, PLIST_PATH };
