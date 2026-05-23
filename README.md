# Forge

Local dev process orchestration daemon with web dashboard.

Forge runs a background daemon that manages your dev processes (servers, workers, watchers) across multiple projects. Each project gets allocated ports, shared services (Postgres, Redis, Mongo) are started on demand, and a web dashboard at `localhost:2525` shows live terminal output for every process.

## Requirements

- macOS (Linux support planned)
- Node.js ≥ 20
- Xcode Command Line Tools (`xcode-select --install`) — required by `node-pty` for terminal emulation

## Install

```bash
npm install -g @brutalsystems/forge
forge install
```

`forge install` registers the daemon as a launchd agent so it starts automatically on login.

## Quick start

```bash
# Register a project
forge add

# Start all processes for a project
forge up <project>

# Open the web dashboard
forge open
```

## Commands

| Command | Description |
|---|---|
| `forge install` | Register daemon as launchd agent and start it |
| `forge uninstall` | Stop daemon and remove launchd agent |
| `forge add` | Register a project with the daemon |
| `forge remove <project>` | Unregister a project |
| `forge up [project]` | Start all processes for a project |
| `forge down [project]` | Stop all processes for a project |
| `forge open` | Open the web dashboard in your browser |
| `forge status` | Show status of all registered projects |
| `forge services` | Show shared service health |
| `forge init` | Scaffold a `forge.yml` config in the current directory |
| `forge extend <project>` | Extend another project's config into this one |
| `forge env <project>` | Print environment variables for a project |

## Dashboard

After `forge install`, the dashboard is available at `http://localhost:2525`. It shows:

- All registered projects and their process status
- Live terminal output per process (via xterm.js over WebSocket)
- Shared service health (Mongo, Redis)
- Per-process start / stop / restart controls
- Drag-to-reorder process panels (order persists per project)

## Development

```bash
git clone https://github.com/BrutalSystems/forge.git
cd forge
npm install
npm run build:web   # build the dashboard
npm test            # run the test suite (155 tests)
```

To work on the dashboard with HMR:

```bash
node src/daemon/server.js &   # start the daemon
npm run dev:web               # Vite dev server at localhost:5173
```

## License

MIT
