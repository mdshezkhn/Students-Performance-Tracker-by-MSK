#!/bin/bash
# round9 full gate chain: fresh clone -> npm ci --include=dev -> npm test x3
# -> build byte-identical -> device-sync 30x pinned to 2 cores (Windows affinity).
set -u
R="/d/links-personal/links-personal/web/workspace/spr-repo"
echo "=== STAGE 1: fresh clone + npm ci --include=dev + npm test #1 + byte-identical ==="
bash "$R/qa/round9_freshclone.sh" || { echo "STAGE1 FAILED"; exit 1; }
FC="$R/.freshclone"
cd "$FC" || { echo "no clone dir"; exit 1; }
echo "node_modules pglite present: $(ls node_modules/@electric-sql 2>/dev/null || echo NO)"
for n in 2 3; do
  echo "=== STAGE 2.$n: npm test run #$n ==="
  npm test > "/tmp/fc-npm-$n.log" 2>&1 && echo "RUN$n exit=0" || { echo "RUN$n FAILED"; grep -h FAIL "/tmp/fc-npm-$n.log" | head -5; exit 1; }
done
echo "=== STAGE 3: device-sync 30x on 2 cores (affinity mask 3) ==="
ok=0; bad=0
for i in $(seq 1 30); do
  powershell -NoProfile -Command "\$p = Start-Process -FilePath node -ArgumentList 'tests/test-device-sync.js' -WorkingDirectory '.' -RedirectStandardOutput 'ds-out.tmp' -RedirectStandardError 'ds-err.tmp' -NoNewWindow -PassThru; \$p.ProcessorAffinity = 3; Wait-Process -Id \$p.Id; \$p.Refresh(); exit \$p.ExitCode" >/dev/null 2>&1
  rc=$?
  if [ $rc -eq 0 ] && grep -q "PASSED" ds-out.tmp 2>/dev/null; then
    ok=$((ok+1)); printf 'run %02d ok\n' "$i"
  else
    bad=$((bad+1)); echo "run $i FAILED rc=$rc"; tail -4 ds-out.tmp 2>/dev/null
  fi
done
echo "DEVICE-SYNC 30x: ok=$ok fail=$bad"
[ $bad -eq 0 ] && echo "ALL GATES GREEN" || exit 1
