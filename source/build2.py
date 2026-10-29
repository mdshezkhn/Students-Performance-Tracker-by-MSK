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

This script never touches student data — the public build always has
window.SEED = null (the seed it embeds is the verified-synthetic demo class).
"""
import hashlib, json, pathlib, shutil

ROOT = pathlib.Path(__file__).parent          # source/
REPO = ROOT.parent
SRC, LIBS = ROOT, ROOT / 'libs'
DIST, DEPLOY = REPO / 'dist', REPO / 'deploy'

def read(p):
    # read with the file's own endings, then NORMALISE to LF: git autocrlf
    # differences between machines must never leak into the build. The output
    # is byte-identical on Windows and Linux (CI verifies the committed build)
    with open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read().replace('\r\n', '\n')

# ---------- guard: never silently clobber hand-edited published files ----
# The published site (repo root) must always equal the last committed build
# (deploy/). If someone hand-edited a root file (e.g. re-themed the landing
# directly in index.html), a rebuild would quietly OVERWRITE their work —
# that is exactly how the azure AEROFOLD landing was lost on 2026-10-21.
# Port such edits into the templates under source/ first, or use --force.
import sys
if '--force' not in sys.argv:
    for published, mirror in [(REPO / 'index.html', DEPLOY / 'index.html'),
                              (REPO / 'app' / 'index.html', DEPLOY / 'app' / 'index.html')]:
        if published.exists() and mirror.exists() and read(published) != read(mirror):
            sys.exit(
                "ABORT: " + str(published.relative_to(REPO)) + " differs from "
                + str(mirror.relative_to(REPO)) + " (the last committed build).\n"
                "A rebuild would OVERWRITE those hand edits.\n"
                "  keep them    -> port the changes into the matching source/ template\n"
                "                 (landing: source/landing.template.html + landing.css\n"
                "                 + landing-fonts.css), then rerun\n"
                "  discard them -> rerun with --force")
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
    ('/*__CLASSSTORE__*/', SRC / 'classstore.js'),
    ('/*__APP__*/', SRC / 'app.js'),
]:
    assert marker in app_html, 'missing marker ' + marker
    app_html = app_html.replace(marker, read(path), 1)

# public build: ship the SYNTHETIC demo class (source/seed_data.json contains
# no real students) so 'Load sample data' works on production
seed_obj = json.loads(read(SRC / 'seed_data.json'))
assert seed_obj.get('meta', '').startswith('SYNTHETIC'), 'refusing to embed a non-synthetic seed'
seed_json = json.dumps(seed_obj, ensure_ascii=False)
app_html = app_html.replace('window.SEED = /*__SEED__*/null;', 'window.SEED = ' + seed_json + ';', 1)
assert 'window.SEED = {"' in app_html and '__SEED__' not in app_html, 'seed injection failed'
for m in ('__FONT__', '__CSS__', '__CHARTJS__', '__XLSX__', '__QRCODE__', '__UTIL__', '__CALC__', '__EXCEL__', '__ANALYSIS__', '__CLASSSTORE__', '__APP__'):
    assert m not in app_html, 'unreplaced marker ' + m

# ---------- service worker: version = content hash of the app HTML ----------
sw_version = hashlib.sha256(app_html.encode('utf-8')).hexdigest()[:10]
sw = read(SRC / 'sw-template.js').replace('__SW_VERSION__', sw_version, 1)
assert '__SW_VERSION__' not in sw
app_html = app_html.replace('__SPR_BUILD__', sw_version, 1)
assert '__SPR_BUILD__' not in app_html, 'build marker unreplaced'

# ---------- the notice: one text, two languages, three places (2026-10-28) ----------
# Single source of truth: source/notice.en.html + source/notice.zh.html.
# They are (a) injected into the app as window.SPR_NOTICE and (b) rendered into
# the standalone notice.html linked from the landing footer.
import json as _json
NOTICE_VERSION, NOTICE_DATE = '1', '28 Oct 2026'
def _notice(src):
    t = read(SRC / src)
    # strip the leading build comment (lines starting with <!-- up to -->)
    import re as _re
    t = _re.sub(r'<!--[\s\S]*?-->', '', t, count=1)
    return t.strip()
notices = {'version': NOTICE_VERSION, 'date': NOTICE_DATE,
           'en': _notice('notice.en.html'), 'zh': _notice('notice.zh.html')}
notices_js = _json.dumps(notices, ensure_ascii=False)
app_html = app_html.replace('window.SPR_NOTICE=/*__NOTICES__*/null;',
                            'window.SPR_NOTICE=' + notices_js + ';', 1)
assert '__NOTICES__' not in app_html, 'notice injection failed'

def notice_page_html():
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<meta name="robots" content="noindex">\n'
            '<title>Notice — Student\'s Performance Report (SPR)</title>\n'
            '<style>\n'
            'body{margin:0;background:#fbfaf5;color:#22312c;font-family:Georgia,"Times New Roman",serif;line-height:1.65}\n'
            '.wrap{max-width:720px;margin:0 auto;padding:48px 22px 64px}\n'
            'h1{font-size:26px;margin:0 0 4px}h4{margin:22px 0 6px;font-size:16.5px}\n'
            'p{margin:0 0 12px;font-size:15.5px}\n'
            '.sub{color:#5b6a62;font-family:system-ui,sans-serif;font-size:14px;margin:0 0 20px}\n'
            '.bar{display:flex;gap:8px;margin:0 0 18px}\n'
            'button{font-family:system-ui,sans-serif;font-size:14px;border-radius:8px;border:1px solid #c9c5b2;background:#fff;padding:6px 14px;cursor:pointer}\n'
            'button.on{background:#1e3b32;border-color:#1e3b32;color:#fff}\n'
            '.meta{margin-top:26px;color:#5b6a62;font-size:13.5px;font-family:system-ui,sans-serif}\n'
            '</style>\n</head>\n<body>\n<div class="wrap">\n'
            '<h1>Notice</h1>\n<p class="sub">Student\u2019s Performance Report (SPR) \u2014 about SPR and your student data</p>\n'
            '<div class="bar"><button id="btn-en" class="on" onclick="setLang(\'en\')">English</button>'
            '<button id="btn-zh" onclick="setLang(\'zh\')">中文</button></div>\n'
            '<div id="body-en">' + notices['en'] + '</div>\n'
            '<div id="body-zh" style="display:none">' + notices['zh'] + '</div>\n'
            '<p class="meta">Notice v' + NOTICE_VERSION + ', ' + NOTICE_DATE + '.</p>\n'
            '<p class="meta"><a href="app/">Open the app</a></p>\n'
            '</div>\n<script>\n'
            'function setLang(l){document.getElementById("body-en").style.display=l==="en"?"":"none";'
            'document.getElementById("body-zh").style.display=l==="zh"?"":"none";'
            'document.getElementById("btn-en").className=l==="en"?"on":"";'
            'document.getElementById("btn-zh").className=l==="zh"?"on":"";}\n'
            '</script>\n</body>\n</html>\n')

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
def write(p, text):
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(text)
write(DIST / 'app' / 'index.html', app_html)
write(DIST / 'app' / 'sw.js', sw)
write(DIST / 'index.html', landing)
write(DIST / 'notice.html', notice_page_html())

if DEPLOY.exists(): shutil.rmtree(DEPLOY)
shutil.copytree(DIST, DEPLOY)
(DEPLOY / 'CNAME').write_text('my-spr-with-mo.duckdns.org\n', encoding='utf-8')

print(f'app:          dist/app/index.html — {len(app_html):,} bytes')
print(f'sw version:   {sw_version}  (spr-app-shell-{sw_version})')
print(f'landing:      dist/index.html — {len(landing):,} bytes')
print('deploy ready: deploy/  (copy deploy/* to repo root to publish)')
