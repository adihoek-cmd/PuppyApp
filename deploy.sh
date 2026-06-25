#!/usr/bin/env bash
# Puppy Log — push to GitHub + serve on GitHub Pages.
#
# Run this from the folder that holds index.html, the icons, and manifest.webmanifest.
# Do the Firebase steps in README.md FIRST and paste your config into index.html,
# otherwise the live app will just show the "Almost there" setup screen.
#
# One-time prerequisites:
#   - git              (https://git-scm.com)
#   - GitHub CLI "gh"  (https://cli.github.com)  then run:  gh auth login
#
# Usage:   ./deploy.sh            (repo name defaults to "puppy-log")
#          ./deploy.sh my-name    (custom repo name)

set -euo pipefail
REPO="${1:-puppy-log}"

if ! command -v gh >/dev/null; then
  echo "GitHub CLI not found. Install it from https://cli.github.com then run: gh auth login"
  exit 1
fi

git init -q 2>/dev/null || true
git add -A
git commit -qm "Puppy Log" || echo "(nothing new to commit)"
git branch -M main

# Creates the repo under your account and pushes. If it already exists, just push.
if gh repo view "$REPO" >/dev/null 2>&1; then
  git remote add origin "$(gh repo view "$REPO" --json url -q .url).git" 2>/dev/null || true
  git push -u origin main
else
  gh repo create "$REPO" --public --source=. --remote=origin --push \
    --description "Shared family puppy log"
fi

USER="$(gh api user -q .login)"
echo
echo "Pushed to https://github.com/$USER/$REPO"
echo
echo "LAST STEP (one click): GitHub > the repo > Settings > Pages"
echo "  Source: Deploy from a branch   Branch: main   Folder: / (root)   Save"
echo
echo "Your app will be live in ~1 min at:  https://$USER.github.io/$REPO/"
