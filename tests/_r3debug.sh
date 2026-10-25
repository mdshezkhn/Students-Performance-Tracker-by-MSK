#!/bin/bash
# patch the pair-open lx-dbg on the LINUX clone (exact local content), then loop 3x
cd ~/spr-r3 || exit 1
python3 - <<'PYEOF'
import io
p = 'tests/test-pair-open.js'
s = io.open(p, encoding='utf-8').read()
i = s.find('      if (!opened) {')
j = s.find("        check(opened,", i)
assert i > 0 and j > i, (i, j)
new_block = """      if (!opened) {
        console.log('  [lx-dbg] hash:', C.w.location.hash,
          '| restored:', C.w.__SPR_SESSION_RESTORED || 'NO',
          '| ELOG:', (C.w.__ELOG || []).join(' | ').slice(-900));
      }
"""
s = s[:i] + new_block + s[j:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('patched on linux clone')
PYEOF
for i in 1 2 3; do
  node tests/test-pair-open.js > /tmp/poe$i.log 2>&1
  res=$(grep -aE 'PASSED|FAILURES' /tmp/poe$i.log | tail -1)
  echo "== run$i: $res"
  if echo "$res" | grep -q FAILURES; then
    grep -a 'lx-dbg' /tmp/poe$i.log | cut -c1-900
  fi
done
