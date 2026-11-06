#!/bin/bash
# round9 fresh-clone gate: run AFTER pushing round9.
# Clones origin/round9 into a scratch dir, npm ci, full tests once,
# then rebuild and require byte-identical built files.
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${1:-$R/.freshclone}"
rm -rf "$WORK"
git clone -q -c core.autocrlf=input -b round9 "$(git -C "$R" remote get-url origin)" "$WORK" || exit 1
cd "$WORK" || exit 1
echo "== clone: $(git log --oneline -1)"
npm ci --include=dev > /tmp/fc-npmci.log 2>&1 || { echo "NPM-CI FAILED"; tail -5 /tmp/fc-npmci.log; exit 1; }
echo "== npm ci ok"
npm test > /tmp/fc-npmtest.log 2>&1; e=$?
echo "npm test exit=$e (last lines below)"
tail -4 /tmp/fc-npmtest.log
[ $e -eq 0 ] || exit 1
python source/build2.py --force > /tmp/fc-build.log 2>&1 || { echo "BUILD FAILED"; exit 1; }
ok=1
for f in index.html app/index.html app/sw.js; do
  if ! cmp -s "$f" "deploy/${f#app/}" 2>/dev/null && ! cmp -s "$f" "deploy/$f" 2>/dev/null; then
    if ! cmp -s "$WORK/$f" "$R/$f"; then echo "DIFFERS: $f"; ok=0; fi
  fi
done
# direct comparison against the pushed working tree (build2 wrote deploy/)
cmp -s "$WORK/app/index.html" "$R/app/index.html" || { echo "DIFFERS: app/index.html"; ok=0; }
cmp -s "$WORK/app/sw.js" "$R/app/sw.js" || { echo "DIFFERS: app/sw.js"; ok=0; }
cmp -s "$WORK/index.html" "$R/index.html" || { echo "DIFFERS: index.html"; ok=0; }
[ $ok -eq 1 ] && echo "FRESHCLONE GATE PASSED (byte-identical build)" || exit 1
