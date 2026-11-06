#!/bin/bash
# reproduction: N runs of the device-sync suite under load (the way the
# reviewer did it: parallel lanes + another suite looping in the background).
# Usage: bash tests/repro-sync-race.sh <runs> <lanes> <tag>
RUNS=${1:-20}
LANES=${2:-3}
TAG=${3:-before}
OUT=/tmp/repro-$TAG
rm -rf "$OUT"; mkdir -p "$OUT"

# load generator: another suite looping for the whole window
( end=$((SECONDS + RUNS/LANES*380 + 600));
  while [ $SECONDS -lt $end ]; do
    node tests/test-class-mode.js >/dev/null 2>&1
    node tests/test-simple-ui.js >/dev/null 2>&1
  done ) &
LOAD_PID=$!

run_lane() {
  local lane=$1
  local n=0
  while [ $n -lt $RUNS ]; do
    if [ $(( n % LANES )) -eq $lane ]; then
      SPR_RUN_RACY_S8=1 node tests/test-device-sync.js > "$OUT/run-$n.log" 2>&1
      echo "run-$n exit=$?" >> "$OUT/exits.txt"
    fi
    n=$((n+1))
  done
}
for ((l=0; l<LANES; l++)); do run_lane $l & done
wait $LOAD_PID 2>/dev/null
wait

echo "== $TAG: $RUNS runs, $LANES lanes, load suite in parallel =="
echo "passes: $(grep -c 'exit=0' "$OUT/exits.txt") / $RUNS"
echo "-- failing checks (count across runs):"
grep -h "FAIL:" "$OUT"/run-*.log | sort | uniq -c | sort -rn
