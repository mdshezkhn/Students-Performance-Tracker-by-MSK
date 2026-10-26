import http.server, threading, os, sys
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath('app')
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self): self.send_header('Cache-Control','no-store'); super().end_headers()
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8799), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = 'docs/qa/polish'
os.makedirs(OUT, exist_ok=True)
fails = []
def check(c, m):
    print(('  PASS ' if c else '  FAIL ') + m)
    if not c: fails.append(m)
def ack_gate(page):
    try:
        page.wait_for_selector('[data-action="privacy-gate-ack"]', timeout=5000)
        page.click('[data-action="privacy-gate-ack"]'); page.wait_for_timeout(350)
        g2 = page.locator('[data-action="privacy-ack"]')
        if g2.count(): g2.first.click(); page.wait_for_timeout(350)
        page.wait_for_timeout(400)
    except Exception: pass
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width':1280,'height':850})
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:100]))
    # 1. login screen
    page.goto('http://127.0.0.1:8799/index.html'); page.wait_for_timeout(1000); ack_gate(page)
    page.wait_for_timeout(600)
    page.screenshot(path=OUT+'/01-login.png')
    # 2. setup + admin + sample
    su = page.locator('[data-action="show-setup"]')
    if su.count(): su.first.click()
    else: page.locator('a,button', has_text='Set up this browser').first.click()
    page.wait_for_timeout(500)
    page.fill('#suUser','Mo'); page.fill('#suPass','polish-pass-1'); page.fill('#suConf','polish-pass-1')
    page.click('[data-action="first-run"]')
    page.wait_for_selector('body:not(.auth-gate)', timeout=45000)
    page.wait_for_timeout(2200); ack_gate(page); page.wait_for_timeout(600)
    # 3. welcome / chooser
    page.screenshot(path=OUT+'/02-welcome.png')
    page.wait_for_timeout(1200)
    print('  [i] post-setup hash:', page.evaluate('location.hash'))
    wiz = page.locator('[data-action="wiz-open"]').first
    wiz.wait_for(state='visible', timeout=25000)
    wiz.click(); page.wait_for_timeout(600)
    page.fill('#wiz-name','Sample 2026 Spring'); page.fill('#wiz-school','ZFY'); page.fill('#wiz-class','P4C4'); page.fill('#wiz-teachers','Mo')
    page.check('input[name="wiz-rmode"][value="paste"]'); page.wait_for_timeout(300)
    page.fill('#wiz-paste', 'demo-01, Wang Xiaoming, Wang Xiaoming, M' + chr(10) + 'demo-02, Li Li, Lily Li, F' + chr(10) + 'demo-03, Chen Qiang, Jack Chen, M')
    page.click('[data-action="wiz-create"]'); page.wait_for_timeout(1800)
    cx = page.locator('#dlg [data-action="dlg-close"]').first
    if cx.count(): cx.click(); page.wait_for_timeout(500)
    ack_gate(page)
    # 4. dashboard
    page.goto('http://127.0.0.1:8799/index.html#/dashboard'); page.wait_for_timeout(1400)
    page.screenshot(path=OUT+'/03-dashboard.png')
    # 5. students (roster editor now here)
    page.goto('http://127.0.0.1:8799/index.html#/students'); page.wait_for_timeout(1400)
    page.screenshot(path=OUT+'/04-students.png', full_page=False)
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)"); page.wait_for_timeout(400)
    page.screenshot(path=OUT+'/05-students-editor.png')
    # 6. entry
    page.goto('http://127.0.0.1:8799/index.html#/entry'); page.wait_for_timeout(1400)
    page.screenshot(path=OUT+'/06-entry.png')
    # 7. reports list
    page.goto('http://127.0.0.1:8799/index.html#/reports'); page.wait_for_timeout(1400)
    page.screenshot(path=OUT+'/07-reports.png')
    # 8. report card (screen)
    sid = page.evaluate("(document.body.innerText.match(/demo-\\d\\d/)||[''])[0]")
    page.wait_for_timeout(1200)
    page.locator('a', has_text='Student report cards').first.click(); page.wait_for_timeout(700)
    sel = page.locator('select').first
    sel.wait_for(state='visible', timeout=15000)
    sel.select_option(index=0)
    page.wait_for_timeout(900)
    print('  [i] buttons:', page.evaluate("Array.from(document.querySelectorAll('button')).map(function(b){return b.textContent.trim()}).filter(function(t){return t}).slice(0,12).join(' | ')"))
    page.locator('button', has_text='View Report Card').first.click(); page.wait_for_timeout(1600)
    page.screenshot(path=OUT+'/08-report-card.png', full_page=True)
    # print pdf
    page.emulate_media(media='print')
    page.pdf(path=OUT+'/08-report-card-print.pdf', format='A4', print_background=True)
    page.emulate_media(media='screen')
    # 9. users (admin)
    page.goto('http://127.0.0.1:8799/index.html#/users'); page.wait_for_timeout(1200)
    page.screenshot(path=OUT+'/09-users.png')
    # 10. manage
    page.goto('http://127.0.0.1:8799/index.html#/manage'); page.wait_for_timeout(1200)
    page.screenshot(path=OUT+'/10-manage.png')
    # 11. phone view of dashboard
    pg2 = ctx.new_page()
    pg2.set_viewport_size({'width':390,'height':844})
    pg2.goto('http://127.0.0.1:8799/index.html#/dashboard'); pg2.wait_for_timeout(1500)
    pg2.screenshot(path=OUT+'/11-phone-dashboard.png')
    check(len(errs)==0, 'zero page errors across all screens' + ('' if not errs else ': '+'; '.join(errs[:3])))
    b.close()
import pymupdf
d = pymupdf.open(OUT+'/08-report-card-print.pdf')
check(len(d)==1, 'report-card print PDF is exactly 1 A4 page (got '+str(len(d))+')')
print('TOTAL:', 'ALL PASS' if not fails else str(len(fails))+' FAILURES')
