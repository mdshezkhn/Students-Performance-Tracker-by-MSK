import io

p = 'app/index.html'
s = io.open(p, encoding='utf-8').read()
anchor = "  function route() {"
if "__ELOG" not in s:
    helper = "  window.__ELOG = window.__ELOG || [];\n  function __elog(m) { try { window.__ELOG.push(m + '@' + (Date.now() % 100000)); } catch (e) {} }\n"
    s = s.replace(anchor, helper + anchor, 1)
old2 = "              } catch (e3) { CLS = null; CLS_KEY = null; }"
assert s.count(old2) == 1
s = s.replace(old2, "              } catch (e3) { __elog('open-err ' + (e3 && e3.message || e3)); CLS = null; CLS_KEY = null; }")
old3 = "              ui.classOpen = true;\n              try { history.replaceState"
assert s.count(old3) == 1
s = s.replace(old3, "              ui.classOpen = true; __elog('cls-else hash=' + location.hash);\n              try { history.replaceState")
old4 = "          ready = true;\n          try { window.__SPR_SESSION_RESTORED = sess.user; } catch (e5) {}"
assert s.count(old4) == 1
s = s.replace(old4, "          ready = true; __elog('restored-set');\n          try { window.__SPR_SESSION_RESTORED = sess.user; } catch (e5) {}")
old5 = "    if (document.body.classList.contains('auth-gate')) return;\n    killCharts(); closeDlg();"
assert s.count(old5) == 1
s = s.replace(old5, "    __elog('route ' + location.hash + ' cls=' + (CLS && CLS.id || 'null'));\n    if (document.body.classList.contains('auth-gate')) return;\n    killCharts(); closeDlg();")
old6 = "closeClass(); return; }"
assert s.count(old6) >= 1
s = s.replace(old6, "closeClass(); __elog('CLOSE-CLASS'); return; }", 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('probes in')
