import io

p = 'tests/test-pair-open.js'
s = io.open(p, encoding='utf-8').read()
old = "          '| blob:', !!C.w.localStorage.getItem('spr-class-P4C4'));"
new = """          '| blob:', !!C.w.localStorage.getItem('spr-class-P4C4'),
          '| RST:', C.w.__RST || 'none',
          '| RTcount:', C.w.__RT || 0,
          '| RThashes:', (C.w.__RTH || 'none').slice(-160),
          '| RTgated:', !!C.w.__RTG);"""
assert s.count(old) == 1
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('probe3 in')
