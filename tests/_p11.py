import io

p = 'tests/test-pair-open.js'
s = io.open(p, encoding='utf-8').read()

# replace the whole lx-dbg tail with a compact one ending in the ordered log
i = s.find("      if (!opened) {")
j = s.find("        check(opened, 'after reload the class auto-opens'")
assert i > 0 and j > i
new_block = """      if (!opened) {
        console.log('  [lx-dbg] hash:', C.w.location.hash,
          '| sess:', (function(){ var x = JSON.parse(C.w.sessionStorage.getItem('spr-session') || 'null'); return x ? ('user=' + x.user + ' keys=' + Object.keys(x.keys || {}).length) : 'none'; })(),
          '| restored:', C.w.__SPR_SESSION_RESTORED || 'NO',
          '| ELOG:', (C.w.__ELOG || []).join(' | ').slice(-900));
      }
"""
s = s[:i] + new_block + s[j:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('compact lx-dbg in')
