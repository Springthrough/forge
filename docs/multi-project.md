# Multi-project setup

This guide covers the `forge extend` pattern for running processes from multiple repos under a single forge project. The running example is `web-app`, which extends both `api-service` and `realtime`.

## When to use forge extend

Use `forge extend` when:

- A frontend project needs to run alongside the backend API and real-time server it depends on
- You want a single `forge up` to start the entire stack across multiple repos
- You want shared services (Mongo, Redis) to be provisioned once and shared correctly between the processes

You do **not** need extend if all processes live in the same repo — just list them all in the same `processes` array.

## How service ownership works

Service declarations belong in the project that **owns the data**, not the project that consumes it. This is the most important rule for getting services right in a multi-project setup.

When `web-app` extends `api-service`, it does not declare `mongo` itself — it inherits the `mongo` declaration from `api-service`'s config. Forge then allocates a Mongo database for the web-app registration using the parameters defined in api-service's config: the same database name `"api-service"`. This is intentional — web-app connects to the same `api-service` database that api-service itself uses.

The same applies to Redis in `realtime`. The `redis` declaration lives in realtime's config because realtime owns that data. When web-app extends realtime, forge allocates a Redis DB number specifically for the web-app registration. A different project that also extends realtime gets a different Redis DB number.

If you declare a service in the consumer project instead of the source project, the allocation will be based on the consumer's config. Other consumers of the same source will also declare the service separately with different parameters, and you will end up with multiple disconnected service allocations rather than one consistent one.

## Step-by-step: setting up a consumer project from scratch

The full sequence for setting up `web-app`, which needs processes from `api-service` and `realtime`:

```bash
cd ~/projects/web-app

# 1. Scaffold the config for web-app's own processes
forge init

# 2. Edit .forge/config.json to add web-app's own processes
#    (Vite dev server, etc.)

# 3. Extend from api-service — adds api-service:server and inherits mongo service
forge extend ../api-service

# 4. Extend from realtime — adds realtime:server and inherits redis service
forge extend ../realtime

# 5. Register with the daemon
forge add

# 6. Start everything
forge up
```

After step 3 and 4, `.forge/config.json` will contain:
- web-app's own processes
- `api-service:server` (from api-service)
- `realtime:server` (from realtime)
- `services.mongo` (inherited from api-service)
- `services.redis` (inherited from realtime, using realtime's `env` key `REALTIME_REDIS_URL`)

If the project is already registered when you extend it, run `forge reload` instead of `forge add` to reallocate ports and provision any new services:

```bash
forge extend ../some-new-dependency
forge reload
```

## Multi-instance services

Two projects can each run their own instance of realtime, with no port or Redis collisions between them. Forge handles this because allocations are per registered project, not per config.

Example: both `web-app` and `some-other-web` extend `realtime`.

**web-app** registered with the daemon:
- Gets port 8101 for realtime:server (first available from `[8101, 8102, 8103]`)
- Gets Redis DB 2 for `REALTIME_REDIS_URL`

**some-other-web** registered with the daemon:
- Gets port 8102 for realtime:server (8101 is taken)
- Gets Redis DB 3 for `REALTIME_REDIS_URL`

Both projects also get `REALTIME_AUTO_START_REDIS=false` injected into the realtime:server process. This comes from the static `env` field in realtime's process config — the process is told not to start its own Docker container because forge manages it.

The realtime source config that enables this:

```json
{
  "name": "realtime",
  "processes": [{
    "name": "server",
    "command": "uv run realtime",
    "ports": [8101, 8102, 8103],
    "portEnv": "REALTIME_PORT",
    "portExportEnv": "REALTIME_PORT",
    "env": { "REALTIME_AUTO_START_REDIS": "false" }
  }],
  "services": {
    "redis": { "env": "REALTIME_REDIS_URL" }
  }
}
```

Key points:
- `portEnv` and `portExportEnv` are both set to `REALTIME_PORT`. This means the process gets `REALTIME_PORT=<port>` in its environment, and the same value is exported to `.env.forge` so sibling processes can also read it.
- The `redis` declaration uses a specific env key (`REALTIME_REDIS_URL`) rather than the generic `REDIS_URL`. This avoids collisions when a project also has its own Redis service.
- The `env` field's `REALTIME_AUTO_START_REDIS=false` is inherited by all consumers.

## portExportEnv: the Vite proxy problem

Vite's dev server needs to know what port the API is running on to configure its proxy. Without forge, this is usually hardcoded in `vite.config.js`. With forge, the API's port is allocated dynamically and changes if the first candidate is taken.

`portExportEnv` solves this. When a process has `portExportEnv` set, forge writes that process's allocated port to `.env.forge` under the given name. Because all processes read `.env.forge` at spawn time, the Vite process has access to the value.

Example: `api-service:server` is configured with:

```json
{
  "name": "api",
  "portEnv": "PORT",
  "portExportEnv": "API_SERVICE_PORT"
}
```

Forge allocates port 8200 for this process:
- `PORT=8200` is injected into the api-service:server PTY environment
- `API_SERVICE_PORT=8200` is written to `.env.forge`

The Vite process reads `.env.forge` at spawn time and has `process.env.API_SERVICE_PORT = "8200"`. In `vite.config.js`:

```js
export default {
  server: {
    proxy: {
      '/api': `http://localhost:${process.env.API_SERVICE_PORT}`
    }
  }
}
```

`PORT` is not written to `.env.forge` because `PORT` is a generic name that would conflict with any other process that also uses `PORT`. Always use `portExportEnv` with a unique name when you need a port to be discoverable by other processes.

## What not to do

**Do not hardcode a Redis DB number in source configs.**

```json
// WRONG — do not do this
"redis": { "db": 3, "env": "REDIS_URL" }
```

Redis DB numbers are assigned by forge per registered project. If you hardcode a number in the config, every consumer that extends this project will try to use the same DB number, defeating isolation. Leave the `db` field absent and let forge assign it.

**Do not set `portExportEnv` to the same value as `portEnv` when the name is generic.**

If `portEnv` is `PORT`, do not set `portExportEnv` to `PORT` as well. That would write `PORT=<value>` to `.env.forge`, which would be read by all sibling processes and potentially override their own port assignments. Use a unique name for `portExportEnv` (e.g. `API_SERVICE_PORT`, `REALTIME_PORT`).

Note: `REALTIME_PORT` is safe to use for both because it is unique enough not to conflict with any other process's `portEnv`.

**Do not declare services in the consumer project.**

```json
// web-app/.forge/config.json — WRONG
"services": {
  "mongo": { "db": "api-service", "env": "MONGODB_URL" }
}
```

Declare services in the project that owns the data (`api-service/.forge/config.json`). When web-app extends api-service, it inherits the mongo declaration automatically. Declaring it again in web-app is redundant at best and causes confusion if the parameters differ.

**Do not forget to run `forge reload` after extending an already-registered project.**

`forge extend` only modifies `.forge/config.json` on disk. The running daemon does not know about the new processes or services until you run `forge reload`, which re-reads the config and reallocates ports and provisions new services.

**Do not run `forge add` on an already-registered project.**

`forge add` is for initial registration. For updates, use `forge reload`. Running `forge add` on an already-registered project may produce unexpected behavior.
