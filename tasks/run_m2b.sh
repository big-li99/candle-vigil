#!/bin/bash
# M2b run: waves, upgrades, block. Detached; writes tasks/m2b.json + tasks/m2b.err
set -u
cd "$HOME/apps/candle-vigil" || exit 1
export PATH="$HOME/.local/bin:$PATH"

for f in src/systems/spells.js src/entities/enemy.js src/ui/hud.js src/game.js; do
  [ -f "$f" ] || { echo "PREFLIGHT FAIL: $f missing" > tasks/m2b.err; exit 2; }
done
grep -q '"nova"' src/systems/spells.js || { echo "PREFLIGHT FAIL: spells.js has no nova (M2a not merged into base)" > tasks/m2b.err; exit 2; }

git checkout -q main && git checkout -q -B feat/m2b main || exit 1
claude -p "$(cat tasks/M2b.md)" \
  --permission-mode acceptEdits \
  --allowedTools "Read,Grep,Glob,Edit,Write,Bash(npm *),Bash(git add *),Bash(git commit *),Bash(git status),Bash(git diff *),Bash(node *)" \
  --max-turns 150 \
  --output-format json > tasks/m2b.json 2> tasks/m2b.err
echo "EXIT=$?" >> tasks/m2b.err
