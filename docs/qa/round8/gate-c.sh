#!/bin/bash
# round8 gate (c): npm ci --include=dev, then npm test (16 suites) three times.
REPO=${1:-/d/links-personal/links-personal/web/workspace/spr-repo}
cd "$REPO" || exit 1
OUT=docs/qa/round8/npmtest.txt
echo "SPR round8 gate (c): npm ci --include=dev && npm test, three times in a row" > $OUT
echo "repo: $REPO (fresh clone of branch round8)" >> $OUT
echo "" >> $OUT
echo "== npm ci --include=dev ==" >> $OUT
npm ci --include=dev >> $OUT 2>&1
CI_RC=$?
echo "npm ci exit=$CI_RC" >> $OUT
echo "" >> $OUT
for n in 1 2 3; do
  echo "== npm test (run $n) ==" >> $OUT
  npm test > /tmp/r8-npmtest-$n.log 2>&1
  rc=$?
  echo "run $n exit=$rc" >> $OUT
  tail -3 /tmp/r8-npmtest-$n.log >> $OUT
  echo "" >> $OUT
done
echo "== last line of every suite (each suite standalone, after the 3 npm test runs) ==" >> $OUT
for s in completeness.test calc-regression.test excel-import.test classstore.test test-help-security test-data-safety test-notices test-round5 test-round6 test-round7 test-load test-simple-ui test-class-mode test-device-sync test-classes-escape test-pair-open; do
  node "tests/$s.js" > "/tmp/r8-suite-$s.log" 2>&1
  rc=$?
  last=$(grep -v '^\s*$' "/tmp/r8-suite-$s.log" | tail -1)
  printf '%-24s exit=%s  %s\n' "$s" "$rc" "$last" >> $OUT
done
echo "gate-c done $(date +%H:%M:%S)"
