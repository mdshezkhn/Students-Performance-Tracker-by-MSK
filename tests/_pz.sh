#!/bin/bash
cd ~/spr-r3 || exit 1
python3 tests/_p12.py
for i in 1 2; do
  node tests/test-pair-open.js > /tmp/pz$i.log 2>&1
  echo "== run$i: $(grep -aE 'PASSED|FAILURES' /tmp/pz$i.log | tail -1)"
  grep -a 'lx-dbg' /tmp/pz$i.log | grep -o 'ELOG:.*' | cut -c1-720
done
