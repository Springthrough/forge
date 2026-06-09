# Forge — Claude Notes

## Release process

After bumping version in `package.json` and pushing:

1. **Update the running daemon** — `forge restart` only restarts project processes, not the daemon itself. To reload the daemon binary:

   On macOS:
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.forge.daemon
   ```

   On Linux:
   ```bash
   systemctl --user restart forge.service
   ```

   On Windows (cmd or PowerShell):
   ```cmd
   schtasks /End /TN \Forge\ForgeDaemon
   schtasks /Run /TN \Forge\ForgeDaemon
   ```

   Then verify with `forge version` — both CLI and daemon should show the same version with no mismatch warning.

2. **Publish to npm** — publishing is triggered by a version tag, not a branch push. After bumping the version and pushing the commit, create and push the tag:
   ```bash
   git tag v<version> && git push origin v<version>
   ```
   The `publish.yml` workflow only fires on `v*` tags. Pushing to `main` alone only runs CI tests — it does not publish.
