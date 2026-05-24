// src/daemon/process-manager.js
const path = require('path');
const net = require('net');
const { parseEnvFile } = require('../parse-env-file');
const { buildStartOrder } = require('./dependency-resolver');

const MAX_BUFFER = 200;

function defaultPollPort(port, timeoutMs) {
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      if (Date.now() >= deadline) return resolve(false);
      const socket = net.createConnection({ port, host: 'localhost' });
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => {
        socket.destroy();
        const remaining = deadline - Date.now();
        if (remaining <= 0) return resolve(false);
        setTimeout(attempt, Math.min(250, remaining));
      });
    }
    attempt();
  });
}

function defaultWaitForExit(ptyProc, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(false); }
    }, timeoutMs);
    ptyProc.onExit(({ exitCode }) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(exitCode === 0);
      }
    });
  });
}

function createProcessManager({ ptySpawn, pollPort, waitForExit } = {}) {
  const spawnFn = ptySpawn ?? function(command, env, cwd) {
    const pty = require('node-pty'); // lazy — not loaded in tests that inject ptySpawn
    const shell = process.env.SHELL || '/bin/zsh';
    return pty.spawn(shell, ['-c', command], {
      name: 'xterm-256color', cols: 120, rows: 30,
      cwd, env: { ...process.env, TERM: 'xterm-256color', ...env },
    });
  };
  const pollPortFn    = pollPort    ?? defaultPollPort;
  const waitForExitFn = waitForExit ?? defaultWaitForExit;

  // "project:process" → { status, startedAt, buffer, pid, ptyProcess }
  const processes = new Map();
  // "project:process" → Set<(event) => void>
  const listeners = new Map();

  const key = (proj, proc) => `${proj}:${proc}`;

  function emit(k, event) {
    for (const cb of (listeners.get(k) ?? [])) { try { cb(event); } catch {} }
  }

  function appendToBuffer(buffer, data) {
    const lines = data.split(/\r?\n/);
    if (buffer.length > 0 && lines.length > 0) buffer[buffer.length - 1] += lines.shift();
    buffer.push(...lines);
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  }

  async function startOne(projectName, proc, allocations, projectPath, servicesConfig) {
    const k = key(projectName, proc.name);
    if (processes.get(k)?.status === 'running') return;

    const env = {};
    for (const [svcName, url] of Object.entries(allocations?.services ?? {})) {
      const envVar = (servicesConfig ?? {})[svcName]?.env;
      if (envVar) env[envVar] = url;
    }
    Object.assign(env, proc.env ?? {});
    const port = allocations?.ports?.[proc.name];
    if (port !== undefined && proc.portEnv) env[proc.portEnv] = String(port);

    if (proc.envFile) {
      const overrides = parseEnvFile(path.resolve(projectPath, proc.envFile));
      if (overrides) Object.assign(env, overrides);
    }

    const cwd = path.resolve(projectPath, proc.cwd ?? '.');
    const record = { status: 'running', startedAt: Date.now(), buffer: [], pid: null, ptyProcess: null };
    processes.set(k, record);

    let ptyProc;
    try {
      ptyProc = spawnFn(proc.command, env, cwd);
    } catch (err) {
      record.status = 'crashed';
      record.startedAt = null;
      emit(k, { type: 'status', status: 'crashed' });
      emit(k, { type: 'output', data: `\r\n\x1b[31mFailed to start: ${err.message}\x1b[0m\r\n` });
      return;
    }

    record.pid = ptyProc.pid;
    record.ptyProcess = ptyProc;
    emit(k, { type: 'status', status: 'running' });

    ptyProc.onData((data) => {
      appendToBuffer(record.buffer, data);
      emit(k, { type: 'output', data });
    });

    ptyProc.onExit(({ exitCode }) => {
      const current = processes.get(k);
      if (!current || current.ptyProcess !== ptyProc) return;
      const status = exitCode === 0 ? 'stopped' : 'crashed';
      current.status = status;
      current.startedAt = null;
      current.ptyProcess = null;
      emit(k, { type: 'status', status });
    });

    if (proc.waitFor?.port) {
      const timeoutMs = (proc.waitFor.timeoutSeconds ?? 30) * 1000;
      if (port == null) {
        const msg = `[forge] Warning: "${proc.name}" has waitFor.port but no allocated port — treating as ready\r\n`;
        appendToBuffer(record.buffer, msg);
        emit(k, { type: 'output', data: msg });
      } else {
        const ready = await pollPortFn(port, timeoutMs);
        if (!ready) {
          const msg = `[forge] Warning: "${proc.name}" did not become ready within ${proc.waitFor.timeoutSeconds ?? 30}s — starting dependents anyway\r\n`;
          appendToBuffer(record.buffer, msg);
          emit(k, { type: 'output', data: msg });
        }
      }
    } else if (proc.waitFor?.exit) {
      const timeoutMs = (proc.waitFor.timeoutSeconds ?? 30) * 1000;
      const ready = await waitForExitFn(ptyProc, timeoutMs);
      if (!ready) {
        const msg = `[forge] Warning: "${proc.name}" did not complete successfully within ${proc.waitFor.timeoutSeconds ?? 30}s — starting dependents anyway\r\n`;
        appendToBuffer(record.buffer, msg);
        emit(k, { type: 'output', data: msg });
      }
    }
  }

  function killOne(projectName, processName) {
    const k = key(projectName, processName);
    const record = processes.get(k);
    if (record?.ptyProcess) { try { record.ptyProcess.kill(); } catch {} }
    emit(k, { type: 'status', status: 'stopped' });
    processes.delete(k);
  }

  return {
    async up(projectName, processConfigs, allocations, projectPath, servicesConfig) {
      const waves = buildStartOrder(processConfigs ?? []);
      for (const wave of waves) {
        await Promise.all(wave.map(proc =>
          startOne(projectName, proc, allocations ?? {}, projectPath, servicesConfig ?? {})
        ));
      }
    },

    down(projectName) {
      for (const k of [...processes.keys()]) {
        if (k.startsWith(`${projectName}:`)) {
          killOne(projectName, k.slice(projectName.length + 1));
        }
      }
    },

    async startProcess(projectName, processName, processConfigs, allocations, projectPath, servicesConfig) {
      const all = processConfigs ?? [];
      const proc = all.find(p => p.name === processName);
      if (!proc) return;

      const byName = new Map(all.map(p => [p.name, p]));
      const ancestors = new Set();
      function collectAncestors(name) {
        for (const dep of byName.get(name)?.dependsOn ?? []) {
          if (!ancestors.has(dep)) {
            ancestors.add(dep);
            collectAncestors(dep);
          }
        }
      }
      collectAncestors(processName);

      if (ancestors.size > 0) {
        const ancestorConfigs = all.filter(p => ancestors.has(p.name));
        const depWaves = buildStartOrder(ancestorConfigs);
        for (const wave of depWaves) {
          await Promise.all(wave.map(p =>
            startOne(projectName, p, allocations ?? {}, projectPath, servicesConfig ?? {})
          ));
        }
      }

      await startOne(projectName, proc, allocations ?? {}, projectPath, servicesConfig ?? {});
    },

    stopProcess(projectName, processName) {
      killOne(projectName, processName);
    },

    async restart(projectName, processName, processConfigs, allocations, projectPath, servicesConfig) {
      killOne(projectName, processName);
      const proc = (processConfigs ?? []).find(p => p.name === processName);
      if (proc) await startOne(projectName, proc, allocations ?? {}, projectPath, servicesConfig ?? {});
    },

    getStatuses(projectName, processConfigs) {
      return (processConfigs ?? []).map(proc => {
        const record = processes.get(key(projectName, proc.name));
        return {
          name: proc.name,
          status: record?.status ?? 'stopped',
          pid: record?.pid ?? null,
          uptime: record?.startedAt ? Math.floor((Date.now() - record.startedAt) / 1000) : 0,
        };
      });
    },

    isRunning(projectName, processName) {
      return processes.get(key(projectName, processName))?.status === 'running';
    },

    getBuffer(projectName, processName, lines = 50) {
      return (processes.get(key(projectName, processName))?.buffer ?? []).slice(-lines);
    },

    subscribe(projectName, processName, callback) {
      const k = key(projectName, processName);
      if (!listeners.has(k)) listeners.set(k, new Set());
      listeners.get(k).add(callback);
    },

    unsubscribe(projectName, processName, callback) {
      listeners.get(key(projectName, processName))?.delete(callback);
    },

    sendInput(projectName, processName, data) {
      processes.get(key(projectName, processName))?.ptyProcess?.write(data);
    },

    resize(projectName, processName, cols, rows) {
      processes.get(key(projectName, processName))?.ptyProcess?.resize(cols, rows);
    },

    killAll() {
      for (const [, record] of processes) {
        if (record?.ptyProcess) { try { record.ptyProcess.kill(); } catch {} }
      }
      processes.clear();
    },
  };
}

module.exports = { createProcessManager };
