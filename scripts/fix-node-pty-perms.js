#!/usr/bin/env node
// npm tarball extraction sometimes drops the executable bit on node-pty's
// prebuilt spawn-helper. Restore +x here so installs are usable out of the box.
if (process.platform === 'win32') process.exit(0);

const fs = require('fs');
const path = require('path');

const prebuilds = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');
if (!fs.existsSync(prebuilds)) process.exit(0);

for (const dir of fs.readdirSync(prebuilds)) {
  const helper = path.join(prebuilds, dir, 'spawn-helper');
  try { fs.chmodSync(helper, 0o755); } catch {}
}
