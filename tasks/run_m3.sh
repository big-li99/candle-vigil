#!/bin/bash
# M3 run: sound, readability, feel tuning. Detached; writes tasks/m3.json + tasks/m3.err
set -u
cd "$HOME/apps/candle-vigil" || exit 1
export PATH="$HOME/.local/bin:$PATH"

for f in src/game.js src/systems/waves.js src/entities/boss.js; do
  [ -f "$f" ] || { echo "PREFLIGHT FAIL: $f missing" > tasks/m3.err; exit 2; }
done
grep -q "boss" src/debug.js || { echo "PREFLIGHT FAIL: debug.js has no boss hooks (M2c not merged)" > tasks/m3.err; exit 2; }

git checkout -q main && git checkout -q -B feat/m3 main || exit 1
claude -p "$(cat tasks/M3.md)" \
  --permission-mode acceptEdits \
  --allowedTools "Read,Grep,Glob,Edit,Write,Bash(npm *),Bash(git add *),Bash(git commit *),Bash(git status),Bash(git diff *),Bash(node *)" \
  --max-turns 150 \
  --output-format json > tasks/m3.json 2> tasks/m3.err
echo "EXIT=$?" >> tasks/m3.err
