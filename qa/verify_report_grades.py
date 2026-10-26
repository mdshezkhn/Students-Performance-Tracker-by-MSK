import http.server, threading, sys, os
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'app')
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8795), H)
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
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width':1280,'height':900})
    page = ctx.new_page()
    page.goto('http://127.0.0.1:8795/index.html')
    page.wait_for_timeout(900); ack_gate(page); page.wait_for_timeout(500)
    # first-run admin
    su = page.locator('[data-action="show-setup"]')
    if su.count(): su.first.click()
    else: page.locator('a,button', has_text='Set up this browser').first.click()
    page.wait_for_timeout(500)
    page.fill('#suUser', 'Mo'); page.fill('#suPass', 'report-pass-1'); page.fill('#suConf', 'report-pass-1')
    page.click('[data-action="first-run"]')
    page.wait_for_selector('body:not(.auth-gate)', timeout=45000)
    page.wait_for_timeout(1500); ack_gate(page)
    # sample data (richest data set) then migration -> class mode
    page.click('[data-action="load-sample"]')
    page.wait_for_timeout(2500); ack_gate(page); page.wait_for_timeout(500)
    # migration
    page.goto('http://127.0.0.1:8795/index.html#/classes'); page.wait_for_timeout(900)
    mig = page.locator('[data-action="class-migrate-open"]')
    if mig.count():
        mig.first.click(); page.wait_for_timeout(800)
        b1 = page.locator('#dlg [data-x="1"]')
        if b1.count(): b1.first.click()
        page.wait_for_timeout(3500); ack_gate(page); page.wait_for_timeout(1500)
    print('  [i] mode:', page.evaluate("localStorage.getItem('spr-mode-v1')"), '| hash:', page.evaluate('location.hash'))
    # find a student id from the DB
    sid = page.evaluate("var d=window.SPR_DEBUG_GET_DB ? window.SPR_DEBUG_GET_DB() : null; d && d.semesters[0] && d.semesters[0].students[0] ? d.semesters[0].students[0].id : null")
    if not sid:
        sid = page.evaluate("JSON.parse(localStorage.getItem(localStorage.key(0))||'{}') && null") or page.evaluate("(function(){ for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if (k.indexOf('spr-class-')===0){ try { var w=JSON.parse(localStorage.getItem(k)); return w.semesters && w.semesters[0] && w.semesters[0].students[0].id; } catch(e){} } } return null; })()")
    print('  [i] student id:', sid)
    check(bool(sid), 'sample class has a student to report on')
    page.goto('http://127.0.0.1:8795/index.html#/reports/student/' + sid); page.wait_for_timeout(1500); ack_gate(page)
    page.goto('http://127.0.0.1:8795/index.html#/report/' + sid); page.wait_for_timeout(1800)
    import re
    scores_txt = page.evaluate("(document.querySelector('.rc-scores')||{innerText:'MISSING'}).innerText")
    print('  [i] rc-scores:', scores_txt.replace(chr(10),' | ')[:300])
    grades = re.findall(r'(?:^|\s)(A\*|[ABCDU])(?=\s)', scores_txt)
    check(len(grades) >= 5, 'skill overview shows letter grades (' + ','.join(grades[:8]) + ')')
    check('%' in page.evaluate("(document.querySelector('.rc-scores')||{}).innerText || ''"), 'exact % still visible small beside grades')
    # comments: practical + no false "not enough assessed work"
    rc = page.evaluate("(document.querySelector('.rc-swot')||{}).innerText || ''")
    check('Not enough assessed work yet to identify a reliable area' not in rc, 'no misleading empty-steps message')
    check('grade' in rc.lower(), 'strengths/steps cite grades: ' + rc.replace(chr(10),' ')[:110])
    ov = page.evaluate("(document.querySelector('.rc-remark')||{}).innerText || ''")
    check(bool(ov.strip()), 'overall comment generated: ' + ov.replace(chr(10),' ')[:110])
    page.screenshot(path='docs/qa/report-grades.png', full_page=False)
    b.close()
print('TOTAL:', 'ALL PASS' if not fails else str(len(fails)) + ' FAILURES')
sys.exit(1 if fails else 0)
