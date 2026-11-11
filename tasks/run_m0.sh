#!/bin/bash
# M0 run: skeleton. Launched detached; writes tasks/m0.json + tasks/m0.log
cd "$HOME/apps/candle-vigil" || exit 1
export PATH="$HOME/.local/bin:$PATH"
git checkout -q feat/m0 2>/dev/null || git checkout -q -b feat/m0
claude -p "$(cat tasks/M0.md)" \
  --permission-mode acceptEdits \
  --allowedTools "Read,Grep,Glob,Edit,Write,Bash(npm *)" \
  --max-turns 80 \
  --output-format json > tasks/m0.json 2> tasks/m0.err
echo "EXIT=$?" >> tasks/m0.err
