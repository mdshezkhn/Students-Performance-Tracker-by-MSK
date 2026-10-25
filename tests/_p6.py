import io

p = 'app/index.html'
s = io.open(p, encoding='utf-8').read()
old = """              ui.classOpen = true;
              if (location.hash.indexOf('#/dashboard') !== 0) location.hash = '#/dashboard';
              buildShell(); route();"""
new = """              ui.classOpen = true;
              window.__R2 = 'enter hash=' + location.hash;
              if (location.hash.indexOf('#/dashboard') !== 0) location.hash = '#/dashboard';
              window.__R2 += ' | afterwrite=' + location.hash;
              try { buildShell(); } catch (be) { window.__R2 += ' | SHELL-ERR ' + (be && be.message); }
              try { route(); } catch (re) { window.__R2 += ' | ROUTE-ERR ' + (re && re.message); }
              window.__R2 += ' | final=' + location.hash;"""
assert s.count(old) == 1
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('R2 probe in')
