#!/bin/bash
# SPR round10 endurance gate — SERIAL ONLY (2-core laptop; Windows has no taskset,
# serial on 2 cores is equal or stricter than taskset -c 0,1)
cd "D:/links-personal/links-personal/web/workspace/spr-repo" || exit 9
HEAD=$(git rev-parse --short HEAD)
echo "=== ROUND10 MARATHON start $(date '+%F %T') head=$HEAD ==="

echo "--- A: full npm test x3 ---"
for i in 1 2 3; do
  npm test > /tmp/m10_chain_$i.log 2>&1
  echo "chain_$i exit=$? $(grep -E 'NPM-TEST-EXIT' /tmp/m10_chain_$i.log | tail -1)"
done

echo "--- B: owner-master x10 ---"
for i in $(seq 1 10); do
  node tests/test-owner-master.js > /tmp/m10_om_$i.log 2>&1
  echo "owner_$i exit=$? $(grep 'RESULT-LINE' /tmp/m10_om_$i.log | tail -1)"
done

echo "--- C: device-sync x30 ---"
for i in $(seq 1 30); do
  node tests/test-device-sync.js > /tmp/m10_ds_$i.log 2>&1
  echo "ds_$i exit=$? $(tail -2 /tmp/m10_ds_$i.log | grep -E 'ok|FAIL' | tail -1)"
done

echo "--- D: fresh clone of origin/round10 ($HEAD) + build byte-check + full chain ---"
R=/tmp/spr-verify-r10
rm -rf $R
git clone -q --depth 1 --branch round10 https://github.com/mdshezkhn/Students-Performance-Tracker-by-MSK $R
cd $R || exit 9
npm ci --include=dev --no-audit --no-fund > /tmp/m10_fc_ci.log 2>&1
echo "fc-npm-ci exit=$?"
python source/build2.py > /tmp/m10_fc_build.log 2>&1
echo "fc-build exit=$? CACHE=$(grep -o 'spr-app-shell-[a-f0-9]*' /tmp/m10_fc_build.log | head -1)"
git status --porcelain | head -5
git status --porcelain | wc -l | xargs echo "fc-dirty-files:"
npm test > /tmp/m10_fc_chain.log 2>&1
echo "fc-chain exit=$? $(grep -E 'NPM-TEST-EXIT' /tmp/m10_fc_chain.log | tail -1)"

echo "=== ROUND10 MARATHON done $(date '+%F %T') ==="
