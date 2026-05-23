jest.mock('../../src/cli/client');
jest.mock('fs');
jest.mock('../../src/cli/env-file', () => ({
  writeEnvFile: jest.fn(),
  ensureGitignored: jest.fn().mockReturnValue('exists'),
}));
jest.mock('../../src/cli/claude-md', () => ({
  writeClaude: jest.fn(),
  hasForgeSection: jest.fn().mockReturnValue(false),
}));
const client = require('../../src/cli/client');
const fs = require('fs');
const path = require('path');

// Import after mocks are set up
const registerReload = require('../../src/cli/commands/reload');

// We test the version-mismatch warning in isolation by mocking all other dependencies
// and verifying console.warn is called when versions differ.

describe('forge reload — version mismatch warning', () => {
  let warnSpy;
  let logSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    logSpy = jest.spyOn(console, 'log').mockImplementation();

    // Simulate a valid .forge/config.json
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      name: 'test-project',
      processes: [],
    }));

    // syncProject returns minimal valid result
    client.syncProject.mockResolvedValue({
      allocations: { ports: {} },
      warnings: [],
    });

    // health returns a stale version by default — overridden in match test
    client.health.mockResolvedValue({ ok: true, version: '0.0.0-stale' });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('warns when daemon version differs from installed version', async () => {
    // Build a minimal commander program and run the action
    const { Command } = require('commander');
    const program = new Command();
    registerReload(program);
    await program.parseAsync(['node', 'forge', 'reload'], { from: 'node' });

    const warned = warnSpy.mock.calls.some(
      ([msg]) => typeof msg === 'string' && msg.includes('⚠') && msg.includes('forge restart')
    );
    expect(warned).toBe(true);
  });

  test('does not warn when daemon version matches installed version', async () => {
    const { version } = require('../../package.json');
    client.health.mockResolvedValue({ ok: true, version });

    const { Command } = require('commander');
    const program = new Command();
    registerReload(program);
    await program.parseAsync(['node', 'forge', 'reload'], { from: 'node' });

    const warned = warnSpy.mock.calls.some(
      ([msg]) => typeof msg === 'string' && msg.includes('⚠')
    );
    expect(warned).toBe(false);
  });

});
