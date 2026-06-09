# Per-process `envFileCommand` for secret decryption

## Problem

Forge processes today get their environment from three layered sources:
1. Shared service env vars (injected by service drivers)
2. Inline `env: { KEY: "value" }` block in `config.json`
3. Plaintext `envFile: "path"` (dotenv file on disk)

There is no clean way to keep secrets encrypted at rest in the repo. Users either commit plaintext (bad), keep `.env` files outside the repo (fragile), or write wrapper scripts that decrypt before invoking forge (defeats the dashboard).

## Goal

Add a fourth, generic mechanism — `envFileCommand` — that lets a process declare an external command whose stdout supplies environment values. Forge runs the command at spawn, parses stdout as dotenv, and merges the result into the spawned process's env. Works for sops, age, `op inject`, `aws-vault exec`, `pass`, custom scripts — anything that emits KEY=value lines on stdout. Forge knows nothing about any specific tool.

## Config

New per-process key:

```jsonc
{
  "name": "sai:api",
  "command": "uvicorn sai.api:app",
  "env":             { "LOG_LEVEL": "info" },
  "envFile":         ".env.shared",
  "envFileCommand":  ["sops", "-d", "--output-type", "dotenv", "secrets/prod.enc.yaml"]
}
```

`envFileCommand` is `string[]` — argv form, executed without a shell. If absent, behavior is unchanged from today. All four env sources (services, `env`, `envFile`, `envFileCommand`) can coexist on one process.

## Resolution order (in `startOne`, low → high priority)

1. Shared service env vars (mongo / redis / etc.)
2. Inline `env: {}` block
3. `portEnv` (the allocated port injected as a single var)
4. `envFile` (existing)
5. **`envFileCommand` stdout, parsed as dotenv** ← new, highest

So a key emitted by the decrypt command always wins over inline / file values. Matches the common pattern of inline non-secret defaults plus encrypted overrides.

## Execution

- Spawned via `child_process.execFile` (no shell — argv form is exact).
- `cwd` = `project.path` (encrypted file paths are typically repo-relative).
- Daemon inherits its own `process.env` so the decrypt tool sees `GPG_TTY`, `OP_SESSION_*`, `AWS_PROFILE`, `PATH`, etc.
- **30-second timeout.** If the command doesn't exit within 30s, send `SIGTERM`, wait 1s, then `SIGKILL`. Treat timeout as a failure.
- **Re-run on every process spawn.** No caching. Predictable mental model; picks up secret rotations automatically.

## Stdout format

Dotenv only: lines of `KEY=value`. Forge's existing `parseEnvFile` already handles:
- Comments (`# ...`)
- Blank lines
- Optional `export` prefix
- Quoted values

Anything `parseEnvFile` accepts is accepted here. No JSON / YAML support in this version.

## Failure handling

If the decrypt command:
- exits non-zero, or
- exceeds the 30s timeout, or
- emits stdout that `parseEnvFile` returns no entries for (e.g., binary garbage),

then:

- The target process **does not spawn**.
- The daemon emits a single structured error to the process's output buffer:
  ```
  [forge] envFileCommand failed for "sai:api": exit 1
  stderr:
  Error: sops metadata not found in secrets/prod.enc.yaml
  ```
  (For timeouts the first line becomes `... failed for "sai:api": timeout after 30s` and stderr is whatever was captured before the kill.)
- The process card's status reflects the spawn failure (`crashed` — existing behavior for spawn failures).
- The structured error is written to the buffer so it shows up in the dashboard card AND survives a page reload (the buffer is what `getBuffer` returns).
- User sees the failure immediately, can fix and `forge restart`.

## Plaintext never hits disk

Critically: `writeEnvFile` is **not** extended to include `envFileCommand` output. The generated `.env.forge` continues to contain only service URLs and `portExportEnv` values. Decrypted secrets exist only in the spawned process's environment block (held by the kernel for the child PID).

## Interactive auth (acknowledged tradeoff)

If the decrypt tool needs a passphrase / Yubikey tap / MFA, the user must be pre-authenticated outside forge:
- `gpg-agent` running with the key cached
- `op signin` having stashed a session token
- `aws sso login` having refreshed tokens

If the tool tries to prompt on stdin, it'll see EOF (we don't attach a TTY) and exit non-zero — surfaced via the failure path above. We do not try to route prompts into the dashboard's xterm in this version.

## Files touched

- **New:** `src/daemon/decrypt-env.js` — exports `runEnvCommand(argv, cwd, timeoutMs = 30_000) → { ok: true, env } | { ok: false, error }`. Wraps `execFile` + parse + timeout + kill-escalation.
- **New:** `test/decrypt-env.test.js` — unit tests for the helper:
  - success: command emits `KEY=value`, helper returns parsed env
  - non-zero exit: helper returns `{ ok: false, error: "exit 1\nstderr:\n..." }`
  - timeout: helper kills child, returns `{ ok: false, error: "timeout after 30s ..." }`
  - empty stdout: helper returns `{ ok: false, error: "envFileCommand produced no entries" }`
  - dotenv with comments and quotes: parsed correctly
- **Modified:** `src/daemon/process-manager.js` — `startOne` calls `runEnvCommand` after `envFile` merge and before `spawnFn`. On failure, write structured error to buffer, emit status `crashed`, do not spawn.
- **Modified:** `test/process-manager.test.js` — integration tests:
  - process spawns with the decrypted env merged in (asserting `spawnCalls[0].env.SECRET_KEY === 'decrypted-value'`)
  - decrypt command failure prevents spawn (no `spawnFn` call) and writes the error to the buffer
  - precedence: a key in `envFileCommand` output overrides the same key in `env: {}` and `envFile`
- **Modified:** existing process-manager tests — confirm no behavior change when `envFileCommand` is absent.

No CLI changes. No registry-schema changes. No new dependencies (uses Node's built-in `child_process` and the existing `parseEnvFile`).

## Non-goals

- No project-level shared `envFileCommand` (per-process only this round).
- No JSON / YAML output support (dotenv only).
- No caching, no TTL.
- No per-value URI scheme (`sops:`, `op:` etc.) — that's a possible Option B follow-up if demand shows up.
- No writing decrypted values to the env file.
- No interactive prompt forwarding into the dashboard terminal.
- No CLI command to test a decrypt config (e.g. `forge decrypt-test <process>`). User can run their command directly to verify.
