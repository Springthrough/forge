const net = require('net');
const { createPortAllocator } = require('../src/daemon/port-allocator');
const { findFreePort } = require('./helpers/find-free-port');

// Bind a server on a random port and keep it bound for the duration of the test.
// Returns { port, close } — call close() in finally/afterEach.
async function bindPort() {
  const s = net.createServer();
  await new Promise((resolve, reject) => {
    s.listen(0, '127.0.0.1', resolve);
    s.on('error', reject);
  });
  return { port: s.address().port, close: () => new Promise(r => s.close(r)) };
}

test('isAvailable returns true for a free port', async () => {
  const alloc = createPortAllocator();
  const port = await findFreePort();
  expect(await alloc.isAvailable(port)).toBe(true);
});

test('isAvailable returns false for a port that is in use', async () => {
  const alloc = createPortAllocator();
  const { port, close } = await bindPort();
  try {
    expect(await alloc.isAvailable(port)).toBe(false);
  } finally {
    await close();
  }
});

test('reserve returns the first available candidate', async () => {
  const alloc = createPortAllocator();
  const busy1 = await bindPort();
  const busy2 = await bindPort();
  const free = await findFreePort();
  try {
    const port = await alloc.reserve('sai', 'api', [busy1.port, busy2.port, free]);
    expect(port).toBe(free);
  } finally {
    await busy1.close();
    await busy2.close();
  }
});

test('reserve skips already-reserved ports', async () => {
  const alloc = createPortAllocator();
  const p1 = await findFreePort();
  const p2 = await findFreePort();
  await alloc.reserve('sai', 'api', [p1, p2]);
  const second = await alloc.reserve('cleome', 'api', [p1, p2]);
  expect(second).toBe(p2);
});

test('release frees a reserved port for reuse', async () => {
  const alloc = createPortAllocator();
  const port = await findFreePort();
  await alloc.reserve('sai', 'api', [port]);
  alloc.release('sai', 'api');
  const reused = await alloc.reserve('cleome', 'api', [port]);
  expect(reused).toBe(port);
});

test('releaseAll frees all ports for a project', async () => {
  const alloc = createPortAllocator();
  const [p1, p2, p3] = await Promise.all([findFreePort(), findFreePort(), findFreePort()]);
  await alloc.reserve('sai', 'api', [p1]);
  await alloc.reserve('sai', 'web', [p2]);
  await alloc.reserve('other', 'api', [p3]);
  alloc.releaseAll('sai');
  expect(await alloc.reserve('new', 'api', [p1])).toBe(p1);
  expect(await alloc.reserve('new', 'web', [p2])).toBe(p2);
});

test('reserve throws if no candidates are available', async () => {
  const alloc = createPortAllocator();
  // Port 1 is always unavailable (privileged)
  await expect(alloc.reserve('sai', 'api', [1])).rejects.toThrow('No available port');
});

test('getAll returns all current reservations', async () => {
  const alloc = createPortAllocator();
  const port = await findFreePort();
  await alloc.reserve('sai', 'api', [port]);
  expect(alloc.getAll()['sai:api']).toBe(port);
});

test('restoreFromRegistry re-populates reservations', async () => {
  const alloc = createPortAllocator();
  const port = await findFreePort();
  alloc.restoreFromRegistry({ sai: { allocations: { ports: { api: port } } } });
  expect(alloc.getAll()['sai:api']).toBe(port);
  // Restored port is treated as reserved
  const other = await findFreePort();
  const second = await alloc.reserve('cleome', 'api', [port, other]);
  expect(second).toBe(other);
});
