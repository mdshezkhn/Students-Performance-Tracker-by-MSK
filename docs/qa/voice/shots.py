# B4 evidence: screenshots (sign-in, entry, report card, notice EN + 中文) and
# the report-card print PDF page count.
import functools, http.server, socketserver, threading, time, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PORT = 8936
def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('127.0.0.1', PORT), handler) as h: h.serve_forever()
threading.Thread(target=serve, daemon=True).start(); time.sleep(0.6)
from playwright.sync_api import sync_playwright
OUT = os.path.dirname(os.path.abspath(__file__))
BASE = f'http://127.0.0.1:{PORT}'

def gate(pg):
    pg.goto(BASE + '/app/index.html#/dashboard'); pg.wait_for_timeout(1300)
    for t in range(30):
        moved = False
        if pg.locator('#notice-read').count():
            pg.locator('#notice-read').check(); pg.wait_for_timeout(150); moved = True
        for sel in ['[data-action="privacy-gate-ack"]', '[data-action="privacy-ack"]']:
            if pg.locator(sel).count():
                pg.locator(sel).first.click(); pg.wait_for_timeout(300); moved = True
        if not moved and ('auth-gate' not in (pg.get_attribute('body', 'class') or '')) and pg.locator('#content, [data-action="show-setup"], #loginUser').count():
            return
        pg.wait_for_timeout(250)

with sync_playwright() as pw:
    b = pw.chromium.launch(channel='msedge', headless=True)
    ctx = b.new_context(viewport={'width': 1280, 'height': 880})

    # 1. sign-in screen (fresh profile)
    pg = ctx.new_page()
    pg.goto(BASE + '/app/index.html#/dashboard'); pg.wait_for_timeout(1300)
    for sel in ['[data-action="privacy-gate-ack"]', '[data-action="privacy-ack"]']:
        if pg.locator(sel).count():
            if pg.locator('#notice-read').count(): pg.locator('#notice-read').check(); pg.wait_for_timeout(150)
            pg.locator(sel).first.click(); pg.wait_for_timeout(400)
    pg.wait_for_selector('#loginUser', timeout=12000)
    pg.screenshot(path=os.path.join(OUT, 'sign-in.png'))

    # 2. set up admin + sample data
    if pg.locator('[data-action="show-setup"]').count():
        pg.locator('[data-action="show-setup"]').first.click(); pg.wait_for_timeout(300)
    pg.fill('#suUser', 'Mo'); pg.fill('#suPass', 'voice-pass-1'); pg.fill('#suConf', 'voice-pass-1')
    pg.locator('[data-action="first-run"]').click(); pg.wait_for_timeout(1500)
    # data-safety (merged 2026-10-28): first-run stops at a recovery-path dialog
    for _ in range(20):
        if pg.locator('[data-action="recovery-ack"]').count():
            pg.locator('[data-action="recovery-dl"]').first.click(); pg.wait_for_timeout(200)
            cb = pg.locator('#recoverySaved')
            if cb.count() and cb.is_enabled(): cb.check(); pg.wait_for_timeout(150)
            pg.locator('[data-action="recovery-ack"]').first.click(); pg.wait_for_timeout(400)
        if 'auth-gate' not in (pg.get_attribute('body', 'class') or ''): break
        pg.wait_for_timeout(300)
    if pg.locator('[data-action="load-sample"]').count():
        pg.locator('[data-action="load-sample"]').first.click(); pg.wait_for_timeout(600)
        if pg.locator('#dlg [data-x="1"]').count():
            pg.locator('#dlg [data-x="1"]').first.click(); pg.wait_for_timeout(800)
    pg.wait_for_timeout(1200)

    # 3. notice dialog EN + 中文 (footer link; admin signed in)
    pg.locator('[data-action="privacy-open"]').first.click(); pg.wait_for_timeout(600)
    pg.screenshot(path=os.path.join(OUT, 'notice-en.png'))
    pg.locator('[data-action="notice-lang"][data-lang="zh"]').first.click(); pg.wait_for_timeout(500)
    pg.screenshot(path=os.path.join(OUT, 'notice-zh.png'))
    pg.locator('#dlg [data-action="dlg-close"]').first.click(); pg.wait_for_timeout(300)

    # 4. entry view
    pg.goto(BASE + '/app/index.html#/entry/sp'); pg.wait_for_timeout(1500)
    pg.screenshot(path=os.path.join(OUT, 'entry.png'))

    # 5. report card (first student) — screen + print PDF page count
    pg.goto(BASE + '/app/index.html#/reports/student'); pg.wait_for_timeout(1500)
    card = pg.locator('.rc, [class*="report-card"], #content table').first
    pg.screenshot(path=os.path.join(OUT, 'report-card.png'), full_page=True)
    pg.emulate_media(media='print')
    pdf = pg.pdf(path=os.path.join(OUT, 'report-card.pdf'), format='A4', print_background=True)
    pg.emulate_media(media='screen')
    size = os.path.getsize(os.path.join(OUT, 'report-card.pdf'))
    log = 'report-card.pdf written (%d bytes); page count check: ' % size
    try:
        from pypdf import PdfReader
        log += str(len(PdfReader(os.path.join(OUT, 'report-card.pdf')).pages)) + ' page(s)'
    except Exception:
        import re
        raw = open(os.path.join(OUT, 'report-card.pdf'), 'rb').read()
        log += str(max(len(re.findall(rb'/Type\s*/Page[^s]', raw)), 0)) + ' page(s) (raw scan)'
    print(log)
    b.close()
