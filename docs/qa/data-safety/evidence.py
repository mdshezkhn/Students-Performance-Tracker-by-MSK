# data-safety evidence in real Chromium/Edge (2026-10-28)
# Covers: item 1 two-tab overwrite refusal, item 2 false-Saved banner,
# item 4 password policy, item 8 reset.html gate.
import functools, http.server, socketserver, threading, os, sys, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PORT = 8923
OUT = os.path.dirname(os.path.abspath(__file__))
log_lines = []

def log(s):
    print(s, flush=True)
    log_lines.append(s)

def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('127.0.0.1', PORT), handler) as h:
        h.serve_forever()

threading.Thread(target=serve, daemon=True).start()
time.sleep(0.6)
BASE = f'http://127.0.0.1:{PORT}'

from playwright.sync_api import sync_playwright

def ack_privacy(pg):
    for sel in ['[data-action="privacy-gate-ack"]', '[data-action="privacy-ack"]']:
        try:
            pg.wait_for_selector(sel, timeout=2500)
            try:
                cbx = pg.locator('#notice-read')   # merged build: notice gate checkbox enables the button
                if cbx.count() and not cbx.is_checked():
                    cbx.check(); pg.wait_for_timeout(150)
            except Exception:
                pass
            pg.locator(sel).first.click()
            pg.wait_for_timeout(300)
        except Exception:
            pass

def first_run(pg, user, pw):
    pg.goto(BASE + '/app/index.html#/dashboard')
    pg.wait_for_timeout(1200)
    ack_privacy(pg)
    try:
        pg.wait_for_selector('[data-action="show-setup"]', timeout=4000)
        pg.locator('[data-action="show-setup"]').first.click()
    except Exception:
        pass
    pg.wait_for_selector('#suUser', timeout=8000)
    pg.fill('#suUser', user); pg.fill('#suPass', pw); pg.fill('#suConf', pw)
    pg.locator('[data-action="first-run"]').click()
    # item 4: mandatory recovery-path dialog
    try:
        pg.wait_for_selector('[data-action="recovery-ack"]', timeout=20000)
        pg.locator('[data-action="recovery-dl"]').click()
        pg.wait_for_timeout(300)
        cb = pg.locator('#recoverySaved')
        if not cb.is_disabled():
            cb.check()
        pg.locator('[data-action="recovery-ack"]').click()
    except Exception as e:
        log('  [recovery step] ' + str(e).splitlines()[0])
    pg.wait_for_timeout(1500)
    return 'auth-gate' not in (pg.get_attribute('body', 'class') or '')

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='msedge', headless=True)
    errors = []

    # ---------- item 4: password "1" must be rejected ----------
    ctx = browser.new_context()
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append('setup: ' + str(e)[:120]))
    pg.goto(BASE + '/app/index.html#/dashboard'); pg.wait_for_timeout(1200)
    ack_privacy(pg)
    try:
        pg.wait_for_selector('[data-action="show-setup"]', timeout=4000)
        pg.locator('[data-action="show-setup"]').first.click()
    except Exception:
        pass
    pg.wait_for_selector('#suUser', timeout=8000)
    pg.fill('#suUser', 'Mo'); pg.fill('#suPass', '1'); pg.fill('#suConf', '1')
    pg.locator('[data-action="first-run"]').click()
    pg.wait_for_timeout(600)
    err = (pg.text_content('#suErr') or '').strip()
    log('item4 password "1" rejected: ' + ('PASS — ' + err if err else 'FAIL'))
    pg.screenshot(path=os.path.join(OUT, 'chromium-pw-reject.png'))
    ctx.close()

    # ---------- items 1 + 2: shared-context tabs ----------
    ctx = browser.new_context()
    pgA = ctx.new_page()
    pgA.on('pageerror', lambda e: errors.append('A: ' + str(e)[:120]))
    ok = first_run(pgA, 'Mo', 'owner-pass-99')
    log('item1 admin signed in (setup + recovery path): ' + ('PASS' if ok else 'FAIL'))

    # seed sample data so the students editor exists
    try:
        pgA.wait_for_selector('[data-action="load-sample"]', timeout=6000)
        pgA.locator('[data-action="load-sample"]').first.click()
        pgA.wait_for_timeout(2500)
        log('item1 sample data loaded: PASS')
    except Exception:
        log('item1 sample data loaded: (no button — maybe already seeded)')

    pgA.goto(BASE + '/app/index.html#/students'); pgA.wait_for_timeout(900)

    # tab B: same browser profile, fresh page → sign in again
    pgB = ctx.new_page()
    pgB.on('pageerror', lambda e: errors.append('B: ' + str(e)[:120]))
    pgB.goto(BASE + '/app/index.html#/dashboard'); pgB.wait_for_timeout(1200)
    ack_privacy(pgB)
    signed_in_b = 'auth-gate' not in (pgB.get_attribute('body', 'class') or '')
    if not signed_in_b:
        pgB.wait_for_selector('#loginUser', timeout=8000)
        pgB.fill('#loginUser', 'Mo'); pgB.fill('#loginPass', 'owner-pass-99')
        pgB.locator('[data-action="do-login"]').click()
        pgB.wait_for_timeout(4500)
        signed_in_b = 'auth-gate' not in (pgB.get_attribute('body', 'class') or '')
    log('item1 tab B signed in: ' + ('PASS' if signed_in_b else 'FAIL'))

    # B edits a student (the "newer" write)
    pgB.goto(BASE + '/app/index.html#/students'); pgB.wait_for_timeout(900)
    inp_b = pgB.locator('[data-stufield="nameEn"]').first
    b_before = inp_b.input_value()
    inp_b.fill(b_before + '-B')
    inp_b.dispatch_event('change')
    pgB.wait_for_timeout(2500)   # debounce 300ms + PBKDF2-free local save + settle
    log('item1 tab B edited first student to: ' + b_before + '-B')

    # A (stale copy of B's edit) edits another student
    pgA.wait_for_timeout(500)
    inp_a = pgA.locator('[data-stufield="nameEn"]').nth(1)
    inp_a.fill('Stale-Edit')
    inp_a.dispatch_event('change')
    pgA.wait_for_timeout(1500)
    overlay = pgA.locator('#spr-stale').count()
    stale_msg = pgA.locator('#spr-stale').inner_text() if overlay else ''
    log('item1 stale tab A got the overlay: ' + ('PASS — ' + stale_msg.replace('\n', ' ')[:70] if overlay else 'FAIL'))
    pgA.screenshot(path=os.path.join(OUT, 'chromium-stale-overlay.png'))
    # and B's edit survived in storage: reload A and check
    pgA.reload(); pgA.wait_for_timeout(3000)
    ack_privacy(pgA); pgA.wait_for_timeout(1500)
    try:
        pgA.goto(BASE + '/app/index.html#/students'); pgA.wait_for_timeout(1200)
        vals = pgA.locator('[data-stufield="nameEn"]').evaluate_all('els => els.map(e => e.value)')
        survived = any(v.endswith('-B') for v in vals)
        log('item1 newer write survived (B edit present after stale tab): ' + ('PASS' if survived else 'FAIL — ' + repr(vals[:6])))
    except Exception as e:
        log('item1 survival check error: ' + str(e).splitlines()[0])

    # ---------- item 2: quota banner ----------
    pgC = ctx.new_page()
    pgC.add_init_script("""
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'p4c4-markbook-v2') { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
        return orig.call(this, k, v);
      };""")
    pgC.on('pageerror', lambda e: errors.append('C: ' + str(e)[:120]))
    pgC.goto(BASE + '/app/index.html#/dashboard'); pgC.wait_for_timeout(1500)
    ack_privacy(pgC)
    try:
        pgC.wait_for_selector('#loginUser', timeout=6000)
        pgC.fill('#loginUser', 'Mo'); pgC.fill('#loginPass', 'owner-pass-99')
        pgC.locator('[data-action="do-login"]').click(); pgC.wait_for_timeout(4500)
    except Exception:
        pass
    pgC.goto(BASE + '/app/index.html#/students'); pgC.wait_for_timeout(1000)
    inp_c = pgC.locator('[data-stufield="nameEn"]').first
    inp_c.fill('Quota-Test')
    inp_c.dispatch_event('change')
    pgC.wait_for_timeout(1500)
    banner = pgC.locator('#saveAlert').count()
    banner_txt = pgC.locator('#saveAlert').inner_text() if banner else ''
    has_btn = banner and pgC.locator('#saveAlert [data-action="dl-backup"]').count() > 0
    log('item2 NOT-SAVED banner on quota failure: ' + ('PASS — ' + banner_txt.replace('\n', ' ')[:60] if banner and 'NOT SAVED' in banner_txt.upper() else 'FAIL'))
    log('item2 banner has Download backup button: ' + ('PASS' if has_btn else 'FAIL'))
    pgC.screenshot(path=os.path.join(OUT, 'chromium-notsaved-banner.png'))
    ctx.close()

    # ---------- item 8: reset.html gate ----------
    ctx = browser.new_context(accept_downloads=True)
    pgD = ctx.new_page()
    pgD.on('pageerror', lambda e: errors.append('D: ' + str(e)[:120]))
    pgD.goto(BASE + '/reset.html'); pgD.wait_for_timeout(500)
    wipe = pgD.locator('#wipe')
    disabled0 = wipe.is_disabled()
    pgD.fill('#erase-confirm', 'DELETE')
    pgD.wait_for_timeout(200)
    still = wipe.is_disabled()
    with pgD.expect_download() as dl_info:
        pgD.locator('#save').click()
    dl = dl_info.value
    dl.save_as(os.path.join(OUT, 'raw-copy-download.json'))
    pgD.fill('#erase-confirm', 'ERASE')
    pgD.wait_for_timeout(200)
    armed = not wipe.is_disabled()
    log('item8 wipe starts disabled: ' + ('PASS' if disabled0 else 'FAIL'))
    log('item8 wrong word keeps it disabled: ' + ('PASS' if still else 'FAIL'))
    log('item8 raw copy downloads first: ' + ('PASS — ' + dl.suggested_filename if os.path.getsize(os.path.join(OUT, 'raw-copy-download.json')) > 2 else 'FAIL'))
    log('item8 typed ERASE + saved copy arms the wipe: ' + ('PASS' if armed else 'FAIL'))
    pgD.screenshot(path=os.path.join(OUT, 'chromium-reset-gate.png'))
    ctx.close()
    browser.close()

    log('')
    log('page errors across all tabs: ' + (str(len(errors)) if not errors else str(len(errors)) + ' -> ' + ' | '.join(errors[:4])))

with open(os.path.join(OUT, 'evidence-chromium.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(log_lines) + '\n')
print('evidence written')
