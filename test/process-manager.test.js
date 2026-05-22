const { createProcessManager } = require('../src/daemon/process-manager');

function makeMockPty() {
  let dataCb = null;
  let exitCb = null;
  return {
    pid: Math.floor(Math.random() * 9000 + 1000),
    onData(cb) { dataCb = cb; },
    onExit(cb) { exitCb = cb; },
    write: jest.fn(),
    resize: jest.fn(),
    kill: jest.fn(() => { exitCb?.({ exitCode: 0 }); }),
    // test helpers
    emit(data) { dataCb?.(data); },
    exit(code = 0) { exitCb?.({ exitCode: code }); },
  };
}

const processConfigs = [
  { name: 'api',    command: 'npm start',       cwd: '.', ports: [3000], portEnv: 'PORT' },
  { name: 'worker', command: 'node worker.js',  cwd: '.', ports: [] },
];
const allocations = { ports: { api: 3000 }, services: {} };

let spawnCalls, pm;

beforeEach(() => {
  spawnCalls = [];
  pm = createProcessManager({
    ptySpawn: (command, env, cwd) => {
      const mock = makeMockPty();
      spawnCalls.push({ command, env, cwd, mock });
      return mock;
    },
  });
});

test('up() spawns one PTY per process config', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  expect(spawnCalls).toHaveLength(2);
});

test('up() injects portEnv into PTY env', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  const api = spawnCalls.find(c => c.command === 'npm start');
  expect(api.env.PORT).toBe('3000');
});

test('up() does not inject portEnv when port is absent', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  const worker = spawnCalls.find(c => c.command === 'node worker.js');
  expect(worker.env).not.toHaveProperty('PORT');
});

test('up() resolves cwd relative to projectPath', () => {
  const configs = [{ name: 'api', command: 'npm start', cwd: 'packages/api', ports: [] }];
  pm.up('sai', configs, {}, '/projects/sai');
  expect(spawnCalls[0].cwd).toBe('/projects/sai/packages/api');
});

test('up() skips already-running processes', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  expect(spawnCalls).toHaveLength(2); // not 4
});

test('isRunning() returns true after up()', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  expect(pm.isRunning('sai', 'api')).toBe(true);
});

test('isRunning() returns false before up()', () => {
  expect(pm.isRunning('sai', 'api')).toBe(false);
});

test('down() stops all processes for a project', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  pm.down('sai');
  expect(pm.isRunning('sai', 'api')).toBe(false);
  expect(pm.isRunning('sai', 'worker')).toBe(false);
});

test('down() does not affect other projects', () => {
  pm.up('sai',    processConfigs, allocations, '/projects/sai');
  pm.up('cleome', processConfigs, allocations, '/projects/cleome');
  pm.down('sai');
  expect(pm.isRunning('cleome', 'api')).toBe(true);
});

test('getStatuses() shows running after up()', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  const s = pm.getStatuses('sai', processConfigs);
  expect(s.find(p => p.name === 'api').status).toBe('running');
});

test('getStatuses() defaults to stopped for unstarted processes', () => {
  const s = pm.getStatuses('sai', processConfigs);
  expect(s.every(p => p.status === 'stopped')).toBe(true);
});

test('getStatuses() shows stopped after clean exit', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  spawnCalls[0].mock.exit(0);
  const s = pm.getStatuses('sai', processConfigs);
  expect(s.find(p => p.name === 'api').status).toBe('stopped');
});

test('getStatuses() shows crashed after non-zero exit', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  spawnCalls[0].mock.exit(1);
  const s = pm.getStatuses('sai', processConfigs);
  expect(s.find(p => p.name === 'api').status).toBe('crashed');
});

test('subscribe() receives output events', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  const events = [];
  pm.subscribe('sai', 'api', e => events.push(e));
  spawnCalls[0].mock.emit('hello\n');
  expect(events).toHaveLength(1);
  expect(events[0]).toEqual({ type: 'output', data: 'hello\n' });
});

test('subscribe() receives status events on exit', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  const events = [];
  pm.subscribe('sai', 'api', e => events.push(e));
  spawnCalls[0].mock.exit(0);
  expect(events.some(e => e.type === 'status' && e.status === 'stopped')).toBe(true);
});

test('unsubscribe() stops receiving events', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  const events = [];
  const cb = e => events.push(e);
  pm.subscribe('sai', 'api', cb);
  pm.unsubscribe('sai', 'api', cb);
  spawnCalls[0].mock.emit('hello\n');
  expect(events).toHaveLength(0);
});

test('getBuffer() returns buffered output lines', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  spawnCalls[0].mock.emit('line one\nline two\n');
  const buf = pm.getBuffer('sai', 'api');
  expect(buf.join(' ')).toContain('line');
});

test('restart() respawns the process', () => {
  pm.up('sai', processConfigs, allocations, '/projects/sai');
  pm.restart('sai', 'api', processConfigs, allocations, '/projects/sai');
  expect(spawnCalls).toHaveLength(3); // initial 2 + 1 restart
  expect(pm.isRunning('sai', 'api')).toBe(true);
});

test('killAll() stops every process across all projects', () => {
  pm.up('sai',    processConfigs, allocations, '/projects/sai');
  pm.up('cleome', processConfigs, allocations, '/projects/cleome');
  pm.killAll();
  expect(pm.isRunning('sai',    'api')).toBe(false);
  expect(pm.isRunning('cleome', 'api')).toBe(false);
});
