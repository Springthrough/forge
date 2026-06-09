const {
  killProcessTree,
  isProcessTreeAlive,
  waitForProcessTreeDead,
} = require('../../src/daemon/process-kill');

jest.mock('tree-kill', () => jest.fn());
const treeKill = require('tree-kill');

describe('killProcessTree', () => {
  let kills;
  let realKill;
  beforeEach(() => {
    kills = [];
    realKill = process.kill;
    process.kill = (pid, signal) => { kills.push({ pid, signal }); };
    treeKill.mockClear();
  });
  afterEach(() => { process.kill = realKill; });

  test('no-op when record has no pid', () => {
    killProcessTree({ pid: null }, 'linux');
    expect(kills).toEqual([]);
    expect(treeKill).not.toHaveBeenCalled();
  });

  test('POSIX path sends SIGTERM to the negated pid (process group)', () => {
    killProcessTree({ pid: 12345 }, 'linux');
    expect(kills).toEqual([{ pid: -12345, signal: 'SIGTERM' }]);
    expect(treeKill).not.toHaveBeenCalled();
  });

  test('POSIX path accepts custom signal', () => {
    killProcessTree({ pid: 12345 }, 'darwin', 'SIGKILL');
    expect(kills).toEqual([{ pid: -12345, signal: 'SIGKILL' }]);
  });

  test('POSIX path swallows ESRCH (already dead)', () => {
    process.kill = () => { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; };
    expect(() => killProcessTree({ pid: 12345 }, 'linux')).not.toThrow();
  });

  test('Windows path calls tree-kill with SIGKILL', () => {
    killProcessTree({ pid: 12345 }, 'win32');
    expect(kills).toEqual([]);
    expect(treeKill).toHaveBeenCalledTimes(1);
    expect(treeKill.mock.calls[0][0]).toBe(12345);
    expect(treeKill.mock.calls[0][1]).toBe('SIGKILL');
  });
});

describe('isProcessTreeAlive', () => {
  let realKill;
  beforeEach(() => { realKill = process.kill; });
  afterEach(() => { process.kill = realKill; });

  test('POSIX: true when kill(-pid, 0) succeeds', () => {
    process.kill = (pid, signal) => {
      if (pid === -777 && signal === 0) return true;
      throw new Error('unexpected');
    };
    expect(isProcessTreeAlive(777, 'linux')).toBe(true);
  });

  test('POSIX: false on ESRCH', () => {
    process.kill = () => { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; };
    expect(isProcessTreeAlive(777, 'linux')).toBe(false);
  });

  test('Windows: true when kill(pid, 0) succeeds', () => {
    process.kill = (pid, signal) => {
      if (pid === 777 && signal === 0) return true;
      throw new Error('unexpected');
    };
    expect(isProcessTreeAlive(777, 'win32')).toBe(true);
  });

  test('Windows: false on throw', () => {
    process.kill = () => { throw new Error('not found'); };
    expect(isProcessTreeAlive(777, 'win32')).toBe(false);
  });
});

describe('waitForProcessTreeDead', () => {
  let realKill;
  beforeEach(() => { realKill = process.kill; });
  afterEach(() => { process.kill = realKill; });

  test('resolves immediately when process is already dead', async () => {
    process.kill = () => { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; };
    const start = Date.now();
    await waitForProcessTreeDead(777, 500, 'linux');
    expect(Date.now() - start).toBeLessThan(100);
  });

  test('resolves after the process dies mid-wait', async () => {
    let alive = true;
    process.kill = () => {
      if (alive) return true;
      const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e;
    };
    setTimeout(() => { alive = false; }, 100);
    const start = Date.now();
    await waitForProcessTreeDead(777, 2000, 'linux');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(500);
  });

  test('resolves at timeout when the process never dies', async () => {
    process.kill = () => true; // always "alive"
    const start = Date.now();
    await waitForProcessTreeDead(777, 200, 'linux');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(500);
  });
});
