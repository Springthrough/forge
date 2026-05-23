const os = require('os');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createServer } = require('../../src/daemon/server');
const { createRegistry } = require('../../src/daemon/registry');
const { createPortAllocator } = require('../../src/daemon/port-allocator');
const { createServiceManager } = require('../../src/daemon/services/manager');
const { createProcessManager } = require('../../src/daemon/process-manager');
const { findFreePort } = require('../helpers/find-free-port');

const noopServiceManager = createServiceManager([]);

function makeTempRegistry() {
  const registryPath = path.join(os.tmpdir(), `forge-ws-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const registry = createRegistry(registryPath);
  return { registry, cleanup: () => { try { fs.unlinkSync(registryPath); } catch {} } };
}

function makeMockPtySpawn() {
  let exitCb = null;
  const pty = {
    pid: 12345,
    onData() {},
    onExit(cb) { exitCb = cb; },
    write: jest.fn(),
    resize: jest.fn(),
    kill: jest.fn(() => exitCb?.({ exitCode: 0 })),
  };
  return { pty, spawn: jest.fn(() => pty) };
}

// Collect all messages from a WebSocket into a queue from the moment of creation.
// Returns { nextMessage, ws } where nextMessage() returns a Promise for the next message.
function makeWsCollector(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (waiters.length > 0) waiters.shift().resolve(msg);
    else queue.push(msg);
  });
  ws.on('error', (err) => {
    for (const w of waiters) w.reject(err);
    waiters.length = 0;
  });
  function nextMessage() {
    if (queue.length > 0) return Promise.resolve(queue.shift());
    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  }
  return { ws, nextMessage };
}

async function closeServer(server, wss) {
  // Terminate all open WebSocket clients so the HTTP server can drain.
  if (wss) {
    for (const client of wss.clients) client.terminate();
    await new Promise(resolve => wss.close(resolve));
  }
  await new Promise(resolve => server.close(resolve));
}

describe('WebSocket terminal streaming', () => {
  let httpServer, httpWss, port, registry, registryCleanup;

  beforeEach(async () => {
    port = await findFreePort();
    const tmp = makeTempRegistry();
    registry = tmp.registry;
    registryCleanup = tmp.cleanup;
    registry.add('sai', {
      path: '/projects/sai',
      config: {
        name: 'sai',
        processes: [{ name: 'api', command: 'echo hi', cwd: '.', ports: [] }],
        services: {},
      },
      allocations: { ports: {}, services: {} },
    });

    const { spawn } = makeMockPtySpawn();
    const processManager = createProcessManager({ ptySpawn: spawn });
    const { server, wss } = createServer({
      registry,
      portAllocator: createPortAllocator(),
      serviceManager: noopServiceManager,
      processManager,
    });
    httpServer = server;
    httpWss = wss;
    await new Promise(resolve => httpServer.listen(port, resolve));
  });

  afterEach(async () => {
    await closeServer(httpServer, httpWss);
    registryCleanup();
  });

  test('connects and receives initial status message', async () => {
    const { ws, nextMessage } = makeWsCollector(`ws://localhost:${port}?project=sai&process=api`);
    await new Promise(resolve => ws.once('open', resolve));
    const msg = await nextMessage();
    expect(msg.type).toBe('status');
    expect(['running', 'stopped', 'crashed']).toContain(msg.status);
    ws.close();
  });

  test('receives error message for unknown project', async () => {
    const { ws, nextMessage } = makeWsCollector(`ws://localhost:${port}?project=nope&process=api`);
    await new Promise(resolve => ws.once('open', resolve));
    const msg = await nextMessage();
    expect(msg.type).toBe('error');
    ws.close();
  });

  test('receives error message when project and process params missing', async () => {
    const { ws, nextMessage } = makeWsCollector(`ws://localhost:${port}`);
    await new Promise(resolve => ws.once('open', resolve));
    const msg = await nextMessage();
    expect(msg.type).toBe('error');
    ws.close();
  });

  test('relays status event when process is started via start message', async () => {
    const { spawn } = makeMockPtySpawn();
    const pm2 = createProcessManager({ ptySpawn: spawn });
    const { server: srv2, wss: wss2 } = createServer({
      registry,
      portAllocator: createPortAllocator(),
      serviceManager: noopServiceManager,
      processManager: pm2,
    });
    await new Promise(resolve => srv2.listen(0, resolve));
    const p2 = srv2.address().port;

    // Use collector to capture messages from the moment the WS is created —
    // the server may send the initial status before the client 'open' fires.
    const { ws, nextMessage } = makeWsCollector(`ws://localhost:${p2}?project=sai&process=api`);
    await new Promise(resolve => ws.once('open', resolve));

    // Drain initial status
    const initialStatus = await nextMessage();
    expect(initialStatus.type).toBe('status');

    // Send start message — this triggers startProcess which emits { type: 'status', status: 'running' }
    ws.send(JSON.stringify({ type: 'start' }));

    const runningStatus = await nextMessage();
    expect(runningStatus.type).toBe('status');
    expect(runningStatus.status).toBe('running');

    await closeServer(srv2, wss2);
  });
});
