"""Before/after visual regression for the two-teacher hardening (2026-11-02).

Shoots the landing + app (dashboard, entry grid, report card) from two builds
of the repo and pixel-compares them. Any diff beyond anti-aliasing noise means
a visual change slipped in.

Usage:
  python qa/visual_compare.py <dirA> <dirB>
    <dirA> = baseline repo root (e.g. a worktree of origin/main, built)
    <dirB> = candidate repo root (built)
Output: qa/visual-diff/<name>.A.png / .B.png / .diff.png + report
"""
import http.server, threading, os, sys, io

ROOT_A, ROOT_B = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'qa', 'visual-diff')
os.makedirs(OUT, exist_ok=True)
PORT_A, PORT_B = 8901, 8902

def serve(root, port):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=root, **k)
        def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

serve(os.path.join(ROOT_A, 'app'), PORT_A)
serve(os.path.join(ROOT_B, 'app'), PORT_B)

from playwright.sync_api import sync_playwright

def ack_gate(page):
    """Clear the privacy gate (tick #notice-read, then ack) and any follow-up
    notice dialogs. Safe to call repeatedly."""
    for _ in range(3):
        try:
            page.wait_for_selector('[data-action="privacy-gate-ack"], [data-action="privacy-ack"]', timeout=4000)
        except Exception:
            return
        box = page.locator('#notice-read')
        if box.count():
            try: box.first.check(timeout=1500)
            except Exception: pass
        b1 = page.locator('[data-action="privacy-gate-ack"]')
        if b1.count():
            try: b1.first.click(timeout=3000)
            except Exception: return
        else:
            b2 = page.locator('[data-action="privacy-ack"]')
            if b2.count():
                try: b2.first.click(timeout=3000)
                except Exception: return
            else:
                return
        page.wait_for_timeout(400)

SHOTS = []   # (name, fn(page, base))

def shoot_landing(page, base, name):
    page.goto(base + '/index.html'); page.wait_for_timeout(2600)
    page.screenshot(path=OUT + '/' + name + '.png', full_page=True)

def shoot_app(page, base, name):
    page.goto(base + '/index.html'); page.wait_for_timeout(1100); ack_gate(page)
    su = page.locator('[data-action="show-setup"]')
    if su.count(): su.first.click(); page.wait_for_timeout(400)
    page.fill('#suUser', 'Mo'); page.fill('#suPass', 'shot-pass-1'); page.fill('#suConf', 'shot-pass-1')
    page.click('[data-action="first-run"]')
    # P0 first-run asks for a recovery path (master password / recovery file)
    try:
        page.wait_for_selector('[data-action="recovery-ack"]', timeout=6000)
        cb = page.locator('#recoverySaved')
        if cb.count(): cb.first.check()
        page.click('[data-action="recovery-ack"]'); page.wait_for_timeout(600)
    except Exception: pass
    try:
        page.wait_for_selector('body:not(.auth-gate)', timeout=30000)
    except Exception:
        raise RuntimeError('still gated after first-run: body=' + page.evaluate('document.body.className'))
    page.wait_for_timeout(1800); ack_gate(page)
    page.evaluate("location.hash='#/manage'"); page.wait_for_timeout(900)
    d = page.locator('details summary')
    for i in range(d.count()):
        d.nth(i).click(); page.wait_for_timeout(150)
        if page.locator('[data-action="load-sample"]').count(): break
    page.locator('[data-action="load-sample"]').first.click(); page.wait_for_timeout(600)
    try:
        page.wait_for_selector('[data-action="first-run"]', timeout=6000)
        page.fill('#suUser', 'Mo'); page.fill('#suPass', 'shot-pass-1'); page.fill('#suConf', 'shot-pass-1')
        page.click('[data-action="first-run"]')
    except Exception: pass
    page.wait_for_timeout(2200); ack_gate(page); page.wait_for_timeout(700)
    if name.endswith('dashboard'):
        page.evaluate("location.hash='#/dashboard'"); page.wait_for_timeout(1400)
    elif name.endswith('entry'):
        page.evaluate("location.hash='#/entry'"); page.wait_for_timeout(1400)
    elif name.endswith('report'):
        page.evaluate("location.hash='#/reports'"); page.wait_for_timeout(1300)
        page.locator('a', has_text='Student report cards').first.click(); page.wait_for_timeout(700)
        sel = page.locator('select').first
        sel.wait_for(state='visible', timeout=15000); sel.select_option(index=0); page.wait_for_timeout(700)
        page.locator('button', has_text='View Report Card').first.click(); page.wait_for_timeout(1700)
    page.screenshot(path=OUT + '/' + name + '.png', full_page=True)

NAMES = ['landing', 'app-dashboard', 'app-entry', 'app-report']
errs = {'A': [], 'B': []}
with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge')
    for tag, port in (('A', PORT_A), ('B', PORT_B)):
        ctx = b.new_context(viewport={'width': 1280, 'height': 850})
        page = ctx.new_page()
        msgs = []
        page.on('console', lambda m: msgs.append(m.type + ': ' + m.text[:160]))
        page.on('pageerror', lambda e: msgs.append('pageerror: ' + str(e)[:160]))
        base = 'http://127.0.0.1:%d' % port
        try:
            shoot_landing(page, base, tag + '-landing')
            for n in NAMES[1:]:
                ctx2 = b.new_context(viewport={'width': 1280, 'height': 850})
                p2 = ctx2.new_page()
                p2.on('pageerror', lambda e: errs[tag].append(str(e)[:160]))
                try: shoot_app(p2, base, tag + '-' + n)
                except Exception as ex: errs[tag].append(n + ': ' + str(ex)[:200])
                ctx2.close()
        except Exception as ex:
            errs[tag].append('landing: ' + str(ex)[:200])
        errs[tag].extend([m for m in msgs if m.startswith('error') or m.startswith('pageerror')][:6])
        ctx.close()
    b.close()

# ---- pixel compare ----
from PIL import Image, ImageChops
report = []
for n in NAMES:
    fa, fb = OUT + '/A-' + n + '.png', OUT + '/B-' + n + '.png'
    if not (os.path.exists(fa) and os.path.exists(fb)):
        report.append('%-16s MISSING (A=%s B=%s)' % (n, os.path.exists(fa), os.path.exists(fb))); continue
    ia, ib = Image.open(fa).convert('RGB'), Image.open(fb).convert('RGB')
    if ia.size != ib.size:
        report.append('%-16s SIZE A=%s B=%s  <-- LAYOUT CHANGE' % (n, ia.size, ib.size)); continue
    diff = ImageChops.difference(ia, ib)
    bbox = diff.getbbox()
    if bbox is None:
        report.append('%-16s IDENTICAL' % n)
    else:
        # count changed pixels > threshold (anti-alias tolerance)
        hist = diff.convert('L').histogram(); changed = sum(hist[12:])
        total = ia.size[0] * ia.size[1]
        pct = 100.0 * changed / total
        diff.save(OUT + '/' + n + '.diff.png')
        report.append('%-16s differs: %.3f%% pixels changed, bbox=%s' % (n, pct, bbox))
print('== VISUAL COMPARE ==')
for r in report: print(' ', r)
for tag in ('A', 'B'):
    if errs[tag]: print('  console/page errors [%s]:' % tag, errs[tag][:8])
print('shots in', OUT)
