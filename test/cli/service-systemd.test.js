const systemd = require('../../src/cli/service/systemd');

describe('systemd.generateUnit', () => {
  test('produces a unit file with ExecStart pointing at node + daemon script', () => {
    const unit = systemd.generateUnit('/usr/bin/node', '/opt/forge/src/daemon/server.js', '/home/u/.forge');
    expect(unit).toMatch(/^\[Unit\]/m);
    expect(unit).toMatch(/^\[Service\]/m);
    expect(unit).toMatch(/^\[Install\]/m);
    expect(unit).toContain('ExecStart=/usr/bin/node /opt/forge/src/daemon/server.js');
    expect(unit).toContain('Environment=FORGE_PORT=');
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('StandardOutput=append:/home/u/.forge/daemon.log');
    expect(unit).toContain('StandardError=append:/home/u/.forge/daemon.error.log');
    expect(unit).toContain('WantedBy=default.target');
  });
});
