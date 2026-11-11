#!/bin/bash
# M2c run: boss, run end states, best record. Detached; writes tasks/m2c.json + tasks/m2c.err
set -u
cd "$HOME/apps/candle-vigil" || exit 1
export PATH="$HOME/.local/bin:$PATH"

for f in src/systems/waves.js src/systems/upgrades.js src/game.js; do
  [ -f "$f" ] || { echo "PREFLIGHT FAIL: $f missing" > tasks/m2c.err; exit 2; }
done
grep -q "waveState" src/game.js || { echo "PREFLIGHT FAIL: game.js has no waveState (M2b not merged into base)" > tasks/m2c.err; exit 2; }

git checkout -q main && git checkout -q -B feat/m2c main || exit 1
claude -p "$(cat tasks/M2c.md)" \
  --permission-mode acceptEdits \
  --allowedTools "Read,Grep,Glob,Edit,Write,Bash(npm *),Bash(git add *),Bash(git commit *),Bash(git status),Bash(git diff *),Bash(node *)" \
  --max-turns 160 \
  --output-format json > tasks/m2c.json 2> tasks/m2c.err
echo "EXIT=$?" >> tasks/m2c.err
