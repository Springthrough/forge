const { execFile } = require('child_process');
const { parseEnvString } = require('../parse-env-file');

function runEnvCommand(argv, cwd, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    if (!Array.isArray(argv) || argv.length === 0) {
      return resolve({ ok: false, error: 'envFileCommand must be a non-empty array' });
    }

    const child = execFile(
      argv[0],
      argv.slice(1),
      { cwd, timeout: timeoutMs, killSignal: 'SIGTERM', maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        clearTimeout(killEscalation);
        if (err) {
          // Spawn-level errors (ENOENT, EACCES) come with syscall='spawn' and
          // a string err.code. Report them as "command not found" rather than
          // the misleading "exit ENOENT".
          if (err.syscall === 'spawn' || err.syscall?.startsWith('spawn ')) {
            return resolve({
              ok: false,
              error: `command not found or not executable: ${argv[0]} (${err.code ?? err.message})`,
            });
          }
          // execFile sets err.signal='SIGTERM' when its own timeout fires.
          if (err.killed || err.signal === 'SIGTERM' || err.signal === 'SIGKILL') {
            return resolve({
              ok: false,
              error: `timeout after ${timeoutMs}ms\nstderr:\n${stderr ?? ''}`.trimEnd(),
            });
          }
          const exitInfo = err.code != null ? `exit ${err.code}` : (err.signal ?? err.message);
          return resolve({
            ok: false,
            error: `${exitInfo}\nstderr:\n${stderr ?? ''}`.trimEnd(),
          });
        }
        const env = parseEnvString(stdout);
        if (!env || Object.keys(env).length === 0) {
          return resolve({ ok: false, error: 'envFileCommand produced no entries' });
        }
        resolve({ ok: true, env });
      }
    );

    // Belt-and-suspenders: if SIGTERM didn't kill the child, escalate to SIGKILL
    // 1s later. execFile's own timeout only sends one signal.
    const killEscalation = setTimeout(() => {
      if (child.exitCode == null && !child.killed) {
        try { child.kill('SIGKILL'); } catch {}
      }
    }, timeoutMs + 1000);
  });
}

module.exports = { runEnvCommand };
