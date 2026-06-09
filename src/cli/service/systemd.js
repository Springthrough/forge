// src/cli/service/systemd.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { FORGE_PORT } = require('../../constants');

function generateUnit(nodeExec, daemonScript, forgeDir) {
  return `[Unit]
Description=Forge dev process orchestration daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodeExec} ${daemonScript}
Environment=FORGE_PORT=${FORGE_PORT}
Environment=PATH=${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}
Restart=always
RestartSec=2
StandardOutput=append:${forgeDir}/daemon.log
StandardError=append:${forgeDir}/daemon.error.log

[Install]
WantedBy=default.target
`;
}

const FORGE_DIR = path.join(os.homedir(), '.forge');
const UNIT_NAME = 'forge.service';

function unitPath() {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'systemd', 'user', UNIT_NAME);
}

function install() {
  const daemonScript = path.resolve(__dirname, '../../daemon/server.js');
  fs.mkdirSync(FORGE_DIR, { recursive: true });

  const target = unitPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, generateUnit(process.execPath, daemonScript, FORGE_DIR));

  execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
  execSync('systemctl --user enable forge.service', { stdio: 'ignore' });
  // Use restart (not start) so re-running install with an updated unit file
  // actually replaces the running daemon — `start` is a no-op on a unit
  // that's already active.
  execSync('systemctl --user restart forge.service', { stdio: 'ignore' });
}

function uninstall() {
  const target = unitPath();
  if (!fs.existsSync(target)) return;
  try { execSync('systemctl --user stop forge.service', { stdio: 'ignore' }); } catch {}
  try { execSync('systemctl --user disable forge.service', { stdio: 'ignore' }); } catch {}
  fs.unlinkSync(target);
  try { execSync('systemctl --user daemon-reload', { stdio: 'ignore' }); } catch {}
}

function isInstalled() {
  return fs.existsSync(unitPath());
}

module.exports = { generateUnit, install, uninstall, isInstalled, unitPath };
