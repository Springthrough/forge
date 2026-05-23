# Multi-project setup

This guide covers the `forge extend` pattern for running processes from multiple repos under a single forge project. The running example is `sai-web`, which extends both `sai` and `bh-realtime`.

## When to use forge extend

Use `forge extend` when:

- A frontend project needs to run alongside the backend API and real-time server it depends on
- You want a single `forge up` to start the entire stack across multiple repos
- You want shared services (Mongo, Redis) to be provisioned once and shared correctly between the processes

You do **not** need extend if all processes live in the same repo — just list them all in the same `processes` array.

## How service ownership works

Service declarations belong in the project that **owns the data**, not the project that consumes it. This is the most important rule for getting services right in a multi-project setup.

When `sai-web` extends `sai`, it does not declare `mongo` itself — it inherits the `mongo` declaration from `sai`'s config. Forge then allocates a Mongo database for the sai-web registration using the parameters defined in sai's config: the same database name `"sai"`. This is intentional — sai-web connects to the same `sai` database that sai itself uses.

The same applies to Redis in `bh-realtime`. The `redis` declaration lives in bh-realtime's config because bh-realtime owns that data. When sai-web extends bh-realtime, forge allocates a Redis DB number specifically for the sai-web registration. A different project that also extends bh-realtime gets a different Redis DB number.

If you declare a service in the consumer project instead of the source project, the allocation will be based on the consumer's config. Other consumers of the same source will also declare the service separately with different parameters, and you will end up with multiple disconnected service allocations rather than one consistent one.

## Step-by-step: setting up a consumer project from scratch

The full sequence for setting up `sai-web`, which needs processes from `sai` and `bh-realtime`:

```bash
cd ~/projects/sai-web

# 1. Scaffold the config for sai-web's own processes
forge init

# 2. Edit .forge/config.json to add sai-web's own processes
#    (Vite dev server, etc.)

# 3. Extend from sai — adds sai:api and inherits mongo service
forge extend ../sai

# 4. Extend from bh-realtime — adds bh-realtime:server and inherits redis service
forge extend ../bh-realtime

# 5. Register with the daemon
forge add

# 6. Start everything
forge up
```

After step 3 and 4, `.forge/config.json` will contain:
- sai-web's own processes
- `sai:api` (from sai)
- `bh-realtime:server` (from bh-realtime)
- `services.mongo` (inherited from sai)
- `services.redis` (inherited from bh-realtime, using bh-realtime's `env` key `BH_REALTIME_REDIS_URL`)

If the project is already registered when you extend it, run `forge reload` instead of `forge add` to reallocate ports and provision any new services:

```bash
forge extend ../some-new-dependency
forge reload
```

## Multi-instance services

Two projects can each run their own instance of bh-realtime, with no port or Redis collisions between them. Forge handles this because allocations are per registered project, not per config.

Example: both `sai-web` and `some-other-web` extend `bh-realtime`.

**sai-web** registered with the daemon:
- Gets port 8101 for bh-realtime:server (first available from `[8101, 8102, 8103]`)
- Gets Redis DB 2 for `BH_REALTIME_REDIS_URL`

**some-other-web** registered with the daemon:
- Gets port 8102 for bh-realtime:server (8101 is taken)
- Gets Redis DB 3 for `BH_REALTIME_REDIS_URL`

Both projects also get `BH_REALTIME_AUTO_START_REDIS=false` injected into the bh-realtime:server process. This comes from the static `env` field in bh-realtime's process config — the process is told not to start its own Docker container because forge manages it.

The bh-realtime source config that enables this:

```json
{
  "name": "bh-realtime",
  "processes": [{
    "name": "server",
    "command": "uv run bh-realtime",
    "ports": [8101, 8102, 8103],
    "portEnv": "BH_REALTIME_PORT",
    "portExportEnv": "BH_REALTIME_PORT",
    "env": { "BH_REALTIME_AUTO_START_REDIS": "false" }
  }],
  "services": {
    "redis": { "env": "BH_REALTIME_REDIS_URL" }
  }
}
```

Key points:
- `portEnv` and `portExportEnv` are both set to `BH_REALTIME_PORT`. This means the process gets `BH_REALTIME_PORT=<port>` in its environment, and the same value is exported to `.env.forge` so sibling processes can also read it.
- The `redis` declaration uses a specific env key (`BH_REALTIME_REDIS_URL`) rather than the generic `REDIS_URL`. This avoids collisions when a project also has its own Redis service.
- The `env` field's `BH_REALTIME_AUTO_START_REDIS=false` is inherited by all consumers.

## portExportEnv: the Vite proxy problem

Vite's dev server needs to know what port the API is running on to configure its proxy. Without forge, this is usually hardcoded in `vite.config.js`. With forge, the API's port is allocated dynamically and changes if the first candidate is taken.

`portExportEnv` solves this. When a process has `portExportEnv` set, forge writes that process's allocated port to `.env.forge` under the given name. Because all processes read `.env.forge` at spawn time, the Vite process has access to the value.

Example: `sai:api` is configured with:

```json
{
  "name": "api",
  "portEnv": "PORT",
  "portExportEnv": "SAI_API_PORT"
}
```

Forge allocates port 8200 for this process:
- `PORT=8200` is injected into the sai:api PTY environment
- `SAI_API_PORT=8200` is written to `.env.forge`

The Vite process reads `.env.forge` at spawn time and has `process.env.SAI_API_PORT = "8200"`. In `vite.config.js`:

```js
export default {
  server: {
    proxy: {
      '/api': `http://localhost:${process.env.SAI_API_PORT}`
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

If `portEnv` is `PORT`, do not set `portExportEnv` to `PORT` as well. That would write `PORT=<value>` to `.env.forge`, which would be read by all sibling processes and potentially override their own port assignments. Use a unique name for `portExportEnv` (e.g. `SAI_API_PORT`, `BH_REALTIME_PORT`).

Note: `BH_REALTIME_PORT` is safe to use for both because it is unique enough not to conflict with any other process's `portEnv`.

**Do not declare services in the consumer project.**

```json
// sai-web/.forge/config.json — WRONG
"services": {
  "mongo": { "db": "sai", "env": "MONGODB_URL" }
}
```

Declare services in the project that owns the data (`sai/.forge/config.json`). When sai-web extends sai, it inherits the mongo declaration automatically. Declaring it again in sai-web is redundant at best and causes confusion if the parameters differ.

**Do not forget to run `forge reload` after extending an already-registered project.**

`forge extend` only modifies `.forge/config.json` on disk. The running daemon does not know about the new processes or services until you run `forge reload`, which re-reads the config and reallocates ports and provisions new services.

**Do not run `forge add` on an already-registered project.**

`forge add` is for initial registration. For updates, use `forge reload`. Running `forge add` on an already-registered project may produce unexpected behavior.
