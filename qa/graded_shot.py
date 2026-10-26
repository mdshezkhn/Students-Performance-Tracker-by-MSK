import http.server, threading, os, re
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath('app')
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self): self.send_header('Cache-Control','no-store'); super().end_headers()
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8801), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = 'docs/qa/polish'
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
    page = b.new_context(viewport={'width':1280,'height':850}).new_page()
    page.goto('http://127.0.0.1:8801/index.html'); page.wait_for_timeout(900); ack_gate(page)
    su = page.locator('[data-action="show-setup"]')
    if su.count(): su.first.click()
    else: page.locator('a,button', has_text='Set up this browser').first.click()
    page.wait_for_timeout(500)
    page.fill('#suUser','Mo'); page.fill('#suPass','graded-pass-1'); page.fill('#suConf','graded-pass-1')
    page.click('[data-action="first-run"]')
    page.wait_for_selector('body:not(.auth-gate)', timeout=45000)
    page.wait_for_timeout(2000); ack_gate(page)
    # load sample via Manage -> Advanced
    page.evaluate("window.location.hash='#/manage'"); page.wait_for_timeout(900)
    d = page.locator('details summary')
    for i in range(d.count()):
        d.nth(i).click(); page.wait_for_timeout(200)
        if page.locator('[data-action="load-sample"]').count(): break
    page.locator('[data-action="load-sample"]').first.click()
    page.wait_for_timeout(500)
    try:
        page.wait_for_selector('[data-action="first-run"]', timeout=8000)
        page.fill('#suUser','Mo'); page.fill('#suPass','graded-pass-1'); page.fill('#suConf','graded-pass-1')
        page.click('[data-action="first-run"]')
    except Exception: pass
    page.wait_for_timeout(2500); ack_gate(page); page.wait_for_timeout(800)
    # reports -> student cards -> first student -> view card
    page.goto('http://127.0.0.1:8801/index.html#/reports'); page.wait_for_timeout(1300)
    page.locator('a', has_text='Student report cards').first.click(); page.wait_for_timeout(700)
    sel = page.locator('select').first
    sel.wait_for(state='visible', timeout=15000); sel.select_option(index=0); page.wait_for_timeout(800)
    page.locator('button', has_text='View Report Card').first.click(); page.wait_for_timeout(1700)
    page.screenshot(path=OUT+'/12-report-card-graded.png', full_page=True)
    page.emulate_media(media='print')
    page.pdf(path=OUT+'/12-report-card-graded-print.pdf', format='A4', print_background=True)
    b.close()
doc = __import__('pymupdf').open(OUT+'/12-report-card-graded-print.pdf')
print('print pages:', len(doc))
