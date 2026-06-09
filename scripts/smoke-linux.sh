#!/usr/bin/env bash
# scripts/smoke-linux.sh — Run the forge Linux smoke test in a Multipass VM.
#
# Spins up a fresh Ubuntu LTS VM via Multipass, copies the local forge
# checkout into it, runs `forge install` / status checks / `forge uninstall`,
# then deletes the VM on exit.
#
# Requires Multipass (brew install multipass).
#
# Usage:
#   scripts/smoke-linux.sh                # cleanup: delete VM (default)
#   scripts/smoke-linux.sh --purge-cache  # also remove the cached LTS image (needs sudo)
#   scripts/smoke-linux.sh --keep         # leave the VM running for debugging
#
# Cleanup behavior:
#   - VM is always deleted on exit (delete --purge) unless --keep is passed.
#   - Cached Ubuntu image (a few hundred MB) is left in place so re-runs are fast.
#     Pass --purge-cache to wipe it (requires sudo).
#   - Multipass itself is not touched.

set -euo pipefail

PURGE_CACHE=0
KEEP_VM=0
for arg in "$@"; do
  case "$arg" in
    --purge-cache) PURGE_CACHE=1 ;;
    --keep)        KEEP_VM=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

VM_NAME="forge-smoke-$$"

if ! command -v multipass >/dev/null 2>&1; then
  echo "multipass is not installed. Install with: brew install multipass" >&2
  exit 1
fi

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  local rc=$?
  if (( KEEP_VM )); then
    echo
    echo "VM kept for debugging: $VM_NAME"
    echo "  multipass shell $VM_NAME    # enter the VM"
    echo "  multipass delete $VM_NAME --purge  # remove when done"
    return $rc
  fi
  echo
  echo "Cleaning up VM $VM_NAME..."
  multipass delete "$VM_NAME" --purge >/dev/null 2>&1 || true
  if (( PURGE_CACHE )); then
    echo "Purging cached multipass images (sudo)..."
    sudo rm -rf "$HOME/Library/Application Support/multipass/data/multipassd/vault/blobs"/* 2>/dev/null || true
  fi
  return $rc
}
trap cleanup EXIT

echo "→ Launching Ubuntu LTS VM ($VM_NAME)..."
multipass launch lts --name "$VM_NAME" --memory 2G --disk 8G --cpus 2

echo "→ Copying forge repo into VM..."
( cd "$REPO_ROOT" && tar --exclude=node_modules \
                          --exclude=.git \
                          --exclude=web/node_modules \
                          --exclude=web/dist \
                          --exclude=coverage \
                          --exclude='.tmp-*' \
                          -czf - . ) \
  | multipass exec "$VM_NAME" -- bash -c 'mkdir -p ~/forge && tar -xzf - -C ~/forge'

echo "→ Running smoke test inside VM (this will take ~60-90s)..."
multipass exec "$VM_NAME" -- bash -seu <<'SMOKE_EOF'
# Install Node 22 + build deps for node-pty
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - >/dev/null
sudo apt-get install -y nodejs build-essential >/dev/null

cd ~/forge
npm install --no-audit --no-fund >/dev/null

# Make `forge` globally available
sudo npm link >/dev/null

PASS=0
FAIL=0
check() {
  local label="$1"; shift
  if "$@"; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label (exit $?)"
    FAIL=$((FAIL + 1))
  fi
}

echo
echo "── forge install ──"
forge install
echo

echo "── checks ──"
check "unit file exists at ~/.config/systemd/user/forge.service" \
  test -f "$HOME/.config/systemd/user/forge.service"
check "service is active" \
  bash -c 'systemctl --user is-active --quiet forge.service'
check "service is enabled" \
  bash -c 'systemctl --user is-enabled --quiet forge.service'
check "forge version succeeds (CLI + daemon match)" \
  bash -c 'forge version | grep -qiE "matching|0\\."'

echo
echo "── idempotent re-install ──"
forge install
check "service still active after re-install" \
  bash -c 'systemctl --user is-active --quiet forge.service'

echo
echo "── forge uninstall ──"
forge uninstall

echo
echo "── cleanup checks ──"
check "unit file is gone" \
  bash -c '! test -f "$HOME/.config/systemd/user/forge.service"'
check "service is inactive" \
  bash -c '! systemctl --user is-active --quiet forge.service'

echo
echo "── summary ──"
echo "passed: $PASS"
echo "failed: $FAIL"
exit $FAIL
SMOKE_EOF

result=$?
echo
if [[ $result -eq 0 ]]; then
  echo "✓ Linux smoke test passed"
else
  echo "✗ Linux smoke test failed (exit $result)"
fi
exit $result
