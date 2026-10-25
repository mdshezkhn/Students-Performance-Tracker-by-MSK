#!/bin/bash
# loop pair-open 3x on the fresh Linux clone, keep logs, report failures + probe values
cd ~/spr-r3 || exit 1
for i in 1 2 3; do
  node tests/test-pair-open.js > /tmp/poL$i.log 2>&1
  res=$(grep -aE 'PASSED|FAILURES' /tmp/poL$i.log | tail -1)
  echo "== run$i: $res"
  if echo "$res" | grep -q FAILURES; then
    grep -a 'lx-dbg' /tmp/poL$i.log | cut -c1-700
    grep -a '  FAIL' /tmp/poL$i.log
  fi
done
