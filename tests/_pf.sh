#!/bin/bash
cd ~/spr-r3 || exit 1
for i in 1 2 3; do
  node tests/test-pair-open.js > /tmp/pf$i.log 2>&1
  echo "run$i: $(grep -aE 'PASSED|FAILURES' /tmp/pf$i.log | tail -1)"
done
