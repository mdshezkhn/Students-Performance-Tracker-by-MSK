#!/bin/bash
# round-3 fresh-clone proof — run from the repo root of a FRESH clone
cd ~/spr-r3 || exit 1
echo "== HEAD: $(git log --oneline -1)"
echo "== build (guard included) =="
python3 source/build2.py 2>&1 | grep 'sw version'
cmp --silent dist/app/index.html app/index.html && echo "CMP app/index.html OK"
cmp --silent dist/app/sw.js app/sw.js && echo "CMP app/sw.js OK"
cmp --silent dist/index.html index.html && echo "CMP index.html (landing) OK"
echo "== jsdom suites =="
for t in test-device-sync test-class-mode test-classes-escape test-pair-open test-simple-ui test-blocker-migrated-admin; do
  echo "== $t"
  node tests/$t.js 2>&1 | tail -1
done
echo "== node-only suites =="
echo "== completeness"; node tests/completeness.test.js 2>&1 | tail -1
echo "== calc-regression"; node tests/calc-regression.test.js 2>&1 | tail -1
echo "== excel-import"; node tests/excel-import.test.js 2>&1 | tail -1
echo "== classstore"; node tests/classstore.test.js 2>&1 | tail -1
