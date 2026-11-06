#!/bin/bash
# round8 phase 2: induce the failure with 4 parallel copies on 2 CPUs (the
# prompt's fallback when serial runs do not reproduce). Trace ON. One round.
cd /d/links-personal/links-personal/web/workspace/spr-repo
OUT=docs/qa/round8/before.txt
echo "" >> $OUT
echo "Phase 2 — 4 copies in parallel on the same 2 CPUs (load induction; SPR_DS_TRACE=1; one round):" >> $OUT
pids=""
for j in 1 2 3 4; do
  SPR_DS_TRACE=1 timeout 1500 node tests/test-device-sync.js > /tmp/r8-par-1-$j.log 2>&1 &
  pids="$pids $!"
done
for p in $pids; do wait $p; done
for j in 1 2 3 4; do
  ff=$(grep -m1 '  FAIL:' /tmp/r8-par-1-$j.log | sed 's/^  FAIL: //' | cut -c1-90)
  [ -z "$ff" ] && ff=-
  pass=$(grep -c 'ALL DEVICE-SYNC CHECKS PASSED' /tmp/r8-par-1-$j.log)
  fails=$(grep -c '  FAIL:' /tmp/r8-par-1-$j.log)
  echo "copy $j: $( [ "$pass" = "1" ] && echo PASS || echo FAIL )  fails=$fails  first=$ff" >> $OUT
done
echo "phase2 done $(date +%H:%M:%S)"
