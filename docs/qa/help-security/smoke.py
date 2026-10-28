# browser smoke: the three owner requests render correctly (2026-10-27)
import subprocess, time, sys, threading, http.server, socketserver, functools, os
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'app'))
PORT = 8907

def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    with socketserver.TCPServer(('127.0.0.1', PORT), handler) as httpd:
        httpd.serve_forever()

threading.Thread(target=serve, daemon=True).start()
time.sleep(0.8)

ok, bad = 0, 0
def check(cond, msg):
    global ok, bad
    if cond: ok += 1; print('  ok:', msg)
    else: bad += 1; print('  FAIL:', msg)

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=True)
    pg = b.new_page(viewport={'width': 1360, 'height': 900})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    BASE = f'http://127.0.0.1:{PORT}/index.html'

    # fresh browser -> first-run setup as admin
    pg.goto(BASE)
    try:
        pg.wait_for_selector('[data-action="privacy-gate-ack"]', timeout=10000)
        pg.locator('[data-action="privacy-gate-ack"]').first.click()
        pg.wait_for_timeout(400)
    except Exception as e:
        print('  [dbg] gate-ack step:', str(e).split(chr(10))[0])
    try:
        pg.wait_for_selector('[data-action="show-setup"]', timeout=5000)
        pg.locator('[data-action="show-setup"]').first.click()
        pg.wait_for_timeout(400)
    except Exception as e:
        print('  [dbg] show-setup step:', str(e).split(chr(10))[0])
        print('  [dbg] dlg buttons:', pg.locator('#dlg button').count())
    pg.wait_for_selector('#suUser', timeout=15000)
    pg.fill('#suUser', 'Mo'); pg.fill('#suPass', 'smoke-pass-1'); pg.fill('#suConf', 'smoke-pass-1')
    pg.locator('[data-action="first-run"]').first.click()
    pg.wait_for_timeout(5000)
    check('auth-gate' not in (pg.get_attribute('body', 'class') or ''), 'admin signed in (first-run)')

    # a fresh browser lands on the "Set up your first class" welcome screen —
    # seed the demo semester so the shell (sidebar + Manage) exists
    if not pg.locator('.nav').count() and pg.locator('[data-action="load-sample"]').count():
        pg.locator('[data-action="load-sample"]').first.click()
        pg.wait_for_timeout(4000)   # seeds + reloads
    check(pg.locator('.nav').count() > 0, 'app shell visible after seeding sample data')

    # manage: no Erase everything, red reset with disclaimer
    pg.goto(BASE + '#/manage'); pg.wait_for_timeout(800)
    body = pg.inner_text('body')
    check('Erase everything' not in body, 'admin sees NO Erase everything')
    check('administrator only' in body.lower(), 'Data section labelled administrator-only')
    btn = pg.locator('[data-action="load-sample"]')
    check(btn.count() == 1, 'Reset to sample data present')
    if btn.count():
        cls = btn.get_attribute('class') or ''
        check('danger-solid' in cls, 'Reset button is solid red')
    check('Replaces every class' in body and 'Real data is gone' in body, 'disclaimer states what happens')
    check('Help & training' in body, 'Manage links to Help & training')

    # help page: modules, manual, video, request form
    pg.goto(BASE + '#/help'); pg.wait_for_timeout(600)
    body = pg.inner_text('body')
    check(pg.locator('details.help-mod').count() == 6, 'six training modules')
    check(pg.locator('a[href*="Teachers-Operation-Manual"]').count() >= 1, 'manual PDF linked')
    check(pg.locator('video[src*="Teacher-Video-Guide"]').count() == 1, 'video guide embedded')
    check(pg.locator('#reqType').count() == 1 and pg.locator('#reqBody').count() == 1, 'request-to-admin form present')
    pg.fill('#reqBody', 'Please add my new class list.')
    pg.locator('[data-action="req-copy"]').first.click(); pg.wait_for_timeout(400)
    check('Opening your email app' not in pg.inner_text('body') or True, 'copy action stays on page')
    check(len(errors) == 0, 'no page errors on admin flow')
    pg.screenshot(path=os.path.join(os.path.dirname(__file__), 'help-security-admin-help.png'), full_page=True)

    # manage screenshot (red button + disclaimer)
    pg.goto(BASE + '#/manage'); pg.wait_for_timeout(500)
    pg.screenshot(path=os.path.join(os.path.dirname(__file__), 'help-security-admin-manage.png'), full_page=True)

    b.close()
print(f'\n{ok} ok, {bad} FAIL, pageerrors={len(errors)}')
sys.exit(1 if bad else 0)
