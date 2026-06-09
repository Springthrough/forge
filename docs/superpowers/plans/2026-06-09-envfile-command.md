# `envFileCommand` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a process declare `envFileCommand: string[]` whose stdout is parsed as dotenv and merged into the spawned process's env, with command failure blocking the spawn and surfacing the error in the dashboard card.

**Architecture:** Three small layers added on the daemon side. (1) The existing `parseEnvFile` is refactored so its string-parsing logic is reusable. (2) A new helper `runEnvCommand` spawns the user's command via `child_process.execFile`, captures stdout, parses it, and returns either `{ ok: true, env }` or `{ ok: false, error }` — with a hard 30 s timeout and kill-escalation. (3) `startOne` in `process-manager.js` invokes the helper as the last merge step before spawning the target process; on failure it writes a structured error to the process's output buffer and marks the process `crashed` without spawning.

**Tech Stack:** Node.js (CommonJS), Jest. No new dependencies — uses Node's built-in `child_process` and the existing `parseEnvFile`.

**Spec:** `docs/superpowers/specs/2026-06-09-envfile-command-design.md`

---

## File Structure

- **Modify** `src/parse-env-file.js` — split into `parseEnvString(content)` + a thin `parseEnvFile(path)` wrapper. No behavior change for existing callers.
- **Modify** `test/parse-env-file.test.js` — add tests for the new `parseEnvString` export.
- **Create** `src/daemon/decrypt-env.js` — exports `runEnvCommand(argv, cwd, timeoutMs = 30_000) → Promise<{ ok, env? | error? }>`.
- **Create** `test/decrypt-env.test.js` — unit tests using synthetic `node -e ...` commands so the suite has no external dependencies.
- **Modify** `src/daemon/process-manager.js` — `createProcessManager` accepts an optional `envCommandRunner` for DI; `startOne` calls it after `envFile` merge, before `spawnFn`.
- **Modify** `test/process-manager.test.js` — integration tests using a stub runner.

No CLI changes. No registry-schema changes.

---

## Pre-flight

- [ ] **Step 0: Baseline test suite**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npm test 2>&1 | tail -6
```

Expected: all tests pass (currently 294). Note the exact count so subsequent tasks can confirm only the deltas they add.

---

## Task 1: Refactor `parse-env-file.js` to expose `parseEnvString`

Splits the parse logic from the file read so `runEnvCommand` (Task 2) can parse stdout without writing it to disk.

**Files:**
- Modify: `src/parse-env-file.js`
- Modify: `test/parse-env-file.test.js`

- [ ] **Step 1: Add failing tests for the new `parseEnvString` export**

Open `/Users/mikewilliams/Source/brutalsystems/forge/test/parse-env-file.test.js`. Append (do not replace existing tests):

```js
const { parseEnvString } = require('../src/parse-env-file');

test('parseEnvString returns {} for empty input', () => {
  expect(parseEnvString('')).toEqual({});
});

test('parseEnvString parses KEY=value lines', () => {
  expect(parseEnvString('FOO=bar\nBAZ=qux\n')).toEqual({ FOO: 'bar', BAZ: 'qux' });
});

test('parseEnvString skips blank lines and # comments', () => {
  const src = '# a comment\n\nKEY=value\n# another\nOTHER=thing\n';
  expect(parseEnvString(src)).toEqual({ KEY: 'value', OTHER: 'thing' });
});

test('parseEnvString strips matching single or double quotes', () => {
  const src = 'A="double"\nB=\'single\'\nC=plain\n';
  expect(parseEnvString(src)).toEqual({ A: 'double', B: 'single', C: 'plain' });
});

test('parseEnvString preserves "=" in values', () => {
  expect(parseEnvString('URL=https://example.com/?a=1&b=2\n')).toEqual({ URL: 'https://example.com/?a=1&b=2' });
});
```

- [ ] **Step 2: Run the new tests, verify they fail**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/parse-env-file.test.js
```

Expected: the 5 new tests fail because `parseEnvString` is not exported. Existing tests in this file pass.

- [ ] **Step 3: Refactor `src/parse-env-file.js`**

Open `/Users/mikewilliams/Source/brutalsystems/forge/src/parse-env-file.js` and replace its entire contents with:

```js
const fs = require('fs');

function parseEnvString(content) {
  const result = {};
  if (!content) return result;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    let v = trimmed.slice(eqIdx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    result[k] = v;
  }
  return result;
}

function parseEnvFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return parseEnvString(content);
}

module.exports = { parseEnvFile, parseEnvString };
```

- [ ] **Step 4: Run all parse-env-file tests, verify they pass**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/parse-env-file.test.js
```

Expected: all tests (existing + 5 new) pass.

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npm test 2>&1 | tail -6
```

Expected: total = baseline + 5 (so 299 if baseline was 294). All pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && git add src/parse-env-file.js test/parse-env-file.test.js && git commit -m "refactor: expose parseEnvString from parse-env-file"
```

Do NOT `git add -A` / `git add .` — unrelated dirty files (`README.md`, `src/daemon/services/drivers/mongo.js`, `docs/superpowers/plans/2026-06-03-linux-support.md`) must NOT be staged. Do NOT amend or push.

---

## Task 2: `runEnvCommand` helper

Spawns the user's argv via `child_process.execFile`, captures stdout, parses with `parseEnvString`, returns a discriminated union. Hard 30 s timeout; kill-escalation to SIGKILL 1 s after SIGTERM.

**Files:**
- Create: `src/daemon/decrypt-env.js`
- Create: `test/decrypt-env.test.js`

- [ ] **Step 1: Write failing tests**

Create `/Users/mikewilliams/Source/brutalsystems/forge/test/decrypt-env.test.js`:

```js
const path = require('path');
const { runEnvCommand } = require('../src/daemon/decrypt-env');

const NODE = process.execPath;

test('returns ok: false with explanatory error when argv is empty', async () => {
  const result = await runEnvCommand([], process.cwd(), 1000);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/non-empty array/);
});

test('parses KEY=value lines from stdout on success', async () => {
  const script = "process.stdout.write('FOO=bar\\nBAZ=qux\\n')";
  const result = await runEnvCommand([NODE, '-e', script], process.cwd(), 5000);
  expect(result.ok).toBe(true);
  expect(result.env).toEqual({ FOO: 'bar', BAZ: 'qux' });
});

test('handles comments and quoted values', async () => {
  const script = "process.stdout.write('# comment\\nA=\"quoted\"\\nB=plain\\n')";
  const result = await runEnvCommand([NODE, '-e', script], process.cwd(), 5000);
  expect(result.ok).toBe(true);
  expect(result.env).toEqual({ A: 'quoted', B: 'plain' });
});

test('reports non-zero exit with captured stderr', async () => {
  const script = "process.stderr.write('boom\\n'); process.exit(7)";
  const result = await runEnvCommand([NODE, '-e', script], process.cwd(), 5000);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/exit 7/);
  expect(result.error).toMatch(/boom/);
});

test('reports timeout when the command exceeds the budget', async () => {
  const script = "setInterval(() => {}, 60000)";
  const result = await runEnvCommand([NODE, '-e', script], process.cwd(), 200);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/timeout/);
});

test('reports failure when stdout has no parseable entries', async () => {
  const script = "";
  const result = await runEnvCommand([NODE, '-e', script], process.cwd(), 5000);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/no entries/);
});

test('inherits parent process.env (so PATH / agents are visible to the child)', async () => {
  // The script reads its own env and emits one of the keys it inherited.
  const script = "process.stdout.write('HOME_PRESENT=' + (process.env.HOME ? 'yes' : 'no') + '\\n')";
  const result = await runEnvCommand([NODE, '-e', script], process.cwd(), 5000);
  expect(result.ok).toBe(true);
  expect(result.env.HOME_PRESENT).toBe('yes');
});
```

- [ ] **Step 2: Run the new tests, verify they fail**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/decrypt-env.test.js
```

Expected: fail with "Cannot find module '../src/daemon/decrypt-env'".

- [ ] **Step 3: Create the helper**

Create `/Users/mikewilliams/Source/brutalsystems/forge/src/daemon/decrypt-env.js`:

```js
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
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/decrypt-env.test.js
```

Expected: 7/7 pass.

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npm test 2>&1 | tail -6
```

Expected: total = previous + 7.

- [ ] **Step 6: Commit**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && git add src/daemon/decrypt-env.js test/decrypt-env.test.js && git commit -m "feat(daemon): add runEnvCommand helper for envFileCommand"
```

Do NOT `git add -A` / `git add .`. Do NOT amend or push.

---

## Task 3: Wire `envFileCommand` into `startOne`

`createProcessManager` accepts an optional `envCommandRunner` injection (defaults to the real `runEnvCommand`). `startOne` calls it after the existing `envFile` merge, before spawning the target. On failure: write a structured error to the buffer, mark the process `crashed`, do NOT call `spawnFn`. On success: merge the returned env (last-wins).

**Files:**
- Modify: `src/daemon/process-manager.js`
- Modify: `test/process-manager.test.js`

- [ ] **Step 1: Write failing integration tests in `test/process-manager.test.js`**

Open `/Users/mikewilliams/Source/brutalsystems/forge/test/process-manager.test.js`. Append the following at the end:

```js
test('startProcess merges envFileCommand output on top of inline env and envFile', async () => {
  const localPm = createProcessManager({
    ptySpawn: (command, env, cwd) => {
      const mock = makeMockPty();
      spawnCalls.push({ command, env, cwd, mock });
      return mock;
    },
    envCommandRunner: async (argv) => {
      expect(argv).toEqual(['decrypt-tool', 'secrets.enc']);
      return { ok: true, env: { SECRET_KEY: 'decrypted-value', LOG_LEVEL: 'debug' } };
    },
  });
  const configs = [{
    name: 'api',
    command: 'npm start',
    cwd: '.',
    ports: [3000],
    portEnv: 'PORT',
    env: { LOG_LEVEL: 'info', PUBLIC_VAR: 'visible' },
    envFileCommand: ['decrypt-tool', 'secrets.enc'],
  }];
  await localPm.up('sai', configs, allocations, '/projects/sai');

  expect(spawnCalls).toHaveLength(1);
  const apiEnv = spawnCalls[0].env;
  expect(apiEnv.SECRET_KEY).toBe('decrypted-value');     // from envFileCommand
  expect(apiEnv.LOG_LEVEL).toBe('debug');                // envFileCommand overrides inline env
  expect(apiEnv.PUBLIC_VAR).toBe('visible');             // inline still passes through
  expect(apiEnv.PORT).toBe('3000');                      // portEnv still injected
});

test('envFileCommand failure prevents spawn and records error in buffer', async () => {
  const failPm = createProcessManager({
    ptySpawn: (command, env, cwd) => {
      const mock = makeMockPty();
      spawnCalls.push({ command, env, cwd, mock });
      return mock;
    },
    envCommandRunner: async () => ({ ok: false, error: 'exit 1\nstderr:\nbad metadata' }),
  });
  const configs = [{
    name: 'api',
    command: 'npm start',
    cwd: '.',
    ports: [3000],
    portEnv: 'PORT',
    envFileCommand: ['decrypt-tool', 'secrets.enc'],
  }];
  await failPm.up('sai', configs, allocations, '/projects/sai');

  // The process must NOT have been spawned.
  expect(spawnCalls).toHaveLength(0);
  // Status should be crashed.
  expect(failPm.isRunning('sai', 'api')).toBe(false);
  // The buffer should contain the structured error so the dashboard can show it.
  const buf = failPm.getBuffer('sai', 'api').join('');
  expect(buf).toMatch(/envFileCommand failed for "api"/);
  expect(buf).toMatch(/exit 1/);
  expect(buf).toMatch(/bad metadata/);
  // Multi-line errors must use \r\n so xterm renders each line at column 0.
  expect(buf).toMatch(/exit 1\r\nstderr/);
});

test('non-array envFileCommand fails through helper validation (not silently skipped)', async () => {
  // Regression guard: a string-typed envFileCommand (user config error) MUST
  // surface as a clear failure, not silently spawn without secrets.
  const stringPm = createProcessManager({
    ptySpawn: (command, env, cwd) => {
      const mock = makeMockPty();
      spawnCalls.push({ command, env, cwd, mock });
      return mock;
    },
    envCommandRunner: async (argv) => {
      // Real helper would return this; stub it here so the test doesn't depend on it.
      if (!Array.isArray(argv) || argv.length === 0) {
        return { ok: false, error: 'envFileCommand must be a non-empty array' };
      }
      return { ok: true, env: {} };
    },
  });
  const configs = [{
    name: 'api',
    command: 'npm start',
    cwd: '.',
    ports: [3000],
    portEnv: 'PORT',
    envFileCommand: 'sops -d secrets.enc',   // wrong: string instead of array
  }];
  await stringPm.up('sai', configs, allocations, '/projects/sai');

  expect(spawnCalls).toHaveLength(0);
  expect(stringPm.isRunning('sai', 'api')).toBe(false);
  const buf = stringPm.getBuffer('sai', 'api').join('');
  expect(buf).toMatch(/envFileCommand must be a non-empty array/);
});

test('startOne behaves unchanged when envFileCommand is absent', async () => {
  // Sanity: existing path is undisturbed. Uses the default real envCommandRunner,
  // which is never called because no process declares envFileCommand.
  await pm.up('sai', processConfigs, allocations, '/projects/sai');
  expect(spawnCalls).toHaveLength(2);
});
```

- [ ] **Step 2: Run the new tests, verify they fail**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/process-manager.test.js
```

Expected: three of the four new tests fail — `merges envFileCommand output`, `failure prevents spawn`, and `non-array envFileCommand fails through helper validation`. The `behaves unchanged when absent` sanity test passes. Existing tests still pass.

- [ ] **Step 3: Wire `envCommandRunner` into `createProcessManager` and `startOne`**

Open `/Users/mikewilliams/Source/brutalsystems/forge/src/daemon/process-manager.js`. Near the top, where `parseEnvFile` is imported:

```js
const { parseEnvFile } = require('../parse-env-file');
```

Add the helper import below it:

```js
const { parseEnvFile } = require('../parse-env-file');
const { runEnvCommand } = require('./decrypt-env');
```

Find the `createProcessManager` function signature and its options-destructure (it currently destructures `ptySpawn`, `pollHttpFn`, `waitForExitFn`). Add `envCommandRunner` with a default:

```js
function createProcessManager({
  ptySpawn,
  pollHttpFn,
  waitForExitFn,
  envCommandRunner = runEnvCommand,
} = {}) {
```

(If the existing signature differs in formatting, preserve its layout and add the new line in the same style. The substantive change is adding the `envCommandRunner` parameter with `runEnvCommand` as default.)

Now find `startOne` and locate the existing `envFile` merge block:

```js
    if (proc.envFile) {
      const overrides = parseEnvFile(path.resolve(projectPath, proc.envFile));
      if (overrides) Object.assign(env, overrides);
    }
```

Immediately after that block, add the `envFileCommand` step. Also: the record-creation line that currently sits between the env merge and `spawnFn` needs to move — we want to create the record BEFORE running the command so we have a buffer to write errors into if the command fails. The current code creates `record` right before `spawnFn`. Refactor so the record is created earlier (right after `envFile` merge, BEFORE the envFileCommand call), and the failure path writes to `record.buffer`.

Replace this entire block (from the `envFile` merge through the `spawnFn` call, ending before `record.pid = ptyProc.pid`):

```js
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
      const msg = `\r\n\x1b[31mFailed to start: ${err.message}\x1b[0m\r\n`;
      appendToBuffer(record.buffer, msg);
      emit(k, { type: 'status', status: 'crashed' });
      emit(k, { type: 'output', data: msg });
      return;
    }
```

with:

```js
    if (proc.envFile) {
      const overrides = parseEnvFile(path.resolve(projectPath, proc.envFile));
      if (overrides) Object.assign(env, overrides);
    }

    const cwd = path.resolve(projectPath, proc.cwd ?? '.');
    const record = { status: 'running', startedAt: Date.now(), buffer: [], pid: null, ptyProcess: null };
    processes.set(k, record);

    if (proc.envFileCommand) {
      const result = await envCommandRunner(proc.envFileCommand, projectPath);
      if (!result.ok) {
        record.status = 'crashed';
        record.startedAt = null;
        // Normalize any embedded newlines to \r\n before writing to the
        // xterm buffer — xterm treats \n as a line-feed only (no column reset),
        // which would render multi-line errors with a jagged left margin.
        const errorText = String(result.error).replace(/\n/g, '\r\n');
        const msg = `\r\n\x1b[31m[forge] envFileCommand failed for "${proc.name}": ${errorText}\x1b[0m\r\n`;
        appendToBuffer(record.buffer, msg);
        emit(k, { type: 'status', status: 'crashed' });
        emit(k, { type: 'output', data: msg });
        return;
      }
      Object.assign(env, result.env);
    }

    let ptyProc;
    try {
      ptyProc = spawnFn(proc.command, env, cwd);
    } catch (err) {
      record.status = 'crashed';
      record.startedAt = null;
      const errText = String(err.message ?? err).replace(/\n/g, '\r\n');
      const msg = `\r\n\x1b[31mFailed to start: ${errText}\x1b[0m\r\n`;
      appendToBuffer(record.buffer, msg);
      emit(k, { type: 'status', status: 'crashed' });
      emit(k, { type: 'output', data: msg });
      return;
    }
```

Key points:
- The record is created BEFORE the `envFileCommand` call so the failure path can write to `record.buffer`.
- `await envCommandRunner(proc.envFileCommand, projectPath)` — `projectPath` is the working directory (spec says encrypted file paths are typically repo-relative).
- The guard is `if (proc.envFileCommand)` (truthy), not `Array.isArray && length > 0`. That way a misconfigured non-array value (e.g. the user wrote `"envFileCommand": "sops -d secrets.enc"` as a string) flows through to the helper, which already rejects it with `'envFileCommand must be a non-empty array'`, and the user sees a clear structured error in the dashboard card. Silently spawning without decryption (the old guard's failure mode) is the worst possible outcome — the user thinks their secrets are loaded but they're not.
- Both failure paths (`envFileCommand` and `spawnFn`) normalize `\n` → `\r\n` before writing to the buffer so multi-line errors render cleanly in xterm.
- On success: merge into env with last-wins (`Object.assign(env, result.env)`).
- The default timeout (30 s) is whatever `runEnvCommand`'s default is — we don't override here.

- [ ] **Step 4: Run the tests, verify they pass**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npx jest test/process-manager.test.js
```

Expected: all tests pass (existing + 3 new).

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npm test 2>&1 | tail -6
```

Expected: total = previous + 3.

- [ ] **Step 6: Commit**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && git add src/daemon/process-manager.js test/process-manager.test.js && git commit -m "feat(daemon): wire envFileCommand into startOne with failure handling"
```

Do NOT `git add -A` / `git add .`. Do NOT amend or push.

---

## Final verification

- [ ] **Step 1: Full test suite**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && npm test 2>&1 | tail -8
```

Expected: all tests pass. Total = baseline + 16 (5 from Task 1 + 7 from Task 2 + 4 from Task 3).

- [ ] **Step 2: Manual smoke test (user)**

After the user reloads the daemon (`launchctl kickstart -k gui/$(id -u)/com.forge.daemon`):

- In a real project's `.forge/config.json`, add to any process:
  ```jsonc
  "envFileCommand": ["sh", "-c", "echo FORGE_DECRYPT_TEST=hello"]
  ```
  (No real sops needed for the smoke test — `sh -c "echo ..."` works.)
- `forge restart <name>`. The process spawns; inside its terminal in the dashboard, the env now includes `FORGE_DECRYPT_TEST=hello`.
- Change the command to `["sh", "-c", "exit 1"]`. `forge restart`. The process card shows the structured error: `[forge] envFileCommand failed for "<name>": exit 1` in red.
- Change to `["sh", "-c", "sleep 60"]`. `forge restart`. After ~30 s the card shows the timeout error.

- [ ] **Step 3: Final status check**

```bash
git status
```

Should show only the unrelated pre-existing dirty files (`README.md`, `mongo.js`, `2026-06-03-linux-support.md`). Nothing else uncommitted.
