#!/bin/bash
# Build the static bundle and refresh the `gh-pages` branch with just what a browser needs.
# Usage: bash tools/pack-pages.sh
set -eu
cd "$(dirname "$0")/.."

npm run build >/dev/null

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp index.html "$stage/"
mkdir -p "$stage/dist"
cp dist/game.js "$stage/dist/"
touch "$stage/.nojekyll"

index=$(mktemp)
rm -f "$index"
GIT_INDEX_FILE="$index" git --work-tree="$stage" add -A
tree=$(GIT_INDEX_FILE="$index" git write-tree)
commit=$(git commit-tree "$tree" -m "pages: build $(date -u +%Y-%m-%dT%H:%MZ)")
git branch -f gh-pages "$commit"
rm -f "$index"

echo "gh-pages -> $commit  ($(du -h dist/game.js | cut -f1) bundle)"
echo
echo "Publish it with (one line, after you create the repo on GitHub):"
echo "  git remote add origin git@github.com:<you>/candle-vigil.git"
echo "  git push -u origin main && git push -f origin gh-pages"
echo "  # then: Settings → Pages → Source: branch gh-pages, folder /"
