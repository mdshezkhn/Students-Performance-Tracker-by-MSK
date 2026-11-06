#!/bin/bash
# round8 gate (b): 10 device-sync runs WHILE another suite loops on the same
# 2 CPUs (contention on purpose).
REPO=${1:-/d/links-personal/links-personal/web/workspace/spr-repo}
cd "$REPO" || exit 1
OUT=docs/qa/round8/after-parallel.txt
echo "SPR round8 gate (b): device-sync x10 with a parallel suite on the same 2 CPUs" > $OUT
echo "Parallel load: tests/test-class-mode.js looping for the whole duration (+ any npm test tail)" >> $OUT
echo "" >> $OUT
# the load loop: keep a second suite running the whole time
( while true; do node tests/test-round5.js >/dev/null 2>&1; node tests/test-class-mode.js >/dev/null 2>&1; done ) &
LOAD=$!
trap "kill $LOAD 2>/dev/null" EXIT
pass=0; fail=0
for i in $(seq 1 10); do
  t0=$(date +%s)
  timeout 1200 node tests/test-device-sync.js > /tmp/r8-par-gate-$i.log 2>&1
  rc=$?
  el=$(( $(date +%s) - t0 ))
  if [ $rc -eq 0 ]; then res=PASS; pass=$((pass+1)); ff=-; else res=FAIL; fail=$((fail+1)); ff=$(grep -m1 '  FAIL:' /tmp/r8-par-gate-$i.log | sed 's/^  FAIL: //' | cut -c1-90); fi
  [ -z "$ff" ] && ff=-
  printf "run %-2s %-6s %-8s %s\n" $i $res $el "$ff" >> $OUT
  echo "gate-b run $i: $res ${el}s" >> /tmp/r8-after-progress.log
done
kill $LOAD 2>/dev/null
echo "" >> $OUT
echo "RESULT: $pass of 10 passed, $fail failed" >> $OUT
echo "gate-b done $(date +%H:%M:%S)"
