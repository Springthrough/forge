# Service Lifecycle: Standalone Start/Stop + Built-in Service Configuration

**Date:** 2026-05-23  
**Status:** Approved

## Problem

Shared services (mongo, redis, postgres, rabbitmq) currently start when a project runs `forge up` and stop when no registered project needs them on `forge down`. There is no way to start or stop services independent of a project, and services stopping on project down is often surprising when multiple projects share a service or when a developer wants services running without any project active.

A second gap: `forge service configure` only works on named custom instances (e.g. `mongo:rs`). There is no way to configure the default built-in singleton — for example, enabling replica-set mode on the standard mongo container at port 27017.

## Goal

1. Services do not auto-stop when a project goes down.
2. `forge services up [name]` starts one or all services explicitly.
3. `forge services down [name]` stops one or all services explicitly, refusing if a currently-running project needs the service.
4. `forge services` (bare) shows status of all services, not just those declared by registered projects.
5. `forge service configure mongo --replica-set` (no instance name) overrides the default built-in service config, stored in the instance store and applied on next start.

## Design

### 1. Service lifecycle change

Remove the `serviceManager.stopUnused(...)` call from `POST /api/projects/:name/processes/down` in `src/daemon/api/processes.js`. Services no longer auto-stop when a project's processes are stopped.

Add two new public methods to the service manager (`src/daemon/services/manager.js`):

- `async startByName(name)` — resolves the driver by name and calls the existing internal `ensureStarted` on it. Errors if the name is unknown.
- `async stopByName(name)` — calls `driver.stop()` on the named driver and removes it from the `started` set. Errors if the name is unknown.

No other service manager changes. Provisioning, health checks, and `ensureServicesRunning` on project up are unchanged.

### 2. API endpoints

`createServicesRoutes` in `src/daemon/api/services.js` receives a new `processManager` parameter.

Four new routes:

| Method | Path | Behaviour |
|--------|------|-----------|
| `POST` | `/api/services/up` | Start all drivers registered with the service manager |
| `POST` | `/api/services/up/:name` | Start the named driver |
| `POST` | `/api/services/down` | Attempt to stop all services; collect blocked entries for any a running project needs |
| `POST` | `/api/services/down/:name` | Stop the named service; return 409 if a running project needs it |

**Running project check:** For each project in `registry.getAll()`, call `processManager.getStatuses(name, processes)` and consider the project "up" if any process has `status === 'running'`. Collect the set of service names declared by up projects — this is the blocked set.

**Response shape for `POST /api/services/down`:**
```json
{ "ok": true, "stopped": ["redis"], "blocked": [{ "name": "mongo", "reason": "project sai is up" }] }
```
`ok` is `true` even when some are blocked, so the CLI can print per-service errors without treating the whole response as a hard failure.

**Fix `GET /api/services`:** Remove the filter that restricts results to services declared by registered projects. Return all statuses from `serviceManager.getStatus()` unconditionally.

`src/daemon/server.js`: pass `processManager: pm` to `createServicesRoutes`.

### 3. CLI

`src/cli/commands/services.js` gains `up` and `down` subcommands. The parent command retains its `.action()` for bare `forge services` status display.

```
forge services              # show status of all services
forge services up           # start all services
forge services up mongo     # start just mongo
forge services down         # stop all; print error per blocked service, exit 1 if any blocked
forge services down redis   # stop just redis; error if a running project needs it
```

`src/cli/client.js` gains:

- `startServices(name?)` → `POST /api/services/up` or `POST /api/services/up/:name`
- `stopServices(name?)` → `POST /api/services/down` or `POST /api/services/down/:name`

### 4. Built-in service configuration overrides

`forge service configure <type>` with no instance name configures the default built-in singleton. Examples:

```
forge service configure mongo --replica-set      # default mongo, replica set on
forge service configure mongo --no-replica-set   # turn it back off
forge service configure postgres --port 5433     # change default postgres port
```

**CLI change (`src/cli/commands/service.js`):** `configure <type> <name>` becomes `configure <type> [name]`. When `name` is omitted, `key = type` (e.g. `mongo`). When present, `key = type:name` as today.

**API change (`src/daemon/api/services.js`):** `PATCH /instances/:key` becomes an upsert — if the key does not exist, create it rather than returning 404. For a built-in key (e.g. `mongo`) the initial record is `{ type: key, port: <built-in default>, options: {} }` merged with the patch body.

**Server startup (`src/daemon/server.js`):** `buildCustomDrivers` currently skips any instance store entry whose key matches a built-in name. Change this: when a built-in key is present in the instance store, use `DRIVER_FACTORIES[key]` to create a configured driver (with `containerName = forge-<key>` and the stored port/options) and exclude the pre-built singleton for that name. Built-ins without an override continue to use their pre-built singletons unchanged.

Built-in default ports used when initializing a new override record:

| Key | Port |
|-----|------|
| `mongo` | 27017 |
| `redis` | 6379 |
| `postgres` | 5432 |
| `rabbitmq` | 5672 |

**Effect timing:** The override is stored immediately. The running container (if any) is not automatically replaced — changes take effect on the next `forge services down <name> && forge services up <name>` cycle (or daemon restart). The CLI prints: `Configuration saved. Run 'forge services down <name> && forge services up <name>' to apply.`

### 5. Files changed

| File | Change |
|------|--------|
| `src/daemon/services/manager.js` | Add `startByName`, `stopByName` |
| `src/daemon/api/processes.js` | Remove `stopUnused` call from project down handler |
| `src/daemon/api/services.js` | Add processManager param; add 4 up/down routes; fix `GET /` filter; make `PATCH /instances/:key` an upsert |
| `src/daemon/server.js` | Pass `processManager` to `createServicesRoutes`; override built-in drivers from instance store in `buildCustomDrivers` |
| `src/cli/client.js` | Add `startServices`, `stopServices` |
| `src/cli/commands/services.js` | Add `up` and `down` subcommands |
| `src/cli/commands/service.js` | Make `[name]` optional in `configure`; derive key from type alone when name absent |

## Out of scope

- Persisting "manually started" service state across daemon restarts (Docker containers persist independently; health check handles recovery).
- A `--force` flag to override the running-project block.
- Live driver replacement without daemon restart after `configure`.
