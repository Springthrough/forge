# Auto-refresh project config on process-mutating routes

## Problem

Two related operational gotchas in forge:

1. **`forge restart` does not re-read `.forge/config.json`.** It restarts the running process using the registry's snapshot of the config, which is only refreshed by `forge reload`. So edits to a process's `env`/`command`/etc. don't take effect on restart.
2. **Newly-added processes need a two-step `forge reload && forge up`.** Reload pulls the new process into the registry; up actually starts it. Single-command intent ("start what's in my config") doesn't work.

A subtler corollary of (1): inline `env: {...}` blocks are applied at process spawn (in `startOne`), so even if `forge reload` is called, a running process keeps its old env until it's killed + respawned with the fresh config. The user has been burned on this (e.g. `sai:api` not seeing a new `JOBS_SERVICE_URL` until a full `forge down && forge up`).

## Goal

Make the daemon's process-mutating routes (`up`, `down`, `restart`) automatically refresh the project's config from disk before acting. Editing `config.json` plus any single forge command should be enough to apply the change. `reload` continues to exist for the env-file-only case but is no longer a precondition for changes to take effect.

## Root cause

In `src/daemon/api/processes.js`, every route starts with `const project = registry.get(req.params.name);`. `registry.get()` reads the registry's JSON file — which is only updated when `reload` runs `client.syncProject(...)`. So `project.config` is whatever the last `reload` (or `add`) baked into the registry. Process spawning later uses `proc.env`, `proc.command`, etc. from that snapshot.

The fix is to refresh the registry entry from `<project.path>/.forge/config.json` at the top of each process-mutating route.

## Design

### New helper

A small helper module — proposed location `src/daemon/refresh-project.js`:

```js
const fs = require('fs');
const path = require('path');

function refreshProjectConfig(registry, projectName, log = console.warn) {
  const entry = registry.get(projectName);
  if (!entry) return null;
  const configPath = path.join(entry.path, '.forge', 'config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const fresh = JSON.parse(raw);
    registry.update(projectName, { config: fresh });
    return registry.get(projectName);
  } catch (err) {
    log(`[forge] Could not refresh config for "${projectName}" from disk: ${err.message}. Using last-known config.`);
    return entry;
  }
}

module.exports = { refreshProjectConfig };
```

Behavior:
- Reads the project's `.forge/config.json` from disk.
- On success, calls `registry.update(name, { config: fresh })` so the registry stays consistent for subsequent calls (status, logs, dashboard reads, etc.).
- On any error (file missing, malformed JSON, IO failure), logs a warning and returns the existing registry entry. Callers continue with the last-known-good config.

The helper takes `log` as a parameter so tests can capture warnings without sending them to stderr.

### Route wiring

In `src/daemon/api/processes.js`, the following routes change their first line from `const project = registry.get(req.params.name);` to `const project = refreshProjectConfig(registry, req.params.name);`:

- `POST /api/projects/:name/processes/up`
- `POST /api/projects/:name/processes/down`
- `POST /api/projects/:name/processes/:processName/up`
- `POST /api/projects/:name/processes/:processName/down`
- `POST /api/projects/:name/processes/:processName/restart`

The helper returns `null` when the project isn't in the registry (matching the existing `registry.get` semantics), so the not-found 404 check immediately after each call works unchanged.

The non-mutating routes (`GET /processes`, `GET /:processName/logs`) keep `registry.get` to stay cheap. The dashboard reads these frequently; they don't need disk hits.

### Env file rewrites

`up` already writes the env file before spawning (line 53-56 of `processes.js`) with current `project.config` and `allocations`. With the refresh, the env file will reflect the fresh config — no additional change needed in that route.

`restart` (per-process) currently does **not** rewrite the env file. With this change, restarting a process whose `env` block changed in `config.json` will respawn it with the new inline env (passed through `startOne`), but the env file on disk would still reflect the old values. That's a smaller inconsistency than the original bug, but worth fixing: after refresh in the restart route, also call `writeEnvFile` before the `processManager.restart` call. The same env-file-write block from the `up` route applies (same arguments).

### `down`: removed-process safety

After refresh, a process removed from `config.json` will not appear in `project.config.processes`. The current `processManager.down` has two code paths (`src/daemon/process-manager.js:230-266`):

- If `processConfigs` is non-empty: it builds a kill order from dependencies and kills only those processes.
- If `processConfigs` is empty/missing: it iterates the live process map for the project and kills everything.

After this change, a `forge down` after removing a process from `config.json` would kill only what's still in config — silently leaving the removed process running.

**Fix:** change the first branch of `processManager.down` to also iterate the live process map for the project and kill anything not already covered by `processConfigs`. Pseudocode:

```js
async down(projectName, processConfigs) {
  if (processConfigs?.length) {
    // existing dependency-ordered shutdown
    ...
    // After the wave-based shutdown, sweep any remaining live PIDs for the project
    // (e.g. processes removed from config since last refresh).
    for (const k of [...processes.keys()]) {
      if (k.startsWith(`${projectName}:`)) {
        killOne(projectName, k.slice(projectName.length + 1));
      }
    }
  } else {
    // existing live-map fallback (unchanged)
    ...
  }
}
```

The sweep is idempotent (`killOne` no-ops on already-deleted keys), so it's safe to always run.

### `reload` is unchanged

`forge reload` still exists and still does its job (sync registry, write env file, update CLAUDE.md). Its CLI surface and behavior are untouched. With the auto-refresh in place, `reload` becomes useful mainly for:
- Regenerating the env file without restarting processes.
- Updating CLAUDE.md after config changes.
- Surfacing config parse errors immediately (rather than discovering them on the next `up`/`restart` via the warning log).

No deprecation, no rename — quietly less necessary.

### Logging

The warning emitted on parse failure goes to the daemon's stdout (which the dashboard captures and surfaces in the "daemon" output stream — confirm during implementation). Format:

```
[forge] Could not refresh config for "<name>" from disk: <error message>. Using last-known config.
```

Single line, consistent prefix for grepping.

## Files touched

- **New:** `src/daemon/refresh-project.js` — the `refreshProjectConfig` helper.
- **Modified:** `src/daemon/api/processes.js` — five routes pick up the refresh helper; one of those (per-process restart) also gains the env-file-write block.
- **Modified:** `src/daemon/process-manager.js` — `down`'s first branch sweeps the live process map for stragglers after the dependency-ordered shutdown.

No CLI changes. No registry-schema changes. No new dependencies.

## Non-goals

- No auto-watching `config.json` for changes (fs.watch). Changes apply on the next user command, not eagerly.
- No removal or deprecation of `forge reload`.
- No change to non-mutating routes (status, logs, listing) — they remain cheap and registry-driven.
- No change to how `add`, `extend`, or `init` work.

## Known limitations / acknowledged tradeoffs

- **Each mutating call now reads `config.json` from disk.** ~1 ms per call on a typical SSD. The dashboard's restart button hits the daemon once per click — imperceptible. Tests that hammer the routes will incur the cost.
- **Mid-edit save:** if the user has `config.json` open in an editor and the daemon refreshes while the file is mid-save (rare on atomic-write editors like vim/VS Code; possible on other tooling), the warning fires and the operation uses the last-known config. The action still completes correctly.
- **Concurrent refresh + reload:** if `forge reload` is running at the same time as a process-mutating route, both call `registry.update`. The registry's write is a single `fs.writeFileSync`. Last writer wins. Both writers compute the same value from the same `config.json`, so the outcome is consistent.
