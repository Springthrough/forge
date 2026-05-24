# README Redesign — Design Spec

**Date:** 2026-05-24  
**Status:** Approved

## Goal

Add the "why" to Forge's README without disrupting its value as a technical reference. The current README leads with mechanism (daemon, launchd, port allocations) and buries the developer's pain. The redesign adds a compelling opening block and a "Why Forge?" section while leaving all existing reference content intact.

## Audience

Solo developers managing multiple local projects. The README should speak to personal productivity pain — the friction of running a multi-repo, multi-process, multi-service dev stack every day.

## Approach

**Option B — Problem-first restructure.** Two additions, zero removals:

1. Replace the current one-liner + opening paragraph with a new opening block (tagline, problem statement, feature bullets)
2. Insert a new "Why Forge?" section after Quick Start, before Core Concepts

All existing sections remain in place. All anchor links and section order below "Why Forge?" are unchanged.

## Section Order

```
# Forge
[NEW] Tagline + problem statement + feature bullets

## Requirements
## Install
## Quick start
## Why Forge?            ← NEW

## Core concepts
## Named Service Instances
## Configuration reference
## Future: dependsOn
## forge extend
## Multi-instance services
## CLI reference
## Dashboard
## Troubleshooting
## Development
## License
```

## New Opening Block

Replaces lines 1–5 of the current README (the one-liner and the opening paragraph).

```markdown
# Forge

Your entire local dev stack — processes, ports, and shared services — started with one command.

Working across multiple repos means juggling terminals, remembering which project owns port 3000, manually starting Docker containers, and re-doing it all after a reboot. Forge runs a background daemon that handles all of it so you don't have to think about it.

- **Automatic port allocation** — picks ports from a candidate list, re-validates on every `forge up`, no more conflicts
- **On-demand shared services** — Mongo, Redis, Postgres, RabbitMQ start when a project needs them, stop when nothing does
- **Live dashboard** at `localhost:2525` — terminal output for every process, start/stop/restart controls, no extra terminals
- **Full PTY processes** — colors, readline, and interactive tools work as expected
- **Multi-repo support** — `forge extend` merges another project's processes and services into your config
- **Survives reboots** — runs as a launchd agent, always ready after login
```

## New "Why Forge?" Section

Inserted after `## Quick start`, before `## Core concepts`.

```markdown
## Why Forge?

**Too many terminals.** Running a modern app means juggling an API server, a frontend dev server, a background worker, and a job queue — each in its own tab. Forge puts live terminal output for all of them in one dashboard, with per-process start, stop, and restart controls.

**Port conflict hell.** Every project defaults to port 3000. Forge assigns ports from a candidate list at registration time and re-validates on every `forge up` — if something else has claimed a port since last time, it auto-reallocates and rewrites `.env.forge` before spawning.

**Service startup ceremony.** Remembering to start Docker, then Mongo, then Redis — in the right order, every morning — is friction. Forge starts shared containers on demand when a project comes up, stops them when nothing needs them, and recreates them automatically if they're removed externally.

**Multi-repo complexity.** When your frontend depends on an API from another repo, you need both sets of processes and services running, with the right env vars wiring them together. `forge extend` merges a dependency's config into yours — ports, services, and env injection included.
```

## What Does Not Change

- All section headings from `## Requirements` onward remain identical
- All existing content, code blocks, and tables are untouched
- No content is removed
- The feature differentiators are implied through the opening block and "Why Forge?" section — no explicit comparison table to alternatives

## Success Criteria

- A developer unfamiliar with Forge can understand the core value proposition within 10 seconds of opening the README
- The four key pain points (terminals, ports, services, multi-repo) are visible before any installation instructions
- All existing reference content remains accessible at its current location
