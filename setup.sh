#!/usr/bin/env sh

set -eu

fail() {
  printf '%s\n' "Blawx setup failed: $*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js 22 is required, but node was not found."

node_major=$(node -p "process.versions.node.split('.')[0]") || fail "Could not read the Node.js version."
[ "$node_major" = "22" ] || fail "Node.js 22 is required; found $(node --version)."

command -v npm >/dev/null 2>&1 || fail "npm is required, but it was not found."

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || fail "Could not resolve the repository directory."
cd "$script_dir" || fail "Could not enter the repository directory."

[ -f package-lock.json ] || fail "package-lock.json is missing; refusing an unpinned install."

printf '%s\n' "Installing the pinned dependency tree with lifecycle scripts disabled..."
npm ci --ignore-scripts --no-audit --no-fund || fail "npm ci did not complete."

printf '%s\n' "Setup complete. Run 'npm run dev' to start the local demo."
