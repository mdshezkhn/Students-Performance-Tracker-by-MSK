import io

p = 'tests/test-pair-open.js'
s = io.open(p, encoding='utf-8').read()
old = "          '| RSTERR2:', C.w.__RSTERR || 'none');"
new = """          '| RSTERR2:', C.w.__RSTERR || 'none',
          '| direct-open:', await C.w.eval('(async function(){ try { var CS = window.ClassStore; var s = JSON.parse(sessionStorage.getItem("spr-session")); var kb = CS.b64uToBytes(s.keys["P4C4"]); var raw = localStorage.getItem("spr-class-P4C4"); var t0 = Date.now(); var out = await Promise.race([CS.openClass(JSON.parse(raw), kb), new Promise(function(r){ setTimeout(function(){ r("HUNG"); }, 8000); })]); return out === "HUNG" ? "HUNG after 8s" : "opened students=" + (out.students || []).length + " in " + (Date.now() - t0) + "ms"; } catch (e) { return "ERR: " + (e && e.message); } })()');"""
assert s.count(old) == 1
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('direct-open probe in')
