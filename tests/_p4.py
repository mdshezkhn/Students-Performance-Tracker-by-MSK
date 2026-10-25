import io

p = 'app/index.html'
s = io.open(p, encoding='utf-8').read()
old = "} catch (e3) { CLS = null; CLS_KEY = null; }"
new = "} catch (e3) { CLS = null; CLS_KEY = null; window.__RSTERR = String(e3 && e3.message || e3); }"
assert s.count(old) == 1
s = s.replace(old, new)
old2 = "if (!CLS) DB = emptyDB();"
new2 = "if (!CLS) { window.__RSTSKIP = 'meta=' + (meta ? meta.id : 'null') + ' key=' + (meta ? !!SESSION.keys[meta.id] : 'n/a') + ' keynames=' + Object.keys(SESSION.keys || {}).join(','); DB = emptyDB(); }"
assert s.count(old2) == 1
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('catch probes in')
