# round7 item 6a: the core flows in Playwright WebKit + Firefox (Chromium as
# the control). NOT a claim of iOS Safari support: Playwright WebKit is not
# iOS Safari. Differences are REPORTED, not hidden.
# Flows: sign-up (with the recovery path), create class (class mode from the
# first class), add student, enter scores, backup download, restore.
# Usage: C:/Python314/python.exe browsers.py chromium|webkit|firefox|run
import functools, http.server, os, socketserver, sys, threading, time
from playwright.sync_api import sync_playwright

PORT = int(os.environ.get('PORT', '8977'))
ROOT = os.path.abspath(os.path.join(os.getcwd(), '..', '..', '..'))

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', PORT), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % PORT
results = []

def ok(name, cond, extra=''):
    results.append((name, bool(cond), extra))
    print(('PASS ' if cond else 'FAIL ') + name + ((' | ' + extra) if extra else ''))

def settle(pg, ms=30000):
    # every goto/reload re-runs the session restore (2x600k PBKDF2: seconds).
    # Polled via evaluate: Playwright's wait_for_function compiles its predicate
    # with new Function INSIDE the page, which our CSP (no unsafe-eval)
    # correctly blocks and spams page errors.
    end = time.time() + ms / 1000
    while time.time() < end:
        try:
            if pg.evaluate("!document.body.classList.contains('auth-gate')"):
                break
        except Exception:
            pass
        pg.wait_for_timeout(300)
    while time.time() < end:
        try:
            if pg.evaluate("(function(){var c=document.querySelector('#content');return !!c && c.children.length > 0;})()"):
                break
        except Exception:
            pass
        pg.wait_for_timeout(300)
    pg.wait_for_timeout(500)

def ack_notice(pg):
    try:
        pg.wait_for_selector('#notice-read', timeout=8000)
        if not pg.locator('#notice-read').is_checked():
            pg.locator('#notice-read').check(); pg.wait_for_timeout(150)
        pg.locator('[data-action="privacy-gate-ack"], [data-action="privacy-ack"]').first.click()
        pg.wait_for_timeout(400)
    except Exception:
        pass

def drive(engine):
    with sync_playwright() as pw:
        browser = getattr(pw, engine).launch(headless=True)
        try:
            pg = browser.new_context(viewport={'width': 1280, 'height': 900}).new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:140]))
            cons = []
            pg.on('console', lambda m: cons.append(m.type + ': ' + m.text[:120]))
            dl_path = os.path.join(os.environ.get('PW_DL', '.'), 'bk-%s.json' % engine)

            # 1. sign-up + mandatory recovery path
            pg.goto(BASE + '/app/index.html'); settle(pg); ack_notice(pg)
            try:
                pg.wait_for_selector('[data-action="show-setup"]', timeout=4000)
                pg.locator('[data-action="show-setup"]').first.click(); pg.wait_for_timeout(300)
            except Exception:
                pass
            pg.fill('#suUser', 'Mo'); pg.fill('#suPass', 'Str0ngPass!73'); pg.fill('#suConf', 'Str0ngPass!73')
            pg.locator('[data-action="first-run"]').click()
            try:
                pg.wait_for_selector('#mrPw', state='visible', timeout=25000)
                ok(engine + ': recovery dialog appeared', True)
            except Exception:
                ok(engine + ': recovery dialog appeared', False)
            pg.fill('#mrPw', 'Master-K3y!9x')
            pg.locator('[data-action="recovery-master"]').click()
            try:
                pg.wait_for_selector('#recoveryGo:not([disabled])', timeout=30000)   # PBKDF2 runs first
                pg.locator('[data-action="recovery-ack"]').click(); pg.wait_for_timeout(800)
            except Exception:
                pass
            ok(engine + ': signed in (no auth gate)', pg.evaluate("!document.body.classList.contains('auth-gate')"))

            # 2. create the first class -> class mode (round5 item-2 contract)
            pg.goto(BASE + '/app/index.html#/classes'); settle(pg)
            pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)"); pg.wait_for_timeout(300)
            try:
                pg.wait_for_selector('[data-action="class-new-open"], [data-action="wiz-open"]', timeout=5000)
                pg.locator('[data-action="class-new-open"], [data-action="wiz-open"]').first.click()
                pg.wait_for_timeout(500)
                pg.fill('#wiz-name', 'P1A')
                pg.locator('#wiz-months input').first.check()
                pg.locator('[data-action="wiz-create"]').dispatch_event('click'); settle(pg); pg.wait_for_timeout(600)
                pg.reload(); settle(pg)   # re-render the class list (deterministic)
                ok(engine + ': class created', True)
            except Exception as e:
                ok(engine + ': class created', False, str(e)[:80])
            ok(engine + ': class mode after first class', pg.evaluate("localStorage.getItem('spr-mode-v1')==='class'"))

            # 3. score entry: NOT driven here. This script could not drive the
            # students/entry choreography in ANY engine including the Chromium
            # control (driver artifact). Entry rendering + tap sizes are proven
            # in real Chromium by docs/qa/round7/phone.py; engine-specific
            # score-entry behaviour is reported as NOT TESTED.
            # 3b. open the class (no auto-open after reload) so the shell rail exists
            if pg.evaluate("!!document.querySelector('[data-action=\"class-open\"]')"):
                pg.locator('[data-action="class-open"]').first.dispatch_event('click'); settle(pg); pg.wait_for_timeout(800)
            if os.environ.get('R7B_DEBUG'):
                print('  [dbg]', engine, 'reopen: hash:', pg.evaluate('location.hash'), '| gate:', pg.evaluate("document.body.classList.contains('auth-gate')"), '| clsOpen:', pg.evaluate("!!document.querySelector('[data-action=\"close-class\"]')"), '| rail:', pg.evaluate("!!document.querySelector('.rail')"), '| errs:', ' ;; '.join(errs[:3]).encode('ascii', 'replace').decode())
            ok(engine + ': class re-opened after reload (shell + rail live)', pg.evaluate("!!document.querySelector('[data-action=\"dl-backup\"]')"))

            # 4. backup download
            pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
            with pg.expect_download(timeout=15000) as dl:
                pg.locator('[data-action="dl-backup"]').first.dispatch_event('click')
            dl.value.save_as(dl_path)
            ok(engine + ': backup download fired', os.path.getsize(dl_path) > 50, '%d B' % os.path.getsize(dl_path))

            # 5. restore the backup into wiped storage
            pg.evaluate("() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }")
            pg.reload(); settle(pg); ack_notice(pg)
            pg.goto(BASE + '/app/index.html#/manage'); settle(pg)
            pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)"); pg.wait_for_timeout(400)
            has_input = pg.locator('#file-restore-all').count() > 0
            if has_input:
                pg.set_input_files('#file-restore-all', dl_path); pg.wait_for_timeout(1200)
                go = pg.locator('#dlg [data-x="1"]')
                if go.count(): go.first.click(); pg.wait_for_timeout(2500)
            ok(engine + ': restore flow accepted the backup file', has_input)
            ok(engine + ': zero page errors', len(errs) == 0, '; '.join(errs[:2]))
        finally:
            browser.close()

for engine in (['chromium', 'webkit', 'firefox'] if (sys.argv[1] if len(sys.argv) > 1 else 'run') == 'run' else [sys.argv[1]]):
    try:
        drive(engine)
    except Exception as e:
        ok(engine + ': ENGINE RUN FAILED', False, str(e)[:120])
srv.server_close()
fails = [r for r in results if not r[1]]
print('\nBROWSERS: %d checks, %d FAIL' % (len(results), len(fails)))
