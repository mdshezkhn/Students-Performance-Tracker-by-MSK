#!/usr/bin/env python3
"""Self-contained build for the PUBLIC site (seed stripped) — runs from the
committed repo alone: vendor libs live in source/libs (extracted from the
previous deployed artifact), sources sit directly in source/.

Outputs:
  dist/index.html            landing page
  dist/app/index.html        the app (single file, everything inline)
  dist/app/sw.js             service worker, version = hash of the app HTML
  dist/app/manifest.webmanifest + icons/
  deploy/                    mirror of what gets committed at repo root

The owner's original build.py (with local-only seed_data.json) stays valid;
this script never touches student data — the public build always has
window.SEED = null.
"""
import hashlib, json, pathlib, shutil

ROOT = pathlib.Path(__file__).parent          # source/
REPO = ROOT.parent
SRC, LIBS = ROOT, ROOT / 'libs'
DIST, DEPLOY = REPO / 'dist', REPO / 'deploy'

def read(p):
    return pathlib.Path(p).read_text(encoding='utf-8')

# ---------- app ----------
app_html = read(SRC / 'index.template.html')
for marker, path in [
    ('/*__FONT__*/', SRC / 'font.css'),
    ('/*__CSS__*/', SRC / 'style.css'),
    ('/*__CHARTJS__*/', LIBS / 'chart.umd.min.js'),
    ('/*__XLSX__*/', LIBS / 'xlsx.full.min.js'),
    ('/*__QRCODE__*/', LIBS / 'qrcode.min.js'),
    ('/*__UTIL__*/', SRC / 'util.js'),
    ('/*__CALC__*/', SRC / 'calc.js'),
    ('/*__EXCEL__*/', SRC / 'excel.js'),
    ('/*__ANALYSIS__*/', SRC / 'analysis.js'),
    ('/*__APP__*/', SRC / 'app.js'),
]:
    assert marker in app_html, 'missing marker ' + marker
    app_html = app_html.replace(marker, read(path), 1)

# public build: no sample data ships
app_html = app_html.replace('window.SEED = /*__SEED__*/null;', 'window.SEED = null;', 1)
assert 'window.SEED = null;' in app_html and '__SEED__' not in app_html, 'seed strip failed'
for m in ('__FONT__', '__CSS__', '__CHARTJS__', '__XLSX__', '__QRCODE__', '__UTIL__', '__CALC__', '__EXCEL__', '__ANALYSIS__', '__APP__'):
    assert m not in app_html, 'unreplaced marker ' + m

# ---------- service worker: version = content hash of the app HTML ----------
sw_version = hashlib.sha256(app_html.encode('utf-8')).hexdigest()[:10]
sw = read(SRC / 'sw-template.js').replace('__SW_VERSION__', sw_version, 1)
assert '__SW_VERSION__' not in sw

# ---------- landing ----------
import base64, re
landing = read(SRC / 'landing.template.html')
landing = landing.replace('/*__FONTS__*/', read(SRC / 'landing-fonts.css'))
landing = landing.replace('/*__LANDING_CSS__*/', read(SRC / 'landing.css'))
# poster placeholder appears in BOTH the template (video attr) and landing.css (background) — replace all
poster_uri = 'data:image/jpeg;base64,' + base64.b64encode((SRC / 'landing-poster.jpg').read_bytes()).decode()
landing = landing.replace('%%POSTER%%', poster_uri)
assert '%%POSTER%%' not in landing and '__FONTS__' not in landing and '__LANDING_CSS__' not in landing, 'landing injection failed'

# ---------- write dist + deploy ----------
if DIST.exists(): shutil.rmtree(DIST)
(DIST / 'app').mkdir(parents=True)
(DIST / 'app' / 'index.html').write_text(app_html, encoding='utf-8')
(DIST / 'app' / 'sw.js').write_text(sw, encoding='utf-8')
(DIST / 'index.html').write_text(landing, encoding='utf-8')

if DEPLOY.exists(): shutil.rmtree(DEPLOY)
shutil.copytree(DIST, DEPLOY)
(DEPLOY / 'CNAME').write_text('my-spr-with-mo.duckdns.org\n', encoding='utf-8')

print(f'app:          dist/app/index.html — {len(app_html):,} bytes')
print(f'sw version:   {sw_version}  (spr-app-shell-{sw_version})')
print(f'landing:      dist/index.html — {len(landing):,} bytes')
print('deploy ready: deploy/  (copy deploy/* to repo root to publish)')
