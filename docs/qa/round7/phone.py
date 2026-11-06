# round7 item 3: phone/tablet layout checks in real Chromium (2026-10-30).
# Screens x 390x844 and 768x1024: no page-level horizontal scroll, tap
# targets (button/select/input) at least 40x40. Wide tables scroll inside
# their own container only.
# Usage: C:/Python314/python.exe phone.py [before|after]
import json, os, re, sys, time
from playwright.sync_api import sync_playwright

MODE = sys.argv[1] if len(sys.argv) > 1 else 'after'
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SHOTS = os.path.join(HERE, 'phone', MODE)
os.makedirs(SHOTS, exist_ok=True)
PORT = 8932

SCREENS = [
    ('signin',     None),
    ('classes',    '#/classes'),
    ('dashboard',  '#/dashboard'),
    ('entry',      '#/entry/sp'),
    ('reports',    '#/reports'),
    ('users',      '#/users'),
    ('manage',     '#/manage'),
]

def start(pg):
    pg.goto('http://127.0.0.1:%d/app/index.html' % PORT)
    pg.wait_for_timeout(700)
    for sel in ['[data-action="privacy-gate-ack"]', '[data-action="privacy-ack"]']:
        try:
            pg.wait_for_selector(sel, timeout=2500)
            cb = pg.locator('#notice-read')
            if cb.count() and not cb.is_checked():
                cb.check(); pg.wait_for_timeout(150)
            pg.locator(sel).first.click(); pg.wait_for_timeout(300)
        except Exception:
            pass

def sign_up(pg):
    try:
        pg.wait_for_selector('[data-action="show-setup"]', timeout=3000)
        pg.locator('[data-action="show-setup"]').first.click(); pg.wait_for_timeout(300)
    except Exception:
        pass
    pg.fill('#suUser', 'Mo'); pg.fill('#suPass', 'Str0ngPass!73'); pg.fill('#suConf', 'Str0ngPass!73')
    pg.locator('[data-action="first-run"]').first.click()
    # recovery gate
    pg.wait_for_selector('#dlg [data-action="recovery-dl"]', timeout=20000)
    with pg.expect_download() as dl:
        pg.locator('#dlg [data-action="recovery-dl"]').click(force=True)
    dl.value.save_as(os.path.join(SHOTS, 'recovery-file.json'))
    pg.wait_for_timeout(400)
    pg.locator('#dlg [data-action="recovery-ack"]').click(force=True)
    pg.wait_for_timeout(600)
    # welcome -> create the FIRST class through the wizard (class mode from day one)
    try:
        pg.wait_for_selector('[data-action="load-sample"]', timeout=4000)
        pg.goto('http://127.0.0.1:%d/app/index.html#/manage' % PORT); pg.wait_for_timeout(800)
    except Exception:
        pass
    pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
    try:
        pg.wait_for_selector('[data-action="wiz-open"]', timeout=5000)
        pg.locator('[data-action="wiz-open"]').first.click(); pg.wait_for_timeout(500)
        pg.evaluate("var el=document.querySelector('#wiz-months input'); if (el && !el.checked) el.click()")
        pg.fill('#wiz-name', 'P1A')
        pg.locator('[data-action="wiz-create"]').first.click()
        pg.wait_for_timeout(2500)
    except Exception as e:
        print('wizard flow note:', str(e)[:120])

def open_first_class(pg):
    try:
        pg.wait_for_selector('[data-action="class-open"]', timeout=4000)
        pg.locator('[data-action="class-open"]').first.click(); pg.wait_for_timeout(800)
    except Exception:
        pass

def check_screen(pg, name, url, w):
    if url: pg.goto('http://127.0.0.1:%d/app/index.html%s' % (PORT, url))
    pg.wait_for_timeout(900)
    m = pg.evaluate("""() => {
      const out = { sw: document.documentElement.scrollWidth, iw: window.innerWidth, bad: [] };
      if (out.sw > out.iw + 1) {
        // find the widest offenders for the report
        document.querySelectorAll('body *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right > out.iw + 2 && r.width > 30) out.bad.push(el.tagName + '.' + String(el.className).slice(0, 36) + ' right=' + Math.round(r.right) + ' w=' + Math.round(r.width));
        });
        out.bad = out.bad.slice(0, 5);
      }
      out.taps = [];
      document.querySelectorAll('button, select, input:not([type=hidden]):not([readonly]), textarea').forEach((el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || r.width === 0) return;
        if (el.closest('.no-print') && el.closest('.no-print').offsetParent === null && st.display === 'none') return;
        if (r.width < 39.5 || r.height < 39.5) out.taps.push(el.tagName + (el.getAttribute('data-action') ? '#' + el.getAttribute('data-action') : '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      out.taps = out.taps.slice(0, 6);
      return out;
    }""")
    shot = '%s-%d.png' % (name, w)
    pg.screenshot(path=os.path.join(SHOTS, shot), full_page=True)
    return name, w, m

def main():
    results = []
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch(channel='msedge', headless=True)
        except Exception:
            browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 1366, 'height': 900})
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        console_msgs = []
        pg.on('console', lambda m: console_msgs.append(m.type + ': ' + m.text[:160]))
        import subprocess, threading, http.server, functools, socketserver
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
        socketserver.TCPServer.allow_reuse_address = True
        srv = socketserver.TCPServer(('127.0.0.1', PORT), handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            start(pg); sign_up(pg); open_first_class(pg)
            for w, h in [(390, 844), (768, 1024)]:
                pg.set_viewport_size({'width': w, 'height': h})
                pg.goto('http://127.0.0.1:%d/app/index.html#/dashboard' % PORT)
                pg.wait_for_timeout(800)
                for name, url in SCREENS:
                    results.append(check_screen(pg, name, url, w))
            # dialogs at 390
            pg.set_viewport_size({'width': 390, 'height': 844})
            pg.goto('http://127.0.0.1:%d/app/index.html#/manage' % PORT); pg.wait_for_timeout(800)
            pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
            pg.reload(); pg.wait_for_timeout(4000)
            # the rail is collapsed on phones: click via JS (the DIALOG is under test)
            if pg.evaluate("!!document.querySelector('[data-action=\"privacy-open\"]')"):
                pg.evaluate("document.querySelector('[data-action=\"privacy-open\"]').click()"); pg.wait_for_timeout(700)
                results.append(check_screen(pg, 'notice-en', None, 390))
                zh = pg.locator('[data-action="notice-lang"][data-lang="zh"]')
                if zh.count():
                    zh.first.click(); pg.wait_for_timeout(500)
                    results.append(check_screen(pg, 'notice-zh', None, 390))
                pg.keyboard.press('Escape'); pg.evaluate("document.getElementById('dlg') && document.getElementById('dlg').close ? document.getElementById('dlg').close() : 0"); pg.wait_for_timeout(400)
            pg.goto('http://127.0.0.1:%d/app/index.html#/dashboard' % PORT)
            pg.reload(); pg.wait_for_timeout(4000)   # boot straight into the class shell
            if not pg.evaluate("!!document.querySelector('[data-action=\"share-hub\"]')"):
                pg.wait_for_timeout(2500)            # class auto-open may lag on a phone CPU
            if not pg.evaluate("!!document.querySelector('[data-action=\"share-hub\"]')"):
                pg.goto('http://127.0.0.1:%d/app/index.html#/classes' % PORT); pg.wait_for_timeout(1200)
            if not pg.evaluate("!!document.querySelector('[data-action=\"share-hub\"]')"):
                # landed on the class chooser: open the class, the top bar (and the hub) follow
                if pg.evaluate("!!document.querySelector('[data-action=\"class-open\"]')"):
                    pg.evaluate("document.querySelector('[data-action=\"class-open\"]').click()"); pg.wait_for_timeout(1500)
            if pg.evaluate("!!document.querySelector('[data-action=\"share-hub\"]')"):
                pg.evaluate("document.querySelector('[data-action=\"share-hub\"]').click()"); pg.wait_for_timeout(700)
                results.append(check_screen(pg, 'share-hub', None, 390))
            else:
                print('NOTE: no share-hub button on this screen (vault mode has no class top bar)')
        finally:
            srv.shutdown(); browser.close()
    fails = 0
    print('mode=%s' % MODE)
    for name, w, m in results:
        overflow = m['sw'] > m['iw'] + 1
        taps = m['taps']
        ok = (not overflow) and (not taps)
        if not ok: fails += 1
        print('%s@%d: %s sw=%d iw=%d %s%s' % (name, w, 'PASS' if ok else 'FAIL', m['sw'], m['iw'],
              ('overflow:' + ';'.join(m['bad'])) if overflow else '', (' tap<40:' + ';'.join(taps)) if taps else ''))
    print('page errors: %d' % len(errs))
    for e in errs[:5]: print('  ' + e[:160])
    if os.environ.get('CONSOLE_DBG'):
        interesting = [m for m in console_msgs if m.startswith(('error', 'warning')) or 'full' in m or 'fail' in m.lower()]
        print('console (interesting %d of %d):' % (len(interesting), len(console_msgs)))
        for m in interesting[:12]: print('  ' + m)
    print('PHONE[%s]: %d checks, %d FAIL' % (MODE, len(results), fails))
    sys.exit(1 if fails or errs else 0)

main()
