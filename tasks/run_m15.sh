#!/bin/bash
# M1.5 run: feel fixes. Detached; writes tasks/m15.json + tasks/m15.err
cd "$HOME/apps/candle-vigil" || exit 1
export PATH="$HOME/.local/bin:$PATH"
git checkout -q main && git checkout -q -B feat/m15 main
claude -p "$(cat tasks/M15.md)" \
  --permission-mode acceptEdits \
  --allowedTools "Read,Grep,Glob,Edit,Write,Bash(npm *),Bash(git add *),Bash(git commit *),Bash(git status),Bash(git diff *),Bash(node *)" \
  --max-turns 90 \
  --output-format json > tasks/m15.json 2> tasks/m15.err
echo "EXIT=$?" >> tasks/m15.err
