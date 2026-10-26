import http.server, threading, sys, os
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'app')
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8793), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def check(c, m):
    print(('  PASS ' if c else '  FAIL ') + m)
    if not c: fails.append(m)
def ack_gate(page):
    try:
        page.wait_for_selector('[data-action="privacy-gate-ack"]', timeout=5000)
        page.click('[data-action="privacy-gate-ack"]'); page.wait_for_timeout(400)
        g2 = page.locator('[data-action="privacy-ack"]')
        if g2.count(): g2.first.click(); page.wait_for_timeout(400)
        page.wait_for_timeout(400)
    except Exception: pass
def settle(page):
    try:
        page.wait_for_function("['#/dashboard','#/classes','#/manage'].some(function(h){return location.hash.indexOf(h)===0})", timeout=30000)
    except Exception: pass
    page.wait_for_timeout(900)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width':1280,'height':850})
    page = ctx.new_page()
    page.on('pageerror', lambda e: print('  [pageerror]', str(e)[:150]))
    page.on('console', lambda m: print('  [console.' + m.type + ']', m.text[:150]) if m.type == 'error' else None)
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:120]))
    page.goto('http://127.0.0.1:8793/index.html')
    page.wait_for_timeout(1000); ack_gate(page); page.wait_for_timeout(600)
    # admin with a SHORT password (2.14 removed minimums)
    page.click('[data-action="show-setup"]'); page.wait_for_timeout(400)
    page.fill('#suUser', 'Mo'); page.fill('#suPass', 'pw1'); page.fill('#suConf', 'pw1')
    page.click('[data-action="first-run"]')
    page.wait_for_selector('body:not(.auth-gate)', timeout=45000)
    settle(page); ack_gate(page)
    check(page.evaluate("(document.body.innerText||'').indexOf('14+')===-1 && (document.body.innerText||'').indexOf('12+')===-1"), 'no 12/14-character hints in visible text after setup')
    # guided class so we have a class open
    if page.locator('[data-action="wiz-open"]').count():
        page.click('[data-action="wiz-open"]'); page.wait_for_timeout(400)
        page.fill('#wiz-school', 'ZFY'); page.fill('#wiz-name', 'P4C4')
        page.check('input[name="wiz-rmode"][value="paste"]'); page.wait_for_timeout(300)
        page.fill('#wiz-paste', '01, WANG Xiaoming, Tom, M' + chr(10) + '02, LI Xiaohong, Lily, F')
        page.click('[data-action="wiz-create"]'); page.wait_for_timeout(1800)
        cx = page.locator('#dlg [data-action="dlg-close"], #dlg [data-x="0"]')
        if cx.count(): cx.first.click(); page.wait_for_timeout(500)
    settle(page); ack_gate(page)
    # 1: Students tab hosts the roster editor
    page.goto('http://127.0.0.1:8793/index.html#/students'); page.wait_for_timeout(900)
    check(page.locator('[data-action="roster-add"]').count() > 0, 'Students tab hosts the Add-student editor (admin)')
    check(page.locator('[data-stufield="nameEn"]').count() >= 2, 'inline student edit fields on the Students tab')
    # manage no longer has the roster editor
    page.goto('http://127.0.0.1:8793/index.html#/manage'); page.wait_for_timeout(900)
    check(page.locator('[data-action="roster-add"]').count() == 0, 'Manage & setup no longer holds the student editor (admin)')
    check(page.locator('[data-action="change-pass-open"]').count() > 0, 'admin keeps Change-my-password in Manage')
    # 2: Users tab back link
    page.goto('http://127.0.0.1:8793/index.html#/users'); page.wait_for_timeout(900)
    back = page.locator('a[href="#/dashboard"]', has_text='Back to the app')
    check(back.count() > 0, 'Users tab has a Back-to-the-app link')
    if back.count(): back.first.click(); page.wait_for_timeout(900)
    check(page.evaluate("location.hash.indexOf('#/dashboard')===0"), 'Back returns into the app (#/dashboard): ' + page.evaluate('location.hash'))
    # change-password dialog without a minimum
    page.goto('http://127.0.0.1:8793/index.html#/manage'); page.wait_for_timeout(700)
    page.click('[data-action="change-pass-open"]'); page.wait_for_timeout(500)
    check(page.evaluate("document.getElementById('cpNew') && document.getElementById('cpNew').closest('.login-field').textContent.indexOf('characters')===-1"), 'change-password dialog has no character-count hint')
    page.fill('#cpCur', 'pw1'); page.fill('#cpNew', 'pw2'); page.fill('#cpConf', 'pw2')
    page.click('[data-action="change-pass-save"]')
    # CSP-safe poll (wait_for_function needs unsafe-eval, which this app's CSP forbids)
    ok_change = False
    for _ in range(50):
        if page.evaluate("!document.getElementById('dlg').open"):
            ok_change = True; break
        if page.evaluate("(document.getElementById('cpErr')||{textContent:''}).textContent"):
            break
        page.wait_for_timeout(500)
    if not ok_change:
        print('  [dbg] dlg:', page.evaluate("var d=document.getElementById('dlg'); d&&d.open ? d.textContent.slice(0,160) : 'closed'"))
        print('  [dbg] cpErr:', page.evaluate("var e=document.getElementById('cpErr'); e ? e.textContent : 'none'"))
    check(ok_change, 'short password accepted by change-password (dialog closes)')
    page.wait_for_timeout(1200)   # let the async change fully settle before signing out
    page.wait_for_timeout(600)
    # sign out, sign back in with the new SHORT password
    page.goto('http://127.0.0.1:8793/index.html#/dashboard'); page.wait_for_timeout(500)
    lo = page.locator('[data-action="logout"]').first
    if lo.count(): lo.click(); page.wait_for_timeout(1200); ack_gate(page); page.wait_for_timeout(600)
    page.fill('#loginUser', 'mo'); page.fill('#loginPass', 'pw2')
    page.click('[data-action="do-login"]')
    page.wait_for_selector('body:not(.auth-gate)', timeout=45000)
    settle(page); ack_gate(page)
    check(not page.evaluate("document.body.classList.contains('auth-gate')"), 're-sign-in with the short changed password works')
    # 3: teacher view — Manage shows only the password card; Students tab editor visible to EAL? (admin creates EAL + pairs)
    page.goto('http://127.0.0.1:8793/index.html#/users'); page.wait_for_timeout(800)
    page.click('[data-action="acct-add-open"]'); page.wait_for_timeout(400)
    page.fill('#naUser', 'anna'); page.fill('#naName', 'Anna'); page.select_option('#naRole', 'teacher')
    page.fill('#naPass', 'anna1'); page.fill('#naConf', 'anna1')
    page.click('[data-action="acct-add"]')
    page.wait_for_timeout(2500)
    cx = page.locator('#dlg [data-action="dlg-close"], #dlg [data-x="0"]')
    if cx.count(): cx.first.click(); page.wait_for_timeout(400)
    # pair anna via Manage -> Advanced -> Pair (class-mode feature: migrate first)
    page.goto('http://127.0.0.1:8793/index.html#/manage'); page.wait_for_timeout(800)
    if page.locator('[data-action="class-migrate-open"]').count():
        page.click('[data-action="class-migrate-open"]'); page.wait_for_timeout(600)
        ap = page.locator('#dlg [data-x="1"]')
        if ap.count(): ap.first.click(); page.wait_for_timeout(3500)
        pg = page.locator('#dlg [data-action="privacy-gate-ack"], [data-action="privacy-gate-ack"]')
        if pg.count(): pg.first.click(); page.wait_for_timeout(500)
        pa = page.locator('[data-action="privacy-ack"]')
        if pa.count(): pa.first.click(); page.wait_for_timeout(500)
        # migration may require signing in again (OTP/one-time) — handle the offer dialog
        if page.evaluate("document.getElementById('dlg') && document.getElementById('dlg').open"):
            tx = page.evaluate("(document.getElementById('dlg').textContent||'').slice(0,80)")
            print('  [i] post-migrate dialog:', tx.replace(chr(10),' '))
            cl = page.locator('#dlg [data-action="dlg-close"], #dlg [data-x="0"]')
            if cl.count(): cl.first.click(); page.wait_for_timeout(400)
        page.goto('http://127.0.0.1:8793/index.html#/manage'); page.wait_for_timeout(900)
    det = page.locator('details summary', has_text='Advanced')
    if det.count(): det.first.click(); page.wait_for_timeout(400)
    pb = page.locator('[data-action="class-pair"]')
    check(pb.count() > 0, 'Pair tool still available in Manage Advanced (admin)')
    if pb.count():
        pb.first.click(); page.wait_for_timeout(900)
        if not page.evaluate("document.getElementById('dlg') && document.getElementById('dlg').open"):
            print('  [i] pair dlg did not open | dlg:', page.evaluate("var d=document.getElementById('dlg'); d?d.textContent.slice(0,120):'none'"))
            print('  [i] hash:', page.evaluate('location.hash'), '| details open:', page.evaluate("Array.from(document.querySelectorAll('details')).map(function(d){return d.open})").__str__()[:80])
        # the pair dialog uses per-role SELECTS (pair-eal / pair-support); 'teacher' accounts map to EAL
        page.wait_for_selector('#pair-eal option[value="anna"]', state='attached', timeout=15000)
        page.select_option('#pair-eal', 'anna')
        page.click('#dlg [data-x="1"]')
        # capture OTP
        otp = ''
        try:
            page.wait_for_selector('#dlg code', timeout=30000)
            otp = page.evaluate("document.querySelector('#dlg code').textContent.trim()")
        except Exception: pass
        cx = page.locator('#dlg [data-x]').first   # passwords-once dialog: Done is data-x="1"
        if cx.count(): cx.click(); page.wait_for_timeout(600)
        print('  [i] OTP captured:', bool(otp))
        if page.evaluate("document.getElementById('dlg') && document.getElementById('dlg').open"):
            page.locator('#dlg [data-x]').first.click(); page.wait_for_timeout(500)
        # teacher session (same origin, wipe storage to simulate her device)
        ctx2 = b.new_context(viewport={'width':1280,'height':850})
        t = ctx2.new_page()
        t.goto('http://127.0.0.1:8793/index.html')
        t.wait_for_timeout(1000); ack_gate(t); t.wait_for_timeout(500)
        # first-run as anna? accounts are device-local — simulate teacher arriving via pairing link is out of scope here;
        # instead verify the teacher MANAGE page shape by signing in as anna on the admin's browser profile after logout
        lo = page.locator('[data-action="logout"]').first
        if lo.count(): lo.click(); page.wait_for_timeout(1200); ack_gate(page); page.wait_for_timeout(500)
        # pairing ROTATED anna's password — the captured OTP is her real one now
        page.fill('#loginUser', 'anna'); page.fill('#loginPass', otp or 'anna1')
        page.click('[data-action="do-login"]')
        page.wait_for_selector('body:not(.auth-gate)', timeout=45000)
        settle(page); ack_gate(page)
        page.goto('http://127.0.0.1:8793/index.html#/manage'); page.wait_for_timeout(900)
        check(page.locator('[data-action="change-pass-open"]').count() > 0, 'teacher Manage shows the password card')
        check(page.locator('[data-action="class-pair"]').count() == 0 and page.locator('details summary', has_text='Advanced').count() == 0, 'teacher Manage has NO admin tools (no Advanced/Pair)')
        check(page.evaluate("((document.getElementById('content')||{}).innerText||'').indexOf('New class / semester')===-1 && ((document.getElementById('content')||{}).innerText||'').indexOf('Backup')===-1"), 'teacher Manage shows only the password card (no class/backup tools)')
        b.close()
print('TOTAL:', 'ALL PASS' if not fails else str(len(fails)) + ' FAILURES')
sys.exit(1 if fails else 0)
