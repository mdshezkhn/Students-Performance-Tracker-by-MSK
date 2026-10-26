import http.server, threading, os, sys, re
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath('app')
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self): self.send_header('Cache-Control','no-store'); super().end_headers()
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8797), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context()
    page = ctx.new_page()
    page.goto('http://127.0.0.1:8797/index.html')
    page.wait_for_timeout(900)
    try:
        page.wait_for_selector('[data-action="privacy-gate-ack"]', timeout=4000)
        page.click('[data-action="privacy-gate-ack"]'); page.wait_for_timeout(300)
        g = page.locator('[data-action="privacy-ack"]')
        if g.count(): g.first.click(); page.wait_for_timeout(300)
    except Exception: pass
    page.wait_for_timeout(600)
    page.evaluate("window.location.hash='#/manage'"); page.wait_for_timeout(700)
    btn = page.locator('[data-action="load-sample"]')
    if not btn.count():
        d = page.locator('details summary')
        for i in range(d.count()):
            d.nth(i).click(); page.wait_for_timeout(200)
            if page.locator('[data-action="load-sample"]').count(): break
    page.locator('[data-action="load-sample"]').first.click()
    page.wait_for_timeout(500)
    try:
        page.wait_for_selector('[data-action="first-run"]', timeout=8000)
        page.fill('#suUser','Mo'); page.fill('#suPass','print-probe-1'); page.fill('#suConf','print-probe-1')
        page.click('[data-action="first-run"]')
    except Exception: pass
    page.wait_for_selector('body:not(.auth-gate)', timeout=45000)
    page.wait_for_timeout(2500)
    try:
        page.wait_for_selector('[data-action="privacy-gate-ack"]', timeout=4000)
        page.click('[data-action="privacy-gate-ack"]'); page.wait_for_timeout(300)
        g = page.locator('[data-action="privacy-ack"]')
        if g.count(): g.first.click(); page.wait_for_timeout(300)
    except Exception: pass
    page.evaluate("window.location.hash='#/manage'"); page.wait_for_timeout(800)
    btn = page.locator('[data-action="load-sample"]')
    if not btn.count():
        d = page.locator('details summary')
        for i in range(d.count()):
            d.nth(i).click(); page.wait_for_timeout(250)
            if page.locator('[data-action="load-sample"]').count(): break
    if btn.count() or page.locator('[data-action="load-sample"]').count():
        page.locator('[data-action="load-sample"]').first.click()
        page.wait_for_timeout(4000)
    page.evaluate("window.location.hash='#/reports'"); page.wait_for_timeout(1200)
    sid = page.evaluate("(document.body.innerText.match(/demo-\\d\\d/)||[''])[0]")
    print('student:', sid)
    page.goto('http://127.0.0.1:8797/index.html#/report/'+sid); page.wait_for_timeout(2000)
    os.makedirs('docs/qa', exist_ok=True)
    page.screenshot(path='docs/qa/rc-screen.png', full_page=True)
    page.emulate_media(media='print')
    page.pdf(path='docs/qa/rc-print.pdf', format='A4', print_background=True)
    data = open('docs/qa/rc-print.pdf','rb').read()
    n = len(re.findall(rb'/Type\s*/Page[^s]', data))
    print('PDF pages:', n)
    b.close()
srv.server_close()
