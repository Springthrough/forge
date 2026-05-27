jest.mock('../../src/cli/client');
jest.mock('../../src/cli/env-file', () => ({ ensureGitignored: jest.fn() }));
const client = require('../../src/cli/client');
const { runUp } = require('../../src/cli/commands/up');

const fakeProject = (name) => ({
  name,
  path: `/projects/${name}`,
  config: { processes: [] },
});

describe('forge up', () => {
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

  test('shows dashboard URL after starting a named project', async () => {
    client.isDaemonRunning.mockResolvedValue(true);
    client.getProject.mockResolvedValue(fakeProject('myapp'));
    client.upProject.mockResolvedValue({});

    await runUp('myapp');

    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).toContain('myapp');
    expect(allOutput).toContain('http://localhost:');
    expect(allOutput).toContain('Dashboard');
  });

  test('shows dashboard URL once when starting all projects', async () => {
    client.isDaemonRunning.mockResolvedValue(true);
    client.getProjects.mockResolvedValue([fakeProject('a'), fakeProject('b')]);
    client.upProject.mockResolvedValue({});

    await runUp(undefined);

    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).toContain('http://localhost:');
    // URL appears exactly once
    expect((allOutput.match(/http:\/\/localhost:/g) ?? []).length).toBe(1);
  });

  test('does not show dashboard URL when no projects registered', async () => {
    client.isDaemonRunning.mockResolvedValue(true);
    client.getProjects.mockResolvedValue([]);

    await runUp(undefined);

    const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(allOutput).not.toContain('http://localhost:');
  });
});
