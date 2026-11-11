#!/bin/bash
# Publish candle-vigil to GitHub Pages. Idempotent: reuses the repo if it already exists.
set -eu
cd "$HOME/apps/candle-vigil"

tok=$(sed -E "s#https://([^:]+):([^@]+)@github.com.*#\2#" "$HOME/.git-credentials" | grep -v '^https' | head -1)
owner=$(sed -E "s#https://([^:]+):([^@]+)@github.com.*#\1#" "$HOME/.git-credentials" | grep -v '^https' | head -1)
echo "owner=$owner"

# 1. create the repo (409/422 = already there)
code=$(curl -s -o /tmp/gh_create.json -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $tok" -H 'Accept: application/vnd.github+json' \
  https://api.github.com/user/repos \
  -d '{"name":"candle-vigil","description":"Candlelight Vigil — a single-screen pixel action game built on pixelfx (MIT)","private":false,"has_issues":true,"has_wiki":false,"auto_init":false}')
echo "create -> HTTP $code"
sed -n 's/.*"full_name": *"\([^"]*\)".*/full_name=\1/p' /tmp/gh_create.json | head -1
sed -n 's/.*"message": *"\([^"]*\)".*/message=\1/p' /tmp/gh_create.json | head -1

# 2. push main + gh-pages (credential helper 'store' supplies the token)
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$owner/candle-vigil.git"
git push -q -u origin main
git push -q -f origin gh-pages
echo "pushed: $(git ls-remote origin refs/heads/main refs/heads/gh-pages | tr '\n' ' ')"

# 3. turn Pages on (409 = already enabled)
pcode=$(curl -s -o /tmp/gh_pages.json -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $tok" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$owner/candle-vigil/pages" \
  -d '{"source":{"branch":"gh-pages","path":"/"}}')
echo "pages -> HTTP $pcode"
cat /tmp/gh_pages.json | head -c 400; echo

# 4. read the published URL back
curl -s -H "Authorization: Bearer $tok" "https://api.github.com/repos/$owner/candle-vigil/pages" \
  | sed -n 's/.*"html_url": *"\([^"]*\)".*/html_url=\1/p' | head -1
rm -f /tmp/gh_create.json /tmp/gh_pages.json
