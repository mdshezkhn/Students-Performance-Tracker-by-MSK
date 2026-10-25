import io

p = 'app/index.html'
s = io.open(p, encoding='utf-8').read()

anchor = "  function route() {"
if "window.__ELOG" not in s:
    helper = "  window.__ELOG = window.__ELOG || [];\n  function __elog(m) { try { window.__ELOG.push(m + '@' + (Date.now() % 100000)); } catch (e) {} }\n"
    s = s.replace(anchor, helper + anchor, 1)

old1 = "                window.__RAWINFO = 'k=' + classBlobKey(meta.id) + ' len=' + (raw || 'null').length;"
if old1 in s:
    s = s.replace(old1, "                __elog('raw-found'); window.__RAWINFO = 'k=' + classBlobKey(meta.id) + ' len=' + (raw || 'null').length;")

old2 = "              } catch (e3) { CLS = null; CLS_KEY = null; }"
assert s.count(old2) == 1
s = s.replace(old2, "              } catch (e3) { __elog('open-err ' + (e3 && e3.message || e3)); CLS = null; CLS_KEY = null; }")

old3 = "              ui.classOpen = true;\n              window.__R2 = 'enter hash=' + location.hash;"
if old3 in s:
    s = s.replace(old3, "              ui.classOpen = true; __elog('cls-else-enter');\n              window.__R2 = 'enter hash=' + location.hash;")
else:
    old3b = "              ui.classOpen = true;\n              if (location.hash.indexOf('#/dashboard') !== 0) location.hash = '#/dashboard';"
    assert s.count(old3b) == 1
    s = s.replace(old3b, "              ui.classOpen = true; __elog('cls-else-enter hash=' + location.hash);\n              if (location.hash.indexOf('#/dashboard') !== 0) location.hash = '#/dashboard';")

old4 = "          ready = true;\n          try { window.__SPR_SESSION_RESTORED = sess.user; } catch (e5) {}"
assert s.count(old4) == 1
s = s.replace(old4, "          ready = true; __elog('restored-set');\n          try { window.__SPR_SESSION_RESTORED = sess.user; } catch (e5) {}")

old5 = "    if (document.body.classList.contains('auth-gate')) return;\n    killCharts(); closeDlg();"
assert s.count(old5) == 1
s = s.replace(old5, "    __elog('route ' + location.hash + ' cls=' + (CLS && CLS.id || 'null'));\n    if (document.body.classList.contains('auth-gate')) return;\n    killCharts(); closeDlg();")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('elog probes in (pristine base)')
