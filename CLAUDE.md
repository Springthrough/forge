# Forge — Claude Notes

## Release process

After bumping version in `package.json` and pushing:

1. **Update the running daemon** — `forge restart` only restarts project processes, not the daemon itself. To reload the daemon binary use:
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.forge.daemon
   ```
   Then verify with `forge version` — both CLI and daemon should show the same version with no mismatch warning.

2. **Publish to npm** — push triggers CI/CD which publishes to npm automatically. Do not run `npm publish` manually.
