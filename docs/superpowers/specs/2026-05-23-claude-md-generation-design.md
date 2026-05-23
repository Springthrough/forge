# Design: CLAUDE.md Generation on `forge add`

## Problem

When Claude Code works in a project managed by forge, it has no signal that forge
exists, what the project's process names are, or how to retrieve logs. This leads to
wrong diagnoses (e.g., attributing a missing env var to a "startup-order issue" when
forge simply never injects `portExportEnv` values into sibling processes — they exist
only in `.env.forge` on disk).

## Solution

`forge add` offers to write a `CLAUDE.md` file (or add a forge section to an existing
one) containing project-specific forge context. `forge reload` silently keeps the
section current. `forge init` hints that this is coming.

---

## User-Facing Flow

### `forge init`

No behavioral change. The "next steps" output is updated to mention CLAUDE.md:

```
✓ Created .forge/config.json

  Edit it to define your processes and services, then run:
  forge add    — registers project and offers to write CLAUDE.md
```

### `forge add`

After the existing success output, before exiting:

- If a forge section already exists in CLAUDE.md → silently update it (user already
  opted in) and log `Updated CLAUDE.md`.
- If CLAUDE.md exists but has no forge section → prompt:
  `Add a forge section to existing CLAUDE.md for AI assistants? [Y/n]`
- If no CLAUDE.md → prompt:
  `Write CLAUDE.md with forge context for AI assistants? [Y/n]`

Default answer is Y (Enter accepts). On Y, write and log. On N, skip silently.
`forge add` never fails because of a CLAUDE.md write error — log a warning and
continue.

### `forge reload`

If a forge section is present in CLAUDE.md, silently update it and log
`Updated CLAUDE.md`. No prompt — user already opted in at `forge add` time.

---

## Generated Content

The forge section is wrapped in HTML comment markers so `forge reload` can locate and
replace it precisely:

```markdown
<!-- forge:start -->
## Forge (process manager)

This project runs under forge. Use forge commands — not systemd, PM2, or direct
process commands.

**Status / control**
- `forge status` — all registered projects and process states
- `forge up` / `forge down` / `forge restart` — start, stop, restart this project
- `forge open` — web dashboard at http://localhost:2525

**Logs**
- `forge logs <process>` — last 100 lines (buffered)
- `forge logs <process> -f` — live follow
- `forge logs <process> -n 200` — more lines

Processes in this project:
| Process | Logs |
|---------|------|
| api | `forge logs api` |
| ui | `forge logs ui` |

**Environment**
- `forge env` — show all env vars forge injects for this project
- `.env.forge` — generated file with service URLs and exported port vars;
  processes must load this themselves (forge does not auto-inject it)

**Services** (mongo, redis)
- `forge service` — check health
- `forge service up <name>` / `forge service down <name>`
<!-- forge:end -->
```

The process table rows and services line are generated from `.forge/config.json` —
never placeholders. The services line is omitted entirely if the project declares no
services.

---

## Implementation

### New file: `src/cli/claude-md.js`

Three exports:

**`generateForgeSection(config)`** — builds the marker-wrapped markdown string from
the project config. Uses `config.processes` for the process table and
`config.services` for the services line. No allocations needed.

**`writeClaude(projectPath, config)`** — reads CLAUDE.md if present:
- If markers found: replace content between them with new section (non-greedy regex
  to handle edge cases).
- If no markers: append section after trimming trailing whitespace, with a blank line
  separator.
- If no file: create it with just the forge section.

**`hasForgeSection(projectPath)`** — returns boolean. Used by `reload.js` to decide
whether to silently update.

### `src/cli/commands/add.js`

After existing success output, add:

```javascript
const { writeClaude, hasForgeSection } = require('../claude-md');

if (hasForgeSection(cwd)) {
  writeClaude(cwd, config);
  console.log(chalk.dim('  Updated CLAUDE.md'));
} else {
  const claudeExists = fs.existsSync(path.join(cwd, 'CLAUDE.md'));
  const q = claudeExists
    ? 'Add a forge section to existing CLAUDE.md for AI assistants? [Y/n] '
    : 'Write CLAUDE.md with forge context for AI assistants? [Y/n] ';
  if (await confirm(q)) {
    try {
      writeClaude(cwd, config);
      console.log(chalk.dim(`  ${claudeExists ? 'Updated' : 'Wrote'} CLAUDE.md`));
    } catch (err) {
      console.warn(chalk.yellow(`  ⚠ Could not write CLAUDE.md: ${err.message}`));
    }
  }
}
```

`confirm(question)` is a small inline helper using Node's built-in `readline`. Default
answer is Y (empty input → true).

### `src/cli/commands/reload.js`

After existing success output, add:

```javascript
const { writeClaude, hasForgeSection } = require('../claude-md');

if (hasForgeSection(cwd)) {
  writeClaude(cwd, config);
  console.log(chalk.dim('  Updated CLAUDE.md'));
}
```

### `src/cli/commands/init.js`

Update the console output after `✓ Created .forge/config.json` to include the
CLAUDE.md mention in the next-steps hint.

---

## Error Handling

- CLAUDE.md write failures are warnings, never fatal to `forge add`.
- Marker regex uses `[\s\S]*?` (non-greedy) so multiple forge blocks cannot merge.
- `hasForgeSection` returns false if CLAUDE.md does not exist (no special case needed).

---

## Testing

`src/cli/claude-md.js` has no daemon dependency — all unit testable with a temp
directory:

- Generates correct markdown with actual process and service names
- Creates CLAUDE.md when none exists
- Appends forge section when CLAUDE.md exists without markers
- Replaces forge section when markers already present (idempotent)
- `hasForgeSection` returns correct boolean in all three states
  (no file / file without markers / file with markers)

`add.js` and `reload.js` changes delegate all logic to `claude-md.js` — no new tests
needed for those commands.
