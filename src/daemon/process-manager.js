// src/daemon/process-manager.js
const path = require('path');

const MAX_BUFFER = 200;

function createProcessManager({ ptySpawn } = {}) {
  const spawnFn = ptySpawn ?? function(command, env, cwd) {
    const pty = require('node-pty'); // lazy — not loaded in tests that inject ptySpawn
    const shell = process.env.SHELL || '/bin/zsh';
    return pty.spawn(shell, ['-c', command], {
      name: 'xterm-256color', cols: 120, rows: 30,
      cwd, env: { ...process.env, TERM: 'xterm-256color', ...env },
    });
  };

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

  function startOne(projectName, proc, allocations, projectPath) {
    const k = key(projectName, proc.name);
    if (processes.get(k)?.status === 'running') return;

    const env = {};
    const port = allocations?.ports?.[proc.name];
    if (port !== undefined && proc.portEnv) env[proc.portEnv] = String(port);

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
  }

  function killOne(projectName, processName) {
    const k = key(projectName, processName);
    const record = processes.get(k);
    if (record?.ptyProcess) { try { record.ptyProcess.kill(); } catch {} }
    processes.delete(k);
  }

  return {
    up(projectName, processConfigs, allocations, projectPath) {
      for (const proc of processConfigs ?? []) {
        startOne(projectName, proc, allocations ?? {}, projectPath);
      }
    },

    down(projectName) {
      for (const k of [...processes.keys()]) {
        if (k.startsWith(`${projectName}:`)) {
          killOne(projectName, k.slice(projectName.length + 1));
        }
      }
    },

    startProcess(projectName, processName, processConfigs, allocations, projectPath) {
      const proc = (processConfigs ?? []).find(p => p.name === processName);
      if (proc) startOne(projectName, proc, allocations ?? {}, projectPath);
    },

    stopProcess(projectName, processName) {
      killOne(projectName, processName);
    },

    restart(projectName, processName, processConfigs, allocations, projectPath) {
      killOne(projectName, processName);
      const proc = (processConfigs ?? []).find(p => p.name === processName);
      if (proc) startOne(projectName, proc, allocations ?? {}, projectPath);
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
