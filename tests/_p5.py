import io

p = 'app/index.html'
s = io.open(p, encoding='utf-8').read()
old = "                const raw = localStorage.getItem(classBlobKey(meta.id));\n                if (raw) { CLS = { id: meta.id }; CLS_KEY = SESSION.keys[meta.id]; DB = normalizeDB(await CS.openClass(JSON.parse(raw), CLS_KEY)); DB.sprClass = 1; DB.id = meta.id; }"
new = "                const raw = localStorage.getItem(classBlobKey(meta.id));\n                window.__RAWINFO = 'k=' + classBlobKey(meta.id) + ' len=' + (raw || 'null').length;\n                if (raw) { CLS = { id: meta.id }; CLS_KEY = SESSION.keys[meta.id]; DB = normalizeDB(await CS.openClass(JSON.parse(raw), CLS_KEY)); DB.sprClass = 1; DB.id = meta.id; }"
assert s.count(old) == 1
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('raw probe in')
