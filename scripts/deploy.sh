#!/usr/bin/env bash
# Publish this folder to its public repository, served by GitHub Pages.
# Usage: scripts/deploy.sh "commit message"
# The remote can be overridden with RT_REMOTE.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${RT_REMOTE:-https://github.com/SamirSaidani/auguste.git}"

# Over HTTPS, let the GitHub CLI provide credentials for this run only (no global git config change).
if [[ "$REMOTE" == https://* ]] && command -v gh >/dev/null; then
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0='!gh auth git-credential'
fi
MESSAGE="${1:-Update}"

command -v rsync >/dev/null || { echo "rsync is required" >&2; exit 1; }

node --test "$HERE/tests/run-tests.js"

# Audit: no absolute home paths and no secret values in published files.
# Looks for values (token formats, private keys, literal assignments), not for words like "password".
AUDIT='/home/|/Users/|BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|glpat-|\b[0-9a-f]{40}\b|(password|secret|token|api[_-]?key)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{8,}'
if grep -rnIE "$AUDIT" "$HERE" \
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
