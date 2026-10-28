# A1 evidence: cold-load network capture (landing + app, sync off, 2026-10-28).
# Answers: which hosts does SPR contact on a normal visit? The landing page
# claims must match exactly what this capture shows.
import functools, http.server, socketserver, threading, time, os, json
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PORT = 8934
def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('127.0.0.1', PORT), handler) as h: h.serve_forever()
threading.Thread(target=serve, daemon=True).start(); time.sleep(0.6)
from playwright.sync_api import sync_playwright
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'network-hosts.txt')
lines = []
def log(s):
    print(s); lines.append(s)

with sync_playwright() as pw:
    b = pw.chromium.launch(channel='msedge', headless=True)
    ctx = b.new_context()
    seen = {}
    def on_request(req):
        from urllib.parse import urlsplit
        u = urlsplit(req.url)
        seen.setdefault(u.netloc, []).append(req.url[:120])
    ctx.on('request', on_request)
    pg = ctx.new_page()

    log('SPR network capture — cold load, no sign-in, device sync OFF')
    log('Captured with Playwright + Edge (Chromium), ' + time.strftime('%Y-%m-%d %H:%M') + ', local server = 127.0.0.1 (not contacted remotely)')
    log('')
    log('[1] landing page (index.html), first visit in a fresh profile')
    pg.goto(f'http://127.0.0.1:{PORT}/index.html'); pg.wait_for_timeout(3500)
    log('')
    log('[2] app (app/index.html), fresh profile, no sign-in performed, sync off')
    pg2 = ctx.new_page()
    pg2.goto(f'http://127.0.0.1:{PORT}/app/index.html#/dashboard'); pg2.wait_for_timeout(4000)
    log('')
    log('[3] app, signed in as admin (sample data), sync STILL off')
    for t in range(40):
        got = False
        if pg2.locator('#notice-read').count():
            pg2.locator('#notice-read').check(); pg2.wait_for_timeout(150)
        for sel in ['[data-action="privacy-gate-ack"]', '[data-action="privacy-ack"]']:
            if pg2.locator(sel).count():
                pg2.locator(sel).first.click(); pg2.wait_for_timeout(300); got = True
        if not got and pg2.locator('[data-action="show-setup"], #loginUser').count():
            break
        pg2.wait_for_timeout(300)
    try:
        pg2.wait_for_selector('[data-action="show-setup"]', timeout=12000)
        pg2.locator('[data-action="show-setup"]').first.click(); pg2.wait_for_timeout(400)
    except Exception as e:
        log('  [setup] ' + str(e).splitlines()[0] + ' | dlg: ' + (pg2.text_content('#dlg') or '')[:80])
    pg2.wait_for_selector('#suUser', timeout=15000)
    pg2.fill('#suUser', 'Mo'); pg2.fill('#suPass', 'capture-pass-1'); pg2.fill('#suConf', 'capture-pass-1')
    pg2.locator('[data-action="first-run"]').click(); pg2.wait_for_timeout(2000)
    try:
        pg2.wait_for_selector('[data-action="recovery-ack"]', timeout=15000)
        pg2.locator('[data-action="recovery-dl"]').click(); pg2.wait_for_timeout(250)
        cb = pg2.locator('#recoverySaved')
        if not cb.is_disabled(): cb.check()
        pg2.locator('[data-action="recovery-ack"]').click()
    except Exception: pass
    pg2.wait_for_timeout(1000)
    try:
        pg2.wait_for_selector('[data-action="load-sample"]', timeout=5000)
        pg2.locator('[data-action="load-sample"]').first.click(); pg2.wait_for_timeout(2500)
    except Exception: pass
    pg2.goto(f'http://127.0.0.1:{PORT}/app/index.html#/students'); pg2.wait_for_timeout(2500)
    pg2.goto(f'http://127.0.0.1:{PORT}/app/index.html#/reports/student'); pg2.wait_for_timeout(2500)
    log('')
    log('=== hosts contacted (total unique: %d) ===' % len(seen))
    for host in sorted(seen):
        log(f'{host}  ({len(seen[host])} request(s))')
        if host.startswith('127.0.0.1') or host == 'localhost':
            for u in seen[host][:6]: log('    ' + u)
            if len(seen[host]) > 6: log('    ... +%d more local asset requests' % (len(seen[host]) - 6))
    remote = [h for h in seen if not (h.startswith('127.0.0.1') or h == 'localhost')]
    log('')
    log('CONCLUSION: remote hosts contacted with sync off: ' + (', '.join(remote) if remote else 'NONE — everything came from this machine'))
    b.close()

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')
print('written', OUT)
