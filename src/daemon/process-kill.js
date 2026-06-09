// src/daemon/process-kill.js
const treeKill = require('tree-kill');

function killProcessTree(record, platform = process.platform, signal = 'SIGTERM') {
  if (!record?.pid) return;
  if (platform === 'win32') {
    // tree-kill internally uses taskkill /T /F on Windows. The signal arg is
    // largely cosmetic there — Windows always sends a forceful kill.
    treeKill(record.pid, 'SIGKILL', () => {});
    return;
  }
  try { process.kill(-record.pid, signal); } catch {}
}

function isProcessTreeAlive(pid, platform = process.platform) {
  if (platform === 'win32') {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }
  try { process.kill(-pid, 0); return true; } catch { return false; }
}

async function waitForProcessTreeDead(pid, timeoutMs = 2000, platform = process.platform) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessTreeAlive(pid, platform)) return;
    await new Promise(r => setTimeout(r, 50));
  }
}

module.exports = { killProcessTree, isProcessTreeAlive, waitForProcessTreeDead };
