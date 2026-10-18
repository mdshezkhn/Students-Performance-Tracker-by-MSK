#!/usr/bin/env python3
"""Build: landing page (root) + app (in /app/)"""
import json, re, pathlib, base64

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / 'src'
LIBS = ROOT / 'libs'

def read(p):
    return pathlib.Path(p).read_text(encoding='utf-8')

seed = json.loads(read(ROOT / 'seed_data.json'))

# ---------- APP ----------
app_html = read(SRC / 'index.template.html')
for marker, path in [
    ('/*__FONT__*/', SRC / 'font.css'),
    ('/*__CSS__*/', SRC / 'style.css'),
    ('/*__CHARTJS__*/', LIBS / 'chart.umd.min.js'),
    ('/*__XLSX__*/', LIBS / 'xlsx.full.min.js'),
    ('/*__UTIL__*/', SRC / 'util.js'),
    ('/*__CALC__*/', SRC / 'calc.js'),
    ('/*__EXCEL__*/', SRC / 'excel.js'),
    ('/*__ANALYSIS__*/', SRC / 'analysis.js'),
    ('/*__APP__*/', SRC / 'app.js'),
]:
    app_html = app_html.replace(marker, read(path), 1)

# full version (with seed) → tracker/index.html
out = ROOT / 'index.html'
out.write_text(app_html.replace('/*__SEED__*/null', json.dumps(seed, ensure_ascii=False), 1), encoding='utf-8')
print(f'app (full):    index.html — {out.stat().st_size:,} bytes')

# seed-stripped → dist/app/index.html
stripped = re.sub(r'window\.SEED = /\*__SEED__\*/null;', 'window.SEED = null;', app_html, count=1)
assert 'window.SEED = null;' in stripped and '__SEED__' not in stripped, 'seed strip failed!'
seed_ids = [x for x in re.findall(r'"id"\s*:\s*"([^"]+)"', json.dumps(seed)) if x]
leaked = [i for i in seed_ids if i in stripped]
assert not leaked, f'student data leaked! {leaked[:3]}'
assert 'window.SEED = null;' in stripped and '__SEED__' not in stripped, 'seed strip failed!'
app_dir = ROOT / 'dist' / 'app'
app_dir.mkdir(parents=True, exist_ok=True)
(app_dir / 'index.html').write_text(stripped, encoding='utf-8')
print(f'app (public):  dist/app/index.html — {(app_dir / "index.html").stat().st_size:,} bytes')

# ---------- LANDING PAGE ----------
landing = read(SRC / 'landing.template.html')

# inject landing fonts (Instrument Serif + Inter, embedded) + hero poster
landing = landing.replace('/*__FONTS__*/', read(SRC / 'landing-fonts.css'))
poster_uri = 'data:image/jpeg;base64,' + base64.b64encode((SRC / 'landing-poster.jpg').read_bytes()).decode()
landing = landing.replace('%%POSTER%%', poster_uri)
assert '%%POSTER%%' not in landing and '__FONTS__' not in landing, 'landing injection failed!'

# inject landing CSS
landing = landing.replace('/*__LANDING_CSS__*/', read(SRC / 'landing.css'))

dist = ROOT / 'dist'
(dist / 'index.html').write_text(landing, encoding='utf-8')
print(f'landing:       dist/index.html — {(dist / "index.html").stat().st_size:,} bytes')

# ---------- DEPLOY ----------
deploy = ROOT / 'deploy'
deploy.mkdir(exist_ok=True)
(deploy / 'index.html').write_text(landing, encoding='utf-8')
app_dep = deploy / 'app'
app_dep.mkdir(exist_ok=True)
(app_dep / 'index.html').write_text(stripped, encoding='utf-8')

# CNAME
(deploy / 'CNAME').write_text('my-spr-with-mo.duckdns.org\n')
print(f'deploy ready:  deploy/index.html + deploy/app/index.html')
