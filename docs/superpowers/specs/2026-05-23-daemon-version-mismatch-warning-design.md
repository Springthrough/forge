# Daemon Version Mismatch Warning

**Date:** 2026-05-23

## Problem

`forge reload` re-reads `config.json` and restarts managed processes, but it does not restart the daemon itself. When forge's own JS code changes (e.g. a new feature added to `process-manager.js`), the running daemon doesn't pick it up. The user must manually run `forge restart` to reload daemon code. This gap is invisible — reload succeeds silently even when the daemon is stale.

## Solution

Surface a warning whenever the installed forge version differs from the daemon's running version. No new infrastructure required: `GET /api/health` already returns `{ ok: true, version }`, and `forge restart` already exists.

## Changes

### `src/cli/commands/reload.js`

After confirming the daemon is running, call `client.health()` and compare the daemon's version against the local `package.json` version. If they differ, print a yellow warning before proceeding:

```
⚠ Daemon is running v0.3.0 but forge v0.4.1 is installed — run `forge restart` to apply code changes.
```

The reload continues — it's a warning, not a hard stop.

### `src/cli/commands/version.js`

Same check. `forge version` is the first place a user looks when something feels off; it should show the full picture. Display format:

```
forge 0.4.1  daemon running  ⚠ daemon is v0.3.0 — run `forge restart`
```

Or if versions match, no extra output (no noise in the happy path).

## Behaviour

| State | `forge version` | `forge reload` |
|---|---|---|
| Versions match | No extra output | No extra output |
| Daemon stale | Yellow warning with restart hint | Yellow warning before reload output |
| Daemon not running | "stopped" (existing) | Error exit (existing) |

## What's Not Changing

- The health endpoint — already returns `version`, no changes needed.
- Daemon startup — no changes.
- The warning is advisory only; it does not block reload or require interaction.
