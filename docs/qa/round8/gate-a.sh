#!/bin/bash
# round8 gate (a): 30 consecutive device-sync runs, 2 CPUs, nothing else running.
# This laptop IS 2-core (i5-6300U, 2C/4T) — no taskset needed; serial, quiet box.
# Usage: gate-a.sh [repo-dir]   (default = working repo; the evidence run used a
# fresh clone of branch round8, see REPORT.md)
REPO=${1:-/d/links-personal/links-personal/web/workspace/spr-repo}
cd "$REPO" || exit 1
OUT=docs/qa/round8/after.txt
echo "SPR round8 AFTER: test-device-sync.js, 30 consecutive runs (fix applied)" > $OUT
echo "Machine: home laptop DESKTOP-FUMPBJ9, i5-6300U (2 cores / 4 threads), Windows + Git Bash node v24.14.1, nothing else running" >> $OUT
echo "" >> $OUT
printf "%-4s %-6s %-8s %s\n" run result secs first_fail >> $OUT
pass=0; fail=0
# daytime-use guard: this evidence must come from an idle box. Before each run,
# wait (up to 10 min) until the OS reports <60% CPU for 3 consecutive samples.
# This does not skip or weaken anything — it only avoids STARTING a run into a
# busy minute (mid-afternoon user activity skewed runs 13-14 of a previous try).
wait_idle() {
  local ok=0 waited=0 l
  while [ $ok -lt 3 ] && [ $waited -lt 600 ]; do
    l=$(wmic cpu get loadpercentage 2>/dev/null | grep -oE '[0-9]+' | head -1)
    [ -n "$l" ] && [ "$l" -lt 60 ] && ok=$((ok+1)) || ok=0
    sleep 2; waited=$((waited+2))
  done
}
for i in $(seq 1 30); do
  wait_idle
  t0=$(date +%s)
  timeout 900 node tests/test-device-sync.js > /tmp/r8-after-$i.log 2>&1
  rc=$?
  el=$(( $(date +%s) - t0 ))
  if [ $rc -eq 0 ]; then res=PASS; pass=$((pass+1)); ff=-; else res=FAIL; fail=$((fail+1)); ff=$(grep -m1 '  FAIL:' /tmp/r8-after-$i.log | sed 's/^  FAIL: //' | cut -c1-90); fi
  [ -z "$ff" ] && ff=-
  printf "%-4s %-6s %-8s %s\n" $i $res $el "$ff" >> $OUT
  echo "run $i: $res ${el}s" >> /tmp/r8-after-progress.log
done
echo "" >> $OUT
echo "RESULT: $pass of 30 passed, $fail failed, 0 SKIP" >> $OUT
echo "gate-a done $(date +%H:%M:%S)"
