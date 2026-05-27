jest.mock('../../src/cli/client');
const client = require('../../src/cli/client');
const { runStatus } = require('../../src/cli/commands/status');

describe('forge status', () => {
  let logSpy, errorSpy, exitSpy;

  beforeEach(() => {
    logSpy   = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
    exitSpy  = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    jest.clearAllMocks();
  });

  test('shows dashboard URL when projects exist', async () => {
    client.isDaemonRunning.mockResolvedValue(true);
    client.getProjects.mockResolvedValue([
      { name: 'myapp', path: '/projects/myapp', allocations: { ports: {}, services: {} }, config: { processes: [] } },
    ]);
    client.getProcesses.mockResolvedValue({ processes: [] });

    await runStatus();

    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).toContain('http://localhost:');
    expect(allOutput).toContain('Dashboard');
  });

  test('does not show dashboard URL when no projects registered', async () => {
    client.isDaemonRunning.mockResolvedValue(true);
    client.getProjects.mockResolvedValue([]);

    await runStatus();

    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).not.toContain('http://localhost:');
  });

  test('does not show dashboard URL when daemon is not running', async () => {
    client.isDaemonRunning.mockResolvedValue(false);

    await expect(runStatus()).rejects.toThrow('exit');

    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).not.toContain('http://localhost:');
  });
});
