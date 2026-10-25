import io

p = 'app/index.html'
s = io.open(p, encoding='utf-8').read()

# ordered event log (works even if init runs twice / continuations interleave)
anchor = "  function route() {"
if "window.__ELOG" not in s:
    helper = "  window.__ELOG = window.__ELOG || [];\\n  function __elog(m) { try { window.__ELOG.push(m + '@' + Date.now() % 100000); } catch (e) {} }\\n"
    s = s.replace(anchor, helper + anchor, 1)

old1 = "                window.__RAWINFO = 'k=' + classBlobKey(meta.id) + ' len=' + (raw || 'null').length;"
new1 = "                __elog('raw-found'); window.__RAWINFO = 'k=' + classBlobKey(meta.id) + ' len=' + (raw || 'null').length;"
assert s.count(old1) == 1
s = s.replace(old1, new1)

old2 = "              } catch (e3) { CLS = null; CLS_KEY = null; window.__RSTERR = String(e3 && e3.message || e3); }"
new2 = "              } catch (e3) { __elog('open-err ' + (e3 && e3.message || e3)); CLS = null; CLS_KEY = null; }"
assert s.count(old2) == 1
s = s.replace(old2, new2)

old3 = "              ui.classOpen = true;\n              window.__R2 = 'enter hash=' + location.hash;"
new3 = "              ui.classOpen = true; __elog('cls-else-enter');\n              window.__R2 = 'enter hash=' + location.hash;"
assert s.count(old3) == 1
s = s.replace(old3, new3)

old4 = "          ready = true;\n          try { window.__SPR_SESSION_RESTORED = sess.user; } catch (e5) {}"
new4 = "          ready = true; __elog('restored-set');\n          try { window.__SPR_SESSION_RESTORED = sess.user; } catch (e5) {}"
assert s.count(old4) == 1
s = s.replace(old4, new4)

old5 = "    if (document.body.classList.contains('auth-gate')) return;\n    killCharts(); closeDlg();"
new5 = "    __elog('route ' + location.hash + ' cls=' + (CLS && CLS.id || 'null'));\n    if (document.body.classList.contains('auth-gate')) return;\n    killCharts(); closeDlg();"
assert s.count(old5) == 1
s = s.replace(old5, new5)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('elog probes in')
