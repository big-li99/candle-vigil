#!/bin/bash
# M2a run: six spells, four enemies, six slots. Detached; writes tasks/m2a.json + tasks/m2a.err
set -u
cd "$HOME/apps/candle-vigil" || exit 1
export PATH="$HOME/.local/bin:$PATH"

for f in src/systems/spells.js src/entities/enemy.js src/ui/hud.js; do
  [ -f "$f" ] || { echo "PREFLIGHT FAIL: $f missing" > tasks/m2a.err; exit 2; }
done

git checkout -q main && git checkout -q -B feat/m2a main || exit 1
claude -p "$(cat tasks/M2a.md)" \
  --permission-mode acceptEdits \
  --allowedTools "Read,Grep,Glob,Edit,Write,Bash(npm *),Bash(git add *),Bash(git commit *),Bash(git status),Bash(git diff *),Bash(node *)" \
  --max-turns 150 \
  --output-format json > tasks/m2a.json 2> tasks/m2a.err
echo "EXIT=$?" >> tasks/m2a.err
