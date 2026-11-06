#!/bin/bash
# round7 review: prove the sync-race fix with N consecutive passing runs.
# Runs happen in ONE fresh clone of origin/round7 (per the review wording),
# sequentially, each run counted. Any failure stops the count and reports.
N=${1:-30}
REPO=https://github.com/mdshezkhn/Students-Performance-Tracker-by-MSK.git
DIR=/tmp/proof-sync
git clone -q --depth 1 -b round7 "$REPO" "$DIR" 2>/dev/null || { echo "clone failed"; exit 2; }
cd "$DIR" || exit 2
npm ci --include=dev --no-audit --no-fund >/dev/null 2>&1 || { echo "npm ci failed"; exit 2; }
pass=0
for i in $(seq 1 "$N"); do
  if node tests/test-device-sync.js > "$DIR/run-$i.log" 2>&1; then
    pass=$((pass+1)); echo "run-$i PASS ($pass/$N)"
  else
    echo "run-$i FAIL at $pass/$N consecutive passes"
    echo "--- failures:"; grep "FAIL" "$DIR/run-$i.log"
    exit 1
  fi
done
echo "PROOF: $pass/$N consecutive passing runs (fresh clone $DIR)"
