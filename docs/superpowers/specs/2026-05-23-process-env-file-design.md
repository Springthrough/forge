# Per-Process envFile Override Design

**Date:** 2026-05-23
**Status:** Approved

## Problem

Multiple projects can extend the same shared repo (e.g. `bh-realtime`) via `forge extend`. When the same process is started for different projects it may need different env vars — particularly secrets that differ per project (e.g. JWT secrets, API keys). Secrets cannot be committed to `config.json`. Today there is no forge-native way to express this, forcing workarounds like sourcing sibling `.env` files inside the command string.

## Goal

Allow a process config entry to declare an optional `envFile` path pointing to a gitignored file in `.forge/`. Forge reads the file at spawn time and injects its vars into the process environment. Each project that uses the shared process has its own copy of the file with its own values.

## Design

### Config shape

A process entry in `.forge/config.json` gains an optional `envFile` field:

```json
{
  "name": "bh-realtime:server",
  "command": "uv run bh-realtime",
  "cwd": "../bh-realtime",
  "envFile": ".forge/bh-realtime.env"
}
```

`envFile` is a path relative to the project root (absolute paths also accepted).

### Override file format

Standard `.env` format: `KEY=VALUE` pairs, one per line. Blank lines and lines beginning with `#` are ignored. Surrounding quotes on values are stripped. No `$VAR` interpolation inside the file — values are taken literally.

```
# .forge/bh-realtime.env — gitignored, per-project
SOME_SECRET=value_for_this_project
OTHER_VAR=something_else
```

### Env merge order (lowest → highest priority)

1. Service URL vars (from forge allocations)
2. Port var (`portEnv`)
3. `proc.env` (static values declared in `config.json` — source repo defaults)
4. `envFile` vars (per-project overrides — highest priority, wins over everything)

`envFile` is last so it acts as a true override file.

### Missing file behaviour

If `envFile` is set but the file does not exist, forge silently skips it. Other developers who do not have the file still work fine. No warning is emitted at spawn time (but `forge env` will note the file is missing).

### Gitignore

When `forge add` or `forge up` runs, for each process config that declares an `envFile`, forge ensures the path is present in the project's `.gitignore` — using the same `ensureGitignored` helper already used for `.env.forge`. If `.gitignore` does not exist, forge logs a warning but does not fail.

### `forge env` output

`forge env` gains an **Override files** section listing each process that declares an `envFile`, the path, and whether the file exists. If the file exists, its keys (not values) are shown. Example:

```
Override files:
  bh-realtime:server  .forge/bh-realtime.env  ✓  [SOME_SECRET, OTHER_VAR]
  other:proc          .forge/other.env         ✗  (file not found)
```

### `.env` parsing helper

A small pure function `parseEnvFile(filePath)` is added to `src/cli/env-file.js` and exported alongside `writeEnvFile` and `ensureGitignored`. It returns a `Record<string, string>` or `null` if the file does not exist. Both `process-manager.js` and `env.js` import it from there.

## Files changed

| File | Change |
|------|--------|
| `src/daemon/process-manager.js` | `startOne` reads `proc.envFile`, calls `parseEnvFile`, merges vars after `proc.env` |
| `src/cli/env-file.js` | Add `parseEnvFile(filePath)` helper; export it |
| `src/cli/commands/up.js` | After writing `.env.forge`, gitignore any `envFile` paths in process configs |
| `src/cli/commands/add.js` | Same gitignore step |
| `src/cli/commands/env.js` | Add Override files section to output |
| `test/process-manager.test.js` | Tests for envFile loading, missing file, merge order |

## Out of scope

- `$VAR` interpolation inside `envFile` values
- Multiple envFiles per process
- A project-level envFile applying to all processes
- Auto-creating the envFile template on `forge extend`
