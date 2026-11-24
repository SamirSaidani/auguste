#!/usr/bin/env bash
# Publish this folder to its public repository, served by GitHub Pages.
# Usage: scripts/deploy.sh "commit message"
# The remote can be overridden with RT_REMOTE.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${RT_REMOTE:-https://github.com/SamirSaidani/rhythm-trainer.git}"

# Over HTTPS, let the GitHub CLI provide credentials for this run only (no global git config change).
if [[ "$REMOTE" == https://* ]] && command -v gh >/dev/null; then
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0='!gh auth git-credential'
fi
MESSAGE="${1:-Update}"

command -v rsync >/dev/null || { echo "rsync is required" >&2; exit 1; }

node --test "$HERE/tests/run-tests.js"

# Audit: no absolute home paths, credentials or private hosts in published files.
if grep -rnIE "/home/|/Users/|api[_-]?key|secret|password|token=|BEGIN [A-Z ]*PRIVATE KEY" "$HERE" \
    --exclude-dir=.git --exclude=deploy.sh; then
  echo "Audit failed: remove the lines above before publishing." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git clone --quiet "$REMOTE" "$WORK/repo"
rsync -a --delete --exclude .git "$HERE/" "$WORK/repo/"
cd "$WORK/repo"
git add -A
if git diff --cached --quiet; then
  echo "Nothing to publish."
  exit 0
fi
git commit --quiet -m "$MESSAGE"
git push --quiet origin HEAD:main
echo "Published to $REMOTE"
