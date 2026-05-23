jest.mock('../../src/cli/client');
const client = require('../../src/cli/client');
const { runVersion } = require('../../src/cli/commands/version');

describe('forge version', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
    jest.clearAllMocks();
  });

  test('shows running status when daemon is up and versions match', async () => {
    const { version } = require('../../package.json');
    client.health.mockResolvedValue({ ok: true, version });
    await runVersion();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('running');
    expect(logSpy.mock.calls[0][0]).not.toContain('⚠');
  });

  test('shows stopped status when daemon is not running', async () => {
    client.health.mockRejectedValue(new Error('connection refused'));
    await runVersion();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('stopped');
    expect(logSpy.mock.calls[0][0]).not.toContain('⚠');
  });

  test('shows mismatch warning when daemon version differs from installed version', async () => {
    client.health.mockResolvedValue({ ok: true, version: '0.3.0' });
    await runVersion();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain('running');
    expect(output).toContain('⚠');
    expect(output).toContain('0.3.0');
    expect(output).toContain('forge restart');
  });

  test('shows stopped status when health response is missing version field', async () => {
    client.health.mockResolvedValue({ ok: true });
    await runVersion();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain('stopped');
    expect(output).not.toContain('⚠');
    expect(output).not.toContain('undefined');
  });
});
