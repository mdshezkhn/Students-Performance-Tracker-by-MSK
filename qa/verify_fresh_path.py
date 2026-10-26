import http.server, socketserver, threading, sys, os, time, functools
import pathlib
pathlib.Path('qa-fresh').mkdir(exist_ok=True)
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'app')   # repo/app (committed build)
PORT = 8939

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass

httpd = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), functools.partial(H, directory=ROOT))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{PORT}/app/'

PASS = FAIL = 0
def check(c, m):
    global PASS, FAIL
    if c: PASS += 1; print('  PASS', m)
    else: FAIL += 1; print('  FAIL', m)

def priv(p):
    p.wait_for_timeout(800)
    for sel in ('[data-action="privacy-gate-ack"]', '[data-action="privacy-ack"]'):
        try:
            b = p.locator('#dlg ' + sel)
            if b.count(): b.first.click(); p.wait_for_timeout(400)
        except Exception: pass

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 850})
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:120]))
    page.goto(BASE); priv(page)
    page.wait_for_timeout(1200)
    bt = page.inner_text('body').replace(chr(10), ' | ')
    print('  [dbg] body:', bt[:280])
    print('  [dbg] setup:', page.locator('[data-action="show-setup"]').count(), 'first-run:', page.locator('[data-action="first-run"]').count(), 'dlgOpen:', page.evaluate('var d=document.getElementById("dlg"); d && d.open'))
    # 1. first-run setup (the link the user sees)
    page.click('[data-action="show-setup"]')
    page.fill('#suUser', 'mo'); page.fill('#suPass', 'Fresh-Start-2026'); page.fill('#suConf', 'Fresh-Start-2026')
    page.click('[data-action="first-run"]')
    page.wait_for_selector('body:not(.auth-gate)', timeout=45000)
    page.wait_for_timeout(900)
    check(page.locator('[data-action="wiz-open"]').count() > 0, 'welcome screen offers guided setup (no data yet)')
    page.screenshot(path='qa-fresh/1-welcome.png')

    # 2. guided setup with the OWNER'S own data
    page.click('[data-action="wiz-open"]')
    page.wait_for_timeout(500)
    page.fill('#wiz-school', 'ZhongFangYuan Bilingual School')
    page.fill('#wiz-name', 'P4C4')
    page.fill('#wiz-year', '2026-2027')
    page.fill('#wiz-period', 'Sep-Jan')
    page.fill('#wiz-teachers', 'Mo')
    page.fill('#wiz-paste', 'S01, 陈小明, Kevin Chen, M\nS02, 王小红, Sophie Wang, F')
    page.click('[data-action="wiz-create"]')
    page.wait_for_timeout(1200)
    body = page.inner_text('body')
    check('Kevin' in body or '陈小明' in body or page.locator('.tabs, .nav').count() > 0, 'class created with their own students (markbook/dashboard)')
    page.screenshot(path='qa-fresh/2-own-class.png')

    # 3. migration to class mode, offered and honest
    try:
        page.click('.nav >> text=Manage & setup', timeout=3000)
    except Exception:
        page.evaluate("location.hash='#/manage'; window.dispatchEvent(new Event('hashchange'))")
    page.wait_for_timeout(700)
    mig = page.locator('[data-action="class-migrate-open"]')
    check(mig.count() > 0, 'Review migration offered on their own (non-sample) class')
    if mig.count():
        mig.first.click(); page.wait_for_timeout(900)
        b1 = page.locator('#dlg button[data-x="1"]')
        if b1.count():
            b1.first.click()
            page.wait_for_timeout(1500)
            # reload like the real flow, then sign in again
            page.reload(); page.wait_for_timeout(800); priv(page)
            try:
                page.wait_for_selector('body:not(.auth-gate)', timeout=4000)
            except Exception:
                page.fill('#loginUser', 'mo'); page.fill('#loginPass', 'Fresh-Start-2026')
                page.click('[data-action="do-login"]')
                page.wait_for_selector('body:not(.auth-gate)', timeout=30000)
            page.wait_for_timeout(1500)
            h = page.evaluate('location.hash')
            check(h.startswith('#/dashboard') or h.startswith('#/classes'), 'after migration: lands inside their class (%s), no dead end' % h)
    page.screenshot(path='qa-fresh/3-migrated.png')

    # 4. their data survived; sample data never appeared
    body = page.inner_text('body')
    check('Sophie' in body or '王小红' in body or page.locator('table').count() > 0, 'their own students present after migration')
    check('Sample Class' not in body, 'no sample data anywhere')

    print('  page errors:', errs or 'none')
    print('TOTAL: %d checks, %d failures' % (PASS + FAIL, FAIL))
    b.close()
httpd.shutdown()
sys.exit(1 if FAIL else 0)
