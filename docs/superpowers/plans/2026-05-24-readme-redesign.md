# README Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a problem-first opening block and a "Why Forge?" section to README.md so developers understand the value proposition before reading any technical details.

**Architecture:** Two targeted edits to `README.md` — replace the current one-liner + opening paragraph with a tagline + problem statement + feature bullets, then insert a "Why Forge?" section after Quick Start. No content is removed; all existing sections stay in place.

**Tech Stack:** Markdown

---

## Files

- Modify: `README.md`

---

### Task 1: Replace the opening block

The current opening block (title through the end of the opening paragraph, before `## Requirements`) is replaced with the new tagline, problem statement, and feature bullets.

**Files:**
- Modify: `README.md:1-6`

- [ ] **Step 1: Apply the edit**

In `README.md`, replace this exact block (lines 1–6):

```markdown
# Forge

Local dev process orchestration daemon with web dashboard for macOS.

Forge runs a background daemon that manages your dev processes (servers, workers, watchers) across one or more repos. Each project gets dedicated port allocations, shared services (Mongo, Redis) start and stop on demand via Docker, and a web dashboard at `localhost:2525` shows live terminal output for every process.
```

With this new block:

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

- [ ] **Step 2: Verify the edit**

Read `README.md` lines 1–20 and confirm:
- Title is `# Forge`
- Second line is blank
- Third line starts with `Your entire local dev stack`
- Feature bullets are present (6 of them)
- `## Requirements` section follows immediately after the bullets

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: replace README opening with problem-first framing"
```

---

### Task 2: Insert "Why Forge?" section

A new `## Why Forge?` section is inserted between `## Quick start` and `## Core concepts`.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Apply the edit**

Use the Edit tool with the following exact old_string and new_string. The anchor is `## Core concepts`, which appears exactly once in the file. The edit prepends the new section before it.

**old_string** — find this exact text in README.md:

```
## Core concepts
```

**new_string** — replace with this (Why Forge? section followed by the original heading):

```
## Why Forge?

**Too many terminals.** Running a modern app means juggling an API server, a frontend dev server, a background worker, and a job queue — each in its own tab. Forge puts live terminal output for all of them in one dashboard, with per-process start, stop, and restart controls.

**Port conflict hell.** Every project defaults to port 3000. Forge assigns ports from a candidate list at registration time and re-validates on every `forge up` — if something else has claimed a port since last time, it auto-reallocates and rewrites `.env.forge` before spawning.

**Service startup ceremony.** Remembering to start Docker, then Mongo, then Redis — in the right order, every morning — is friction. Forge starts shared containers on demand when a project comes up, stops them when nothing needs them, and recreates them automatically if they're removed externally.

**Multi-repo complexity.** When your frontend depends on an API from another repo, you need both sets of processes and services running, with the right env vars wiring them together. `forge extend` merges a dependency's config into yours — ports, services, and env injection included.

## Core concepts
```

- [ ] **Step 2: Verify the edit**

Read `README.md` and confirm:
- `## Why Forge?` section exists
- It contains exactly four bold-lead paragraphs: "Too many terminals.", "Port conflict hell.", "Service startup ceremony.", "Multi-repo complexity."
- `## Core concepts` still follows immediately after
- No content between Quick start and Core concepts has been removed

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Why Forge? section after Quick start"
```

---

### Task 3: Final review

- [ ] **Step 1: Read the full README opening**

Read `README.md` lines 1–60 and do a final sanity check:
- Opening block: tagline → problem statement → 6 feature bullets
- Requirements section follows
- Install section follows
- Quick start section follows
- Why Forge? section follows (4 pain-point paragraphs)
- Core concepts section follows

- [ ] **Step 2: Check no content was lost**

Run:
```bash
grep -n "## " README.md
```

Expected output (in order):
```
7:## Requirements
15:## Install
24:## Quick start
43:## Why Forge?
57:## Core concepts
...remaining sections...
```

Line numbers will differ slightly from above — what matters is the **order** of these headings is correct and none are missing compared to the original.
