// src/cli/service/systemd.js
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

module.exports = { generateUnit };
