# dependsOn: Process Startup Ordering

**Date:** 2026-05-24
**Status:** Approved

## Problem

All processes in a project currently start in parallel with no readiness gating. For most setups this is fine — `.env.forge` is written with correct port values before any process spawns. But some scenarios genuinely require one process to be ready before another starts:

- A migration runner that must complete (exit 0) before the API accepts traffic
- A code-generation step whose output a subsequent build step reads
- A process that needs a sibling's port to be accepting TCP connections at startup

## Goal

Add a `dependsOn` field to process configs that sequences startup: a process does not start until all named dependencies are ready. A dependency is "ready" according to its own declared `waitFor` condition. Failures (crash, timeout) warn and proceed rather than blocking dependents indefinitely.

## Config Schema

`waitFor` lives on the **dependency** — the process being waited on — describing when it is considered ready. `dependsOn` names which processes must be ready before this one starts.

```json
{
  "processes": [
    {
      "name": "migrate",
      "command": "node migrate.js",
      "waitFor": { "exit": true, "timeoutSeconds": 60 }
    },
    {
      "name": "api",
      "command": "node server.js",
      "ports": [3000, 3001],
      "portEnv": "PORT",
      "dependsOn": ["migrate"],
      "waitFor": { "port": true, "timeoutSeconds": 30 }
    },
    {
      "name": "app",
      "command": "yarn dev",
      "dependsOn": ["api"]
    }
  ]
}
```

### `waitFor` options

| Field | Type | Meaning |
|---|---|---|
| `port` | `true` | Poll TCP on this process's own allocated port until it accepts connections |
| `exit` | `true` | Wait for the process to exit with code 0 |
| `timeoutSeconds` | number | How long to wait. Defaults to 30 if omitted |

Omitting `waitFor` entirely means the process is considered ready immediately after spawn — preserving current behaviour for all existing configs.

### Validation errors (thrown at startup, not silently ignored)

- **Cycle detected** — `dependsOn` graph contains a cycle. Error includes the full cycle path: `Cycle detected in dependsOn: migrate → api → migrate`
- **Unknown dependency** — a process names a `dependsOn` entry that doesn't exist in the config: `Process "app" depends on unknown process "nonexistent"`

## Architecture

### New module: `src/daemon/dependency-resolver.js`

A pure module (no I/O, no side effects) with a single export:

```js
buildStartOrder(processConfigs)
// Returns: Array<Array<ProcessConfig>>
// Each inner array is a wave — processes that can start in parallel.
// Throws on cycles or unknown dependency names.
```

**Algorithm:**
1. Build an adjacency map from `dependsOn` declarations.
2. Validate all named dependencies exist — throw if not.
3. DFS cycle detection — throw with the cycle path if found.
4. Kahn's algorithm (repeated removal of zero-in-degree nodes) to produce waves.

**Example output:**
```
// migrate → api → app, worker has no deps
// Wave 0: [migrate, worker]
// Wave 1: [api]
// Wave 2: [app]
```

### Changes to `src/daemon/process-manager.js`

**`startOne` becomes async.** It now returns a Promise that resolves once the process is ready (or immediately if no `waitFor` is declared).

**Two new private readiness helpers** (injectable for testing):

- `pollPort(port, timeoutMs)` — attempts `net.createConnection` to `localhost:port` every 250ms. Resolves `true` when a connection succeeds, `false` on timeout.
- `waitForExit(ptyProc, timeoutMs)` — attaches to `ptyProc.onExit`. Resolves `true` on exit code 0, `false` on non-zero exit or timeout.

Both are injected via the `createProcessManager` options object (like `ptySpawn`), so tests never open real TCP connections or wait on real processes.

**`up()` changes:**
1. Calls `buildStartOrder(processConfigs)` — throws on cycles/unknown deps (caller catches and returns 500).
2. Iterates waves sequentially. Within each wave, calls `startOne` for all processes and awaits `Promise.all`.
3. After each wave, the next wave starts. If a process's readiness check fails, a warning is injected into its PTY buffer and a `status` event is emitted — dependents start anyway.

**`startProcess()` (single named process) changes:**
Runs `buildStartOrder` on the full project config, then walks all ancestors of the named process (direct and transitive), skips any already running, and starts the remainder in wave order before starting the requested process.

**`up()` and `startProcess()` signatures are unchanged** — no API or CLI changes required.

## Error Handling

| Scenario | Behaviour |
|---|---|
| Cycle or unknown dep in config | `buildStartOrder` throws; API returns `500 { error: "..." }`; CLI prints red error and exits 1 |
| Readiness timeout | Warning injected into process PTY buffer; `status` event emitted; dependents start anyway |
| Dependency crashes before ready | Same warning path; dependents start anyway |
| `forge up <name>` — dependency already running | `startOne` skips running processes; readiness not re-polled; dependent starts immediately |
| `waitFor.port` with no allocated port | Warning logged; process treated as immediately ready |

The warning line injected into the PTY buffer uses a consistent format so it's scannable in logs:
```
[forge] Warning: "api" did not become ready within 30s — starting dependents anyway
```

## Files Changed

| File | Change |
|---|---|
| `src/daemon/dependency-resolver.js` | New — `buildStartOrder`, cycle detection, topological sort |
| `src/daemon/process-manager.js` | `startOne` async; `up()` uses waves; `startProcess()` resolves deps; `pollPort`/`waitForExit` helpers; inject options |
| `test/dependency-resolver.test.js` | New — pure unit tests for graph logic |
| `test/process-manager.test.js` | Extended — ordering, readiness, timeout, crash, single-process dep resolution |
| `README.md` | Update "Future: dependsOn" section to mark as implemented; update process fields table |

## Testing

### `test/dependency-resolver.test.js` (new, pure unit tests)

- Linear chain resolves to correct waves
- Parallel processes with no deps all land in wave 0
- Diamond dependency (A→C, B→C, D depends on A+B) resolves correctly
- Direct cycle throws with the cycle path in the message
- Indirect cycle (A→B→C→A) throws
- Unknown `dependsOn` entry throws with the process name

### `test/process-manager.test.js` (additions)

- `up()` with `dependsOn` spawns wave 0 before wave 1
- `waitFor: { port: true }` — injected `pollPort` resolves; dependent starts after
- `waitFor: { exit: true }` — mock process exits 0; dependent starts after
- Readiness timeout emits warning to buffer and starts dependent anyway
- Dependency non-zero exit emits warning and starts dependent anyway
- `startProcess()` with deps auto-starts the full dependency chain first
- Cycle in config causes `up()` to throw
- Already-running dependency is not re-spawned

## Out of Scope

- Cross-project dependencies (one project's process depending on another project's process)
- `--force` flag to skip dependency ordering
- Dynamic readiness signals (stdout pattern matching)
- Retry on crash before starting dependents
