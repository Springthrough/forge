const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('child_process');
const { execSync } = require('child_process');

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

describe('systemd.install', () => {
  let configHome;

  beforeEach(() => {
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-systemd-cfg-'));
    process.env.XDG_CONFIG_HOME = configHome;
    execSync.mockReset();
  });

  afterEach(() => {
    fs.rmSync(configHome, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('writes the unit file to $XDG_CONFIG_HOME/systemd/user/forge.service', () => {
    systemd.install();
    const unitPath = path.join(configHome, 'systemd', 'user', 'forge.service');
    expect(fs.existsSync(unitPath)).toBe(true);
    expect(fs.readFileSync(unitPath, 'utf8')).toContain('ExecStart=');
  });

  test('runs systemctl daemon-reload, enable, restart (in that order)', () => {
    systemd.install();
    const calls = execSync.mock.calls.map(c => c[0]);
    expect(calls).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user enable forge.service',
      'systemctl --user restart forge.service',
    ]);
  });
});

describe('systemd.uninstall', () => {
  let configHome;

  beforeEach(() => {
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-systemd-cfg-'));
    process.env.XDG_CONFIG_HOME = configHome;
    execSync.mockReset();
  });

  afterEach(() => {
    fs.rmSync(configHome, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('stops + disables service and removes the unit file', () => {
    const target = path.join(configHome, 'systemd', 'user', 'forge.service');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'placeholder');

    systemd.uninstall();

    expect(fs.existsSync(target)).toBe(false);
    const calls = execSync.mock.calls.map(c => c[0]);
    expect(calls).toEqual([
      'systemctl --user stop forge.service',
      'systemctl --user disable forge.service',
      'systemctl --user daemon-reload',
    ]);
  });

  test('is a no-op when not installed', () => {
    systemd.uninstall();
    expect(execSync).not.toHaveBeenCalled();
  });
});

describe('systemd.isInstalled', () => {
  let configHome;

  beforeEach(() => {
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-systemd-cfg-'));
    process.env.XDG_CONFIG_HOME = configHome;
  });

  afterEach(() => {
    fs.rmSync(configHome, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('returns false when unit file does not exist', () => {
    expect(systemd.isInstalled()).toBe(false);
  });

  test('returns true when unit file exists', () => {
    const target = path.join(configHome, 'systemd', 'user', 'forge.service');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'placeholder');
    expect(systemd.isInstalled()).toBe(true);
  });
});
