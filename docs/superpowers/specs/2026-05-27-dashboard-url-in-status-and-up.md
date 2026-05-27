---
title: Dashboard URL in forge status and forge up
date: 2026-05-27
status: approved
---

## Problem

`forge status` and `forge up` give no quick way to open the web dashboard. The user must either remember the URL or run `forge open`.

## Solution

Append a `Dashboard  http://localhost:<PORT>` footer line to the output of both commands so the user can click directly into the UI.

## Affected files

- `src/cli/commands/status.js`
- `src/cli/commands/up.js`
- `src/constants.js` (already exports `FORGE_PORT`)

## Behavior

### forge status

After iterating all projects, print one footer line:

```
  Dashboard  http://localhost:2525
```

- Uses `chalk.dim('  Dashboard  ')` + `chalk.cyan('http://localhost:2525')`
- Only reached when the daemon is running and at least one project exists (the early-exit paths are unchanged)
- `FORGE_PORT` is imported from `src/constants.js`

### forge up

After the `✓ projectName  started` success line for each project, print the same footer line once — after all projects have started (not after each one individually, to avoid repetition when starting multiple projects).

```
✓ myapp  started
  Dashboard  http://localhost:2525
```

- If multiple projects start, the URL appears once at the end
- On error the URL is not shown

## Non-goals

- No OSC 8 hyperlink escape codes — plain URL is auto-linked by macOS terminals
- No new npm dependencies
- No change to `forge down`, `forge restart`, or any other command
