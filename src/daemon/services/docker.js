const Docker = require('dockerode');
const net = require('net');

const docker = new Docker();

async function ensureContainerRunning({ image, name, port, cmd, env = [] }) {
  const containers = await docker.listContainers({ all: true });
  const existing = containers.find(c => c.Names.includes(`/${name}`));

  if (existing) {
    if (existing.State === 'running') return;
    await docker.getContainer(existing.Id).start();
    return;
  }

  // Pull image if not present locally
  await new Promise((resolve, reject) => {
    docker.pull(image, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, err => err ? reject(err) : resolve());
    });
  });

  const container = await docker.createContainer({
    Image: image,
    name,
    Cmd: cmd,
    ExposedPorts: { [`${port}/tcp`]: {} },
    HostConfig: {
      PortBindings: { [`${port}/tcp`]: [{ HostPort: String(port) }] },
      RestartPolicy: { Name: 'unless-stopped' },
    },
    Env: env,
  });
  await container.start();
}

// TCP probe — returns true if the service is accepting connections
function checkTcpHealth(host, port) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(2000);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => { s.destroy(); resolve(false); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.connect(port, host);
  });
}

async function stopContainer(name) {
  const containers = await docker.listContainers({ all: true });
  const existing = containers.find(c => c.Names.includes(`/${name}`));
  if (!existing || existing.State !== 'running') return;
  await docker.getContainer(existing.Id).stop();
}

// Exec a command inside a running container. Exit code is not checked — callers
// that need idempotent provisioning (e.g. "create if not exists") can ignore failures.
async function execInContainer(containerName, cmd) {
  const containers = await docker.listContainers();
  const existing = containers.find(c => c.Names.includes(`/${containerName}`));
  if (!existing) throw new Error(`Container "${containerName}" is not running`);
  const container = docker.getContainer(existing.Id);
  const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  await new Promise((resolve, reject) => {
    exec.start({}, (err, stream) => {
      if (err) return reject(err);
      stream.resume();
      stream.on('end', resolve);
      stream.on('error', reject);
    });
  });
}

module.exports = { ensureContainerRunning, stopContainer, checkTcpHealth, execInContainer };
